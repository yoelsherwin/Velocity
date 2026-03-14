import { useMemo, useCallback, useRef } from 'react';
import { tokenize } from '../../lib/shell-tokenizer';

interface InputEditorProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: (value: string) => void;
  disabled?: boolean;
}

function InputEditor({ value, onChange, onSubmit, disabled }: InputEditorProps) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const tokens = useMemo(() => tokenize(value), [value]);

  const lineCount = useMemo(() => {
    const count = value.split('\n').length;
    return Math.max(1, count);
  }, [value]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        onSubmit(value);
      } else if (e.key === 'Tab') {
        e.preventDefault();
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
    },
    [value, onSubmit, onChange],
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
          {'\n'}
        </pre>
        <textarea
          ref={textareaRef}
          className="editor-textarea"
          data-testid="editor-textarea"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={handleKeyDown}
          rows={lineCount}
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
