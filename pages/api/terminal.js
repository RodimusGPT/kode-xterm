import { v4 as uuidv4 } from 'uuid';
import { getPrivateKey } from './keys';
import { setSession, getSession, deleteSession } from '../../lib/sessionStore';

// Demo mode flag
const DEMO_MODE = true;

export default async function handler(req, res) {
  switch (req.method) {
    case 'POST':
      return createSession(req, res);
    case 'DELETE':
      return terminateSession(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

// POST /api/terminal - Create a new SSH session
async function createSession(req, res) {
  try {
    const { host, port, username, authMethod, password, keyId, privateKeyContent } = req.body;
    
    console.log(`Received SSH connection request:`, {
      host,
      port,
      username,
      authMethod,
      hasPassword: !!password,
      hasKeyId: !!keyId,
      hasPrivateKeyContent: !!privateKeyContent
    });
    
    // Basic validation
    if (!host || !username) {
      console.log('Validation error: Host and username are required');
      return res.status(400).json({ error: 'Host and username are required' });
    }
    
    if (authMethod === 'password' && !password) {
      console.log('Validation error: Password is required');
      return res.status(400).json({ error: 'Password is required for password authentication' });
    }
    
    // Get private key if using key authentication
    let privateKey = null;
    if (authMethod === 'key') {
      // If direct private key content is provided, use it
      if (privateKeyContent) {
        privateKey = privateKeyContent;
        console.log('Using provided private key content for authentication');
      } 
      // Otherwise, try to retrieve key from the store
      else if (keyId) {
        try {
          privateKey = await getPrivateKey(keyId);
          console.log('Successfully retrieved private key for authentication');
        } catch (err) {
          console.error('Error retrieving SSH key:', err);
          // If we're in demo mode, proceed anyway
          if (DEMO_MODE) {
            console.log('In DEMO mode, proceeding despite key error');
          } else {
            return res.status(400).json({ error: 'Unable to retrieve SSH key. Please use direct key input instead.' });
          }
        }
      } else {
        console.log('Validation error: Either keyId or privateKeyContent is required');
        return res.status(400).json({ error: 'Either a stored key or direct key content is required for key authentication' });
      }
    }
    
    // Generate a unique session ID
    const sessionId = uuidv4();
    
    // Create and store session
    const session = {
      id: sessionId,
      host,
      port: port || 22,
      username,
      authMethod,
      password: authMethod === 'password' ? password : null,
      privateKey: authMethod === 'key' ? privateKey : null,
      createdAt: new Date().toISOString(),
      demoMode: DEMO_MODE
    };
    
    // Store in the persistent session store
    setSession(sessionId, session);
    
    // Log the connection attempt
    console.log(`[${new Date().toISOString()}] New SSH connection attempt: ${username}@${host}:${port || 22} using ${authMethod}`);
    console.log(`Session created successfully with ID: ${sessionId}`);
    
    return res.status(200).json({ sessionId });
  } catch (error) {
    console.error('Error creating SSH session:', error);
    return res.status(500).json({ error: 'Failed to create SSH session' });
  }
}

// DELETE /api/terminal?sessionId=<sessionId> - Terminate an SSH session
async function terminateSession(req, res) {
  try {
    const { sessionId } = req.query;
    
    if (!sessionId) {
      return res.status(400).json({ error: 'Session ID is required' });
    }
    
    const session = getSession(sessionId);
    
    if (!session) {
      console.log(`Session ${sessionId} not found or already terminated`);
      return res.status(200).json({ success: true, message: 'Session not found or already terminated' });
    }
    
    // Clean up resources
    try {
      if (session.stream) {
        session.stream.close();
        session.stream = null;
      }
      
      if (session.client) {
        session.client.end();
        session.client = null;
      }
    } catch (cleanupError) {
      console.error('Error cleaning up session resources:', cleanupError);
      // Continue anyway to ensure the session is removed
    }
    
    // Remove from session store
    deleteSession(sessionId);
    
    console.log(`[${new Date().toISOString()}] SSH session terminated: ${session.username}@${session.host}:${session.port}`);
    
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error terminating SSH session:', error);
    return res.status(500).json({ error: 'Failed to terminate SSH session' });
  }
}