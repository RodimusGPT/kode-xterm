// API endpoint for managing terminal session transcripts
import { getAllTranscripts, getTranscriptContent, deleteTranscript } from '../../lib/transcriptStore';

export default async function handler(req, res) {
  switch (req.method) {
    case 'GET':
      return handleGet(req, res);
    case 'DELETE':
      return handleDelete(req, res);
    default:
      return res.status(405).json({ error: 'Method not allowed' });
  }
}

// GET /api/transcripts - List all transcripts
// GET /api/transcripts?id=<sessionId> - Get specific transcript content
async function handleGet(req, res) {
  try {
    const { id } = req.query;
    
    // If ID is provided, return that specific transcript
    if (id) {
      const transcriptContent = getTranscriptContent(id);
      
      if (!transcriptContent) {
        return res.status(404).json({ error: 'Transcript not found' });
      }
      
      return res.status(200).json({ content: transcriptContent });
    }
    
    // Otherwise, return all transcript metadata
    const transcripts = getAllTranscripts();
    return res.status(200).json({ transcripts });
  } catch (error) {
    console.error('Error retrieving transcripts:', error);
    return res.status(500).json({ error: 'Failed to retrieve transcripts' });
  }
}

// DELETE /api/transcripts?id=<sessionId> - Delete a transcript
async function handleDelete(req, res) {
  try {
    const { id } = req.query;
    
    if (!id) {
      return res.status(400).json({ error: 'Transcript ID is required' });
    }
    
    deleteTranscript(id);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('Error deleting transcript:', error);
    return res.status(500).json({ error: 'Failed to delete transcript' });
  }
}
