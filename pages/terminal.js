import { useState, useEffect, useRef } from 'react';
import Head from 'next/head';
import axios from 'axios';
import dynamic from 'next/dynamic';

// Dynamically import Terminal with no SSR
const TerminalComponent = dynamic(
  () => import('../components/TerminalComponent'),
  { ssr: false }
);

export default function TerminalPage() {
  const [isConnected, setIsConnected] = useState(false);
  const [sessionId, setSessionId] = useState('');
  const [host, setHost] = useState('');
  const [port, setPort] = useState('22');
  const [username, setUsername] = useState('');
  const [authMethod, setAuthMethod] = useState('key');
  const [password, setPassword] = useState('');
  const [selectedKey, setSelectedKey] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [availableKeys, setAvailableKeys] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');
  const [useStoredKeys, setUseStoredKeys] = useState(true);
  
  const socketRef = useRef(null);
  
  // Fetch available SSH keys on component mount
  useEffect(() => {
    async function fetchKeys() {
      try {
        const response = await axios.get('/api/keys');
        setAvailableKeys(response.data.keys || []);
        if (response.data.keys?.length > 0) {
          setSelectedKey(response.data.keys[0].id);
        } else {
          // If no keys available, default to direct key input
          setUseStoredKeys(false);
        }
      } catch (err) {
        console.error('Failed to fetch SSH keys:', err);
        setError('Failed to load SSH keys');
        setUseStoredKeys(false);
      }
    }
    
    fetchKeys();
    
    // Clean up on unmount
    return () => {
      if (socketRef.current) {
        socketRef.current.close();
      }
    };
  }, []);

  // Connect to SSH server using the new WebSocket server
  const connectToServer = async (e) => {
    e.preventDefault();
    setError('');
    setIsLoading(true);
    
    // Clean up any existing session
    if (sessionId) {
      try {
        console.log('Terminating existing session before reconnecting');
        await axios.delete(`http://localhost:3001/api/sessions/${sessionId}`);
      } catch (err) {
        console.warn('Failed to terminate existing session:', err);
        // Continue anyway - we'll create a new session
      }
      setSessionId('');
    }
    
    try {
      // Basic validation
      if (!host || !username) {
        throw new Error('Host and username are required');
      }
      
      if (authMethod === 'password' && !password) {
        throw new Error('Password is required');
      }
      
      if (authMethod === 'key' && !useStoredKeys && !privateKey) {
        throw new Error('SSH key is required');
      }
      
      // Start SSH session via the standalone API server
      console.log("Connecting to SSH server:", {
        host,
        port: parseInt(port, 10) || 22,
        username,
        authMethod
      });
      
      const requestData = {
        host,
        port: parseInt(port, 10) || 22,
        username,
        authMethod,
        // Set to false to use real SSH connections
        demoMode: false
      };
      
      // Add auth credentials
      if (authMethod === 'password') {
        requestData.password = password;
      } else {
        // Always send the private key directly to the standalone server
        // since it doesn't have access to the stored keys
        requestData.privateKey = privateKey;
      }
      
      // Send request to our standalone server
      const response = await axios.post('http://localhost:3001/api/sessions', requestData);
      
      const { sessionId: newSessionId } = response.data;
      console.log(`Session created with ID: ${newSessionId}`);
      
      // Store the session ID
      setSessionId(newSessionId);
      setIsConnected(true);
      setIsLoading(false);
      
    } catch (err) {
      console.error('Connection error:', err);
      setError(err.response?.data?.error || err.message || 'Failed to connect');
      setIsLoading(false);
    }
  };
  
  // Disconnect from SSH server
  const disconnect = async () => {
    setIsLoading(true);
    
    try {
      // Terminate the session on the backend
      if (sessionId) {
        console.log(`Terminating session ${sessionId}`);
        await axios.delete(`http://localhost:3001/api/sessions/${sessionId}`);
        console.log('Session terminated successfully');
      }
    } catch (err) {
      console.error('Error terminating session:', err);
    } finally {
      // Reset client state
      setSessionId('');
      setIsConnected(false);
      setError('');
      setIsLoading(false);
      console.log('Terminal session reset');
    }
  };

  // Handle session close event from terminal component
  const handleSessionClose = () => {
    console.log('Terminal session closed');
    setIsConnected(false);
    setSessionId('');
  };
  
  return (
    <div className="min-h-screen bg-gray-100">
      <Head>
        <title>SSH Terminal | Next.js SSH Terminal</title>
      </Head>
      
      <main className="container mx-auto px-4 py-8">
        <h1 className="text-3xl font-bold mb-6">SSH Terminal</h1>
        
        {!isConnected ? (
          <div className="bg-white p-6 rounded-lg shadow-md max-w-2xl mx-auto">
            <div className="flex justify-between items-center mb-4">
              <h2 className="text-xl font-semibold">Connect to Server</h2>
              <span className="px-3 py-1 bg-gray-200 rounded-md text-sm text-gray-600">
                {isConnected ? 'Active Connection' : 'Ready for Connection'}
              </span>
            </div>
            
            {error && (
              <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-4 mb-4">
                <p>{error}</p>
              </div>
            )}
            
            <form onSubmit={connectToServer}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Host *
                  </label>
                  <input
                    type="text"
                    value={host}
                    onChange={(e) => setHost(e.target.value)}
                    className="w-full p-2 border rounded-md"
                    placeholder="hostname or IP"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Port
                  </label>
                  <input
                    type="text"
                    value={port}
                    onChange={(e) => setPort(e.target.value)}
                    className="w-full p-2 border rounded-md"
                    placeholder="22"
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Username *
                  </label>
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    className="w-full p-2 border rounded-md"
                    placeholder="username"
                    required
                  />
                </div>
                
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">
                    Authentication Method
                  </label>
                  <select
                    value={authMethod}
                    onChange={(e) => setAuthMethod(e.target.value)}
                    className="w-full p-2 border rounded-md"
                  >
                    <option value="key">SSH Key</option>
                    <option value="password">Password</option>
                  </select>
                </div>
                
                {authMethod === 'password' ? (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Password *
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      className="w-full p-2 border rounded-md"
                      placeholder="password"
                      required={authMethod === 'password'}
                    />
                  </div>
                ) : (
                  <div className="md:col-span-2">
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      SSH Key *
                    </label>
                    <textarea
                      value={privateKey}
                      onChange={(e) => setPrivateKey(e.target.value)}
                      className="w-full p-2 border rounded-md font-mono text-sm"
                      rows={8}
                      placeholder="-----BEGIN RSA PRIVATE KEY-----..."
                      required={authMethod === 'key'}
                    ></textarea>
                    
                    <div className="mt-1 text-xs text-gray-500 flex items-center">
                      <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 mr-1 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                      </svg>
                      <span>Paste your private key here. The key will not be stored on the server.</span>
                    </div>
                  </div>
                )}
              </div>
              
              <div className="flex justify-between mt-6">
                <a
                  href="/"
                  className="bg-gray-500 text-white py-2 px-4 rounded-md hover:bg-gray-600 transition-colors"
                >
                  Back to Home
                </a>
                
                <button
                  type="submit"
                  className="bg-blue-600 text-white py-2 px-6 rounded-md hover:bg-blue-700 transition-colors flex items-center"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <>
                      <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Connecting...
                    </>
                  ) : (
                    'Connect'
                  )}
                </button>
              </div>
            </form>
          </div>
        ) : (
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-gray-800 text-white p-3 flex justify-between items-center">
              <div>
                <span className="font-mono">{username}@{host}</span>
                <span className="ml-2 text-xs bg-green-500 text-white px-2 py-0.5 rounded-full">Connected</span>
              </div>
              <button
                onClick={disconnect}
                className="bg-red-600 text-white px-3 py-1 rounded-md text-sm hover:bg-red-700 transition-colors"
              >
                Disconnect
              </button>
            </div>
            <TerminalComponent 
              sessionId={sessionId}
              onSessionClose={handleSessionClose}
            />
          </div>
        )}
      </main>
    </div>
  );
}