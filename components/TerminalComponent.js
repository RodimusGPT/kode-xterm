import { useEffect, useRef, useState } from 'react';

export default function TerminalComponent({ sessionId, onSessionClose }) {
  const terminalRef = useRef(null);
  const terminalContainerRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);

  // Initialize terminal when component mounts or when sessionId changes
  useEffect(() => {
    console.log(`TerminalComponent: sessionId changed to ${sessionId}`);
    
    if (!sessionId) return;
    
    // Make sure the DOM element is visible before initializing
    const timer = setTimeout(() => {
      // If terminal already exists, dispose it first
      if (terminalRef.current) {
        console.log('TerminalComponent: disposing existing terminal');
        terminalRef.current.dispose();
        terminalRef.current = null;
      }
      
      // Initialize new terminal
      initTerminal();
      
      // Initialize WebSocket connection
      initWebSocket();
    }, 500);

    return () => {
      clearTimeout(timer);
      
      // Clean up WebSocket on unmount
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId]); // Re-initialize when sessionId changes

  // Initialize WebSocket connection
  const initWebSocket = () => {
    // Close existing connection if any
    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
    
    // WebSocket server URL - would be configurable in production
    const wsUrl = `ws://localhost:3001`;
    
    console.log(`Connecting to WebSocket server: ${wsUrl}`);
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    
    // Connection opened
    ws.addEventListener('open', (event) => {
      console.log('WebSocket connection established');
      setIsConnected(true);
      setError(null);
      
      // Join the session
      ws.send(JSON.stringify({
        type: 'join',
        sessionId: sessionId
      }));
    });
    
    // Listen for messages
    ws.addEventListener('message', (event) => {
      try {
        const message = JSON.parse(event.data);
        console.log(`Received message type: ${message.type}`);
        
        switch (message.type) {
          case 'output':
            // Write terminal output
            if (terminalRef.current && message.data) {
              terminalRef.current.write(message.data);
            }
            break;
            
          case 'error':
            // Display error
            console.error('Terminal error:', message.data);
            setError(message.data);
            break;
            
          case 'closed':
            // Terminal session closed
            console.log('Terminal session closed by server');
            if (terminalRef.current) {
              terminalRef.current.write('\r\n\nConnection closed\r\n');
            }
            
            // Notify parent component
            if (onSessionClose) {
              onSessionClose();
            }
            break;
            
          default:
            console.log('Unknown message type:', message.type);
        }
      } catch (err) {
        console.error('Error processing message:', err);
      }
    });
    
    // Connection closed
    ws.addEventListener('close', (event) => {
      console.log('WebSocket connection closed');
      setIsConnected(false);
      
      // Notify parent component
      if (onSessionClose) {
        onSessionClose();
      }
    });
    
    // Connection error
    ws.addEventListener('error', (event) => {
      console.error('WebSocket error:', event);
      setError('Failed to connect to terminal server');
      setIsConnected(false);
    });
  };

  const initTerminal = async () => {
    if (!terminalContainerRef.current) return;

    try {
      // Import xterm and fit addon dynamically to avoid SSR issues
      const { Terminal } = await import('xterm');
      const { FitAddon } = await import('xterm-addon-fit');
      await import('xterm/css/xterm.css');

      // Clear previous terminal instance
      if (terminalRef.current) {
        terminalRef.current.dispose();
      }
      
      terminalContainerRef.current.innerHTML = '';
      
      // Create new terminal instance with explicit initial dimensions
      const term = new Terminal({
        cursorBlink: true,
        theme: {
          background: '#1e1e1e',
          foreground: '#f0f0f0'
        },
        fontFamily: 'Menlo, Monaco, "Courier New", monospace',
        fontSize: 14,
        lineHeight: 1.2,
        cols: 80, // Default columns
        rows: 24  // Default rows
      });
      
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      
      // Open terminal in the container
      term.open(terminalContainerRef.current);
      
      // Store references
      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      
      // Fit terminal to container
      setTimeout(() => {
        try {
          // Only fit if the element has dimensions
          if (terminalContainerRef.current.clientHeight > 0 && 
              terminalContainerRef.current.clientWidth > 0) {
            fitAddon.fit();
            
            // Send initial dimensions to server
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'resize',
                cols: term.cols,
                rows: term.rows
              }));
            }
          }
        } catch (e) {
          console.error('Error fitting terminal:', e);
        }
        
        // Mark terminal as ready
        setIsTerminalReady(true);
      }, 100);
      
      // Handle terminal input
      term.onData(data => {
        // Send input to server
        if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
          wsRef.current.send(JSON.stringify({
            type: 'input',
            data: data
          }));
        }
      });
      
      // Focus terminal
      term.focus();
      
      // Handle window resize
      const handleResize = () => {
        if (fitAddonRef.current && terminalRef.current) {
          try {
            fitAddonRef.current.fit();
            
            // Send new dimensions to server
            if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({
                type: 'resize',
                cols: terminalRef.current.cols,
                rows: terminalRef.current.rows
              }));
            }
          } catch (e) {
            console.error('Error handling resize:', e);
          }
        }
      };
      
      // Add resize event listener
      window.addEventListener('resize', handleResize);
      
      // Return cleanup function
      return () => {
        window.removeEventListener('resize', handleResize);
        if (terminalRef.current) {
          terminalRef.current.dispose();
        }
      };
    } catch (error) {
      console.error('Failed to initialize terminal:', error);
      setError('Failed to initialize terminal');
    }
  };

  return (
    <div className="flex flex-col h-full">
      {error && (
        <div className="bg-red-100 border-l-4 border-red-500 text-red-700 p-2 mb-2 text-sm">
          <p>{error}</p>
        </div>
      )}
      
      <div 
        ref={terminalContainerRef}
        className="h-[70vh] w-full bg-black flex-grow"
        style={{ minHeight: '400px', position: 'relative' }}
      />
      
      <div className="flex justify-between items-center px-2 py-1 bg-gray-800 text-white text-xs">
        <span>
          {isConnected ? (
            <span className="text-green-400">● Connected</span>
          ) : (
            <span className="text-red-400">● Disconnected</span>
          )}
        </span>
        
        <span>Session: {sessionId?.substring(0, 8) || 'None'}</span>
      </div>
    </div>
  );
}