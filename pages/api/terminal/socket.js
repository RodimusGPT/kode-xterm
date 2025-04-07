import { Server } from 'socket.io';
import { Client } from 'ssh2';
import { getSession, setSession } from '../../../lib/sessionStore';
import { createTranscript, appendToTranscript, getTranscriptMetadata } from '../../../lib/transcriptStore';

// Create a demo terminal stream that doesn't require actual SSH
function createDemoStream(isDemoFallback = false) {
  const { EventEmitter } = require('events');
  const stream = new EventEmitter();
  
  // Log whether this is an intentional demo or fallback
  console.log(`Creating ${isDemoFallback ? 'fallback' : 'intentional'} demo stream`);
  
  // Add methods to simulate a readable/writable stream
  stream.write = (data) => {
    console.log(`Demo terminal received: ${data}`);
    
    // Use an arbitrary sessionId for demo mode
    const demoSessionId = 'demo-session';
    
    // Echo back what was typed, simulating a terminal
    if (data.includes('\r')) {
      // Command execution simulation
      const command = data.trim();
      
      // Wait a bit before responding
      setTimeout(() => {
        if (command === 'python' || command === 'node') {
          // Enter REPL mode
          global.REPL_ENVIRONMENTS.set(demoSessionId, command);
          console.log(`Demo mode: Entering ${command} REPL environment`);
          
          if (command === 'python') {
            stream.emit('data', '\r\nPython 3.9.5 (Demo Mode)\r\n>>> ');
          } else if (command === 'node') {
            stream.emit('data', '\r\nWelcome to Node.js v16.13.0 (Demo Mode)\r\n> ');
          }
        } 
        else if (command === 'exit' && global.REPL_ENVIRONMENTS.has(demoSessionId)) {
          // Exit REPL mode
          const replType = global.REPL_ENVIRONMENTS.get(demoSessionId);
          stream.emit('data', `\r\nExiting ${replType}...\r\n`);
          global.REPL_ENVIRONMENTS.delete(demoSessionId);
          stream.emit('data', '\r\ndemo@localhost:~$ ');
        }
        else if (global.REPL_ENVIRONMENTS.has(demoSessionId)) {
          // Handle REPL input
          const replType = global.REPL_ENVIRONMENTS.get(demoSessionId);
          
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
  
  // Emit initial prompt
  setTimeout(() => {
    stream.emit('data', 'Welcome to Demo Terminal\r\n');
    stream.emit('data', 'This is a simulated SSH terminal for testing purposes.\r\n');
    stream.emit('data', 'Type "help" to see available commands.\r\n\r\n');
    stream.emit('data', 'demo@localhost:~$ ');
  }, 500);
  
  // Add stderr for completeness
  stream.stderr = new EventEmitter();
  
  return stream;
}

// Create SSH connection for the given session ID
async function createSshConnection(sessionId) {
  // Access the persistent session store
  const session = getSession(sessionId);
  
  console.log(`Attempting to create SSH connection for session ID: ${sessionId}`);
  
  if (!session) {
    console.error(`Session not found for ID: ${sessionId}`);
    console.error('Session not found and not in demo mode');
    throw new Error('SSH session not found');
  }
  
  console.log(`Creating SSH connection for session ${sessionId}: ${session.username}@${session.host}`);
  
  // Check if we're in demo mode
  if (session.demoMode) {
    console.log('Using DEMO mode - no actual SSH connection will be made');
    const demoStream = createDemoStream();
    session.stream = demoStream;
    setSession(sessionId, session);
    return demoStream;
  }
  
  // Real SSH connection code
  return new Promise(async (resolve, reject) => {
    try {
      const conn = new Client();
      
      // Add client to session
      session.client = conn;
      global.SSH_SESSIONS.set(sessionId, session);
      
      // Configure authentication
      const config = {
        host: session.host,
        port: session.port,
        username: session.username,
        // For development only - disable strict host key checking
        algorithms: {
          serverHostKey: ['ssh-rsa', 'ecdsa-sha2-nistp256', 'ssh-ed25519']
        }
      };
      
      if (session.authMethod === 'password') {
        config.password = session.password;
      } else if (session.authMethod === 'key') {
        config.privateKey = session.privateKey;
      }
      
      // Connect to SSH server
      conn.on('ready', () => {
        console.log(`[${new Date().toISOString()}] SSH connection established: ${session.username}@${session.host}:${session.port}`);
        
        // Request a pseudo-terminal
        conn.shell((err, stream) => {
          if (err) {
            conn.end();
            return reject(err);
          }
          
          // Store stream in session
          session.stream = stream;
          setSession(sessionId, session);
          
          // Resolve with stream
          resolve(stream);
        });
      });
      
      conn.on('error', (err) => {
        console.error(`[${new Date().toISOString()}] SSH connection error:`, err);
        reject(err);
      });
      
      // Attempt to connect
      conn.connect(config);
    } catch (error) {
      reject(error);
    }
  });
}

// Track REPL environments for each session
if (!global.REPL_ENVIRONMENTS) {
  console.log('Initializing global REPL environment tracker');
  global.REPL_ENVIRONMENTS = new Map();
}

// Track pending command flags to only record after Enter key
if (!global.PENDING_COMMANDS) {
  console.log('Initializing global pending command tracker');
  global.PENDING_COMMANDS = new Map();
}

// Helper function to detect if session is in a REPL environment
function detectReplEnvironment(sessionId, output) {
  // Check for common REPL prompts
  if (output.includes('>>> ') || output.includes('... ')) {
    // Python REPL
    global.REPL_ENVIRONMENTS.set(sessionId, 'python');
    console.log(`Detected Python REPL for session ${sessionId}`);
    return true;
  } 
  else if (output.includes('> ') && (output.includes('node') || output.match(/js>\s*$/))) {
    // Node.js REPL
    global.REPL_ENVIRONMENTS.set(sessionId, 'node');
    console.log(`Detected Node.js REPL for session ${sessionId}`);
    return true;
  }
  else if (output.match(/irb\([0-9:]+\)[>*]\s*$/)) {
    // Ruby IRB
    global.REPL_ENVIRONMENTS.set(sessionId, 'ruby');
    console.log(`Detected Ruby REPL for session ${sessionId}`);
    return true;
  }
  else if (output.match(/scala>\s*$/)) {
    // Scala REPL
    global.REPL_ENVIRONMENTS.set(sessionId, 'scala');
    console.log(`Detected Scala REPL for session ${sessionId}`);
    return true;
  }
  else if (output.match(/ghci>\s*$/)) {
    // Haskell GHCi
    global.REPL_ENVIRONMENTS.set(sessionId, 'haskell');
    console.log(`Detected Haskell REPL for session ${sessionId}`);
    return true;
  }
  // Detect any interactive environments with command suggestions or box displays
  else if (output.includes('╭') && output.includes('╰')) {
    // Any command suggestion interface or interactive prompt with box characters
    global.REPL_ENVIRONMENTS.set(sessionId, 'interactive');
    console.log(`Detected interactive interface for session ${sessionId}`);
    return true;
  }
  
  // Reset REPL state if we detect shell prompt
  if (output.match(/[$#%>]\s*$/) || output.match(/[a-z]+@[a-z0-9\-\.]+:[~\/][^\s\n]*[$#%]/i)) {
    // But only if we're not in a clearly identified REPL
    const currentType = global.REPL_ENVIRONMENTS.get(sessionId);
    if (currentType !== 'python' && currentType !== 'node' && 
        currentType !== 'ruby' && currentType !== 'scala' && 
        currentType !== 'haskell') {
      console.log(`Exiting REPL environment for session ${sessionId}`);
      global.REPL_ENVIRONMENTS.delete(sessionId);
      return false;
    }
  }
  
  // Continue with current detection state
  return global.REPL_ENVIRONMENTS.has(sessionId);
}

export default function SocketHandler(req, res) {
  // If socket server is already running, just return success
  if (res.socket.server.io) {
    console.log('Socket server is already running');
    res.end();
    return;
  }
  
  // Clear any orphaned sessions
  if (global.SSH_SESSIONS) {
    console.log(`Cleaning up ${global.SSH_SESSIONS.size} orphaned sessions`);
    global.SSH_SESSIONS.clear();
  }
  
  console.log('Setting up Socket.io server...');
  const io = new Server(res.socket.server);
  res.socket.server.io = io;
  
  io.on('connection', (socket) => {
    console.log('New client connected');
    
    socket.on('join', async (sessionId) => {
      if (!sessionId) {
        socket.emit('error', 'Session ID is required');
        return;
      }
      
      console.log(`Client joined session: ${sessionId}`);
      socket.join(sessionId);
      
      // Check if session exists 
      const existingSession = getSession(sessionId);
      console.log(`Checking for session ${sessionId}: ${existingSession ? 'Found' : 'Not found'}`);
            
      // Check if session exists first
      if (!existingSession) {
        console.error(`Session ${sessionId} not found in session store`);
        socket.emit('error', 'SSH session not found. Please try reconnecting.');
        return;
      }
      
      try {
        const stream = await createSshConnection(sessionId);
        
        // Create a transcript for this session
        const session = getSession(sessionId);
        if (session) {
          createTranscript(sessionId, session);
        }
        
        // Forward SSH output to the client
        stream.on('data', (data) => {
          const output = data.toString('utf-8');
          socket.emit('output', output);
          
          // Detect if we're in a REPL environment based on output
          detectReplEnvironment(sessionId, output);
          
          // Record output to transcript
          appendToTranscript(sessionId, 'OUTPUT', output);
        });
        
        stream.on('close', () => {
          socket.emit('closed');
          console.log(`SSH stream closed for session: ${sessionId}`);
        });
        
        stream.stderr.on('data', (data) => {
          const errorText = data.toString('utf-8');
          socket.emit('error', errorText);
          
          // Record error output to transcript
          appendToTranscript(sessionId, 'ERROR', errorText);
        });
        
        // Helper function to get session
        function getSession(id) {
          return global.SSH_SESSIONS?.get(id);
        }

        // Handle terminal input
        socket.on('input', (data) => {
          try {
            const session = getSession(sessionId);
            if (!session || !session.stream) {
              socket.emit('error', 'Session not found or not connected');
              return;
            }
            
            // Send to terminal
            session.stream.write(data);
            
            // Initialize command buffer for session if needed
            if (!session.commandBuffer) {
              session.commandBuffer = '';
            }
            
            // Check if this session is in a REPL environment
            const isReplEnvironment = global.REPL_ENVIRONMENTS.has(sessionId);
            
            // Get the current command buffer
            let currentBuffer = session.commandBuffer;
            
            // Check if Enter key is detected
            const hasEnterKey = data.includes('\r') || data.includes('\n');
            
            // If this is a REPL environment, we use a different approach:
            // We collect all keystrokes in the buffer but NEVER record them
            // until an Enter key is pressed
            if (isReplEnvironment) {
              // This is the key insight: Only add to transcript when Enter is pressed
              if (hasEnterKey) {
                // Split the data by newline to handle the part before Enter
                const parts = data.split(/[\r\n]/);
                if (parts[0]) {
                  currentBuffer += parts[0];
                }
                
                // If we have a non-empty command, record it now
                if (currentBuffer.trim()) {
                  console.log(`Recording complete REPL command: [${currentBuffer.trim()}]`);
                  appendToTranscript(sessionId, 'REPL_COMMAND', currentBuffer.trim());
                  
                  // Mark as not pending anymore - command is recorded
                  global.PENDING_COMMANDS.set(sessionId, false);
                }
                
                // Reset buffer for next command, keeping any text after the Enter
                session.commandBuffer = parts[1] || '';
              }
              // Handle backspace by removing the last character from buffer
              else if (data === '\b' || data === '\x7f') {
                if (currentBuffer.length > 0) {
                  // Remove last character
                  currentBuffer = currentBuffer.slice(0, -1);
                  session.commandBuffer = currentBuffer;
                }
              }
              // For regular keystrokes, just add to buffer without recording
              else {
                // Add keystroke to buffer
                currentBuffer += data;
                session.commandBuffer = currentBuffer;
                
                // Mark as pending - we're collecting keystrokes
                global.PENDING_COMMANDS.set(sessionId, true);
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
                  global.PENDING_COMMANDS.set(sessionId, false);
                }
                
                // Reset buffer for next command
                session.commandBuffer = parts[1] || '';
              } 
              // Handle backspace
              else if (data === '\b' || data === '\x7f') {
                if (currentBuffer.length > 0) {
                  currentBuffer = currentBuffer.slice(0, -1);
                  session.commandBuffer = currentBuffer;
                }
              }
              // Regular keystroke
              else {
                currentBuffer += data;
                session.commandBuffer = currentBuffer;
                
                // Set pending flag
                global.PENDING_COMMANDS.set(sessionId, true);
              }
            }
          } catch (err) {
            console.error('Error processing input:', err);
            socket.emit('error', 'Failed to send input to terminal');
          }
        });
        
        // Handle terminal resize
        socket.on('resize', ({ cols, rows }) => {
          try {
            const session = getSession(sessionId);
            if (!session || !session.stream) return;
            
            session.stream.setWindow(rows, cols);
            console.log(`Terminal resized for session ${sessionId}: ${cols}x${rows}`);
          } catch (err) {
            console.error('Error resizing terminal:', err);
          }
        });
        
        // Handle disconnection
        socket.on('disconnect', () => {
          try {
            console.log(`Client disconnected from session: ${sessionId}`);
            const session = getSession(sessionId);
            
            if (!session) return;
            
            if (session.stream) {
              session.stream.close();
            }
            
            if (session.client) {
              session.client.end();
            }
            
            // Handle any remaining command buffer if there's a pending command
            if (session.commandBuffer && session.commandBuffer.trim() && global.PENDING_COMMANDS.get(sessionId)) {
              // Check if we're in a REPL environment
              const isInRepl = global.REPL_ENVIRONMENTS.has(sessionId);
              const eventType = isInRepl ? 'REPL_COMMAND' : 'COMMAND';
              
              // Mark as incomplete since the user didn't press Enter
              console.log(`Recording incomplete ${eventType}: [${session.commandBuffer.trim()}]`);
              appendToTranscript(sessionId, eventType, session.commandBuffer.trim() + ' (incomplete)');
            }
            
            // Clean up pending command flags
            if (global.PENDING_COMMANDS.has(sessionId)) {
              global.PENDING_COMMANDS.delete(sessionId);
            }
            
            // Clean up REPL environment tracking
            if (global.REPL_ENVIRONMENTS.has(sessionId)) {
              const replType = global.REPL_ENVIRONMENTS.get(sessionId);
              console.log(`Cleaning up REPL environment (${replType}) for session ${sessionId}`);
              global.REPL_ENVIRONMENTS.delete(sessionId);
            }
            
            // Remove session from global store
            global.SSH_SESSIONS.delete(sessionId);
            console.log(`Removed session ${sessionId} from global store`);
          } catch (err) {
            console.error('Error handling disconnection:', err);
          }
        });
        
      } catch (err) {
        console.error('Error setting up SSH connection:', err);
        socket.emit('error', err.message || 'Failed to establish SSH connection');
      }
    });
  });
  
  console.log('Socket.io server started');
  res.end();
}