// Dedicated WebSocket server for SSH terminal connections
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const crypto = require('crypto');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

// Ensure transcripts directory exists
const transcriptsDir = path.join(__dirname, '..', 'transcripts');
if (!fs.existsSync(transcriptsDir)) {
  fs.mkdirSync(transcriptsDir, { recursive: true });
}

// Track transcript metadata
let transcriptsMetadata = [];
const transcriptsMetadataPath = path.join(__dirname, '..', 'terminal_transcripts.json');

// Load existing transcript metadata if available
if (fs.existsSync(transcriptsMetadataPath)) {
  try {
    const data = fs.readFileSync(transcriptsMetadataPath, 'utf8');
    const json = JSON.parse(data);
    transcriptsMetadata = json.transcripts || [];
  } catch (err) {
    console.error('Error loading transcript metadata:', err);
    transcriptsMetadata = [];
  }
} else {
  // Initialize with empty array
  fs.writeFileSync(transcriptsMetadataPath, JSON.stringify({ transcripts: [] }), 'utf8');
}

// Create Express app
const app = express();
app.use(cors());
app.use(express.json());

// Create HTTP server
const server = http.createServer(app);

// Create WebSocket server
const wss = new WebSocket.Server({ server });

// In-memory session store (would be replaced with Redis in production)
const sessions = new Map();

// Command buffer for each session to collect keystrokes until Enter is pressed
const commandBuffers = new Map();

// Track REPL environment states
const replEnvironments = new Map();

// Pending command flags - only record commands after Enter key
const pendingCommands = new Map();

// Transcript handling functions
function createTranscript(sessionId, session) {
  const timestamp = new Date().toISOString();
  const filename = `${sessionId}.log`;
  const filePath = path.join(transcriptsDir, filename);
  
  // Create transcript metadata
  const transcript = {
    id: sessionId,
    filename,
    host: session.host,
    username: session.username,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
  };
  
  // Add header to transcript file
  const header = `# Terminal Transcript\n# Session ID: ${sessionId}\n# Host: ${session.host}\n# User: ${session.username}\n# Started: ${timestamp}\n\n`;
  fs.writeFileSync(filePath, header, 'utf8');
  
  // Save transcript metadata
  transcriptsMetadata.push(transcript);
  saveTranscriptsMetadata();
  
  console.log(`Created transcript for session ${sessionId}`);
  return transcript;
}

function appendToTranscript(sessionId, source, data) {
  const timestamp = new Date().toISOString();
  const filePath = path.join(transcriptsDir, `${sessionId}.log`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Transcript file not found for session ${sessionId}`);
    const session = sessions.get(sessionId);
    if (session) {
      createTranscript(sessionId, session);
    } else {
      return false;
    }
  }
  
  // Format the data with timestamp and direction indicator
  const formattedData = `[${timestamp}] [${source}] ${data.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}\n`;
  
  // Append to transcript file
  fs.appendFileSync(filePath, formattedData, 'utf8');
  
  // Update last updated timestamp
  const transcriptIndex = transcriptsMetadata.findIndex(t => t.id === sessionId);
  if (transcriptIndex >= 0) {
    transcriptsMetadata[transcriptIndex].lastUpdatedAt = timestamp;
    saveTranscriptsMetadata();
  }
  
  return true;
}

function saveTranscriptsMetadata() {
  try {
    fs.writeFileSync(
      transcriptsMetadataPath, 
      JSON.stringify({ transcripts: transcriptsMetadata }, null, 2), 
      'utf8'
    );
  } catch (err) {
    console.error('Error saving transcript metadata:', err);
  }
}

// Utility to create a unique session ID
function generateSessionId() {
  return crypto.randomBytes(16).toString('hex');
}

// Setup WebSocket connection handler
wss.on('connection', (ws) => {
  console.log('WebSocket client connected');
  let sessionId = null;
  let sshStream = null;

  // Handle messages from client
  ws.on('message', (message) => {
    try {
      const data = JSON.parse(message);
      console.log('Received message:', data.type);

      // Handle different message types
      switch (data.type) {
        case 'join':
          handleJoinSession(data.sessionId, ws);
          sessionId = data.sessionId;
          break;
          
        case 'input':
          handleTerminalInput(sessionId, data.data, ws);
          break;
          
        case 'resize':
          handleTerminalResize(sessionId, data.cols, data.rows, ws);
          break;
          
        default:
          console.log('Unknown message type:', data.type);
      }
    } catch (err) {
      console.error('Error processing message:', err);
      sendError(ws, 'Failed to process message');
    }
  });

  // Handle client disconnect
  ws.on('close', () => {
    console.log('WebSocket client disconnected');
    if (sessionId) {
      cleanupSession(sessionId);
    }
  });

  // Handle errors
  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
    cleanupSession(sessionId);
  });
});

// Handle client joining a session
function handleJoinSession(sessionId, ws) {
  const session = sessions.get(sessionId);
  
  if (!session) {
    return sendError(ws, 'Session not found');
  }
  
  console.log(`Client joined session: ${sessionId}`);
  
  // Create transcript for this session if not already created
  const transcriptExists = transcriptsMetadata.some(t => t.id === sessionId);
  if (!transcriptExists) {
    createTranscript(sessionId, session);
  }
  
  // Record connection in transcript
  appendToTranscript(sessionId, 'SYSTEM', 'Client connected to session');
  
  // Attach this WebSocket to the session
  session.websockets = session.websockets || [];
  session.websockets.push(ws);
  
  // If the session has an SSH stream, pipe it to this new client
  if (session.stream) {
    // Send any buffered output
    if (session.outputBuffer && session.outputBuffer.length > 0) {
      ws.send(JSON.stringify({
        type: 'output',
        data: session.outputBuffer
      }));
    }
  } else {
    // No stream yet, create SSH connection
    createSshConnection(sessionId, ws);
  }
}

// Helper function to detect if session is in a REPL environment
function detectReplEnvironment(sessionId, output) {
  // Check for common REPL prompts
  if (output.includes('>>> ') || output.includes('... ')) {
    // Python REPL
    replEnvironments.set(sessionId, 'python');
    return true;
  } 
  else if (output.includes('> ') && (output.includes('node') || output.match(/js>\s*$/))) {
    // Node.js REPL
    replEnvironments.set(sessionId, 'node');
    return true;
  }
  else if (output.match(/irb\([0-9:]+\)[>*]\s*$/)) {
    // Ruby IRB
    replEnvironments.set(sessionId, 'ruby');
    return true;
  }
  else if (output.match(/scala>\s*$/)) {
    // Scala REPL
    replEnvironments.set(sessionId, 'scala');
    return true;
  }
  else if (output.match(/ghci>\s*$/)) {
    // Haskell GHCi
    replEnvironments.set(sessionId, 'haskell');
    return true;
  }
  // Detect any interactive environments with command suggestions or box displays
  else if (output.includes('╭') && output.includes('╰')) {
    // Any command suggestion interface or interactive prompt with box characters
    replEnvironments.set(sessionId, 'interactive');
    console.log(`Detected interactive interface for session ${sessionId}`);
    return true;
  }
  
  // Reset REPL state if we detect shell prompt
  if (output.match(/[$#%>]\s*$/) || output.match(/[a-z]+@[a-z0-9\-\.]+:[~\/][^\s\n]*[$#%]/i)) {
    // But only if we're not in a clearly identified REPL
    const currentType = replEnvironments.get(sessionId);
    if (currentType !== 'python' && currentType !== 'node' && 
        currentType !== 'ruby' && currentType !== 'scala' && 
        currentType !== 'haskell') {
      replEnvironments.delete(sessionId);
      return false;
    }
  }
  
  // Continue with current detection state
  return replEnvironments.has(sessionId);
}

// Handle terminal input
function handleTerminalInput(sessionId, data, ws) {
  const session = sessions.get(sessionId);
  
  if (!session || !session.stream) {
    return sendError(ws, 'Session not connected');
  }
  
  try {
    // Initialize command buffer for session if needed
    if (!commandBuffers.has(sessionId)) {
      commandBuffers.set(sessionId, '');
    }
    
    // Check if this session is in a REPL environment
    const isReplEnvironment = replEnvironments.has(sessionId);
    
    // Get the current buffer
    let currentBuffer = commandBuffers.get(sessionId);
    
    // Check if Enter key is detected
    const hasEnterKey = data.includes('\r') || data.includes('\n');
    
    // If this is a REPL environment, we use a different approach:
    // We collect all keystrokes in the buffer but NEVER record them
    // until an Enter key is pressed
    if (isReplEnvironment) {
      // For REPL environments, accumulate keystrokes but don't record anything yet
      
      // This is the key insight: Only add to the transcript when Enter is pressed
      if (hasEnterKey) {
        // Split the data by newline to handle the part before Enter
        const parts = data.split(/[\r\n]/);
        if (parts[0]) {
          currentBuffer += parts[0];
        }
        
        // If we have a non-empty command, record it now
        if (currentBuffer.trim()) {
          // Record the complete REPL command and log it
          console.log(`Recording complete REPL command: [${currentBuffer.trim()}]`);
          appendToTranscript(sessionId, 'REPL_COMMAND', currentBuffer.trim());
          
          // Set a flag indicating we just recorded a command - prevents duplicate recording
          pendingCommands.set(sessionId, false);
        }
        
        // Reset buffer for next command, keeping any text after the Enter
        commandBuffers.set(sessionId, parts[1] || '');
      }
      // Handle backspace by removing the last character from buffer
      else if (data === '\b' || data === '\x7f') {
        if (currentBuffer.length > 0) {
          // Remove last character
          currentBuffer = currentBuffer.slice(0, -1);
          commandBuffers.set(sessionId, currentBuffer);
        }
      }
      // For regular keystrokes, just add to buffer without recording
      else {
        // Add keystroke to buffer
        currentBuffer += data;
        commandBuffers.set(sessionId, currentBuffer);
        
        // Set a pending flag to indicate we're collecting keystrokes
        pendingCommands.set(sessionId, true);
      }
    } 
    // Regular shell handling (non-REPL environment)
    else {
      // For shell commands, we also collect until Enter key is pressed
      if (hasEnterKey) {
        // Get any content before the Enter key
        const parts = data.split(/[\r\n]/);
        if (parts[0]) {
          currentBuffer += parts[0];
        }
        
        // If we have a non-empty command, record it
        if (currentBuffer.trim()) {
          console.log(`Recording complete shell command: [${currentBuffer.trim()}]`);
          appendToTranscript(sessionId, 'COMMAND', currentBuffer.trim());
          
          // Clear pending flag
          pendingCommands.set(sessionId, false);
        }
        
        // Reset buffer for next command
        commandBuffers.set(sessionId, parts[1] || '');
      } 
      // Handle backspace
      else if (data === '\b' || data === '\x7f') {
        if (currentBuffer.length > 0) {
          currentBuffer = currentBuffer.slice(0, -1);
          commandBuffers.set(sessionId, currentBuffer);
        }
      }
      // Regular keystroke
      else {
        currentBuffer += data;
        commandBuffers.set(sessionId, currentBuffer);
        
        // Set pending flag
        pendingCommands.set(sessionId, true); 
      }
    }
    
    // Send to terminal
    session.stream.write(data);
  } catch (err) {
    console.error('Error writing to SSH stream:', err);
    sendError(ws, 'Failed to send input to terminal');
  }
}

// Handle terminal resize
function handleTerminalResize(sessionId, cols, rows, ws) {
  const session = sessions.get(sessionId);
  
  if (!session || !session.stream) {
    return;
  }
  
  try {
    session.stream.setWindow(rows, cols);
    console.log(`Resized terminal for session ${sessionId}: ${cols}x${rows}`);
  } catch (err) {
    console.error('Error resizing terminal:', err);
  }
}

// Create SSH connection for session
function createSshConnection(sessionId, ws) {
  const session = sessions.get(sessionId);
  
  if (!session) {
    return sendError(ws, 'Session not found');
  }
  
  // If in demo mode, create a simulated terminal
  if (session.demoMode) {
    console.log(`Creating demo terminal for session ${sessionId}`);
    createDemoTerminal(sessionId, ws);
    return;
  }
  
  console.log(`Creating SSH connection for session ${sessionId}: ${session.username}@${session.host}`);
  
  // Create SSH client
  const conn = new Client();
  session.client = conn;
  
  // Configure authentication
  const config = {
    host: session.host,
    port: session.port || 22,
    username: session.username,
    // For development only - disable strict host key checking
    algorithms: {
      serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519']
    }
  };
  
  // Set authentication method
  if (session.authMethod === 'password') {
    config.password = session.password;
  } else if (session.authMethod === 'key') {
    config.privateKey = session.privateKey;
  }
  
  // Handle connection events
  conn.on('ready', () => {
    console.log(`SSH connection established: ${session.username}@${session.host}:${session.port}`);
    
    // Request a pseudo-terminal
    conn.shell((err, stream) => {
      if (err) {
        conn.end();
        return sendError(ws, `Failed to create terminal: ${err.message}`);
      }
      
      // Store stream in session
      session.stream = stream;
      
      // Initialize output buffer
      session.outputBuffer = '';
      const MAX_BUFFER_SIZE = 100000; // Limit buffer size to prevent memory issues
      
      // Forward SSH output to all connected clients
      stream.on('data', (data) => {
        const output = data.toString('utf-8');
        
        // Detect if we are in a REPL environment based on output patterns
        detectReplEnvironment(sessionId, output);
        
        // Record output to transcript
        appendToTranscript(sessionId, 'OUTPUT', output);
        
        // Store in buffer (with size limit)
        session.outputBuffer += output;
        if (session.outputBuffer.length > MAX_BUFFER_SIZE) {
          session.outputBuffer = session.outputBuffer.substring(
            session.outputBuffer.length - MAX_BUFFER_SIZE
          );
        }
        
        // Send to all connected websockets
        broadcastToSession(sessionId, 'output', output);
      });
      
      stream.stderr.on('data', (data) => {
        const errorText = data.toString('utf-8');
        
        // Record error to transcript
        appendToTranscript(sessionId, 'ERROR', errorText);
        
        broadcastToSession(sessionId, 'error', errorText);
      });
      
      stream.on('close', () => {
        // Record session closure in transcript
        appendToTranscript(sessionId, 'SYSTEM', 'Terminal session closed');
        
        broadcastToSession(sessionId, 'closed');
        cleanupSession(sessionId);
      });
    });
  });
  
  conn.on('error', (err) => {
    console.error(`SSH connection error: ${err.message}`);
    sendError(ws, `SSH connection error: ${err.message}`);
    cleanupSession(sessionId);
  });
  
  // Attempt to connect
  try {
    conn.connect(config);
  } catch (err) {
    console.error(`Failed to connect: ${err.message}`);
    sendError(ws, `Failed to connect: ${err.message}`);
    cleanupSession(sessionId);
  }
}

// Create a demo terminal that simulates SSH
function createDemoTerminal(sessionId, ws) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  // Initialize output buffer
  session.outputBuffer = '';
  
  // Simulate an SSH stream with an EventEmitter
  const EventEmitter = require('events');
  const stream = new EventEmitter();
  
  // Add methods to make it behave like a stream
   stream.stderr = new EventEmitter(); // Add stderr emitter
   stream.write = (data) => {
    console.log(`Demo terminal received: ${data}`);
    
    // Echo back what was typed, simulating a terminal
    if (data.includes('\r')) {
      // Command execution simulation
      const command = data.trim();
      
      // Wait a bit before responding
      setTimeout(() => {
        if (command === 'python' || command === 'node') {
          // Enter REPL mode
          replEnvironments.set(sessionId, command);
          
          if (command === 'python') {
            stream.emit('data', '\r\nPython 3.9.5 (Demo Mode)\r\n>>> ');
          } else if (command === 'node') {
            stream.emit('data', '\r\nWelcome to Node.js v16.13.0 (Demo Mode)\r\n> ');
          }
        } 
        else if (command === 'exit' && replEnvironments.has(sessionId)) {
          // Exit REPL mode
          const replType = replEnvironments.get(sessionId);
          stream.emit('data', `\r\nExiting ${replType}...\r\n`);
          replEnvironments.delete(sessionId);
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        }
        else if (replEnvironments.has(sessionId)) {
          // Handle REPL input
          const replType = replEnvironments.get(sessionId);
          
          if (replType === 'python') {
            if (command === 'print("hello")') {
              stream.emit('data', '\r\nhello\r\n>>> ');
            } else if (command.startsWith('for ')) {
              stream.emit('data', '\r\n... ');
            } else {
              stream.emit('data', '\r\n>>> ');
            }
          } else if (replType === 'node') {
            if (command === 'console.log("hello")') {
              stream.emit('data', '\r\nhello\r\nundefined\r\n> ');
            } else if (command.startsWith('function')) {
              stream.emit('data', '\r\nundefined\r\n> ');
            } else {
              // Evaluate simple expressions
              try {
                let result = command;
                if (command.match(/^[0-9+\-*/() ]+$/)) {
                  // Simple arithmetic
                  result = eval(command);
                }
                stream.emit('data', `\r\n${result}\r\n> `);
              } catch {
                stream.emit('data', '\r\n> ');
              }
            }
          }
        }
        else if (command.startsWith('ls')) {
          stream.emit('data', '\r\nDEMO MODE - Simulated directory listing:\r\n');
          stream.emit('data', 'file1.txt  file2.txt  folder1/  folder2/\r\n');
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command.startsWith('pwd')) {
          stream.emit('data', '\r\n/home/demo\r\n');
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command.startsWith('whoami')) {
          stream.emit('data', '\r\ndemo-user\r\n');
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command.startsWith('date')) {
          stream.emit('data', `\r\n${new Date().toString()}\r\n`);
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command.startsWith('echo')) {
          stream.emit('data', `\r\n${command.substring(5)}\r\n`);
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command.startsWith('help')) {
          stream.emit('data', '\r\nDEMO MODE - Available commands:\r\n');
          stream.emit('data', 'ls, pwd, whoami, date, echo, help, python, node\r\n');
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else if (command) {
          stream.emit('data', `\r\nCommand not found: ${command}\r\nType 'help' to see available commands.\r\n`);
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        } else {
          // Just enter, show new prompt
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        }
        
      }, 300);
    } else {
      // Echo back characters as if typed in real terminal
      stream.emit('data', data);
    }
    return true;
  };
  
  stream.setWindow = (rows, cols) => {
    console.log(`Demo terminal resized to ${cols}x${rows}`);
    return true;
  };
  
  stream.close = () => {
    stream.emit('close');
    return true;
  };
  
  // Store the stream in the session
  session.stream = stream;
  
  // Send welcome message
  setTimeout(() => {
    const welcomeMessage = 'Welcome to Demo Terminal\r\n' +
      'This is a simulated SSH terminal for testing purposes.\r\n' +
      'Type "help" to see available commands.\r\n\r\n' +
      'demo@localhost:~$ ';
      
    session.outputBuffer += welcomeMessage;
    // Log raw output for demo
    appendToTranscript(sessionId, 'OUTPUT', welcomeMessage);
    broadcastToSession(sessionId, 'output', welcomeMessage);
  }, 500);
  
  // Setup event handlers
   stream.on('data', (data) => {
        const rawOutput = data.toString('utf-8');
        appendToTranscript(sessionId, 'OUTPUT', rawOutput);
        session.outputBuffer += rawOutput;
        if (session.outputBuffer.length > 10000) { // Simple buffer limit for demo
            session.outputBuffer = session.outputBuffer.slice(-10000);
        }
        broadcastToSession(sessionId, 'output', rawOutput);
   });

   stream.stderr.on('data', (data) => {
        const rawError = data.toString('utf-8');
        appendToTranscript(sessionId, 'ERROR', rawError);
        broadcastToSession(sessionId, 'error', rawError);
   });

  stream.on('close', () => {
    appendToTranscript(sessionId, 'SYSTEM', 'Demo terminal closed');
    broadcastToSession(sessionId, 'closed');
    cleanupSession(sessionId);
  });
}

// Broadcast a message to all websockets in a session
function broadcastToSession(sessionId, type, data) {
  const session = sessions.get(sessionId);
  if (!session || !session.websockets) return;
  
  const message = JSON.stringify({ type, data });
  
  // Send to all connected websockets
  session.websockets.forEach((ws) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(message);
    }
  });
}

// Send an error message to a client
function sendError(ws, message) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      type: 'error',
      data: message
    }));
  }
}

// Clean up a session when it's no longer needed
function cleanupSession(sessionId) {
  const session = sessions.get(sessionId);
  if (!session) return;
  
  console.log(`Cleaning up session ${sessionId}`);
  
  // Clean up command buffer if there's any pending command
  if (commandBuffers.has(sessionId) && pendingCommands.get(sessionId)) {
    const remainingBuffer = commandBuffers.get(sessionId);
    
    // If there's any buffered command input left, record it before cleaning up
    if (remainingBuffer && remainingBuffer.trim()) {
      // Check if we're in a REPL environment to determine command type
      const isInRepl = replEnvironments.has(sessionId);
      const eventType = isInRepl ? 'REPL_COMMAND' : 'COMMAND';
      
      // Mark as incomplete since the user didn't press Enter
      console.log(`Recording incomplete ${eventType}: [${remainingBuffer.trim()}]`);
      appendToTranscript(sessionId, eventType, remainingBuffer.trim() + ' (incomplete)');
    }
    
    // Clear the command buffer
    commandBuffers.delete(sessionId);
  }
  
  // Clean up pending command flags
  if (pendingCommands.has(sessionId)) {
    pendingCommands.delete(sessionId);
  }
  
  // Clean up REPL environment tracking
  if (replEnvironments.has(sessionId)) {
    const replType = replEnvironments.get(sessionId);
    console.log(`Cleaning up REPL environment (${replType}) for session ${sessionId}`);
    replEnvironments.delete(sessionId);
  }
  
  // Close SSH client if it exists
  if (session.client) {
    try {
      session.client.end();
    } catch (err) {
      console.error('Error closing SSH client:', err);
    }
    session.client = null;
  }
  
  // Close stream if it exists
  if (session.stream) {
    try {
      session.stream.close();
    } catch (err) {
      console.error('Error closing stream:', err);
    }
    session.stream = null;
  }
  // Remove session itself
  sessions.delete(sessionId);
}

// API endpoint to list active sessions
app.get('/api/sessions', (req, res) => {
  try {
    const { id } = req.query;
    
    // If ID is provided, return that specific session
    if (id) {
      const session = sessions.get(id);
      
      if (!session) {
        // If session not found in memory, try to find in transcript metadata
        console.log(`Session ${id} not found in active sessions, checking transcripts...`);
        const transcript = transcriptsMetadata.find(t => t.id === id);
        
        if (transcript) {
          console.log(`Found transcript for session ${id}, returning info for reconnection`);
          // Return session info derived from transcript
          return res.json({
            success: true,
            session: {
              id: transcript.id,
              host: transcript.host,
              username: transcript.username,
              createdAt: transcript.createdAt,
              lastUpdatedAt: transcript.lastUpdatedAt,
              active: false,
              recovered: true
            }
          });
        }
        
        return res.status(404).json({ success: false, error: 'Session not found' });
      }
      
      const sessionInfo = {
        id,
        host: session.host,
        username: session.username,
        createdAt: session.createdAt || new Date().toISOString(),
        active: !!session.stream
      };
      
      return res.json({ success: true, session: sessionInfo });
    }
    
    // Otherwise, return all sessions
    const sessionList = Array.from(sessions.entries()).map(([id, session]) => {
      return {
        id,
        host: session.host,
        username: session.username,
        createdAt: session.createdAt || new Date().toISOString(),
        active: !!session.stream
      };
    });
    
    res.json({ success: true, sessions: sessionList });
  } catch (error) {
    console.error('Error listing sessions:', error);
    res.status(500).json({ success: false, error: 'Failed to list sessions' });
  }
});

// API endpoint to get transcripts
// Function to process raw transcript content and return a clean version
// focusing on commands entered and their corresponding output.
function getCleanTranscriptContent(rawContent) {
  if (!rawContent) return '';
  
  // Parse each line
  const lines = rawContent.split('\n');
  const cleanLines = [];
  
  // Track commands and outputs by timestamp
  const eventsByTimestamp = new Map();
  
  // Pass 1: Collect relevant events (COMMAND, REPL_COMMAND, OUTPUT, ERROR, SYSTEM)
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line || line.startsWith('#')) continue; // Skip empty lines and headers
    
    // Parse the line format: [timestamp] [type] content
    const match = line.match(/^\[([^\]]+)\] \[([A-Z_]+)\] (.*)$/);
    if (!match) continue;
    
    const [, timestamp, type, content] = match;
    
    // Ignore INPUT events completely
    if (type === 'INPUT') {
      continue;
    }
    
    // Format the timestamp
    const date = new Date(timestamp);
    const formattedTimestamp = date.toLocaleString();
    
    // Initialize data structure for this timestamp if needed
    if (!eventsByTimestamp.has(formattedTimestamp)) {
      eventsByTimestamp.set(formattedTimestamp, []);
    }
    
    // Add the relevant event
    eventsByTimestamp.get(formattedTimestamp).push({ type, content });
  }
  
  // Pass 2: Build the clean transcript
  const timestamps = [...eventsByTimestamp.keys()].sort((a, b) => {
    return new Date(a) - new Date(b);
  });
  
  for (const timestamp of timestamps) {
    const events = eventsByTimestamp.get(timestamp);
    
    if (events && events.length > 0) {
      cleanLines.push(`[${timestamp}]`);
      
      for (const event of events) {
        // Format commands with '$'
        if (event.type === 'COMMAND' || event.type === 'REPL_COMMAND') {
          const cleanCommand = event.content.replace(/\\r/g, '').replace(/\\n/g, '');
          if (cleanCommand.trim()) {
            cleanLines.push(`$ ${cleanCommand.trim()}`);
          }
        } 
        // Display OUTPUT, ERROR, SYSTEM directly after cleaning
        else if (event.type === 'OUTPUT' || event.type === 'ERROR' || event.type === 'SYSTEM') {
          const cleanContent = event.content.replace(/\\r/g, '\r').replace(/\\n/g, '\n');
          if (cleanContent.trim()) {
            // Add type prefix for ERROR and SYSTEM for clarity
            const prefix = (event.type === 'ERROR' || event.type === 'SYSTEM') ? `[${event.type}] ` : '';
            cleanLines.push(prefix + cleanContent);
          }
        }
      }
      // Add blank line for readability between timestamp blocks
      cleanLines.push(''); 
    }
  }
  
  // Join lines and trim any excess whitespace
  return cleanLines.join('\n').trim();
}

app.get('/api/transcripts', (req, res) => {
  try {
    const { id, clean } = req.query;
    
    // If ID is provided, return that specific transcript content
    if (id) {
      const filePath = path.join(transcriptsDir, `${id}.log`);
      
      if (!fs.existsSync(filePath)) {
        return res.status(404).json({ error: 'Transcript not found' });
      }
      
      const rawContent = fs.readFileSync(filePath, 'utf8');
      
      // Use the formatter utility
       try {
           // Dynamically import the formatter
          import('../utils/transcriptFormatter.js').then(formatterModule => {
               const formattedContent = formatterModule.formatTranscript(rawContent);
               return res.status(200).json({ content: formattedContent });
          }).catch(importErr => {
               console.error('Error importing/using transcript formatter:', importErr);
               // Fallback gracefully if formatter fails
               return res.status(200).json({ content: rawContent, warning: 'Formatter failed, showing raw content.' });
           });
       } catch (formatErr) {
           console.error('Error in formatting logic:', formatErr);
           return res.status(200).json({ content: rawContent, warning: 'Formatter error, showing raw content.' });
       }
       return; // Important: Prevent sending response twice due to async import
    }
    
    // Otherwise, return all transcript metadata
    return res.status(200).json({ transcripts: transcriptsMetadata });
  } catch (error) {
    console.error('Error retrieving transcripts:', error);
    return res.status(500).json({ error: 'Failed to retrieve transcripts' });
  }
});

// API endpoint to delete a transcript
app.delete('/api/transcripts', (req, res) => {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Transcript ID is required' });
    }
    
    const filePath = path.join(transcriptsDir, `${id}.log`);
    
    // Delete file if exists
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
    
    // Remove from metadata
    const index = transcriptsMetadata.findIndex(t => t.id === id);
    if (index >= 0) {
      transcriptsMetadata.splice(index, 1);
      saveTranscriptsMetadata();
    }
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    return res.status(500).json({ error: 'Failed to delete transcript' });
  }
});

// API endpoint to create a new session
app.post('/api/sessions', (req, res) => {
  try {
    const { host, port, username, authMethod, password, privateKey, demoMode } = req.body;
    
    console.log(`Received SSH connection request:`, {
      host,
      port,
      username,
      authMethod,
      hasPassword: !!password,
      hasPrivateKey: !!privateKey,
      demoMode
    });
    
    // Validate required fields
    if (!host || !username) {
      return res.status(400).json({ error: 'Host and username are required' });
    }
    
    // Validate auth method
    if (authMethod === 'password' && !password) {
      return res.status(400).json({ error: 'Password is required for password authentication' });
    } else if (authMethod === 'key' && !privateKey && !demoMode) {
      return res.status(400).json({ error: 'Private key is required for key authentication' });
    }
    
    // Generate a session ID
    const sessionId = generateSessionId();
    
    // Create and store the session
    const session = {
      id: sessionId,
      host,
      port: port || 22,
      username,
      authMethod,
      password: authMethod === 'password' ? password : null,
      privateKey: authMethod === 'key' ? privateKey : null,
      demoMode: !!demoMode,
      createdAt: new Date().toISOString(),
      websockets: []
    };
    
    sessions.set(sessionId, session);
    console.log(`Session created: ${sessionId}`);
    
    // Return the session ID to the client
    return res.status(201).json({ sessionId });
  } catch (error) {
    console.error('Error creating session:', error);
    return res.status(500).json({ error: 'Failed to create session' });
  }
});

// API endpoint to delete a session
app.delete('/api/sessions/:sessionId', (req, res) => {
  try {
    const { sessionId } = req.params;
    
    // Check if session exists
    if (!sessions.has(sessionId)) {
      return res.status(404).json({ error: 'Session not found' });
    }
    
    // Clean up the session
    cleanupSession(sessionId);
    
    // Remove from sessions store
    sessions.delete(sessionId);
    
    console.log(`Session deleted: ${sessionId}`);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting session:', error);
    return res.status(500).json({ error: 'Failed to delete session' });
  }
});

// Start the server
const PORT = process.env.PORT || 3001;
server.listen(PORT, () => {
  console.log(`WebSocket server running on port ${PORT}`);
});
