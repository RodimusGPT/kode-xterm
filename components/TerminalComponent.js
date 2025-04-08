import { useEffect, useRef, useState } from 'react';

// Simple debounce utility
function debounce(func, wait) {
  let timeout;
  return function executedFunction(...args) {
    const later = () => {
      clearTimeout(timeout);
      func(...args);
    };
    clearTimeout(timeout);
    timeout = setTimeout(later, wait);
  };
}

export default function TerminalComponent({ sessionId, onSessionClose, panelId }) {
  const terminalRef = useRef(null);
  const terminalContainerRef = useRef(null);
  const fitAddonRef = useRef(null);
  const wsRef = useRef(null);
  const [isTerminalReady, setIsTerminalReady] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState(null);
  
  // Define forceResize BEFORE using it in debounce
  const forceResize = () => {
     if (fitAddonRef.current && terminalRef.current && terminalContainerRef.current) {
      console.log(`TerminalComponent [${sessionId?.substring(0,4)}]: Debounced forceResize executing`); // Log entry
      try {
        if (terminalContainerRef.current.clientHeight > 0 &&
            terminalContainerRef.current.clientWidth > 0) {
          console.log(`TerminalComponent [${sessionId?.substring(0,4)}]: Container has dimensions (${terminalContainerRef.current.clientWidth}x${terminalContainerRef.current.clientHeight}), fitting...`);
          fitAddonRef.current.fit();
          console.log(`TerminalComponent [${sessionId?.substring(0,4)}]: Initial fit complete. Tentative size: ${terminalRef.current.cols}x${terminalRef.current.rows}`);

          // --- Manual Row Calculation Override ---
          const term = terminalRef.current;
          const container = terminalContainerRef.current;
          if (term.renderer?.dimensions?.actualCellHeight > 0) {
              const containerHeight = container.clientHeight;
              const effectiveHeight = containerHeight;
              const cellHeight = term.renderer.dimensions.actualCellHeight;
              const calculatedRows = Math.floor(effectiveHeight / cellHeight);
              console.log(`TerminalComponent [${sessionId?.substring(0,4)}]: Post-fit check. ContainerH: ${containerHeight}, CellH: ${cellHeight}, FitRows: ${term.rows}, CalcRows: ${calculatedRows}`);
              if (term.rows !== calculatedRows && calculatedRows > 0) {
                  console.log(`TerminalComponent [${sessionId?.substring(0,4)}]: Row mismatch detected. Resizing to ${term.cols}x${calculatedRows}`);
                  term.resize(term.cols, calculatedRows);
                  // REMOVED aggressive scroll reset here
              }
          } else {
            console.warn(`TerminalComponent [${sessionId?.substring(0,4)}]: Could not get cell height for manual row calculation.`);
          }
          // --- End Manual Row Calculation ---

          terminalRef.current.scrollToBottom();
          setIsTerminalReady(true);
        } else {
           console.log('TerminalComponent: Container has no dimensions, skipping force fit');
        }
      } catch (e) {
        console.error('Error during force resize fit:', e);
      }
    } else {
       console.log('TerminalComponent: Refs not ready for force resize');
    }
  };

  const debouncedForceResize = useRef(debounce(forceResize, 50)).current; // Debounce by 50ms


  // Maybe set isTerminalReady in forceResize after a successful fit?
  // Let's modify forceResize slightly:
  /* // Original forceResize definition moved up and modified
  const forceResize = () => {
    // ... content moved up ...
  };
  */

  
  // Initialize terminal when component mounts or when sessionId changes
  useEffect(() => {
    console.log(`TerminalComponent: sessionId changed to ${sessionId}, panelId: ${panelId || 'unknown'}`);
    if (!sessionId) return;

    let observer = null; // Define observer variable
    let panelBDelayedFitTimer = null; // For delayed fit in Panel B

    const timer = setTimeout(() => {
      // If terminal already exists, dispose it first
      if (terminalRef.current) {
        console.log('TerminalComponent: disposing existing terminal');
        terminalRef.current.dispose();
        terminalRef.current = null;
      }

      initTerminal(); // Initializes terminal, fitAddon etc.
      initWebSocket();

      // --- ResizeObserver Setup ---
      if (terminalContainerRef.current) {
        observer = new ResizeObserver((entries) => {
          // Log the observed size
          for (let entry of entries) {
            const { width, height } = entry.contentRect;
            console.log(`ResizeObserver [${sessionId?.substring(0,4)}/${panelId || '?'}] triggered: Observed size ${width}x${height}. Calling forceResize.`);
          }
          forceResize();
        });
        observer.observe(terminalContainerRef.current);
        console.log(`ResizeObserver [${sessionId?.substring(0,4)}/${panelId || '?'}] observing terminal container.`);
      }
      // --- End ResizeObserver Setup ---

      // Special handling for Panel B - Add delayed fit
      if (panelId === 'B') {
        console.log('Panel B detected: Adding delayed fit timers');
        
        // First fit after 1 second
        panelBDelayedFitTimer = setTimeout(() => {
          console.log('PANEL B: Executing 1-second delayed fit');
          if (fitAddonRef.current && terminalRef.current) {
            try {
              fitAddonRef.current.fit();
              console.log('PANEL B: 1-second delayed fit complete');
            } catch(e) {
              console.error('Error in Panel B delayed fit:', e);
            }
          }
          
          // Second fit after 2 seconds total
          setTimeout(() => {
            console.log('PANEL B: Executing 2-second delayed fit');
            if (fitAddonRef.current && terminalRef.current) {
              try {
                fitAddonRef.current.fit();
                console.log('PANEL B: 2-second delayed fit complete');
              } catch(e) {
                console.error('Error in Panel B second delayed fit:', e);
              }
            }
          }, 1000);
        }, 1000);
      }

    }, 500); // Initial delay before setup

    return () => {
      clearTimeout(timer);
      // Clear Panel B special timer if it exists
      if (panelBDelayedFitTimer) {
        clearTimeout(panelBDelayedFitTimer);
      }
      // Disconnect observer on cleanup
      if (observer) {
        console.log('Disconnecting ResizeObserver.');
        observer.disconnect();
      }
      // Clean up WebSocket on unmount
      if (wsRef.current) {
        wsRef.current.close();
        wsRef.current = null;
      }
    };
  }, [sessionId, panelId]); // Re-initialize when sessionId or panelId changes

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
            // Write terminal output
            if (terminalRef.current && message.data) {
              // --- START: Added logging around write ---
              const term = terminalRef.current;
              console.log('[Before write] State:', {
                viewportY: term.buffer.active.viewportY,
                baseY: term.buffer.active.baseY,
                rows: term.rows,
                clientHeight: term.element?.clientHeight,
              });
              term.write(message.data);
              console.log('[After write] State:', {
                 viewportY: term.buffer.active.viewportY,
                 baseY: term.buffer.active.baseY,
                 rows: term.rows,
                 clientHeight: term.element?.clientHeight,
               });
              // --- END: Added logging around write ---

              // Use setTimeout to delay scroll reset slightly after write
              setTimeout(() => {
                 // Re-check refs inside timeout
                 if (terminalRef.current) { // Only need terminalRef
                    try {
                      console.log('TerminalComponent: Resetting scroll after write (delayed)');
                      // REMOVED: fitAddonRef.current.fit();
                      terminalRef.current.scrollToTop();
                      terminalRef.current.scrollToBottom();
                      // --- START: Added logging after scroll ---
                      console.log('[After scroll attempts] State:', {
                        viewportY: term.buffer.active.viewportY,
                        baseY: term.buffer.active.baseY,
                        rows: term.rows,
                        clientHeight: term.element?.clientHeight,
                      });
                      // --- END: Added logging after scroll ---
                    } catch (e) {
                      console.error('Error scrolling after write (delayed):', e);
                    }
                 }
              }, 0); // Minimal delay
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
        rows: 24,  // Default rows
        scrollback: 5000,
        allowProposedApi: true // Add this to use proposed APIs
        // padding: 10 // Temporarily removed
      });
      
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);
      
      // Open terminal in the container
      term.open(terminalContainerRef.current);
      
      // Store references
      terminalRef.current = term;
      fitAddonRef.current = fitAddon;
      
      // Perform an initial fit AFTER the ResizeObserver is set up and WebSocket might have connected.
      // Let the observer handle the initial fit.
      // setTimeout(() => { ... initial fit logic ... }, 100);

      // Set terminal ready state maybe after websocket connects or first resize happens?
      // For simplicity now, let's assume connection implies readiness for interaction.
      // We can refine this if needed. Maybe set it in forceResize?

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
            console.log('TerminalComponent: Window resize detected, fitting terminal'); // Added log
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
        className="w-full bg-black flex-grow"
        style={{ position: 'relative', height: '100%' }}
      />
      
      {/* Status bar removed per user request */}
    </div>
  );
}