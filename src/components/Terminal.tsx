import { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { useQuitWarning } from '../hooks/useQuitWarning';
import { listen } from '@tauri-apps/api/event';
import { createSession, writeToSession, closeSession, startReading } from '../lib/pty';
import { isValidCwdPath } from '../lib/session';
import { SHELL_TYPES, ShellType, Block } from '../lib/types';
import { extractExitCode, getExitCodeMarker } from '../lib/exit-code-parser';
import { classifyIntent, stripHashPrefix, ClassificationResult } from '../lib/intent-classifier';
import { translateCommand, classifyIntentLLM } from '../lib/llm';
import { getSettings } from '../lib/settings';
import { getCwd } from '../lib/cwd';
import { getGitInfo, type GitInfo } from '../lib/git';
import { stripAnsi } from '../lib/ansi';
import { showCommandNotification, sendTestNotification } from '../lib/notifications';
import { encodeKey } from '../lib/key-encoder';
import { computeTabTitle } from '../lib/tab-title';
import { useKnownCommands } from '../hooks/useKnownCommands';
import BlockView from './blocks/BlockView';
import InputEditor from './editor/InputEditor';
import TerminalGrid, { GridRow, GridUpdatePayload } from './TerminalGrid';
import SearchBar from './SearchBar';
import HistorySearch from './HistorySearch';
import { useCommandHistory } from '../hooks/useCommandHistory';
import { useSessionContext } from '../lib/session-context';
import { useCompletions } from '../hooks/useCompletions';
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
  onTitleChange?: (title: string) => void;
}

function Terminal({ paneId, onTitleChange }: TerminalProps) {
  const { getSavedPane, updatePaneData } = useSessionContext();
  const savedPaneRef = useRef(paneId ? getSavedPane(paneId) : undefined);
  const savedPane = savedPaneRef.current;

  const sessionIdRef = useRef<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [shellType, setShellType] = useState<ShellType>(savedPane?.shellType ?? 'powershell');
  const [blocks, setBlocks] = useState<Block[]>([]);
  const blocksRef = useRef<Block[]>(blocks);
  blocksRef.current = blocks;
  const activeBlockIdRef = useRef<string | null>(null);
  const [input, setInput] = useState('');
  const [closed, setClosed] = useState(false);
  const [altScreenActive, setAltScreenActive] = useState(false);
  const [focusedBlockIndex, setFocusedBlockIndex] = useState(-1);
  const [collapsedBlocks, setCollapsedBlocks] = useState<Set<string>>(new Set());
  const [gridRows, setGridRows] = useState<GridRow[]>([]);
  const [cursorRow, setCursorRow] = useState<number>(0);
  const [cursorCol, setCursorCol] = useState<number>(0);
  const [cursorVisible, setCursorVisible] = useState<boolean>(true);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState<string | null>(null);
  const [loadingLabel, setLoadingLabel] = useState<string>('Translating...');
  const translationIdRef = useRef(0);
  const outputRef = useRef<HTMLDivElement>(null);
  const unlistenRefs = useRef<(() => void)[]>([]);
  const startSessionIdRef = useRef(0);

  // Intent classifier state
  const [inputMode, setInputMode] = useState<ClassificationResult>({ intent: 'cli', confidence: 'high' });
  const [modeOverride, setModeOverride] = useState(false);
  const knownCommands = useKnownCommands();

  const [cursorPos, setCursorPos] = useState(0);
  const [cwd, setCwd] = useState(savedPane?.cwd ?? 'C:\\');
  const [gitInfo, setGitInfo] = useState<GitInfo | null>(null);
  const [runningCommand, setRunningCommand] = useState<string | null>(null);

  const { history, addCommand, navigateUp, navigateDown, reset, setDraft } = useCommandHistory(
    100,
    savedPane?.history ?? [],
  );
  const completions = useCompletions(input, cursorPos, history, knownCommands, cwd);
  const { visibleIds, observeBlock } = useBlockVisibility();
  const search = useSearch(blocks);
  const [historySearchOpen, setHistorySearchOpen] = useState(false);
  const savedInputRef = useRef('');
  const [hasApiKey, setHasApiKey] = useState(false);

  // Keep a stable ref for onTitleChange to avoid re-triggering the effect
  const onTitleChangeRef = useRef(onTitleChange);
  onTitleChangeRef.current = onTitleChange;

  // Emit tab title changes when CWD or running command changes
  useEffect(() => {
    if (onTitleChangeRef.current) {
      const title = computeTabTitle(cwd, runningCommand, '');
      if (title) {
        onTitleChangeRef.current(title);
      }
    }
  }, [cwd, runningCommand]);

  // Determine the most recently failed block (for error suggestion)
  const mostRecentFailedBlockId = useMemo(() => {
    for (let i = blocks.length - 1; i >= 0; i--) {
      const b = blocks[i];
      if (b.command && b.status === 'completed' && b.exitCode != null && b.exitCode !== 0) {
        return b.id;
      }
    }
    return null;
  }, [blocks]);

  // Warn on window close if any command is still running
  const hasRunningProcesses = useMemo(
    () => blocks.some((b) => b.command !== '' && b.status === 'running'),
    [blocks],
  );
  useQuitWarning(hasRunningProcesses);

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
            let commandCompleted = false;
            let completedBlockInfo: { command: string; exitCode: number; timestamp: number } | null = null;
            setBlocks((prev) =>
              prev.map((b) => {
                if (b.id !== activeBlockIdRef.current) return b;
                let newOutput = b.output + event.payload;
                // Apply per-block output cap: truncate from front, keep most recent output
                if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
                  newOutput = TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK);
                }
                const { cleanOutput, exitCode } = extractExitCode(newOutput);
                if (exitCode !== null) {
                  commandCompleted = true;
                  completedBlockInfo = { command: b.command, exitCode, timestamp: b.timestamp };
                }
                return {
                  ...b,
                  output: cleanOutput,
                  ...(exitCode !== null ? { exitCode, status: 'completed' as const } : {}),
                };
              }),
            );
            // Re-fetch CWD after command completes so path completions use the
            // current directory. MVP limitation: the child shell's CWD (e.g. after
            // `cd`) is not directly observable from the parent process, so this
            // returns the Tauri process CWD which may differ from the shell's CWD.
            if (commandCompleted) {
              setRunningCommand(null);
              getCwd().then((dir) => {
                setCwd(dir);
                getGitInfo(dir).then(setGitInfo).catch(() => setGitInfo(null));
              }).catch(() => {});
              // Show desktop notification for long-running commands
              if (completedBlockInfo) {
                const { command, exitCode, timestamp } = completedBlockInfo;
                showCommandNotification(command, exitCode, timestamp).catch(() => {});
              }
            }
          },
        );

        // Check again after async listen
        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenOutputReplace = await listen<string>(
          `pty:output-replace:${sid}`,
          (event) => {
            let commandCompleted = false;
            let completedBlockInfo: { command: string; exitCode: number; timestamp: number } | null = null;
            setBlocks((prev) =>
              prev.map((b) => {
                if (b.id !== activeBlockIdRef.current) return b;
                let newOutput = event.payload;
                // Apply per-block output cap
                if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
                  newOutput = TRUNCATION_MARKER + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK);
                }
                const { cleanOutput, exitCode } = extractExitCode(newOutput);
                if (exitCode !== null) {
                  commandCompleted = true;
                  completedBlockInfo = { command: b.command, exitCode, timestamp: b.timestamp };
                }
                return {
                  ...b,
                  output: cleanOutput,
                  ...(exitCode !== null ? { exitCode, status: 'completed' as const } : {}),
                };
              }),
            );
            if (commandCompleted) {
              setRunningCommand(null);
              getCwd().then((dir) => {
                setCwd(dir);
                getGitInfo(dir).then(setGitInfo).catch(() => setGitInfo(null));
              }).catch(() => {});
              // Show desktop notification for long-running commands
              if (completedBlockInfo) {
                const { command, exitCode, timestamp } = completedBlockInfo;
                showCommandNotification(command, exitCode, timestamp).catch(() => {});
              }
            }
          },
        );

        // Check again after async listen
        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenOutputReplace();
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
          unlistenOutputReplace();
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
          unlistenOutputReplace();
          unlistenError();
          unlistenClosed();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenAltScreenEnter = await listen<{ rows: number; cols: number }>(
          `pty:alt-screen-enter:${sid}`,
          () => {
            setAltScreenActive(true);
          },
        );

        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenOutputReplace();
          unlistenError();
          unlistenClosed();
          unlistenAltScreenEnter();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenAltScreenExit = await listen<void>(
          `pty:alt-screen-exit:${sid}`,
          () => {
            setAltScreenActive(false);
            setGridRows([]);
          },
        );

        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenOutputReplace();
          unlistenError();
          unlistenClosed();
          unlistenAltScreenEnter();
          unlistenAltScreenExit();
          closeSession(sid).catch(() => {});
          return;
        }

        const unlistenGridUpdate = await listen<GridUpdatePayload>(
          `pty:grid-update:${sid}`,
          (event) => {
            setGridRows(event.payload.rows);
            setCursorRow(event.payload.cursor_row);
            setCursorCol(event.payload.cursor_col);
            setCursorVisible(event.payload.cursor_visible);
          },
        );

        if (startSessionIdRef.current !== thisInvocation) {
          unlistenOutput();
          unlistenOutputReplace();
          unlistenError();
          unlistenClosed();
          unlistenAltScreenEnter();
          unlistenAltScreenExit();
          unlistenGridUpdate();
          closeSession(sid).catch(() => {});
          return;
        }

        unlistenRefs.current = [
          unlistenOutput,
          unlistenOutputReplace,
          unlistenError,
          unlistenClosed,
          unlistenAltScreenEnter,
          unlistenAltScreenExit,
          unlistenGridUpdate,
        ];

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
    const initialShell = savedPaneRef.current?.shellType ?? 'powershell';
    const initialCwd = savedPaneRef.current?.cwd;
    startSession(initialShell).then(() => {
      // After session starts, cd to saved CWD if available
      if (initialCwd && initialCwd !== 'C:\\' && sessionIdRef.current && isValidCwdPath(initialCwd)) {
        // Use shell-appropriate safe commands to prevent metacharacter injection:
        // - PowerShell: Set-Location -LiteralPath prevents wildcard/variable expansion
        // - CMD/WSL: single quotes prevent variable expansion in most shells
        const cdCommand = initialShell === 'powershell'
          ? `Set-Location -LiteralPath '${initialCwd.replace(/'/g, "''")}'`
          : `cd '${initialCwd.replace(/'/g, "'\\''")}'`;
        writeToSession(sessionIdRef.current, cdCommand + '\r').catch(() => {});
      }
    }).catch(() => {});

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

  // Report pane session data for persistence
  useEffect(() => {
    if (paneId) {
      updatePaneData(paneId, {
        shellType,
        cwd,
        history,
      });
    }
  }, [paneId, shellType, cwd, history, updatePaneData]);

  // Fetch CWD and git info for completions and prompt display
  useEffect(() => {
    getCwd().then((dir) => {
      setCwd(dir);
      getGitInfo(dir).then(setGitInfo).catch(() => setGitInfo(null));
    }).catch(() => {});
  }, []);

  // Check if API key is configured (for error suggestion feature)
  useEffect(() => {
    getSettings()
      .then((settings) => {
        setHasApiKey(!!settings.api_key);
      })
      .catch(() => setHasApiKey(false));
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
      setRunningCommand(command);
      // Auto-expand the new running block if it was somehow collapsed,
      // and prune IDs of blocks that were evicted by MAX_BLOCKS
      setCollapsedBlocks((prev) => {
        const currentBlockIds = new Set(blocksRef.current.map((b) => b.id));
        let changed = false;
        const next = new Set(prev);
        // Prune evicted block IDs
        for (const id of next) {
          if (!currentBlockIds.has(id)) {
            next.delete(id);
            changed = true;
          }
        }
        // Auto-expand new running block
        if (next.has(newBlock.id)) {
          next.delete(newBlock.id);
          changed = true;
        }
        return changed ? next : prev;
      });
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

  const handleUseFix = useCallback(
    (command: string) => {
      setInput(command);
    },
    [],
  );

  const toggleBlockCollapse = useCallback((blockId: string) => {
    setCollapsedBlocks((prev) => {
      const next = new Set(prev);
      if (next.has(blockId)) {
        next.delete(blockId);
      } else {
        next.add(blockId);
      }
      return next;
    });
  }, []);

  const collapseAllBlocks = useCallback(() => {
    setCollapsedBlocks(new Set(
      blocksRef.current
        .filter((b) => b.command !== '' && b.status !== 'running')
        .map((b) => b.id),
    ));
  }, []);

  const expandAllBlocks = useCallback(() => {
    setCollapsedBlocks(new Set());
  }, []);

  const handleSubmit = useCallback(
    async (cmd: string) => {
      const trimmed = cmd.trim();
      if (!trimmed) {
        setInput('');
        return;
      }

      let resolvedIntent = inputMode.intent;

      // LLM fallback for ambiguous classification (only on submit, not keystroke)
      if (inputMode.confidence === 'low') {
        try {
          const thisTranslation = ++translationIdRef.current;
          setAgentLoading(true);
          setLoadingLabel('Classifying...');
          setAgentError(null);
          resolvedIntent = await classifyIntentLLM(trimmed, shellType);
          // Discard stale result if user switched shells or reset while in-flight
          if (translationIdRef.current !== thisTranslation) return;
          // Update the mode indicator to show the resolved intent
          setInputMode({ intent: resolvedIntent, confidence: 'high' });
        } catch {
          // LLM unavailable — use heuristic result
          resolvedIntent = inputMode.intent;
        } finally {
          setAgentLoading(false);
        }
      }

      // Use inputMode.intent to determine routing (replaces hardcoded hasHashPrefix check)
      if (resolvedIntent === 'natural_language') {
        // Agent mode: translate via LLM
        // Strip # prefix if present (backward compatible)
        const nlInput = trimmed.startsWith('#') ? stripHashPrefix(trimmed) : trimmed;
        if (!nlInput) {
          setInput('');
          return;
        }
        const thisTranslation = ++translationIdRef.current;
        setAgentLoading(true);
        setLoadingLabel('Translating...');
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
      // Reset block navigation focus on submit
      setFocusedBlockIndex(-1);
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
      // Reset block navigation focus on input
      setFocusedBlockIndex(-1);
      // Clear agent error when user starts typing
      setAgentError(null);
      // Auto-classify on input change (unless user has manually overridden)
      if (!modeOverride) {
        setInputMode(classifyIntent(newValue, knownCommands));
      }
      // Cursor position is updated via onCursorChange from InputEditor
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

  const handleTab = useCallback(() => {
    // Called by InputEditor when Tab is pressed — either to accept visible ghost
    // text or to trigger/cycle completions.
    if (completions.suggestion && completions.completionIndex >= 0) {
      // Active tab completion with ghost text showing — accept it using the
      // proper replace semantics (handles mid-input cursor positions correctly)
      const newValue = completions.accept();
      if (newValue !== null) {
        setInput(newValue);
        setCursorPos(newValue.length);
      }
    } else if (completions.suggestion && completions.completionIndex === -1) {
      // History ghost text — append to end (existing behavior)
      setInput(input + completions.suggestion);
      setCursorPos((input + completions.suggestion).length);
    } else {
      // No ghost text — trigger completion cycling. cycleNext populates
      // completions on first call, or cycles to the next candidate on
      // subsequent calls.
      completions.cycleNext();
    }
  }, [completions.cycleNext, completions.suggestion, completions.completionIndex, completions.accept, input]);

  const handleCursorChange = useCallback((pos: number) => {
    setCursorPos(pos);
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

  // Handle keyboard input when in alternate screen (grid) mode
  const handleGridKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!sessionIdRef.current) return;
      const encoded = encodeKey(e);
      if (encoded !== null) {
        writeToSession(sessionIdRef.current, encoded).catch(() => {});
      }
    },
    [],
  );

  // Block navigation: Ctrl+Up/Down (document-level, like Ctrl+Shift+F)
  // Enter/Space toggles collapse on focused block
  useEffect(() => {
    const handleBlockNav = (e: KeyboardEvent) => {
      // Enter/Space toggles collapse when a block is focused
      if ((e.key === 'Enter' || e.key === ' ') && focusedBlockIndex >= 0) {
        // Don't intercept keys when the user is typing in an input or textarea
        const tag = (e.target as HTMLElement)?.tagName;
        if (tag === 'TEXTAREA' || tag === 'INPUT') return;
        const block = blocksRef.current[focusedBlockIndex];
        if (block && block.command !== '') {
          e.preventDefault();
          toggleBlockCollapse(block.id);
          return;
        }
      }

      if (!e.ctrlKey || e.shiftKey || e.altKey || e.metaKey) return;

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setFocusedBlockIndex((prev) => {
          const maxIndex = blocksRef.current.length - 1;
          if (maxIndex < 0) return -1;
          if (prev === -1) return 0;
          return Math.min(prev + 1, maxIndex);
        });
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        setFocusedBlockIndex((prev) => {
          const maxIndex = blocksRef.current.length - 1;
          if (maxIndex < 0) return -1;
          if (prev === -1) return maxIndex;
          return Math.max(prev - 1, 0);
        });
      }
    };

    document.addEventListener('keydown', handleBlockNav);
    return () => document.removeEventListener('keydown', handleBlockNav);
  }, [focusedBlockIndex, toggleBlockCollapse]);

  // Scroll focused block into view
  useEffect(() => {
    if (focusedBlockIndex < 0) return;
    const containers = document.querySelectorAll('[data-testid="block-container"]');
    if (containers[focusedBlockIndex]) {
      containers[focusedBlockIndex].scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    }
  }, [focusedBlockIndex]);

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

  // Ctrl+R keyboard handler for history search
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey && (e.key === 'r' || e.key === 'R')) {
        // If history search is already open, let the HistorySearch component handle Ctrl+R cycling
        if (historySearchOpen) return;
        e.preventDefault();
        savedInputRef.current = input;
        setHistorySearchOpen(true);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [historySearchOpen, input]);

  const handleHistorySearchAccept = useCallback((command: string) => {
    setHistorySearchOpen(false);
    setInput(command);
    // Return focus to editor
    editorRef.current?.focus();
  }, []);

  const handleHistorySearchCancel = useCallback(() => {
    setHistorySearchOpen(false);
    setInput(savedInputRef.current);
    // Return focus to editor
    editorRef.current?.focus();
  }, []);

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
        case 'block.prev':
          setFocusedBlockIndex((prev) => {
            const maxIndex = blocksRef.current.length - 1;
            if (maxIndex < 0) return -1;
            if (prev === -1) return maxIndex;
            return Math.max(prev - 1, 0);
          });
          break;
        case 'block.next':
          setFocusedBlockIndex((prev) => {
            const maxIndex = blocksRef.current.length - 1;
            if (maxIndex < 0) return -1;
            if (prev === -1) return 0;
            return Math.min(prev + 1, maxIndex);
          });
          break;
        case 'search.find':
          if (search.isOpen) {
            searchInputRef.current?.focus();
          } else {
            search.open();
          }
          break;
        case 'notifications.test':
          sendTestNotification().catch(() => {});
          break;
        case 'history.search':
          if (!historySearchOpen) {
            savedInputRef.current = input;
            setHistorySearchOpen(true);
          }
          break;
        case 'block.collapseAll':
          collapseAllBlocks();
          break;
        case 'block.expandAll':
          expandAllBlocks();
          break;
        case 'block.toggleCollapse': {
          if (focusedBlockIndex >= 0) {
            const block = blocksRef.current[focusedBlockIndex];
            if (block && block.command !== '') {
              toggleBlockCollapse(block.id);
            }
          }
          break;
        }
        default:
          break;
      }
    };

    document.addEventListener('velocity:command', handleCommand);
    return () => document.removeEventListener('velocity:command', handleCommand);
  }, [paneId, handleShellSwitch, handleRestart, handleToggleMode, search.isOpen, search.open, historySearchOpen, input, collapseAllBlocks, expandAllBlocks, toggleBlockCollapse, focusedBlockIndex]);

  // Auto-expand collapsed block when search navigates to a match inside it
  useEffect(() => {
    if (search.currentMatchIndex < 0 || search.matches.length === 0) return;
    const match = search.matches[search.currentMatchIndex];
    if (match && collapsedBlocks.has(match.blockId)) {
      setCollapsedBlocks((prev) => {
        const next = new Set(prev);
        next.delete(match.blockId);
        return next;
      });
    }
  }, [search.currentMatchIndex, search.matches, collapsedBlocks]);

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
      {!altScreenActive && (
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
      )}
      {altScreenActive ? (
        <TerminalGrid
          rows={gridRows}
          onKeyDown={handleGridKeyDown}
          cursorRow={cursorRow}
          cursorCol={cursorCol}
          cursorVisible={cursorVisible}
        />
      ) : (
        <div
          ref={outputRef}
          className="terminal-output"
          data-testid="terminal-output"
          onClick={(e) => { if (e.target === e.currentTarget) setFocusedBlockIndex(-1); }}
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
          {blocks.map((block, index) => {
            // Active running blocks are never collapsed
            const isRunning = block.id === activeBlockIdRef.current && block.status === 'running';
            const isCollapsed = !isRunning && collapsedBlocks.has(block.id);
            return (
              <BlockView
                key={block.id}
                block={block}
                isActive={block.id === activeBlockIdRef.current}
                isFocused={index === focusedBlockIndex}
                isCollapsed={isCollapsed}
                onToggleCollapse={() => toggleBlockCollapse(block.id)}
                onRerun={handleRerun}
                onSelect={() => setFocusedBlockIndex(index)}
                onUseFix={handleUseFix}
                isVisible={visibleIds.has(block.id)}
                observeRef={(el) => observeBlock(block.id, el)}
                highlights={blockHighlights.get(block.id)}
                shellType={shellType}
                cwd={cwd}
                hasApiKey={hasApiKey}
                isMostRecentFailed={block.id === mostRecentFailedBlockId}
              />
            );
          })}
          {closed && <div className="block-process-exited">[Process exited]</div>}
        </div>
      )}
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
      ) : !altScreenActive ? (
        <div data-testid="terminal-input">
          {agentLoading && (
            <div className="agent-loading" data-testid="agent-loading">
              <span className="agent-spinner">&#x27F3;</span>
              {loadingLabel}
            </div>
          )}
          <HistorySearch
            history={history}
            isOpen={historySearchOpen}
            onAccept={handleHistorySearchAccept}
            onCancel={handleHistorySearchCancel}
          />
          <InputEditor
            value={input}
            onChange={handleInputChange}
            onSubmit={handleSubmit}
            disabled={closed || agentLoading || historySearchOpen}
            ghostText={completions.suggestion}
            onNavigateUp={handleNavigateUp}
            onNavigateDown={handleNavigateDown}
            mode={inputMode}
            onToggleMode={handleToggleMode}
            textareaRef={editorRef}
            onTab={handleTab}
            onCursorChange={handleCursorChange}
            gitInfo={gitInfo}
          />
          {agentError && (
            <div className="agent-error" data-testid="agent-error">
              {agentError}
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

export default Terminal;
