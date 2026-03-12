import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createSession, writeToSession, closeSession } from '../lib/pty';
import { SHELL_TYPES, ShellType, Block } from '../lib/types';
import BlockView from './blocks/BlockView';

export const MAX_BLOCKS = 50;

const SHELL_LABELS: Record<ShellType, string> = {
  powershell: 'PowerShell',
  cmd: 'CMD',
  wsl: 'WSL',
};

function createBlock(command: string, shellType: ShellType): Block {
  return {
    id: crypto.randomUUID(),
    command,
    output: '',
    timestamp: Date.now(),
    status: 'running',
    shellType,
  };
}

function Terminal() {
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shellType, setShellType] = useState<ShellType>('powershell');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const activeBlockIdRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [closed, setClosed] = useState(false);
  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const startSessionIdRef = useRef(0);

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
      const thisInvocation = ++startSessionIdRef.current;

      // Close any existing session first to prevent leaks
      if (sessionIdRef.current) {
        cleanupListeners();
        await closeSession(sessionIdRef.current).catch(() => {});
        updateSessionId(null);
      }

      try {
        const sid = await createSession(shell, 24, 80);

        // Bail if this invocation was superseded (e.g., by StrictMode remount)
        if (startSessionIdRef.current !== thisInvocation) {
          closeSession(sid).catch(() => {});
          return;
        }

        updateSessionId(sid);
        setClosed(false);

        // Create initial welcome block
        const welcomeBlock = createBlock('', shell);
        activeBlockIdRef.current = welcomeBlock.id;
        setBlocks([welcomeBlock]);

        // Clean up any previous listeners before setting new ones
        cleanupListeners();

        const unlistenOutput = await listen<string>(
          `pty:output:${sid}`,
          (event) => {
            setBlocks((prev) =>
              prev.map((b) =>
                b.id === activeBlockIdRef.current
                  ? { ...b, output: b.output + event.payload }
                  : b,
              ),
            );
          },
        );

        // Check again after async listen
        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenError = await listen<string>(
          `pty:error:${sid}`,
          (event) => {
            setBlocks((prev) =>
              prev.map((b) =>
                b.id === activeBlockIdRef.current
                  ? { ...b, output: b.output + `\n[Error: ${event.payload}]\n` }
                  : b,
              ),
            );
          },
        );

        // Check again after async listen
        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenError();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenClosed = await listen<void>(
          `pty:closed:${sid}`,
          () => {
            setClosed(true);
          },
        );

        // Check again after async listen
        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenError();
          unlistenClosed();
          closeSession(sid).catch(() => {});
          return;
        }

        unlistenRefs.current = [unlistenOutput, unlistenError, unlistenClosed];
      } catch (err) {
        // Bail if this invocation was superseded
        if (startSessionIdRef.current !== thisInvocation) return;

        const errorBlock = createBlock('', shell);
        errorBlock.output = `[Failed to create session: ${err}]`;
        errorBlock.status = 'completed';
        activeBlockIdRef.current = errorBlock.id;
        setBlocks([errorBlock]);
      }
    },
    [updateSessionId, cleanupListeners],
  );

  const resetAndStart = useCallback(
    async (shell: ShellType) => {
      // Increment counter to cancel any in-flight startSession
      startSessionIdRef.current++;

      if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});
      }
      cleanupListeners();
      setBlocks([]);
      activeBlockIdRef.current = null;
      setInput('');
      setClosed(false);
      updateSessionId(null);
      await startSession(shell);
    },
    [cleanupListeners, startSession, updateSessionId],
  );

  // Initialize session on mount
  useEffect(() => {
    startSession('powershell');

    return () => {
      // Invalidate any in-flight startSession from this mount
      startSessionIdRef.current++;
      cleanupListeners();
      // Close session on unmount — best-effort, using ref for current value
      if (sessionIdRef.current) {
        closeSession(sessionIdRef.current).catch(() => {});
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Auto-scroll to bottom when blocks update
  useEffect(() => {
    if (outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [blocks]);

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

  const submitCommand = useCallback(
    (command: string) => {
      if (!sessionIdRef.current || closed) return;
      const newBlock = createBlock(command, shellType);
      // Finalize current active block, add new block, enforce limit
      setBlocks((prev) => {
        const updated = prev.map((b) =>
          b.id === activeBlockIdRef.current
            ? { ...b, status: 'completed' as const }
            : b,
        );
        const withNew = [...updated, newBlock];
        return withNew.length > MAX_BLOCKS
          ? withNew.slice(-MAX_BLOCKS)
          : withNew;
      });
      activeBlockIdRef.current = newBlock.id;
      writeToSession(sessionIdRef.current, command + '\r').catch((err) => {
        setBlocks((prev) =>
          prev.map((b) =>
            b.id === newBlock.id
              ? { ...b, output: b.output + `\n[Write error: ${err}]\n` }
              : b,
          ),
        );
      });
    },
    [closed, shellType],
  );

  const handleRerun = useCallback(
    (command: string) => {
      submitCommand(command);
    },
    [submitCommand],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && sessionIdRef.current && !closed) {
        submitCommand(input);
        setInput('');
      }
    },
    [submitCommand, input, closed],
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
      <div
        ref={outputRef}
        className="terminal-output"
        data-testid="terminal-output"
      >
        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            isActive={block.id === activeBlockIdRef.current}
            onRerun={handleRerun}
          />
        ))}
        {closed && <div className="block-process-exited">[Process exited]</div>}
      </div>
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
