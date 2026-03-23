import { render, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import InputEditor from '../components/editor/InputEditor';

describe('IDE Cursor Selection Highlighting', () => {
  it('test_selection_highlight_and_cursor_hidden', () => {
    const { container } = render(
      <InputEditor value="hello world" onChange={vi.fn()} onSubmit={vi.fn()} />,
    );
    const textarea = container.querySelector('.editor-textarea') as HTMLTextAreaElement;
    textarea.setSelectionRange(6, 11);
    fireEvent.mouseUp(textarea);
    // Selection highlight should appear
    expect(container.querySelector('.editor-selection')).not.toBeNull();
    // Cursor should be hidden during selection
    expect(container.querySelector('.editor-cursor')).toBeNull();
  });
});
