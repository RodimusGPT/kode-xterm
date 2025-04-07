// Transcript storage for terminal sessions
// Uses LowDB for file-based persistence

import path from 'path';
import fs from 'fs';
import low from 'lowdb';
import FileSync from 'lowdb/adapters/FileSync';

// Configure LowDB for persistent storage of transcript metadata
const adapter = new FileSync(path.join(process.cwd(), 'terminal_transcripts.json'));
const db = low(adapter);

// Initialize the database with default structure
db.defaults({ transcripts: [] }).write();

// Get the transcript directory path
const transcriptDir = path.join(process.cwd(), 'transcripts');

// Create the transcripts directory if it doesn't exist
if (!fs.existsSync(transcriptDir)) {
  fs.mkdirSync(transcriptDir, { recursive: true });
}

// Create a new transcript record
export function createTranscript(sessionId, sessionInfo) {
  const timestamp = new Date().toISOString();
  const filename = `${sessionId}.log`;
  const filePath = path.join(transcriptDir, filename);
  
  // Create transcript metadata
  const transcript = {
    id: sessionId,
    filename,
    host: sessionInfo.host,
    username: sessionInfo.username,
    createdAt: timestamp,
    lastUpdatedAt: timestamp,
  };
  
  // Add header to transcript file
  const header = `# Terminal Transcript\n# Session ID: ${sessionId}\n# Host: ${sessionInfo.host}\n# User: ${sessionInfo.username}\n# Started: ${timestamp}\n\n`;
  fs.writeFileSync(filePath, header, 'utf8');
  
  // Save transcript metadata to database
  db.get('transcripts')
    .push(transcript)
    .write();
    
  return transcript;
}

// Append to an existing transcript
export function appendToTranscript(sessionId, source, data) {
  const timestamp = new Date().toISOString();
  const filePath = path.join(transcriptDir, `${sessionId}.log`);
  
  if (!fs.existsSync(filePath)) {
    console.error(`Transcript file not found for session ${sessionId}`);
    return false;
  }
  
  // Format the data with timestamp and direction indicator
  const formattedData = `[${timestamp}] [${source}] ${data.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}\n`;
  
  // Append to transcript file
  fs.appendFileSync(filePath, formattedData, 'utf8');
  
  // Update last updated timestamp
  db.get('transcripts')
    .find({ id: sessionId })
    .assign({ lastUpdatedAt: timestamp })
    .write();
    
  return true;
}

// Get transcript metadata
export function getTranscriptMetadata(sessionId) {
  return db.get('transcripts')
    .find({ id: sessionId })
    .value();
}

// Get transcript content
export function getTranscriptContent(sessionId) {
  const filePath = path.join(transcriptDir, `${sessionId}.log`);
  
  if (!fs.existsSync(filePath)) {
    return null;
  }
  
  return fs.readFileSync(filePath, 'utf8');
}

// Get all transcripts
export function getAllTranscripts() {
  return db.get('transcripts')
    .orderBy(['lastUpdatedAt'], ['desc'])
    .value();
}

// Delete a transcript
export function deleteTranscript(sessionId) {
  const filePath = path.join(transcriptDir, `${sessionId}.log`);
  
  if (fs.existsSync(filePath)) {
    fs.unlinkSync(filePath);
  }
  
  return db.get('transcripts')
    .remove({ id: sessionId })
    .write();
}
