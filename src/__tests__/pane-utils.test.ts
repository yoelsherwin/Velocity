import { describe, it, expect } from 'vitest';
import {
  splitPane,
  closePane,
  findPane,
  countLeaves,
  getLeafIds,
  updatePaneRatio,
} from '../lib/pane-utils';
import type { PaneNode } from '../lib/types';

describe('pane-utils', () => {
  const leaf = (id: string): PaneNode => ({ type: 'leaf', id });

  it('test_splitPane_horizontal', () => {
    const root = leaf('pane-1');
    const result = splitPane(root, 'pane-1', 'horizontal');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('horizontal');
      expect(result.ratio).toBe(0.5);
      expect(result.first).toEqual({ type: 'leaf', id: 'pane-1' });
      expect(result.second.type).toBe('leaf');
      expect((result.second as { type: 'leaf'; id: string }).id).not.toBe('pane-1');
    }
  });

  it('test_splitPane_vertical', () => {
    const root = leaf('pane-1');
    const result = splitPane(root, 'pane-1', 'vertical');

    expect(result.type).toBe('split');
    if (result.type === 'split') {
      expect(result.direction).toBe('vertical');
      expect(result.ratio).toBe(0.5);
      expect(result.first).toEqual({ type: 'leaf', id: 'pane-1' });
      expect(result.second.type).toBe('leaf');
    }
  });

  it('test_splitPane_nested', () => {
    const root = leaf('pane-1');
    // Split the root into two leaves
    const afterFirstSplit = splitPane(root, 'pane-1', 'horizontal');
    expect(afterFirstSplit.type).toBe('split');

    // Get the second child's ID
    const secondId =
      afterFirstSplit.type === 'split'
        ? (afterFirstSplit.second as { type: 'leaf'; id: string }).id
        : '';

    // Split the second child
    const afterSecondSplit = splitPane(afterFirstSplit, secondId, 'vertical');

    // Now there should be 3 leaves total
    expect(countLeaves(afterSecondSplit)).toBe(3);
  });

  it('test_closePane_collapses_parent', () => {
    // Create a split with 2 leaves
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const result = closePane(root, 'pane-2');
    // Should collapse to just pane-1
    expect(result).toEqual({ type: 'leaf', id: 'pane-1' });
  });

  it('test_closePane_last_returns_null', () => {
    const root = leaf('pane-1');
    const result = closePane(root, 'pane-1');
    expect(result).toBeNull();
  });

  it('test_countLeaves', () => {
    // Build a tree with 3 leaves:
    //   split
    //   ├── leaf (pane-1)
    //   └── split
    //       ├── leaf (pane-2)
    //       └── leaf (pane-3)
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: {
        type: 'split',
        id: 'split-2',
        direction: 'vertical',
        first: leaf('pane-2'),
        second: leaf('pane-3'),
        ratio: 0.5,
      },
      ratio: 0.5,
    };

    expect(countLeaves(root)).toBe(3);
  });

  it('test_getLeafIds', () => {
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: {
        type: 'split',
        id: 'split-2',
        direction: 'vertical',
        first: leaf('pane-2'),
        second: leaf('pane-3'),
        ratio: 0.5,
      },
      ratio: 0.5,
    };

    const ids = getLeafIds(root);
    expect(ids).toHaveLength(3);
    expect(ids).toContain('pane-1');
    expect(ids).toContain('pane-2');
    expect(ids).toContain('pane-3');
  });

  it('test_findPane_exists', () => {
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const found = findPane(root, 'pane-2');
    expect(found).toEqual({ type: 'leaf', id: 'pane-2' });
  });

  it('test_findPane_not_found', () => {
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const found = findPane(root, 'nonexistent');
    expect(found).toBeNull();
  });

  // --- Task 013: updatePaneRatio tests ---

  it('test_updatePaneRatio', () => {
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const updated = updatePaneRatio(root, 'split-1', 0.7);
    expect(updated.type).toBe('split');
    if (updated.type === 'split') {
      expect(updated.ratio).toBe(0.7);
      // Children should be unchanged
      expect(updated.first).toEqual(leaf('pane-1'));
      expect(updated.second).toEqual(leaf('pane-2'));
    }
  });

  it('test_updatePaneRatio_nested', () => {
    // Build a nested tree:
    //   split-1 (ratio 0.5)
    //   ├── leaf (pane-1)
    //   └── split-2 (ratio 0.5)
    //       ├── leaf (pane-2)
    //       └── leaf (pane-3)
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: {
        type: 'split',
        id: 'split-2',
        direction: 'vertical',
        first: leaf('pane-2'),
        second: leaf('pane-3'),
        ratio: 0.5,
      },
      ratio: 0.5,
    };

    // Update only the inner split
    const updated = updatePaneRatio(root, 'split-2', 0.3);
    expect(updated.type).toBe('split');
    if (updated.type === 'split') {
      // Outer split ratio should remain unchanged
      expect(updated.ratio).toBe(0.5);
      // Inner split ratio should be updated
      expect(updated.second.type).toBe('split');
      if (updated.second.type === 'split') {
        expect(updated.second.ratio).toBe(0.3);
      }
    }
  });

  it('test_updatePaneRatio_leaf_returns_unchanged', () => {
    const root = leaf('pane-1');
    const updated = updatePaneRatio(root, 'split-1', 0.7);
    // Leaf nodes are returned unchanged
    expect(updated).toBe(root);
  });

  it('test_updatePaneRatio_not_found_returns_unchanged', () => {
    const root: PaneNode = {
      type: 'split',
      id: 'split-1',
      direction: 'horizontal',
      first: leaf('pane-1'),
      second: leaf('pane-2'),
      ratio: 0.5,
    };

    const updated = updatePaneRatio(root, 'nonexistent', 0.7);
    // When ID not found, tree is structurally unchanged
    expect(updated).toBe(root);
  });
});
