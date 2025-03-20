import { Server } from 'socket.io';
import { Client } from 'ssh2';
import { getSession, setSession } from '../../../lib/sessionStore';

// Create a demo terminal stream that doesn't require actual SSH
function createDemoStream(isDemoFallback = false) {
  const { EventEmitter } = require('events');
  const stream = new EventEmitter();
  
  // Log whether this is an intentional demo or fallback
  console.log(`Creating ${isDemoFallback ? 'fallback' : 'intentional'} demo stream`);
  
  // Add methods to simulate a readable/writable stream
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
        
        // Forward SSH output to the client
        stream.on('data', (data) => {
          socket.emit('output', data.toString('utf-8'));
        });
        
        stream.on('close', () => {
          socket.emit('closed');
          console.log(`SSH stream closed for session: ${sessionId}`);
        });
        
        stream.stderr.on('data', (data) => {
          socket.emit('error', data.toString('utf-8'));
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
            
            session.stream.write(data);
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