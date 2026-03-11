import { useEffect, useRef, useState, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

const OUTPUT_BUFFER_LIMIT = 100_000;

function Terminal() {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [closed, setClosed] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);

  useEffect(() => {
    let mounted = true;
    let unlistenOutput: (() => void) | null = null;
    let unlistenError: (() => void) | null = null;
    let unlistenClosed: (() => void) | null = null;
    let sid: string | null = null;

    async function init() {
      try {
        sid = await invoke<string>('create_session', {
          shell_type: 'powershell',
          rows: 24,
          cols: 80,
        });

        if (!mounted) return;
        setSessionId(sid);

        unlistenOutput = await listen<string>(`pty:output:${sid}`, (event) => {
          setOutput((prev) => {
            const next = prev + event.payload;
            if (next.length > OUTPUT_BUFFER_LIMIT) {
              return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
            }
            return next;
          });
        });

        unlistenError = await listen<string>(`pty:error:${sid}`, (event) => {
          setOutput((prev) => prev + `\n[Error: ${event.payload}]\n`);
        });

        unlistenClosed = await listen<void>(`pty:closed:${sid}`, () => {
          setClosed(true);
        });
      } catch (err) {
        if (mounted) {
          setOutput(`[Failed to create session: ${err}]`);
        }
      }
    }

    init();

    return () => {
      mounted = false;
      if (unlistenOutput) unlistenOutput();
      if (unlistenError) unlistenError();
      if (unlistenClosed) unlistenClosed();
      if (sid) {
        invoke('close_session', { session_id: sid }).catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && sessionId && !closed) {
        invoke('write_to_session', {
          session_id: sessionId,
          data: input + '\r',
        }).catch(() => {});
        setInput('');
      }
    },
    [sessionId, input, closed],
  );

  return (
    <div className="terminal-container">
      <pre
        ref={outputRef}
        className="terminal-output"
        data-testid="terminal-output"
      >
        {output}
        {closed && '\n[Process exited]'}
      </pre>
      <div className="terminal-input-row">
        <span className="terminal-prompt">&gt;</span>
        <input
          className="terminal-input"
          data-testid="terminal-input"
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={closed}
          autoFocus
        />
      </div>
    </div>
  );
}

export default Terminal;
