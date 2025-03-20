// API endpoint to force reset all server state

import { deleteSession, getAllSessions } from '../../../lib/sessionStore';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  try {
    // Get all sessions
    const sessions = getAllSessions();
    console.log(`Resetting ${sessions.length} sessions`);
    
    // Delete each session
    for (const session of sessions) {
      if (session && session.id) {
        console.log(`Deleting session ${session.id}`);
        deleteSession(session.id);
      }
    }
    
    // Try to close socket server if possible
    if (res.socket && res.socket.server && res.socket.server.io) {
      console.log('Closing socket server');
      try {
        res.socket.server.io.close();
        delete res.socket.server.io;
      } catch (err) {
        console.error('Error closing socket server:', err);
      }
    }
    
    return res.status(200).json({ 
      success: true, 
      message: 'Server state reset' 
    });
  } catch (error) {
    console.error('Error resetting server state:', error);
    return res.status(500).json({ 
      error: 'Failed to reset server state' 
    });
  }
}