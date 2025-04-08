
import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import Link from 'next/link';
import { useRouter } from 'next/router';
import axios from 'axios';
import dynamic from 'next/dynamic';
import styles from '../styles/Terminal.module.css';
import { formatTranscript } from '../utils/transcriptFormatter';

// New Imports for File Explorer
import { Tree, TreeItem, TreeItemIndex } from 'react-complex-tree';
import 'react-complex-tree/lib/style-modern.css';

// Dynamically import Terminal with no SSR
const TerminalComponent = dynamic(
  () => import('../components/TerminalComponent'),
  { ssr: false }
);

// Dynamically import FileExplorer with no SSR (assuming it uses browser APIs)
const FileExplorer = dynamic(
  () => import('../components/FileExplorer'),
  { ssr: false }
);

// Simple IFrame component for the browser panel
const BrowserPanel = ({ initialUrl = 'https://example.com/' }) => {
  const [url, setUrl] = useState(initialUrl);
  const [inputValue, setInputValue] = useState(initialUrl);
  const iframeRef = useRef(null);

  const handleLoadUrl = (e) => {
    e.preventDefault();
    let finalUrl = inputValue.trim();
    if (!finalUrl.startsWith('http://') && !finalUrl.startsWith('https://')) {
      finalUrl = `https://${finalUrl}`;
    }
    setUrl(finalUrl);
  };

  return (
    <div className={styles.browserPanel}>
      <form onSubmit={handleLoadUrl} className={styles.urlForm}>
        <input
          type="text"
          value={inputValue}
          onChange={(e) => setInputValue(e.target.value)}
          placeholder="Enter URL"
          className={styles.urlInput}
        />
        <button type="submit" className={styles.loadButton}>Load</button>
      </form>
      <iframe
        ref={iframeRef}
        src={url}
        className={styles.iframe}
        title="Inline Browser"
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-presentation"
      />
    </div>
  );
};


export default function TerminalPage() {
  const router = useRouter();

  // Stages: 'form', 'connecting', 'standardLayout', 'splitLayout'
  const [stage, setStage] = useState('form');
  const [layoutChoice, setLayoutChoice] = useState('split'); // 'standard' or 'split' - Default changed

  // Session IDs
  const [primarySessionId, setPrimarySessionId] = useState('');
  const [secondarySessionId, setSecondarySessionId] = useState(''); // Only used in split layout

  // Store connection details per session
  const [sessionDetails, setSessionDetails] = useState({}); // { [sessionId]: { host, username, port } }

  // Form state
  const [host, setHost] = useState('85.31.234.214');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('vibe');
  const [authMethod, setAuthMethod] = useState('key');
  const [password, setPassword] = useState('');
  const [privateKey, setPrivateKey] = useState('');

  // Transcript state
  const [showTranscript, setShowTranscript] = useState(false);
  const [transcriptContent, setTranscriptContent] = useState('');
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [autoScroll, setAutoScroll] = useState(true);
  const [liveTranscriptUpdate, setLiveTranscriptUpdate] = useState(true);
  const transcriptUpdateIntervalRef = useRef(null);
  const transcriptContentRef = useRef(null);
  const currentTranscriptSessionId = useRef(null);

  // General UI state
  const [isLoading, setIsLoading] = useState(false); // Indicates connection attempts
  const [error, setError] = useState('');

  // Check for session parameter in URL (only for standard layout reconnect)
  useEffect(() => {
    if (!router.isReady) return;
    const { session } = router.query;
    if (session && stage === 'form') { // Only reconnect if starting on the form page
      reconnectToStandardSession(session);
    }
  }, [router.isReady, router.query, stage]);

  // Function to reconnect to an existing standard session
  const reconnectToStandardSession = async (existingSessionId) => {
      setStage('connecting');
      setError('');
      try {
        console.log('Attempting to reconnect to standard session:', existingSessionId);
        const sessionResponse = await axios.get(`http://localhost:3001/api/sessions?id=${existingSessionId}`);
        const sessionInfo = sessionResponse.data.session;

        if (!sessionInfo || !sessionInfo.active) {
           throw new Error('Session not found or no longer active');
        }

        setSessionDetails(prev => ({
           ...prev,
           [existingSessionId]: { host: sessionInfo.host, username: sessionInfo.username, port: sessionInfo.port }
        }));
        setPrimarySessionId(existingSessionId);
        setLayoutChoice('standard'); // Force layout to standard on reconnect
        setStage('standardLayout');

      } catch (err) {
        console.error('Failed to reconnect to session:', err);
        setError(`Failed to reconnect: ${err.message || 'Unknown error'}. Please connect manually.`);
        setStage('form'); // Go back to form on failure
        // Clear the invalid session query parameter from URL to prevent reconnect loops
        router.replace('/terminal', undefined, { shallow: true });
      } finally {
        // No setIsLoading needed, stage handles UI
      }
  };

  // Clean up sessions on unmount
  useEffect(() => {
    return () => {
      if (primarySessionId) disconnectFromServer(primarySessionId);
      if (secondarySessionId) disconnectFromServer(secondarySessionId);
      stopLiveTranscriptUpdates();
    };
  }, []); // <-- EMPTY DEPENDENCY ARRAY: Run cleanup only on unmount

  // Core connection function (reusable)
  const establishSession = async (credentials) => {
    console.log('[establishSession] Attempting to establish session with:', credentials.host);
    // No loading/error state management here, handled by caller
    try {
      console.log(`Establishing session with:`, { host: credentials.host, port: credentials.port, username: credentials.username, authMethod: credentials.authMethod });
      const requestData = {
        host: credentials.host,
        port: parseInt(credentials.port, 10) || 22,
        username: credentials.username,
        authMethod: credentials.authMethod,
        privateKey: credentials.authMethod === 'key' ? credentials.privateKey : undefined,
        password: credentials.authMethod === 'password' ? credentials.password : undefined,
        demoMode: false
      };

      const response = await axios.post('http://localhost:3001/api/sessions', requestData);
      const { sessionId: newSessionId } = response.data;
      console.log(`Session established: ${newSessionId}`);

      // Store details
      setSessionDetails(prev => ({
        ...prev,
        [newSessionId]: { host: credentials.host, username: credentials.username, port: requestData.port }
      }));
      return newSessionId;
    } catch (err) {
      console.error('establishSession error:', err);
      let errorMessage = 'Failed to connect.';
      if (err.response?.data?.error) errorMessage = err.response.data.error;
      else if (err.message) errorMessage = err.message;
      // Set error in the main handler, just throw from here
      throw new Error(errorMessage); // Throw a new error with a potentially cleaner message
    }
  };

  // Handle connection form submission
  const handleConnect = async (e) => {
    console.log('[handleConnect] Initiated');
    if (e) e.preventDefault();
    setStage('connecting');
    setError('');
    setIsLoading(true);
    setPrimarySessionId(''); // Clear previous IDs
    setSecondarySessionId('');

    // Basic form validation
    try {
        if (!host || !username) throw new Error('Host and username are required');
        if (authMethod === 'password' && !password) throw new Error('Password is required');
        if (authMethod === 'key' && !privateKey) throw new Error('SSH private key is required');
    } catch (validationErr) {
        setError(validationErr.message);
        setStage('form');
        setIsLoading(false);
        return;
    }

    const currentCredentials = {
      host,
      port,
      username,
      authMethod,
      privateKey: authMethod === 'key' ? privateKey : null,
      password: authMethod === 'password' ? password : null,
    };

    try {
      // --- Attempt First Connection ---
      const firstSessionId = await establishSession(currentCredentials);
      setPrimarySessionId(firstSessionId);

      // --- Handle Based on Layout Choice ---
      if (layoutChoice === 'standard') {
        console.log('[handleConnect] Standard layout chosen. Setting stage to standardLayout.');
        setStage('standardLayout');
      } else {
        // --- Attempt Second Connection for Split View ---
        console.log('[handleConnect] Split layout chosen. Attempting second connection...');
        try {
          const secondSessionId = await establishSession(currentCredentials);
          console.log('[handleConnect] Second session established:', secondSessionId);
          setSecondarySessionId(secondSessionId);
          setStage('splitLayout');
          console.log('[handleConnect] Stage set to splitLayout.');
        } catch (secondErr) {
          console.error('[handleConnect] Second connection failed:', secondErr);
          setError(`Primary connection OK, but second session failed: ${secondErr.message}. Falling back to standard layout.`);
          console.log('[handleConnect] Falling back to standardLayout due to second connection failure.');
          // Keep primary session, fallback to standard layout
          setStage('standardLayout');
        }
      }
    } catch (firstErr) {
      // Error during the *first* connection attempt
      setError(firstErr.message); // Error message from establishSession
      setStage('form'); // Go back to form
    } finally {
      setIsLoading(false);
    }
  };


  // Disconnect from a specific SSH session
  const disconnectFromServer = async (targetSessionId) => {
    if (!targetSessionId) return;
    console.log(`Disconnecting session ${targetSessionId}`);

    const isPrimary = targetSessionId === primarySessionId;
    const isSecondary = targetSessionId === secondarySessionId;

    // Optimistically clear state
    if (isPrimary) setPrimarySessionId('');
    if (isSecondary) setSecondarySessionId('');
    setSessionDetails(prev => {
        const newDetails = { ...prev };
        delete newDetails[targetSessionId];
        return newDetails;
     });
     if (currentTranscriptSessionId.current === targetSessionId) closeTranscript();

     // Determine if we need to go back to the form
     const remainingPrimary = isPrimary ? '' : primarySessionId;
     const remainingSecondary = isSecondary ? '' : secondarySessionId;
     if (!remainingPrimary && !remainingSecondary) {
         setStage('form');
     }

    // Terminate on backend (fire and forget, mostly)
    try {
      await axios.delete(`http://localhost:3001/api/sessions/${targetSessionId}`);
      console.log(`Session ${targetSessionId} terminated successfully on backend.`);
    } catch (err) {
       // Check if it's an Axios error and the status is 404
       if (axios.isAxiosError(err) && err.response?.status === 404) {
         // Session already gone from backend, which is acceptable for disconnect.
         console.warn(`Session ${targetSessionId} not found on backend during disconnect (already terminated?).`);
       } else {
         // Log other errors as actual errors
         console.error(`Error terminating session ${targetSessionId} on backend:`, err);
         // Optionally: setError(`Failed to confirm disconnection for session ${targetSessionId}.`);
       }
    }
  };

  // Handle session close event from TerminalComponent (e.g., user typed 'exit')
  const handleSessionClose = (closedSessionId) => {
    console.log(`Terminal component reported session ${closedSessionId} closed.`);
    disconnectFromServer(closedSessionId); // Use the main disconnect logic
  };

  // --- Transcript Logic (Largely Unchanged) ---
  const viewTranscript = async (targetSessionId) => {
    if (!targetSessionId) {
      setError("No active session selected for transcript view.");
      return;
    }
    setTranscriptLoading(true);
    setError('');
    try {
      const response = await axios.get(`http://localhost:3001/api/transcripts?id=${targetSessionId}`);
      const readableContent = response.data.content || 'Transcript not available or empty.';
      setTranscriptContent(readableContent);
      currentTranscriptSessionId.current = targetSessionId;
      setShowTranscript(true);
      if (liveTranscriptUpdate) startLiveTranscriptUpdates(targetSessionId);
      setTimeout(() => {
        if (autoScroll && transcriptContentRef.current) {
          transcriptContentRef.current.scrollTop = transcriptContentRef.current.scrollHeight;
        }
      }, 100);
    } catch (err) {
      console.error('Failed to load transcript:', err);
      setError(`Failed to load transcript for session ${targetSessionId.substring(0, 8)}...`);
      setTranscriptContent('Error loading transcript.');
      currentTranscriptSessionId.current = null;
      setShowTranscript(true);
    } finally {
      setTranscriptLoading(false);
    }
  };

  const closeTranscript = () => {
    setShowTranscript(false);
    stopLiveTranscriptUpdates();
    setTranscriptContent('');
    currentTranscriptSessionId.current = null;
  };

  const startLiveTranscriptUpdates = (targetSessionId) => {
    stopLiveTranscriptUpdates();
    currentTranscriptSessionId.current = targetSessionId;
    transcriptUpdateIntervalRef.current = setInterval(async () => {
      if (!currentTranscriptSessionId.current || !showTranscript) {
         stopLiveTranscriptUpdates(); return;
      }
      try {
        const response = await axios.get(`http://localhost:3001/api/transcripts?id=${currentTranscriptSessionId.current}`);
        setTranscriptContent(response.data.content || '');
        if (autoScroll && transcriptContentRef.current) {
           const { scrollTop, scrollHeight, clientHeight } = transcriptContentRef.current;
           if (scrollHeight - scrollTop <= clientHeight + 20) {
             transcriptContentRef.current.scrollTop = transcriptContentRef.current.scrollHeight;
           }
        }
      } catch (err) {
        console.error('Failed to auto-update transcript:', err);
        if (err.response && err.response.status === 404) {
          setError(`Transcript session ${currentTranscriptSessionId.current?.substring(0,8)}... ended.`);
          stopLiveTranscriptUpdates();
        }
      }
    }, 2500);
  };

  const stopLiveTranscriptUpdates = () => {
    if (transcriptUpdateIntervalRef.current) {
      clearInterval(transcriptUpdateIntervalRef.current);
      transcriptUpdateIntervalRef.current = null;
    }
  };

  const toggleLiveTranscriptUpdates = () => {
    const targetSessionId = currentTranscriptSessionId.current;
    if (!targetSessionId) return;
    const turningOn = !liveTranscriptUpdate;
    setLiveTranscriptUpdate(turningOn);
    if (turningOn) {
      startLiveTranscriptUpdates(targetSessionId);
      viewTranscript(targetSessionId);
    } else {
      stopLiveTranscriptUpdates();
    }
  };

  // --- Render Logic ---

  const renderConnectionForm = () => (
    <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto">
      <h2 className="text-xl font-semibold mb-4">Connect to Server</h2>

      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
          <p>{error}</p>
        </div>
      )}

      <form onSubmit={handleConnect}>
        {/* Credentials Inputs */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
          {/* Host */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Host *</label>
            <input type="text" value={host} onChange={(e) => setHost(e.target.value)} className={styles.formInputStd} placeholder="hostname or IP" required disabled={isLoading} />
          </div>
          {/* Port */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Port</label>
            <input type="text" value={port} onChange={(e) => setPort(e.target.value)} className={styles.formInputStd} placeholder="22" disabled={isLoading} />
          </div>
          {/* Username */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Username *</label>
            <input type="text" value={username} onChange={(e) => setUsername(e.target.value)} className={styles.formInputStd} placeholder="user" required disabled={isLoading} />
          </div>
          {/* Auth Method */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Authentication</label>
            <select value={authMethod} onChange={(e) => setAuthMethod(e.target.value)} className={styles.formSelectStd} disabled={isLoading}>
              <option value="key">SSH Key</option>
              <option value="password">Password</option>
            </select>
          </div>
          {/* Key / Password Area */}
          <div className="md:col-span-2">
            {authMethod === 'password' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Password *</label>
                <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} className={styles.formInputStd} required={authMethod === 'password'} disabled={isLoading} />
              </div>
            ) : (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Private Key *</label>
                <textarea
                  value={privateKey}
                  onChange={(e) => setPrivateKey(e.target.value)}
                  className={`${styles.formTextareaStd} h-32`}
                  placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                  spellCheck="false"
                  required={authMethod === 'key'}
                  disabled={isLoading}
                />
              </div>
            )}
          </div>
        </div>

        {/* Layout Selection */}
        <div className="mb-6">
          <label className="block text-sm font-medium text-gray-700 mb-2">Terminal Layout:</label>
          <div className="flex space-x-4">
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-blue-600"
                name="layoutChoice"
                value="standard"
                checked={layoutChoice === 'standard'}
                onChange={() => setLayoutChoice('standard')}
                disabled={isLoading}
              />
              <span className="ml-2 text-gray-700">Standard</span>
            </label>
            <label className="inline-flex items-center">
              <input
                type="radio"
                className="form-radio text-purple-600"
                name="layoutChoice"
                value="split"
                checked={layoutChoice === 'split'}
                onChange={() => setLayoutChoice('split')}
                disabled={isLoading}
              />
              <span className="ml-2 text-gray-700">Split View</span>
            </label>
          </div>
        </div>

        {/* Buttons */}
        <div className="flex justify-between mt-6">
           <Link href="/" className={`bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`} aria-disabled={isLoading}> Back </Link>
          <button
            type="submit"
            className={`bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 flex items-center ${isLoading ? 'opacity-50 cursor-not-allowed' : ''}`}
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path></svg>
                Connecting...
              </>
            ) : (
              'Connect'
            )}
          </button>
        </div>
      </form>
    </div>
  );

   const renderTerminal = (targetSessionId, panelLabel = null) => {
     if (!targetSessionId) return null; // Don't render if session ID is missing
     const details = sessionDetails[targetSessionId] || {};
     const displayHost = details.host || 'unknown';
     const displayUser = details.username || 'unknown';

     return (
      <div key={targetSessionId} className={`${styles.terminalWrapper} ${panelLabel ? styles.splitTerminalWrapper : ''}`}>
           <div className={`bg-gray-800 text-white p-1 px-2 flex justify-between items-center ${styles.terminalHeader}`}>
             <div className="flex items-center overflow-hidden whitespace-nowrap">
               <span className="font-mono text-xs mr-2">{displayUser}@{displayHost}</span>
               <span className="text-xs bg-green-600 text-white px-1.5 py-0.5 rounded-full mr-2">Online</span>
               {panelLabel && <span className="text-xs text-gray-400">(Panel {panelLabel})</span>}
             </div>
             <div className="flex items-center space-x-1.5">
               <button
                 onClick={() => viewTranscript(targetSessionId)}
                 className={`bg-blue-600 text-white px-1.5 py-0.5 rounded text-xs hover:bg-blue-700 ${transcriptLoading && currentTranscriptSessionId.current === targetSessionId ? 'opacity-50 cursor-not-allowed' : ''}`}
                 disabled={transcriptLoading && currentTranscriptSessionId.current === targetSessionId}
                 title="View Session Log"
               >
                 {transcriptLoading && currentTranscriptSessionId.current === targetSessionId ? '...' : 'Log'}
               </button>
               {layoutChoice === 'standard' && (
                 <button
                   onClick={() => disconnectFromServer(targetSessionId)}
                   className="bg-red-600 text-white px-1.5 py-0.5 rounded text-xs hover:bg-red-700"
                   title="Disconnect Session"
                  > X </button>
               )}
             </div>
           </div>
         {/* Terminal instance container */}
         <div className={styles.terminalInstanceContainer}>
           <TerminalComponent
             sessionId={targetSessionId}
             onSessionClose={() => handleSessionClose(targetSessionId)}
             panelId={panelLabel}
           />
         </div>
       </div>
     );
   };

  return (
    <div className={`min-h-screen ${(stage === 'splitLayout' || stage === 'standardLayout') ? styles.layoutActive : 'bg-gray-100'}`}>
      <Head>
        <title>SSH Terminal</title>
      </Head>

      {/* Render based on stage */}
      {(stage === 'form' || stage === 'connecting') && (
         <main className="container mx-auto px-4 py-8">
           <h1 className="text-3xl font-bold mb-6 text-center">SSH Terminal</h1>
           {renderConnectionForm()} {/* Form handles its own loading state display */}
         </main>
       )}

      {stage === 'standardLayout' && primarySessionId && (
        <main className={`container mx-auto px-4 py-8 flex flex-col flex-grow ${styles.standardLayoutMain}`} style={{ height: 'calc(100vh - 50px)' }}> {/* Adjust height based on actual header/footer */}
           {/* Show error if fallback occurred */}
           {error && error.includes('second session') && (
              <div className="bg-yellow-100 border-l-4 border-yellow-500 text-yellow-700 p-4 mb-4 flex-shrink-0"> {/* Error should not grow */}
                 <p>{error}</p>
              </div>
           )}
            {/* This div will grow to fill the space within the flex container */}
           <div className={`flex-grow min-h-0 ${styles.terminalContainerDiv}`}>
             {renderTerminal(primarySessionId)}
           </div>
        </main>
      )}

      {stage === 'splitLayout' && primarySessionId && secondarySessionId && (
        <main className={styles.threePanelLayoutMain}> {/* New class name */}
          {/* Left Panel: File Explorer */}
          <div className={styles.leftPanelFiles}>
            <FileExplorer sessionId={primarySessionId} />
          </div>

          {/* Middle Panel: Browser over Terminal A */}
          <div className={styles.middlePanelContainer}>
            <div className={styles.middlePanelBrowser}>
              <BrowserPanel />
            </div>
            <div className={styles.middlePanelTerminalA}>
              {renderTerminal(primarySessionId, 'A')}
            </div>
          </div>

          {/* Right Panel: Terminal B */}
          <div className={styles.rightPanelTerminalB}>
            {renderTerminal(secondarySessionId, 'B')}
          </div>
        </main>
      )}

      {/* Transcript Modal (Common) */}
      {showTranscript && (
         <div className={styles.transcriptOverlay}>
           <div className={styles.transcriptModal}>
             <div className={styles.transcriptHeader}>
                <h2 className="text-lg font-semibold"> Session Log ({currentTranscriptSessionId.current?.substring(0, 8)}...) </h2>
               <div className={styles.transcriptControls}>
                 <label className={styles.controlLabel}> <input type="checkbox" checked={autoScroll} onChange={() => setAutoScroll(!autoScroll)} /> Auto-scroll </label>
                 <button className={`${styles.liveButton} ${liveTranscriptUpdate ? styles.liveActive : ''}`} onClick={toggleLiveTranscriptUpdates} disabled={!currentTranscriptSessionId.current} title={liveTranscriptUpdate ? "Disable live updates" : "Enable live updates"}> {liveTranscriptUpdate ? 'Live: ON' : 'Live: OFF'} </button>
                 <button className={styles.closeButton} onClick={closeTranscript}> Close </button>
               </div>
             </div>
             <pre className={styles.transcriptContent} ref={transcriptContentRef}> {transcriptContent} </pre>
           </div>
         </div>
       )}

    </div>
  );
}
