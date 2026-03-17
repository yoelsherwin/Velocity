import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { createSession, writeToSession, closeSession, startReading } from '../lib/pty';
import { SHELL_TYPES, ShellType, Block } from '../lib/types';
import { extractExitCode, getExitCodeMarker } from '../lib/exit-code-parser';
import { classifyIntent, stripHashPrefix, ClassificationResult } from '../lib/intent-classifier';
import { translateCommand } from '../lib/llm';
import { getCwd } from '../lib/cwd';
import { stripAnsi } from '../lib/ansi';
import { useKnownCommands } from '../hooks/useKnownCommands';
import BlockView from './blocks/BlockView';
import InputEditor from './editor/InputEditor';
import SearchBar from './SearchBar';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { useGhostText } from '../hooks/useGhostText';
import { useBlockVisibility } from '../hooks/useBlockVisibility';
import { useSearch } from '../hooks/useSearch';
import { HighlightRange } from './AnsiOutput';

export const MAX_BLOCKS = 500;
export const OUTPUT_LIMIT_PER_BLOCK = 500_000;

const TRUNCATION_MARKER = '[Output truncated \u2014 showing last 500KB]\n';

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

interface TerminalProps {
  paneId?: string;
}

function Terminal({ paneId }: TerminalProps) {
  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shellType, setShellType] = useState<ShellType>('powershell');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const blocksRef = useRef<Block[]>(blocks);
  blocksRef.current = blocks;
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
  const { visibleIds, observeBlock } = useBlockVisibility();
  const search = useSearch(blocks);

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
                let newOutput = b.output + event.payload;
                // Apply per-block output cap: truncate from front, keep most recent output
                if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
                  newOutput = TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK);
                }
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

  // Ref for the search input element, passed to SearchBar
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Ctrl+Shift+F keyboard handler for search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.shiftKey && (e.key === 'f' || e.key === 'F')) {
        e.preventDefault();
        if (search.isOpen) {
          // Re-focus the search input
          searchInputRef.current?.focus();
        } else {
          search.open();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [search.isOpen, search.open]);

  // Ref for the editor textarea, used to return focus on search close
  const editorRef = useRef<HTMLTextAreaElement>(null);

  // When search closes, return focus to the InputEditor
  const handleSearchClose = useCallback(() => {
    search.close();
    // Return focus to the editor textarea
    editorRef.current?.focus();
  }, [search.close]);

  // Listen for velocity:command custom events (dispatched by command palette)
  useEffect(() => {
    const handleCommand = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      const commandId = detail?.commandId;
      if (!commandId) return;

      // Ignore events targeted at a different pane
      if (detail.paneId && paneId && detail.paneId !== paneId) return;

      switch (commandId) {
        case 'shell.powershell':
          handleShellSwitch('powershell');
          break;
        case 'shell.cmd':
          handleShellSwitch('cmd');
          break;
        case 'shell.wsl':
          handleShellSwitch('wsl');
          break;
        case 'terminal.restart':
          handleRestart();
          break;
        case 'terminal.toggleMode':
          handleToggleMode();
          break;
        case 'terminal.clear':
          setBlocks([]);
          activeBlockIdRef.current = null;
          break;
        case 'terminal.copyLastCommand': {
          const lastCmdBlock = [...blocksRef.current].reverse().find((b) => b.command.trim() !== '');
          if (lastCmdBlock) {
            navigator.clipboard.writeText(lastCmdBlock.command).catch(() => {});
          }
          break;
        }
        case 'terminal.copyLastOutput': {
          const lastOutBlock = [...blocksRef.current].reverse().find((b) => b.output.trim() !== '');
          if (lastOutBlock) {
            navigator.clipboard.writeText(stripAnsi(lastOutBlock.output)).catch(() => {});
          }
          break;
        }
        case 'search.find':
          if (search.isOpen) {
            searchInputRef.current?.focus();
          } else {
            search.open();
          }
          break;
        default:
          break;
      }
    };

    document.addEventListener('velocity:command', handleCommand);
    return () => document.removeEventListener('velocity:command', handleCommand);
  }, [paneId, handleShellSwitch, handleRestart, handleToggleMode, search.isOpen, search.open]);

  // Scroll to current match when it changes
  useEffect(() => {
    if (search.currentMatchIndex < 0 || search.matches.length === 0) return;

    let innerTimer: ReturnType<typeof setTimeout>;
    // Use a short delay to allow the DOM to render highlights
    const timer = setTimeout(() => {
      const currentEl = document.querySelector('.search-highlight-current[data-match-current="true"]');
      if (currentEl) {
        currentEl.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
      } else {
        // The block might be off-screen (placeholder). Scroll the block container into view first.
        const match = search.matches[search.currentMatchIndex];
        if (match) {
          const blockContainers = document.querySelectorAll('[data-testid="block-container"]');
          // Find the matching block container
          const blockIndex = blocks.findIndex(b => b.id === match.blockId);
          if (blockIndex >= 0 && blockContainers[blockIndex]) {
            blockContainers[blockIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            // After scroll, try again to find the highlight element
            innerTimer = setTimeout(() => {
              const el = document.querySelector('.search-highlight-current[data-match-current="true"]');
              el?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
            }, 200);
          }
        }
      }
    }, 50);

    return () => { clearTimeout(timer); clearTimeout(innerTimer); };
  }, [search.currentMatchIndex, search.matches, blocks]);

  // Compute highlights for each block, only for visible blocks
  const blockHighlights = useMemo((): Map<string, HighlightRange[]> => {
    if (!search.isOpen || search.matches.length === 0) return new Map();

    const result = new Map<string, HighlightRange[]>();
    const currentMatch = search.currentMatchIndex >= 0
      ? search.matches[search.currentMatchIndex]
      : null;

    for (const [blockId, blockMatches] of search.matchesByBlock) {
      // Only compute highlights for visible blocks
      if (!visibleIds.has(blockId)) continue;

      const highlights: HighlightRange[] = blockMatches.map((m) => ({
        startOffset: m.startOffset,
        length: m.length,
        isCurrent: currentMatch !== null
          && m.blockId === currentMatch.blockId
          && m.startOffset === currentMatch.startOffset,
      }));
      result.set(blockId, highlights);
    }

    return result;
  }, [search.isOpen, search.matches, search.matchesByBlock, search.currentMatchIndex, visibleIds]);

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
        <SearchBar
          query={search.query}
          setQuery={search.setQuery}
          caseSensitive={search.caseSensitive}
          setCaseSensitive={search.setCaseSensitive}
          matchCount={search.matches.length}
          currentMatchIndex={search.currentMatchIndex}
          goToNext={search.goToNext}
          goToPrev={search.goToPrev}
          isOpen={search.isOpen}
          onClose={handleSearchClose}
          inputRef={searchInputRef}
        />
        {blocks.map((block) => (
          <BlockView
            key={block.id}
            block={block}
            isActive={block.id === activeBlockIdRef.current}
            onRerun={handleRerun}
            isVisible={visibleIds.has(block.id)}
            observeRef={(el) => observeBlock(block.id, el)}
            highlights={blockHighlights.get(block.id)}
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
            textareaRef={editorRef}
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
