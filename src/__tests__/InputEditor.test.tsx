import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InputEditor from '../components/editor/InputEditor';

describe('InputEditor Component', () => {
  const defaultProps = {
    value: '',
    onChange: vi.fn(),
    onSubmit: vi.fn(),
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
    const textarea = screen.getByTestId('editor-textarea');

    fireEvent.keyDown(textarea, { key: 'Tab' });

    // Tab should insert two spaces via onChange
    expect(onChange).toHaveBeenCalledWith('  ');
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

  // --- Task 011: Ghost text + history navigation tests ---

  it('test_ghost_text_rendered', () => {
    render(
      <InputEditor {...defaultProps} value="git co" ghostText="mmit" />,
    );
    const editor = screen.getByTestId('input-editor');
    const ghostSpan = editor.querySelector('.ghost-text');
    expect(ghostSpan).not.toBeNull();
    expect(ghostSpan!.textContent).toBe('mmit');
  });

  it('test_tab_accepts_ghost_text', () => {
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value="git co"
        onChange={onChange}
        ghostText="mmit"
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('git commit');
  });

  it('test_tab_inserts_spaces_without_ghost', () => {
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value="echo"
        onChange={onChange}
        ghostText={null}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea') as HTMLTextAreaElement;
    // Place cursor at end of text so spaces are inserted after "echo"
    textarea.selectionStart = 4;
    textarea.selectionEnd = 4;
    fireEvent.keyDown(textarea, { key: 'Tab' });
    expect(onChange).toHaveBeenCalledWith('echo  ');
  });

  it('test_up_arrow_calls_onNavigateUp', () => {
    const onNavigateUp = vi.fn();
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value=""
        onChange={onChange}
        onNavigateUp={onNavigateUp}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'ArrowUp' });
    expect(onNavigateUp).toHaveBeenCalled();
    // onChange should NOT be called — Terminal handles state update directly
    expect(onChange).not.toHaveBeenCalled();
  });

  it('test_down_arrow_calls_onNavigateDown', () => {
    const onNavigateDown = vi.fn();
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value=""
        onChange={onChange}
        onNavigateDown={onNavigateDown}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'ArrowDown' });
    expect(onNavigateDown).toHaveBeenCalled();
    // onChange should NOT be called — Terminal handles state update directly
    expect(onChange).not.toHaveBeenCalled();
  });

  // --- Task 022: Tab completions tests ---

  it('test_tab_calls_on_tab_callback', () => {
    const onTab = vi.fn();
    const onChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value="gi"
        onChange={onChange}
        ghostText={null}
        onTab={onTab}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.keyDown(textarea, { key: 'Tab' });
    // onTab should be called when provided and no ghost text
    expect(onTab).toHaveBeenCalled();
    // onChange should NOT have been called (no space insertion when onTab is provided)
    expect(onChange).not.toHaveBeenCalled();
  });

  it('test_cursor_change_callback', () => {
    const onCursorChange = vi.fn();
    render(
      <InputEditor
        {...defaultProps}
        value="hello"
        onCursorChange={onCursorChange}
      />,
    );
    const textarea = screen.getByTestId('editor-textarea');
    // Simulate keyup which should report cursor position
    fireEvent.keyUp(textarea, { key: 'h' });
    expect(onCursorChange).toHaveBeenCalled();
  });
});
