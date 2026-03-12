import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createSession, writeToSession, closeSession } from '../lib/pty';
import { SHELL_TYPES, ShellType } from '../lib/types';
import AnsiOutput from './AnsiOutput';

const OUTPUT_BUFFER_LIMIT = 100_000;

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  wsl: 'WSL',
};

function Terminal() {
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shellType, setShellType] = useState<ShellType>('powershell');
  const [output, setOutput] = useState('');
  const [input, setInput] = useState('');
  const [closed, setClosed] = useState(false);
  const outputRef = useRef<HTMLPreElement>(null);
  const unlistenRefs = useRef<(() => void)[]>([]);

  const updateSessionId = useCallback((id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
  }, []);

  const cleanupListeners = useCallback(() => {
    for (const unlisten of unlistenRefs.current) {
      unlisten();
    }
    unlistenRefs.current = [];
  }, []);

  const startSession = useCallback(
    async (shell: ShellType) => {
      try {
        const sid = await createSession(shell, 24, 80);
        updateSessionId(sid);
        setClosed(false);

        const unlistenOutput = await listen<string>(
          `pty:output:${sid}`,
          (event) => {
            setOutput((prev) => {
              const next = prev + event.payload;
              if (next.length > OUTPUT_BUFFER_LIMIT) {
                return next.slice(next.length - OUTPUT_BUFFER_LIMIT);
              }
              return next;
            });
          },
        );

        const unlistenError = await listen<string>(
          `pty:error:${sid}`,
          (event) => {
            setOutput((prev) => prev + `\n[Error: ${event.payload}]\n`);
          },
        );

        const unlistenClosed = await listen<void>(
          `pty:closed:${sid}`,
          () => {
            setClosed(true);
          },
        );

        unlistenRefs.current = [unlistenOutput, unlistenError, unlistenClosed];
      } catch (err) {
        setOutput(`[Failed to create session: ${err}]`);
      }
    },
    [updateSessionId],
  );

  const resetAndStart = useCallback(
    async (shell: ShellType) => {
      if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});
      }
      cleanupListeners();
      setOutput('');
      setInput('');
      setClosed(false);
      updateSessionId(null);
      await startSession(shell);
    },
    [cleanupListeners, startSession, updateSessionId],
  );

  // Initialize session on mount
  useEffect(() => {
    let mounted = true;

    async function init() {
      if (!mounted) return;
      await startSession('powershell');
    }

    init();

    return () => {
      mounted = false;
      cleanupListeners();
      // Close session on unmount — best-effort, using ref for current value
      if (sessionIdRef.current) {
        closeSession(sessionIdRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output]);

  const handleShellSwitch = useCallback(
    async (newShell: ShellType) => {
      if (newShell === shellType && !closed) return;
      setShellType(newShell);
      await resetAndStart(newShell);
    },
    [shellType, closed, resetAndStart],
  );

  const handleRestart = useCallback(async () => {
    await resetAndStart(shellType);
  }, [shellType, resetAndStart]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && sessionId && !closed) {
        writeToSession(sessionId, input + '\r').catch((err) => {
          setOutput((prev) => prev + `\n[Write error: ${err}]\n`);
        });
        setInput('');
      }
    },
    [sessionId, input, closed],
  );

  return (
    <div className="terminal-container">
      <div className="shell-selector" role="tablist" data-testid="shell-selector">
        {SHELL_TYPES.map((shell) => (
          <button
            key={shell}
            role="tab"
            className={`shell-btn ${shell === shellType ? 'shell-btn-active' : ''}`}
            data-testid={`shell-btn-${shell}`}
            aria-selected={shell === shellType}
            onClick={() => handleShellSwitch(shell)}
          >
            {SHELL_LABELS[shell]}
          </button>
        ))}
      </div>
      <pre
        ref={outputRef}
        className="terminal-output"
        data-testid="terminal-output"
      >
        <AnsiOutput text={output} />
        {closed && '\n[Process exited]'}
      </pre>
      {closed ? (
        <div className="terminal-restart-row">
          <button
            className="restart-btn"
            data-testid="restart-button"
            onClick={handleRestart}
          >
            Restart
          </button>
        </div>
      ) : (
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
      )}
    </div>
  );
}

export default Terminal;
