import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import type { PaneNode } from '../lib/types';

// Mock Terminal so it doesn't try to create real PTY sessions
vi.mock('../components/Terminal', () => ({
  default: () => <div data-testid="mock-terminal">Terminal</div>,
}));

import PaneContainer from '../components/layout/PaneContainer';

describe('PaneContainer', () => {
  const leaf = (id: string): PaneNode => ({ type: 'leaf', id });

  it('test_renders_single_leaf', () => {
    const node = leaf('pane-1');
    render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        isOnlyPane={true}
      />,
    );

    expect(screen.getByTestId('pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('mock-terminal')).toBeInTheDocument();
  });

  it('test_renders_split', () => {
    const node: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        isOnlyPane={false}
      />,
    );

    expect(screen.getByTestId('pane-pane-1')).toBeInTheDocument();
    expect(screen.getByTestId('pane-pane-2')).toBeInTheDocument();
    // Should have 2 mock terminals
    const terminals = screen.getAllByTestId('mock-terminal');
    expect(terminals).toHaveLength(2);
  });

  it('test_focused_pane_has_indicator', () => {
    const node = leaf('pane-1');
    render(
      <PaneContainer
        node={node}
        focusedPaneId="pane-1"
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        isOnlyPane={true}
      />,
    );

    const paneEl = screen.getByTestId('pane-pane-1');
    expect(paneEl).toHaveClass('pane-focused');
  });

  it('test_click_pane_calls_onFocusPane', () => {
    const onFocusPane = vi.fn();
    const node = leaf('pane-1');

    render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={onFocusPane}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        isOnlyPane={true}
      />,
    );

    fireEvent.click(screen.getByTestId('pane-pane-1'));
    expect(onFocusPane).toHaveBeenCalledWith('pane-1');
  });

  it('test_split_button_calls_onSplitPane', () => {
    const onSplitPane = vi.fn();
    const node = leaf('pane-1');

    render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={onSplitPane}
        onClosePane={vi.fn()}
        isOnlyPane={true}
      />,
    );

    // Click the "Split Right" button
    const splitRightBtn = screen.getByTitle('Split Right');
    fireEvent.click(splitRightBtn);
    expect(onSplitPane).toHaveBeenCalledWith('pane-1', 'horizontal');
  });
});
