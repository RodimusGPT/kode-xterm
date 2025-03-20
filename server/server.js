// Dedicated WebSocket server for SSH terminal connections
const express = require('express');
const http = require('http');
const WebSocket = require('ws');
const { Client } = require('ssh2');
const crypto = require('crypto');
const cors = require('cors');

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

// Handle terminal input
function handleTerminalInput(sessionId, data, ws) {
  const session = sessions.get(sessionId);
  
  if (!session || !session.stream) {
    return sendError(ws, 'Session not connected');
  }
  
  try {
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
        broadcastToSession(sessionId, 'error', data.toString('utf-8'));
      });
      
      stream.on('close', () => {
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
  stream.write = (data) => {
    console.log(`Demo terminal received: ${data}`);
    
    // Echo back what was typed, simulating a terminal
    if (data.includes('\r')) {
      // Command execution simulation
      const command = data.trim();
      
      // Wait a bit before responding
      setTimeout(() => {
        if (command.startsWith('ls')) {
          stream.emit('data', '\r\nDEMO MODE - Simulated directory listing:\r\n');
          stream.emit('data', 'file1.txt  file2.txt  folder1/  folder2/\r\n');
        } else if (command.startsWith('pwd')) {
          stream.emit('data', '\r\n/home/demo\r\n');
        } else if (command.startsWith('whoami')) {
          stream.emit('data', '\r\ndemo-user\r\n');
        } else if (command.startsWith('date')) {
          stream.emit('data', `\r\n${new Date().toString()}\r\n`);
        } else if (command.startsWith('echo')) {
          stream.emit('data', `\r\n${command.substring(5)}\r\n`);
        } else if (command.startsWith('help')) {
          stream.emit('data', '\r\nDEMO MODE - Available commands:\r\n');
          stream.emit('data', 'ls, pwd, whoami, date, echo, help\r\n');
        } else if (command) {
          stream.emit('data', `\r\nCommand not found: ${command}\r\nType 'help' to see available commands.\r\n`);
        }
        
        // Display prompt
        stream.emit('data', '\r\ndemo@localhost:~$ ');
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
    broadcastToSession(sessionId, 'output', welcomeMessage);
  }, 500);
  
  // Setup event handlers
  stream.on('close', () => {
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
}

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