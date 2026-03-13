import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InputEditor from '../components/editor/InputEditor';

describe('InputEditor Component', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
    shellType: 'powershell' as const,
  };

  it('test_renders_textarea', () => {
    render(<InputEditor {...defaultProps} />);
    expect(screen.getByTestId('editor-textarea')).toBeInTheDocument();
  });

  it('test_renders_prompt', () => {
    render(<InputEditor {...defaultProps} />);
    const editor = screen.getByTestId('input-editor');
    // The prompt symbol should be visible somewhere in the editor
    expect(editor.textContent).toContain('\u276F'); // ❯
  });

  it('test_calls_onChange', () => {
    const onChange = vi.fn();
    render(<InputEditor {...defaultProps} onChange={onChange} />);
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: 'hello' } });
    expect(onChange).toHaveBeenCalledWith('hello');
  });

  it('test_enter_calls_onSubmit', () => {
    const onSubmit = vi.fn();
    render(
      <InputEditor {...defaultProps} value="echo hi" onSubmit={onSubmit} />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: false });
    expect(onSubmit).toHaveBeenCalledWith('echo hi');
  });

  it('test_shift_enter_does_not_submit', () => {
    const onSubmit = vi.fn();
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value="line1"
        onSubmit={onSubmit}
        onChange={onChange}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'Enter', shiftKey: true });
    // onSubmit should NOT have been called
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('test_tab_inserts_spaces', () => {
    const onChange = vi.fn();
    render(<InputEditor {...defaultProps} value="" onChange={onChange} />);
    const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;

    // Simulate Tab key
    const event = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    const preventDefaultSpy = vi.spyOn(event, 'preventDefault');
    textarea.dispatchEvent(event);

    // Tab should call preventDefault to avoid focus change
    expect(preventDefaultSpy).toHaveBeenCalled();
  });

  it('test_disabled_prevents_input', () => {
    render(<InputEditor {...defaultProps} disabled={true} />);
    const textarea = screen.getByTestId('editor-textarea');
    expect(textarea).toBeDisabled();
  });

  it('test_syntax_highlighting_renders', () => {
    render(<InputEditor {...defaultProps} value="echo hello" />);
    const editor = screen.getByTestId('input-editor');
    const commandSpan = editor.querySelector('.token-command');
    expect(commandSpan).not.toBeNull();
    expect(commandSpan!.textContent).toBe('echo');
  });
});
