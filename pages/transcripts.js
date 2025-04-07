import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import axios from 'axios';
import styles from '../styles/Transcripts.module.css';
import { formatTranscript } from '../utils/transcriptFormatter';

// Function to filter out redundant single keystrokes
function filterRedundantKeystrokes(content) {
  if (!content) return '';
  
  console.log('Before filtering:', content);
  
  // Strategy: Identify multi-char commands, then retroactively remove any
  // single-char commands that are part of them from the same timestamp group
  
  // Split into lines and groups by timestamp
  const lines = content.split('\n');
  const timestampGroups = {};
  let currentGroup = null;
  
  // First pass: group by timestamp
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmedLine = line.trim();
    
    // Detect timestamp markers
    if (trimmedLine.match(/^\[.*\]$/)) {
      // Start a new group
      currentGroup = trimmedLine;
      if (!timestampGroups[currentGroup]) {
        timestampGroups[currentGroup] = {
          timestampLine: line,  // Keep original formatting
          commands: [],
          outputs: [],
          originalOrder: Object.keys(timestampGroups).length
        };
      }
      continue;
    }
    
    if (!currentGroup) continue; // Skip lines before first timestamp
    
    // Check if this is a command ($ prefix)
    const cmdMatch = trimmedLine.match(/^\$\s+(.*)$/);
    if (cmdMatch) {
      const cmd = cmdMatch[1].trim();
      timestampGroups[currentGroup].commands.push({
        original: line,
        cmd: cmd,
        isSingleChar: cmd.length === 1
      });
    } else {
      // This is output text
      timestampGroups[currentGroup].outputs.push(line);
    }
  }
  
  // Second pass: filter out redundant single-char commands
  const result = [];
  
  // Get groups in original order
  const sortedGroups = Object.keys(timestampGroups).sort(
    (a, b) => timestampGroups[a].originalOrder - timestampGroups[b].originalOrder
  );
  
  for (const groupKey of sortedGroups) {
    const group = timestampGroups[groupKey];
    
    // Add the timestamp header
    result.push(group.timestampLine);
    
    // Find all single chars that are part of multi-char commands
    const redundantChars = new Set();
    const multiCharCmds = group.commands.filter(c => !c.isSingleChar);
    
    for (const { cmd } of multiCharCmds) {
      // For each character in multi-char commands
      for (let i = 0; i < cmd.length; i++) {
        redundantChars.add(cmd[i]);
      }
    }
    
    console.log(`Group ${groupKey} - Redundant chars:`, [...redundantChars]);
    
    // Add all multi-char commands
    for (const cmdObj of group.commands) {
      if (!cmdObj.isSingleChar) {
        result.push(cmdObj.original);
      } else if (!redundantChars.has(cmdObj.cmd)) {
        // Only add single-char commands if they're not redundant
        result.push(cmdObj.original);
      } else {
        console.log(`Filtered out redundant cmd: ${cmdObj.cmd}`);
      }
    }
    
    // Add all outputs
    result.push(...group.outputs);
  }
  
  const finalContent = result.join('\n');
  console.log('After filtering:', finalContent);
  return finalContent;
}

// Special clean view formatter that skips all individual keystrokes
function getCleanTranscriptView(rawContent) {
  if (!rawContent) return '';
  
  // Parse each line into structured format
  const lines = rawContent.split('\n');
  const result = [];
  
  // Track state for each timestamp
  const commands = new Map();
  const outputs = new Map();
  
  // Collect all commands and outputs
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse line format: [timestamp] [type] content
    const match = line.match(/^\[([^\]]+)\] \[([A-Z]+)\] (.*)$/);
    if (!match) continue;
    
    const [, timestamp, type, content] = match;
    const formattedTimestamp = new Date(timestamp).toLocaleString();
    
    // Initialize collections for this timestamp if needed
    if (!commands.has(formattedTimestamp)) {
      commands.set(formattedTimestamp, new Set());
      outputs.set(formattedTimestamp, []);
    }
    
    // Process by type - only care about COMMAND and OUTPUT
    if (type === 'COMMAND') {
      // Keep all commands
      commands.get(formattedTimestamp).add(content);
    }
    else if (type === 'OUTPUT') {
      // Clean and add output
      const cleanOutput = content.replace(/\\r/g, '\r').replace(/\\n/g, '\n');
      if (cleanOutput.trim()) {
        outputs.get(formattedTimestamp).push(cleanOutput);
      }
    }
    // Ignore INPUT events entirely
  }
  
  // Build clean output
  const timestamps = [...commands.keys()].sort();
  
  for (const timestamp of timestamps) {
    const commandList = Array.from(commands.get(timestamp));
    const outputList = outputs.get(timestamp);
    
    // Only add timestamps that have commands or outputs
    if (commandList.length > 0 || outputList.length > 0) {
      // Add timestamp header
      result.push(`\n[${timestamp}]`);
      
      // Add all commands
      for (const cmd of commandList) {
        result.push(`$ ${cmd}`);
      }
      
      // Add all outputs
      if (outputList.length > 0) {
        result.push(outputList.join('\n'));
      }
    }
  }
  
  return result.join('\n').trim();
}

export default function TranscriptsPage() {
  const router = useRouter();
  const [transcripts, setTranscripts] = useState([]);
  const [selectedTranscript, setSelectedTranscript] = useState(null);
  const [transcriptContent, setTranscriptContent] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState('');
  const [isLive, setIsLive] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [activeSessions, setActiveSessions] = useState([]);
  const [cleanView, setCleanView] = useState(true); // Default to clean view
  const refreshIntervalRef = useRef(null);
  const contentRef = useRef(null);
  
  // Load transcript list on component mount
  useEffect(() => {
    async function fetchTranscripts() {
      try {
        setIsLoading(true);
        const response = await axios.get('http://localhost:3001/api/transcripts');
        setTranscripts(response.data.transcripts || []);
        
        // Get active sessions
        try {
          const sessionsResponse = await axios.get('http://localhost:3001/api/sessions');
          setActiveSessions(sessionsResponse.data.sessions || []);
        } catch (sessionErr) {
          console.error('Failed to fetch active sessions:', sessionErr);
          setActiveSessions([]);
        }
        
        setError('');
      } catch (err) {
        console.error('Failed to fetch transcripts:', err);
        setError('Failed to load transcripts');
      } finally {
        setIsLoading(false);
      }
    }
    
    fetchTranscripts();
  }, []);
  
  // Load transcript content when a transcript is selected
  const loadTranscriptContent = async (transcriptId, isInitialLoad = false) => {
    if (!transcriptId) return;
    
    try {
      if (isInitialLoad) {
        setIsLoading(true);
      }
      
      // ALWAYS REQUEST CLEAN TRANSCRIPT - bypass all other filters
      const url = `http://localhost:3001/api/transcripts?id=${transcriptId}&clean=true`;
      
      console.log(`Loading transcript with clean view: ${url}`);
      const response = await axios.get(url);
      
      // Use the server's clean transcript directly without any client-side formatting
      setTranscriptContent(response.data.content);
      
      if (autoScroll && contentRef.current) {
        setTimeout(() => {
          contentRef.current.scrollTop = contentRef.current.scrollHeight;
        }, 100);
      }
      
      setError('');
    } catch (err) {
      console.error('Failed to fetch transcript content:', err);
      setError('Failed to load transcript content');
      setTranscriptContent('');
    } finally {
      if (isInitialLoad) {
        setIsLoading(false);
      }
    }
  };
  
  // Start or stop live updates
  const toggleLiveUpdates = () => {
    if (isLive) {
      // Stop live updates
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
      setIsLive(false);
    } else {
      // Start live updates
      if (selectedTranscript?.id) {
        refreshIntervalRef.current = setInterval(() => {
          loadTranscriptContent(selectedTranscript.id, false);
        }, 2000); // Refresh every 2 seconds
        setIsLive(true);
      }
    }
  };
  
  // Clean up interval on unmount or when selected transcript changes
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
      }
    };
  }, [selectedTranscript]);
  
  // Handle transcript selection
  const handleSelectTranscript = (transcript) => {
    // Clear any existing interval
    if (refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
    setIsLive(false);
    
    setSelectedTranscript(transcript);
    loadTranscriptContent(transcript.id, true);
  };
  
  // Handle transcript deletion
  const handleDeleteTranscript = async (transcriptId, event) => {
    // Prevent triggering selection when clicking delete button
    event.stopPropagation();
    
    if (!transcriptId || !window.confirm('Are you sure you want to delete this transcript?')) {
      return;
    }
    
    try {
      await axios.delete(`http://localhost:3001/api/transcripts?id=${transcriptId}`);
      
      // Remove from list and clear selection if needed
      setTranscripts(transcripts.filter(t => t.id !== transcriptId));
      
      if (selectedTranscript?.id === transcriptId) {
        setSelectedTranscript(null);
        setTranscriptContent('');
      }
    } catch (err) {
      console.error('Failed to delete transcript:', err);
      setError('Failed to delete transcript');
    }
  };
  
  // Check if a session is active
  const isSessionActive = (sessionId) => {
    // Make sure we have the activeSessions array and it's populated
    if (!Array.isArray(activeSessions) || activeSessions.length === 0) {
      return false;
    }
    return activeSessions.some(session => session.id === sessionId);
  };
  
  // Return to active terminal session
  const returnToSession = (sessionId) => {
    router.push(`/terminal?session=${sessionId}`);
  };
  
  // Format timestamp for display
  const formatDate = (isoDate) => {
    if (!isoDate) return '';
    const date = new Date(isoDate);
    return date.toLocaleString();
  };
  
  return (
    <div className={styles.container}>
      <Head>
        <title>Terminal Transcripts | Kode-XTerm</title>
        <meta name="description" content="View terminal session transcripts" />
      </Head>
      
      <header className={styles.header}>
        <h1>Terminal Transcripts</h1>
        <Link href="/terminal" className={styles.backLink}>
          Back to Terminal
        </Link>
      </header>
      
      {error && <div className={styles.error}>{error}</div>}
      
      <div className={styles.content}>
        <div className={styles.transcriptList}>
          <h2>Available Transcripts</h2>
          
          {isLoading && !transcriptContent && (
            <div className={styles.loading}>Loading transcripts...</div>
          )}
          
          {!isLoading && transcripts.length === 0 && (
            <div className={styles.empty}>No transcripts available</div>
          )}
          
          <ul>
            {transcripts.map((transcript) => (
              <li 
                key={transcript.id} 
                className={`${styles.transcriptItem} ${selectedTranscript?.id === transcript.id ? styles.selected : ''}`}
                onClick={() => handleSelectTranscript(transcript)}
              >
                <div className={styles.transcriptInfo}>
                  <span className={styles.host}>{transcript.username}@{transcript.host}</span>
                  <span className={styles.date}>Created: {formatDate(transcript.createdAt)}</span>
                  <span className={styles.date}>Last Updated: {formatDate(transcript.lastUpdatedAt)}</span>
                  {isSessionActive(transcript.id) && (
                    <span className={styles.activeIndicator}>ACTIVE</span>
                  )}
                </div>
                <button 
                  className={styles.deleteButton}
                  onClick={(e) => handleDeleteTranscript(transcript.id, e)}
                >
                  Delete
                </button>
              </li>
            ))}
          </ul>
        </div>
        
        <div className={styles.transcriptContent}>
          <div className={styles.transcriptHeader}>
            <h2>{selectedTranscript ? `Transcript: ${selectedTranscript.username}@${selectedTranscript.host}` : 'Select a Transcript'}</h2>
            
            {selectedTranscript && (
              <div className={styles.controls}>
                <label className={styles.controlLabel}>
                  <input 
                    type="checkbox" 
                    checked={autoScroll} 
                    onChange={() => setAutoScroll(!autoScroll)}
                  />
                  Auto-scroll
                </label>
                
                <label className={styles.controlLabel}>
                  <input 
                    type="checkbox" 
                    checked={cleanView} 
                    onChange={() => {
                      setCleanView(!cleanView);
                      // Reload content with new view setting
                      if (selectedTranscript?.id) {
                        loadTranscriptContent(selectedTranscript.id, false);
                      }
                    }}
                  />
                  Clean View (no keystrokes)
                </label>
                
                <button 
                  className={`${styles.liveButton} ${isLive ? styles.liveActive : ''}`}
                  onClick={toggleLiveUpdates}
                >
                  {isLive ? 'Live: ON' : 'Live: OFF'}
                </button>
              </div>
            )}
          </div>
          
          {isLoading && selectedTranscript && (
            <div className={styles.loading}>Loading transcript content...</div>
          )}
          
          {!isLoading && selectedTranscript && (
            <>
              {isSessionActive(selectedTranscript.id) && (
                <div className={styles.actionBar}>
                  <button 
                    className={styles.returnButton}
                    onClick={() => returnToSession(selectedTranscript.id)}
                  >
                    Return to Active Session
                  </button>
                </div>
              )}
              <pre className={styles.terminal} ref={contentRef}>
                {transcriptContent ? (
                  transcriptContent
                ) : 'No content available'}
                {isLive && <div className={styles.liveIndicator}>•</div>}
              </pre>
            </>
          )}
          
          {!selectedTranscript && (
            <div className={styles.empty}>Select a transcript to view its content</div>
          )}
        </div>
      </div>
    </div>
  );
}
