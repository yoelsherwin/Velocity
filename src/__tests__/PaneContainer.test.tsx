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

  // --- Task 013: Divider drag tests ---

  it('test_divider_has_mousedown_handler', () => {
    const node: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const { container } = render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={vi.fn()}
        isOnlyPane={false}
      />,
    );

    // The divider should exist and be interactable
    const divider = container.querySelector('.pane-divider');
    expect(divider).toBeInTheDocument();

    // Mousedown on divider should not throw
    fireEvent.mouseDown(divider!);
  });

  it('test_divider_drag_calls_onResizePane', () => {
    const onResizePane = vi.fn();
    const node: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const { container } = render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={onResizePane}
        isOnlyPane={false}
      />,
    );

    const divider = container.querySelector('.pane-divider');
    expect(divider).toBeInTheDocument();

    // Get the split container (parent of the divider)
    const splitContainer = container.querySelector('.pane-split');
    expect(splitContainer).toBeInTheDocument();

    // Mock getBoundingClientRect on the split container
    vi.spyOn(splitContainer! as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag
    fireEvent.mouseDown(divider!);

    // Move mouse to 70% of the container width
    fireEvent.mouseMove(document, { clientX: 700, clientY: 250 });

    // onResizePane should have been called with the split ID and new ratio
    expect(onResizePane).toHaveBeenCalledWith('split-1', 0.7);

    // Release mouse
    fireEvent.mouseUp(document);
  });

  it('test_divider_drag_clamps_ratio', () => {
    const onResizePane = vi.fn();
    const node: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const { container } = render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={onResizePane}
        isOnlyPane={false}
      />,
    );

    const divider = container.querySelector('.pane-divider');
    const splitContainer = container.querySelector('.pane-split');

    vi.spyOn(splitContainer! as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag
    fireEvent.mouseDown(divider!);

    // Move mouse beyond 90% — should clamp to 0.9
    fireEvent.mouseMove(document, { clientX: 950, clientY: 250 });
    expect(onResizePane).toHaveBeenCalledWith('split-1', 0.9);

    onResizePane.mockClear();

    // Move mouse below 10% — should clamp to 0.1
    fireEvent.mouseMove(document, { clientX: 50, clientY: 250 });
    expect(onResizePane).toHaveBeenCalledWith('split-1', 0.1);

    // Release
    fireEvent.mouseUp(document);
  });

  it('test_vertical_divider_drag_uses_clientY', () => {
    const onResizePane = vi.fn();
    const node: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'vertical',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const { container } = render(
      <PaneContainer
        node={node}
        focusedPaneId={null}
        onFocusPane={vi.fn()}
        onSplitPane={vi.fn()}
        onClosePane={vi.fn()}
        onResizePane={onResizePane}
        isOnlyPane={false}
      />,
    );

    const divider = container.querySelector('.pane-divider');
    const splitContainer = container.querySelector('.pane-split');

    vi.spyOn(splitContainer! as HTMLElement, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      width: 1000,
      height: 500,
      right: 1000,
      bottom: 500,
      x: 0,
      y: 0,
      toJSON: () => {},
    });

    // Start drag
    fireEvent.mouseDown(divider!);

    // Move mouse to 60% of the container height (300 / 500 = 0.6)
    fireEvent.mouseMove(document, { clientX: 500, clientY: 300 });
    expect(onResizePane).toHaveBeenCalledWith('split-1', 0.6);

    // Release
    fireEvent.mouseUp(document);
  });
});
