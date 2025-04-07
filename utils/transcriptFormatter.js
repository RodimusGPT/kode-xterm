/**
 * Utility functions for formatting terminal transcripts in a human-readable way
 */

/**
 * Main function to process raw transcript content into a human-readable format.
 * It focuses on presenting commands and their corresponding output clearly.
 *
 * @param {string} rawContent - Raw transcript content from the log file.
 * @returns {string} Formatted transcript content.
 */
export function formatTranscript(rawContent) {
  if (!rawContent) {
    console.warn('No content provided to formatter');
    return '';
  }

  const lines = rawContent.split('\n');
  const formattedLines = [];
  let sessionInfo = {};

  // --- Pass 1: Extract Header and Parse Events ---
  const events = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('#')) {
      if (i < 10) { // Only parse header within first few lines
         if (line.startsWith('# Terminal Transcript')) formattedLines.push(line);
         const hostMatch = line.match(/^# Host: (.*)$/);
         const userMatch = line.match(/^# User: (.*)$/);
         const startedMatch = line.match(/^# Started: (.*)$/);
         if (hostMatch) sessionInfo.host = hostMatch[1].trim();
         if (userMatch) sessionInfo.user = userMatch[1].trim();
         if (startedMatch) sessionInfo.started = startedMatch[1].trim();
      }
      continue; // Skip processing header lines further
    }

    if (!line.trim()) continue; // Skip empty lines between events

    const match = line.match(/^\[([^\]]+)\] \[([A-Z_]+)\] (.*)$/);
    if (match) {
      const [, timestamp, type, content] = match;
      // Decode the escaped characters from the log format
      const decodedContent = content.replace(/\\r/g, '\r').replace(/\\n/g, '\n');
      events.push({ timestamp, type, content: decodedContent });
    } else if (events.length > 0) {
        // Append line to previous event's content if doesn't match log format
        const lastEvent = events[events.length - 1];
        lastEvent.content += '\n' + line;
    }
  }

  // Construct header string
  if (sessionInfo.user && sessionInfo.host) {
     formattedLines.push(`# ${sessionInfo.user}@${sessionInfo.host}`);
  }
  if (sessionInfo.started) {
     formattedLines.push(`# Started: ${sessionInfo.started}`);
  }
  formattedLines.push(''); // Blank line after header

  // --- Pass 2: Process Events into Command/Output Blocks ---
  let currentBlock = { command: null, outputLines: [], timestamp: null, isRepl: false };
  let lastCommandContent = null;

  for (let i = 0; i < events.length; i++) {
    const event = events[i];

    if (event.type === 'COMMAND' || event.type === 'REPL_COMMAND') {
      // Process the previous block before starting a new command
      if (currentBlock.command || currentBlock.outputLines.length > 0) {
        formattedLines.push(...processAndFormatBlock(currentBlock));
      }

      // Start a new block
      const commandContent = event.content.trim();
       if (commandContent.endsWith(' (incomplete)')) {
           currentBlock = { command: `[INCOMPLETE] ${commandContent.replace(' (incomplete)', '')}`, outputLines: [], timestamp: event.timestamp, isRepl: false };
           lastCommandContent = null; // Reset context
       } else {
           lastCommandContent = commandContent;
           currentBlock = {
               command: commandContent,
               outputLines: [],
               timestamp: event.timestamp,
               isRepl: event.type === 'REPL_COMMAND',
               commandTimestamp: event.timestamp // Store exact command timestamp
           };
       }
    } else if (event.type === 'OUTPUT' || event.type === 'ERROR' || event.type === 'SYSTEM') {
       // Add output line to the current block
       const prefix = event.type === 'ERROR' ? '[ERROR] ' : (event.type === 'SYSTEM' ? '[SYSTEM] ' : '');
        // Check if output is just echo of input chars (heuristic)
        // If output matches last command chars exactly, and is very close in time, maybe skip?
        // This is hard. Let's rely on cleaning in processAndFormatBlock for now.
       currentBlock.outputLines.push(prefix + event.content);
    }
    // Ignore INPUT type
  }

  // Process the final block
  if (currentBlock.command || currentBlock.outputLines.length > 0) {
     formattedLines.push(...processAndFormatBlock(currentBlock));
  }

  // --- Pass 3: Final Cleanup --- 
  let finalOutput = formattedLines.join('\n');
  // Remove excessive consecutive blank lines (3+ becomes 2)
  finalOutput = finalOutput.replace(/\n{3,}/g, '\n\n');

  return finalOutput.trim();
}

/**
 * Processes a block (command + subsequent output lines), cleans the output,
 * and formats it for display.
 *
 * @param {object} block - An object containing { command, outputLines, timestamp, isRepl, commandTimestamp }
 * @returns {string[]} An array of formatted lines for this block.
 */
function processAndFormatBlock(block) {
    const blockLines = [];

    // Add the command line, prefixed appropriately
    if (block.command) {
        if (block.command.startsWith('[INCOMPLETE]')) {
            blockLines.push(block.command);
        } else {
            const prompt = block.isRepl ? '>>>' : '$';
            blockLines.push(`${prompt} ${block.command}`);
        }
    }

    // Combine and clean the output lines for this block
    let combinedOutput = block.outputLines.join('');
    let cleanedOutput = cleanTerminalString(combinedOutput, block.command);

    // Add cleaned output lines, filtering initial/trailing blank lines
    if (cleanedOutput.trim()) {
        const outputLines = cleanedOutput.split('\n');
        let firstContentLine = -1;
        let lastContentLine = -1;

        for(let i=0; i < outputLines.length; i++) {
            if (outputLines[i].trim() !== '') {
                if (firstContentLine === -1) firstContentLine = i;
                lastContentLine = i;
            }
        }

        if(firstContentLine !== -1) {
             // Add only lines with content, preserving internal structure
             blockLines.push(...outputLines.slice(firstContentLine, lastContentLine + 1));
        }
    }

    // Add a blank line after the block for separation, if it contained anything
    if (blockLines.length > 0 && (block.command || cleanedOutput.trim())) {
         blockLines.push('');
    }

    return blockLines;
}

/**
 * Cleans a string containing raw terminal output.
 * Removes ANSI escape codes, control characters, handles carriage returns,
 * filters echo, prompts, and known noise patterns.
 *
 * @param {string} rawString - The raw string potentially containing terminal codes.
 * @param {string|null} precedingCommand - The command text that came before this output block.
 * @returns {string} The cleaned string.
 */
function cleanTerminalString(rawString, precedingCommand) {
    if (!rawString) return '';

    // --- Step 1: Basic cleaning of control chars & ANSI codes ---
    let cleaned = rawString
        .replace(/\x1b\[[0-9;?]*[a-zA-Z]/g, '') // ANSI escape codes (CSI)
        .replace(/\x1b\][^\x07]*\x07/g, '')   // OSC sequences
        .replace(/\x1b[()][0-9A-B]/g, '')     // Character set selection
        .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, ''); // Other C0 control chars except \n, \r, \t

    // --- Step 2: Simulate line overwrites caused by carriage return (\r) ---
    const lines = cleaned.split('\n');
    const processedLines = [];
    lines.forEach(line => {
        let currentLineContent = '';
        const parts = line.split('\r');
        currentLineContent = parts[0];
        for (let i = 1; i < parts.length; i++) {
            const overwritePart = parts[i];
            const len = overwritePart.length;
            currentLineContent = overwritePart + currentLineContent.substring(len);
        }
        processedLines.push(currentLineContent);
    });
    cleaned = processedLines.join('\n');

    // --- Step 3: Remove command echo specifically ---
    // This is tricky. We only remove if it appears at the very start
    // of the cleaned block, potentially after some whitespace.
    if (precedingCommand) {
        const commandPattern = precedingCommand.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); // Escape regex chars
        // Match command at the start, possibly preceded by whitespace/newlines, followed by newline
        const echoRegex = new RegExp(`^[\s\n]*${commandPattern}\r?\n?`);
        cleaned = cleaned.replace(echoRegex, '');
    }

    // --- Step 4: Filter known application-specific noise & prompts ---
    // Remove Claude Code UI box more robustly
    cleaned = cleaned.replace(/^\s*╭[─]+╮[\s\S]*?^\s*╰[─]+╯\s*$/gm, '');
    // Remove common shell prompts appearing at the start of a line
    cleaned = cleaned.replace(/^[\w\-]+@[\w\-\.]+:[^\$#%]*[\$#% G>]+ /gm, ''); // Common prompt pattern
     // Remove simple REPL prompts if they are the only thing on the line
     cleaned = cleaned.split('\n').map(line => {
         const trimmed = line.trim();
         if (trimmed === '>>>' || trimmed === '...' || trimmed === '>') return '';
         if (trimmed.match(/^irb\(.*\)[>*]$/) || trimmed.match(/^scala>$/) || trimmed.match(/^ghci>$/)) return '';
         return line;
     }).filter(line => line !== null).join('\n'); // Filter out removed lines


    // --- Step 5: Final whitespace cleanup ---
    // Trim leading/trailing whitespace from the whole block
    cleaned = cleaned.trim();
    // Normalize multiple blank lines inside the output to a single blank line
    cleaned = cleaned.replace(/\n\s*\n/g, '\n\n');

    return cleaned;
}


/**
 * Simplified version that just returns visible commands and output
 * without timestamps and internal markup. This essentially calls the main formatter.
 *
 * @param {string} rawContent - Raw transcript content
 * @returns {string} Simplified transcript content
 */
export function simplifyTranscript(rawContent) {
  // The main formatTranscript function now produces the desired simplified output
  return formatTranscript(rawContent);
}
