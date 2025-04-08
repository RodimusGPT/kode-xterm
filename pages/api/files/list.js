const { getSessionById } = require('../../../lib/sessionStore');
const { runCommandInSession } = require('../../../server/server'); // Assuming this is also CJS

async function listFilesHandler(req, res) {
  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Method Not Allowed' });
  }

  const { sessionId, path } = req.query;

  if (!sessionId || typeof sessionId !== 'string') {
    return res.status(400).json({ error: 'Missing or invalid sessionId' });
  }

  const targetPath = typeof path === 'string' && path.trim() ? path.trim() : '/';

  console.log(`[API /files/list] Received request for session ${sessionId}, path: ${targetPath}`);

  const session = getSessionById(sessionId);
  if (!session || !session.connection) {
    console.log(`[API /files/list] Session not found or inactive: ${sessionId}`);
    return res.status(404).json({ error: 'Session not found or inactive' });
  }

  // Basic security check: prevent path traversal
  if (targetPath.includes('..') || !targetPath.startsWith('/')) {
     console.log(`[API /files/list] Invalid path requested: ${targetPath}`);
     return res.status(400).json({ error: 'Invalid path requested' });
   }

  // Construct the command to list files and directories separately
  const separator = '__||SEP||__';
   // Note: Using `ls -Ap --time-style=+` and awk/sed for better parsing
   // Ensure targetPath is properly escaped for shell command
  const escapedPath = targetPath.replace(/"/g, '\\"');
  // Ensure the final command ends with a newline for execution
  const command = `ls -Ap --time-style=+ "${escapedPath}" | awk '{print $1}' | sed 's/$/${separator}/'; echo "__DONE__"\n`;

  console.log(`[API /files/list] Running command: ${command.trim()}`);

  try {
    // Assuming runCommandInSession handles the end marker correctly
    const output = await runCommandInSession(sessionId, command, '__DONE__');
    console.log(`[API /files/list] Command output for ${sessionId} path ${targetPath}:\n${output}`);

    // Process the output
    const lines = output.split(separator).map(line => line.trim()).filter(line => line && line !== '__DONE__');

    const directories = [];
    const files = [];

    lines.forEach(line => {
      if (line.endsWith('/')) {
        directories.push(line.slice(0, -1)); // Remove trailing slash
      } else {
        files.push(line);
      }
    });

    console.log(`[API /files/list] Parsed for ${sessionId}, path ${targetPath}:`, { files, directories });

    // Check if headers already sent before sending response
    if (!res.headersSent) {
        res.status(200).json({ files, directories });
    }

  } catch (error) {
    console.error(`[API /files/list] Error running command for session ${sessionId}, path ${targetPath}:`, error);
    // Check if headers already sent before trying to send another response
    if (!res.headersSent) {
       res.status(500).json({ error: `Failed to list files: ${error.message}` });
    }
  }
}

module.exports = listFilesHandler; // Export using CommonJS
