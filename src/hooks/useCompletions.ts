import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCompletionContext } from '../lib/completion-context';

export interface UseCompletionsResult {
  suggestion: string | null;        // Ghost text to display (same interface as before)
  completions: string[];            // All available completions for cycling
  completionIndex: number;          // Current index in completions (-1 = history suggestion)
  cycleNext: () => void;            // Move to next completion
  accept: () => string | null;      // Accept current completion, return new input value
  reset: () => void;                // Clear completions (on input change)
}

/**
 * Unified completions hook replacing useGhostText.
 *
 * Provides:
 * 1. History-based ghost text (passive, like the old useGhostText)
 * 2. Tab-triggered command completions (synchronous, from knownCommands set)
 * 3. Tab-triggered path completions (async, via IPC to Rust)
 */
export function useCompletions(
  input: string,
  cursorPos: number,
  history: string[],
  knownCommands: Set<string>,
  cwd: string,
): UseCompletionsResult {
  // Active completion state
  const [completions, setCompletions] = useState<string[]>([]);
  const [completionIndex, setCompletionIndex] = useState(-1);
  const [activeContext, setActiveContext] = useState<{
    type: 'command' | 'path' | 'none';
    partial: string;
    replaceStart: number;
    replaceEnd: number;
  } | null>(null);

  // Track previous input to detect changes
  const prevInputRef = useRef(input);
  const prevCursorRef = useRef(cursorPos);

  // Debounce timer for path completions
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // History-based suggestion (passive, like old useGhostText)
  const historySuggestion = useMemo(() => {
    if (!input) return null;
    if (input.includes('\n')) return null;

    for (let i = history.length - 1; i >= 0; i--) {
      const cmd = history[i];
      if (cmd.startsWith(input) && cmd !== input) {
        return cmd.slice(input.length);
      }
    }

    return null;
  }, [input, history]);

  // Clean up debounce timer on unmount
  useEffect(() => {
    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }
    };
  }, []);

  // Reset completions when input or cursor changes
  useEffect(() => {
    if (input !== prevInputRef.current || cursorPos !== prevCursorRef.current) {
      setCompletions([]);
      setCompletionIndex(-1);
      setActiveContext(null);
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
        debounceRef.current = null;
      }
    }
    prevInputRef.current = input;
    prevCursorRef.current = cursorPos;
  }, [input, cursorPos]);

  // Compute the suggestion to display
  const suggestion = useMemo(() => {
    // If there are active completions, show the current one as ghost text
    if (completions.length > 0 && completionIndex >= 0 && activeContext) {
      const completion = completions[completionIndex];
      // The suggestion is the remainder after the partial
      const partial = activeContext.partial;
      if (completion.startsWith(partial)) {
        return completion.slice(partial.length);
      }
      // For case-insensitive matches, still show the remainder
      if (completion.toLowerCase().startsWith(partial.toLowerCase())) {
        return completion.slice(partial.length);
      }
      return completion;
    }

    // Fall back to history suggestion
    return historySuggestion;
  }, [completions, completionIndex, activeContext, historySuggestion]);

  const cycleNext = useCallback(() => {
    // If we already have completions, cycle through them
    if (completions.length > 0) {
      setCompletionIndex((prev) => (prev + 1) % completions.length);
      return;
    }

    // No completions yet — compute them
    const ctx = getCompletionContext(input, cursorPos);

    if (ctx.type === 'none') {
      return;
    }

    if (ctx.type === 'command') {
      // Synchronous: filter knownCommands
      const partial = ctx.partial.toLowerCase();
      const matches = Array.from(knownCommands)
        .filter((cmd) => cmd.toLowerCase().startsWith(partial))
        .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

      if (matches.length > 0) {
        setCompletions(matches);
        setCompletionIndex(0);
        setActiveContext(ctx);
      }
      return;
    }

    if (ctx.type === 'path') {
      // Async: call Rust via IPC (with debounce)
      if (debounceRef.current) {
        clearTimeout(debounceRef.current);
      }

      debounceRef.current = setTimeout(async () => {
        try {
          const results = await invoke<string[]>('get_completions', {
            partial: ctx.partial,
            cwd,
            context: 'path',
          });

          if (results.length > 0) {
            setCompletions(results);
            setCompletionIndex(0);
            setActiveContext(ctx);
          }
        } catch {
          // Silently fail — no completions available
        }
      }, 100);
      return;
    }
  }, [input, cursorPos, knownCommands, cwd, completions.length]);

  const accept = useCallback((): string | null => {
    // If there's a history suggestion (and no active tab completions), accept it
    if (completions.length === 0 && historySuggestion) {
      return input + historySuggestion;
    }

    // If there are active completions, accept the current one
    if (completions.length > 0 && completionIndex >= 0 && activeContext) {
      const completion = completions[completionIndex];
      // Replace the partial in the input with the full completion
      const before = input.substring(0, activeContext.replaceStart);
      const after = input.substring(activeContext.replaceEnd);
      return before + completion + after;
    }

    return null;
  }, [input, completions, completionIndex, activeContext, historySuggestion]);

  const resetFn = useCallback(() => {
    setCompletions([]);
    setCompletionIndex(-1);
    setActiveContext(null);
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
  }, []);

  return {
    suggestion,
    completions,
    completionIndex,
    cycleNext,
    accept,
    reset: resetFn,
  };
}
