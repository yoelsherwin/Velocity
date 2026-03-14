import { useMemo, useCallback, useRef } from 'react';
import { tokenize } from '../../lib/shell-tokenizer';

interface InputEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
  ghostText?: string | null;
  onNavigateUp?: () => void;
  onNavigateDown?: () => void;
}

function InputEditor({ value, onChange, onSubmit, disabled, ghostText, onNavigateUp, onNavigateDown }: InputEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tokens = useMemo(() => tokenize(value), [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit(value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        if (ghostText) {
          // Accept ghost text suggestion
          onChange(value + ghostText);
        } else {
          // Insert 2 spaces at cursor position
          const textarea = textareaRef.current;
          if (textarea) {
            const start = textarea.selectionStart;
            const end = textarea.selectionEnd;
            const newValue = value.substring(0, start) + '  ' + value.substring(end);
            onChange(newValue);
            // Restore cursor position after React re-renders
            requestAnimationFrame(() => {
              textarea.selectionStart = start + 2;
              textarea.selectionEnd = start + 2;
            });
          }
        }
      } else if (e.key === 'ArrowUp' && !e.shiftKey) {
        // Only intercept if cursor is on the first line
        const textarea = textareaRef.current;
        if (textarea && textarea.selectionStart === textarea.selectionEnd) {
          const textBeforeCursor = value.substring(0, textarea.selectionStart);
          if (!textBeforeCursor.includes('\n')) {
            // Cursor is on the first line — navigate history
            e.preventDefault();
            onNavigateUp?.();
            // Don't call onChange — Terminal handles the state update directly
          }
        }
      } else if (e.key === 'ArrowDown' && !e.shiftKey) {
        // Only intercept if cursor is on the last line
        const textarea = textareaRef.current;
        if (textarea && textarea.selectionStart === textarea.selectionEnd) {
          const textAfterCursor = value.substring(textarea.selectionEnd);
          if (!textAfterCursor.includes('\n')) {
            // Cursor is on the last line — navigate history
            e.preventDefault();
            onNavigateDown?.();
            // Don't call onChange — Terminal handles the state update directly
          }
        }
      }
    },
    [value, onSubmit, onChange, ghostText, onNavigateUp, onNavigateDown],
  );

  return (
    <div className="input-editor" data-testid="input-editor">
      <span className="editor-prompt">{'\u276F'}</span>
      <div className="editor-area">
        <pre className="editor-highlight" aria-hidden="true">
          {tokens.map((token, i) => (
            <span key={i} className={`token-${token.type}`}>
              {token.value}
            </span>
          ))}
          {ghostText && <span className="ghost-text">{ghostText}</span>}
          {'\n'}
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          data-testid="editor-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
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
