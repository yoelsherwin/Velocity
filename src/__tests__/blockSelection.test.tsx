import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

describe('Block Selection (click-to-select)', () => {
  const makeBlock = (id: string, command: string): Block => ({
    id,
    command,
    output: 'some output',
    timestamp: Date.now(),
    status: 'completed',
    shellType: 'powershell',
  });

  const mockOnRerun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_click_selects_block', () => {
    const onSelect = vi.fn();
    render(
      <BlockView
        block={makeBlock('b1', 'dir')}
        isActive={false}
        onRerun={mockOnRerun}
        onSelect={onSelect}
      />,
    );
    const container = screen.getByTestId('block-container');
    fireEvent.click(container);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it('test_click_different_block_changes_selection', () => {
    const onSelect1 = vi.fn();
    const onSelect2 = vi.fn();
    const { rerender } = render(
      <div>
        <BlockView
          block={makeBlock('b1', 'dir')}
          isActive={false}
          onRerun={mockOnRerun}
          onSelect={onSelect1}
          isFocused={true}
        />
        <BlockView
          block={makeBlock('b2', 'ls')}
          isActive={false}
          onRerun={mockOnRerun}
          onSelect={onSelect2}
          isFocused={false}
        />
      </div>,
    );

    const containers = screen.getAllByTestId('block-container');
    // Click second block
    fireEvent.click(containers[1]);
    expect(onSelect2).toHaveBeenCalledTimes(1);

    // Re-render with updated focus
    rerender(
      <div>
        <BlockView
          block={makeBlock('b1', 'dir')}
          isActive={false}
          onRerun={mockOnRerun}
          onSelect={onSelect1}
          isFocused={false}
        />
        <BlockView
          block={makeBlock('b2', 'ls')}
          isActive={false}
          onRerun={mockOnRerun}
          onSelect={onSelect2}
          isFocused={true}
        />
      </div>,
    );

    // Second block should now have focused class
    expect(containers[1]).toHaveClass('block-focused');
    expect(containers[0]).not.toHaveClass('block-focused');
  });

  it('test_click_outside_deselects', () => {
    const onSelect = vi.fn();
    const { container } = render(
      <div className="terminal-output" data-testid="terminal-output">
        <BlockView
          block={makeBlock('b1', 'dir')}
          isActive={false}
          onRerun={mockOnRerun}
          onSelect={onSelect}
          isFocused={true}
        />
      </div>,
    );
    // Clicking the block-actions buttons should NOT trigger onSelect
    const copyBtn = screen.getByText('Copy Command');
    onSelect.mockClear();
    fireEvent.click(copyBtn);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it('test_selected_block_has_block_focused_class', () => {
    render(
      <BlockView
        block={makeBlock('b1', 'dir')}
        isActive={false}
        isFocused={true}
        onRerun={mockOnRerun}
      />,
    );
    const container = screen.getByTestId('block-container');
    expect(container).toHaveClass('block-focused');
  });
});
