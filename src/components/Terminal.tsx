import { useEffect, useRef, useState, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createSession, writeToSession, closeSession, startReading } from '../lib/pty';
import { SHELL_TYPES, ShellType, Block } from '../lib/types';
import { extractExitCode, getExitCodeMarker } from '../lib/exit-code-parser';
import { classifyIntent, stripHashPrefix, ClassificationResult } from '../lib/intent-classifier';
import { translateCommand } from '../lib/llm';
import { getCwd } from '../lib/cwd';
import { useKnownCommands } from '../hooks/useKnownCommands';
import BlockView from './blocks/BlockView';
import InputEditor from './editor/InputEditor';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { useGhostText } from '../hooks/useGhostText';

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
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const translationIdRef = useRef(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const startSessionIdRef = useRef(0);

  // Intent classifier state
  const [inputMode, setInputMode] = useState<ClassificationResult>({ intent: 'cli', confidence: 'high' });
  const [modeOverride, setModeOverride] = useState(false);
  const knownCommands = useKnownCommands();

  const { history, addCommand, navigateUp, navigateDown, reset, setDraft } = useCommandHistory();
  const { suggestion } = useGhostText(input, history);

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
              prev.map((b) => {
                if (b.id !== activeBlockIdRef.current) return b;
                const newOutput = b.output + event.payload;
                const { cleanOutput, exitCode } = extractExitCode(newOutput);
                return {
                  ...b,
                  output: cleanOutput,
                  ...(exitCode !== null ? { exitCode, status: 'completed' as const } : {}),
                };
              }),
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

        // Start the reader thread NOW — all listeners are guaranteed to be
        // registered, so no output will be lost to the emit/listen race.
        await startReading(sid);

        // Check staleness one more time after the async startReading call
        if (startSessionIdRef.current !== thisInvocation) {
          cleanupListeners();
          closeSession(sid).catch(() => {});
          return;
        }
      } catch (err) {
        // Bail if this invocation was superseded
        if (startSessionIdRef.current !== thisInvocation) return;

        const errorBlock = createBlock('', shell);
        errorBlock.output = `[Failed to create session: ${err}]`;
        errorBlock.status = 'completed';
        activeBlockIdRef.current = errorBlock.id;
        setBlocks([errorBlock]);
        setClosed(true);
      }
    },
    [updateSessionId, cleanupListeners],
  );

  const resetAndStart = useCallback(
    async (shell: ShellType) => {
      // Increment counter to cancel any in-flight startSession
      startSessionIdRef.current++;
      // Cancel any in-flight agent translation
      translationIdRef.current++;

      cleanupListeners(); // Stop listening FIRST to prevent stale events during async gap
      if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});
      }
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
      // Cancel any in-flight agent translation immediately on shell switch
      translationIdRef.current++;
      setAgentLoading(false);
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
      // Skip the exit-code marker for commands that kill the shell (e.g. "exit").
      // The marker suffix would never execute and its echoed text clutters the output.
      const trimmedLower = command.trim().toLowerCase();
      const isExitCommand = trimmedLower === 'exit' || trimmedLower.startsWith('exit ');
      const markerSuffix = isExitCommand ? '' : getExitCodeMarker(shellType);
      writeToSession(sessionIdRef.current, command.replace(/\n/g, '\r') + markerSuffix + '\r').catch((err) => {
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

  const handleSubmit = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) {
        setInput('');
        return;
      }

      // Use inputMode.intent to determine routing (replaces hardcoded hasHashPrefix check)
      if (inputMode.intent === 'natural_language') {
        // Agent mode: translate via LLM
        // Strip # prefix if present (backward compatible)
        const nlInput = trimmed.startsWith('#') ? stripHashPrefix(trimmed) : trimmed;
        if (!nlInput) {
          setInput('');
          return;
        }
        const thisTranslation = ++translationIdRef.current;
        setAgentLoading(true);
        setAgentError(null);
        try {
          const cwd = await getCwd().catch(() => 'C:\\');
          const translated = await translateCommand(nlInput, shellType, cwd);
          // Discard stale translation if user switched shells or reset while in-flight
          if (translationIdRef.current !== thisTranslation) return;
          setInput(translated); // Put translated command in the editor for review
          // After translation populates, reset override so auto-detect kicks in on next input
          setModeOverride(false);
          setInputMode({ intent: 'cli', confidence: 'high' });
        } catch (err) {
          // Discard stale error if user switched shells or reset while in-flight
          if (translationIdRef.current !== thisTranslation) return;
          setAgentError(String(err));
        } finally {
          if (translationIdRef.current === thisTranslation) {
            setAgentLoading(false);
          }
        }
        return; // Don't execute — user reviews first
      }

      // CLI mode: execute normally
      addCommand(trimmed);
      submitCommand(trimmed);
      setInput('');
      // Reset mode override after submit
      setModeOverride(false);
      setInputMode({ intent: 'cli', confidence: 'high' });
    },
    [shellType, addCommand, submitCommand, inputMode],
  );

  const handleInputChange = useCallback(
    (newValue: string) => {
      setInput(newValue);
      setDraft(newValue);
      reset();
      // Clear agent error when user starts typing
      setAgentError(null);
      // Auto-classify on input change (unless user has manually overridden)
      if (!modeOverride) {
        setInputMode(classifyIntent(newValue, knownCommands));
      }
    },
    [setDraft, reset, modeOverride, knownCommands],
  );

  const handleToggleMode = useCallback(() => {
    setInputMode(prev => ({
      intent: prev.intent === 'cli' ? 'natural_language' : 'cli',
      confidence: 'high',
    }));
    setModeOverride(true);
  }, []);

  const handleNavigateUp = useCallback(() => {
    setDraft(input);
    const prev = navigateUp();
    if (prev !== null) {
      setInput(prev);
    }
  }, [input, setDraft, navigateUp]);

  const handleNavigateDown = useCallback(() => {
    const next = navigateDown();
    if (next !== null) {
      setInput(next);
    }
  }, [navigateDown]);

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
        <div data-testid="terminal-input">
          {agentLoading && (
            <div className="agent-loading" data-testid="agent-loading">
              <span className="agent-spinner">&#x27F3;</span>
              Translating...
            </div>
          )}
          <InputEditor
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            disabled={closed || agentLoading}
            ghostText={suggestion}
            onNavigateUp={handleNavigateUp}
            onNavigateDown={handleNavigateDown}
            mode={inputMode}
            onToggleMode={handleToggleMode}
          />
          {agentError && (
            <div className="agent-error" data-testid="agent-error">
              {agentError}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default Terminal;
