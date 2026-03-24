import { useMemo, useCallback, useRef, useState, type RefObject } from 'react';
import { tokenize, Token } from '../../lib/shell-tokenizer';
import { ClassificationResult } from '../../lib/intent-classifier';
import type { GitInfo } from '../../lib/git';
import type { CursorShape } from '../../lib/types';
import ModeIndicator from './ModeIndicator';
import GitContext from './GitContext';

interface InputEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  ghostText?: string | null;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
  mode?: ClassificationResult;
  onToggleMode?: () => void;
  textareaRef?: RefObject<HTMLTextAreaElement | null>;
  onTab?: () => void;
  onCursorChange?: (pos: number) => void;
  gitInfo?: GitInfo | null;
  cursorShape?: CursorShape;
}

/**
 * Build the overlay content with cursor and selection highlighting.
 *
 * Walks through tokens, inserting a cursor element at `cursorPos` and
 * wrapping characters in [selStart, selEnd) with a selection highlight span.
 */
function buildOverlayContent(
  tokens: Token[],
  cursorPos: number,
  selStart: number,
  selEnd: number,
  cursorShape: string = 'bar',
): React.ReactNode[] {
  const hasSelection = selStart !== selEnd;
  const nodes: React.ReactNode[] = [];
  let charIndex = 0;
  const cursorClassName = `editor-cursor editor-cursor-${cursorShape} editor-cursor-blink`;

  for (let t = 0; t < tokens.length; t++) {
    const token = tokens[t];
    const tokenStart = charIndex;
    const tokenEnd = charIndex + token.value.length;
    const className = `token-${token.type}`;

    // If cursor is exactly at token start (and no selection), insert cursor before this token
    if (!hasSelection && cursorPos === tokenStart) {
      nodes.push(
        <span key={`cursor-${charIndex}`} className={cursorClassName} />,
      );
    }

    // Check if this token intersects with the selection or contains the cursor
    const selIntersects = hasSelection && selStart < tokenEnd && selEnd > tokenStart;
    const cursorInside = !hasSelection && cursorPos > tokenStart && cursorPos < tokenEnd;

    if (!selIntersects && !cursorInside) {
      // Simple case: render the whole token as-is
      nodes.push(
        <span key={`t-${t}`} className={className}>
          {token.value}
        </span>,
      );
    } else {
      // Need to split this token for cursor or selection insertion
      const parts: React.ReactNode[] = [];
      let i = 0;
      const chars = token.value;

      while (i < chars.length) {
        const globalPos = tokenStart + i;

        // Insert cursor at this position if needed
        if (!hasSelection && globalPos === cursorPos) {
          parts.push(
            <span key={`cursor-${globalPos}`} className={cursorClassName} />,
          );
        }

        if (hasSelection && globalPos >= selStart && globalPos < selEnd) {
          // Collect all selected characters within this token
          const selChunkStart = i;
          while (i < chars.length && tokenStart + i < selEnd) {
            i++;
          }
          parts.push(
            <span key={`sel-${globalPos}`} className="editor-selection">
              {chars.slice(selChunkStart, i)}
            </span>,
          );
        } else {
          // Collect all non-selected characters until next boundary
          const chunkStart = i;
          while (i < chars.length) {
            const gp = tokenStart + i;
            if (!hasSelection && gp === cursorPos) break;
            if (hasSelection && gp >= selStart && gp < selEnd) break;
            i++;
          }
          if (i > chunkStart) {
            parts.push(chars.slice(chunkStart, i));
          }
        }
      }

      nodes.push(
        <span key={`t-${t}`} className={className}>
          {parts}
        </span>,
      );
    }

    charIndex = tokenEnd;
  }

  // Cursor at the very end of all tokens
  if (!hasSelection && cursorPos >= charIndex) {
    nodes.push(
      <span key={`cursor-end`} className={cursorClassName} />,
    );
  }

  return nodes;
}

function InputEditor({ value, onChange, onSubmit, disabled, ghostText, onNavigateUp, onNavigateDown, mode, onToggleMode, textareaRef: externalRef, onTab, onCursorChange, gitInfo, cursorShape = 'bar' }: InputEditorProps) {
  const internalRef = useRef<HTMLTextAreaElement>(null);
  const textareaRef = externalRef || internalRef;

  // Use a counter to force re-render when selection changes
  const [, setTick] = useState(0);

  // Store selection in refs to avoid render loops
  const cursorPosRef = useRef(0);
  const selStartRef = useRef(0);
  const selEndRef = useRef(0);

  const tokens = useMemo(() => tokenize(value), [value]);

  const syncSelection = useCallback(() => {
    const ta = textareaRef.current;
    if (!ta) return;
    const start = ta.selectionStart;
    const end = ta.selectionEnd;
    // Only trigger re-render if selection actually changed
    if (start !== cursorPosRef.current || start !== selStartRef.current || end !== selEndRef.current) {
      cursorPosRef.current = start;
      selStartRef.current = start;
      selEndRef.current = end;
      setTick((t) => t + 1);
    }
    if (onCursorChange) {
      onCursorChange(start);
    }
  }, [onCursorChange, textareaRef]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit(value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (ghostText && onTab) {
          onTab();
        } else if (ghostText) {
          onChange(value + ghostText);
        } else if (onTab) {
          onTab();
        } else {
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newValue = value.substring(0, start) + '  ' + value.substring(end);
            onChange(newValue);
            requestAnimationFrame(() => {
              textarea.selectionStart = start + 2;
              textarea.selectionEnd = start + 2;
              syncSelection();
            });
          }
        }
      } else if (e.key === 'ArrowUp' && !e.shiftKey) {
        const textarea = textareaRef.current;
        if (textarea && textarea.selectionStart === textarea.selectionEnd) {
          const textBeforeCursor = value.substring(0, textarea.selectionStart);
          if (!textBeforeCursor.includes('\n')) {
            e.preventDefault();
            onNavigateUp?.();
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey) {
        const textarea = textareaRef.current;
        if (textarea && textarea.selectionStart === textarea.selectionEnd) {
          const textAfterCursor = value.substring(textarea.selectionEnd);
          if (!textAfterCursor.includes('\n')) {
            e.preventDefault();
            onNavigateDown?.();
          }
        }
      }
    },
    [value, onSubmit, onChange, ghostText, onNavigateUp, onNavigateDown, onTab, syncSelection],
  );

  const overlayContent = useMemo(
    () => buildOverlayContent(tokens, cursorPosRef.current, selStartRef.current, selEndRef.current, cursorShape),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs read during render, tick forces recalc
    [tokens, cursorPosRef.current, selStartRef.current, selEndRef.current, cursorShape],
  );

  return (
    <div className="input-editor" data-testid="input-editor">
      {mode && onToggleMode && (
        <ModeIndicator
          intent={mode.intent}
          confidence={mode.confidence}
          onToggle={onToggleMode}
          disabled={disabled}
        />
      )}
      <GitContext gitInfo={gitInfo ?? null} />
      <span className="editor-prompt">{'\u276F'}</span>
      <div className="editor-area">
        <pre className="editor-highlight" aria-hidden="true">
          {overlayContent}
          {ghostText && <span className="ghost-text">{ghostText}</span>}
          {'\n'}
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          data-testid="editor-textarea"
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            const pos = e.target.selectionStart;
            const end = e.target.selectionEnd;
            cursorPosRef.current = pos;
            selStartRef.current = pos;
            selEndRef.current = end;
            if (onCursorChange) {
              onCursorChange(pos);
            }
          }}
          onKeyDown={handleKeyDown}
          onKeyUp={syncSelection}
          onClick={syncSelection}
          onMouseUp={syncSelection}
          rows={1}
          disabled={disabled}
          autoFocus
          spellCheck={false}
          autoComplete="off"
        />
      </div>
    </div>
  );
}

export default InputEditor;
