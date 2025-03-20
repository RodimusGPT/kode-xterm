// Session storage for SSH sessions across API routes 
// Uses LowDB for file-based persistence to work with serverless API routes

import path from 'path';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

// Configure LowDB for persistent storage
const adapter = new FileSync(path.join(process.cwd(), 'ssh_sessions.json'));
const db = low(adapter);

// Initialize the database with default structure
db.defaults({ sessions: [] }).write();

// Set a session in the store
export function setSession(sessionId, sessionData) {
  console.log(`Setting session ${sessionId} in persistent store`);
  
  // Remove any non-serializable properties like stream and client
  const cleanedSession = { ...sessionData };
  delete cleanedSession.stream;
  delete cleanedSession.client;
  
  // Check if session already exists
  const existing = db.get('sessions').find({ id: sessionId }).value();
  
  if (existing) {
    // Update existing session
    db.get('sessions')
      .find({ id: sessionId })
      .assign(cleanedSession)
      .write();
  } else {
    // Add new session
    db.get('sessions')
      .push(cleanedSession)
      .write();
  }
  
  return sessionData;
}

// Get a session from the store
export function getSession(sessionId) {
  console.log(`Getting session ${sessionId} from persistent store`);
  const session = db.get('sessions').find({ id: sessionId }).value();
  console.log(`Session found: ${!!session}`);
  return session;
}

// Delete a session from the store
export function deleteSession(sessionId) {
  console.log(`Deleting session ${sessionId} from persistent store`);
  return db.get('sessions')
    .remove({ id: sessionId })
    .write();
}

// Get all sessions
export function getAllSessions() {
  return db.get('sessions').value();
}

// Export debugSessions for backwards compatibility
global.debugSessions = () => {
  const sessions = getAllSessions();
  console.log('Active Sessions:', sessions.length);
  for (const session of sessions) {
    console.log(`- Session ${session.id}: ${session.username}@${session.host}`);
  }
};