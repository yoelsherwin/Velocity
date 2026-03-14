import type { PaneNode, PaneDirection } from './types';

/**
 * Split a leaf pane into two panes.
 * The original leaf becomes the "first" child; a new leaf becomes the "second".
 * Returns a new tree (immutable).
 */
export function splitPane(
  root: PaneNode,
  paneId: string,
  direction: PaneDirection,
): PaneNode {
  if (root.type === 'leaf') {
    if (root.id === paneId) {
      return {
        type: 'split',
        id: crypto.randomUUID(),
        direction,
        first: { type: 'leaf', id: root.id },
        second: { type: 'leaf', id: crypto.randomUUID() },
        ratio: 0.5,
      };
    }
    return root;
  }

  // Split node: recurse into children
  const newFirst = splitPane(root.first, paneId, direction);
  const newSecond = splitPane(root.second, paneId, direction);

  if (newFirst === root.first && newSecond === root.second) {
    return root; // No change
  }

  return { ...root, first: newFirst, second: newSecond };
}

/**
 * Remove a leaf pane, collapsing its parent split.
 * If the removed pane is the only leaf (root is a leaf), returns null.
 * Returns a new tree (immutable).
 */
export function closePane(
  root: PaneNode,
  paneId: string,
): PaneNode | null {
  if (root.type === 'leaf') {
    return root.id === paneId ? null : root;
  }

  // If one of the direct children is the target leaf, collapse
  if (root.first.type === 'leaf' && root.first.id === paneId) {
    return root.second;
  }
  if (root.second.type === 'leaf' && root.second.id === paneId) {
    return root.first;
  }

  // Recurse into children
  const newFirst = closePane(root.first, paneId);
  if (newFirst !== root.first) {
    // The pane was found and removed in the first subtree
    if (newFirst === null) {
      return root.second;
    }
    return { ...root, first: newFirst };
  }

  const newSecond = closePane(root.second, paneId);
  if (newSecond !== root.second) {
    // The pane was found and removed in the second subtree
    if (newSecond === null) {
      return root.first;
    }
    return { ...root, second: newSecond };
  }

  return root; // No change (paneId not found)
}

/**
 * Find a leaf by ID. Returns the leaf node or null.
 */
export function findPane(
  root: PaneNode,
  paneId: string,
): PaneNode | null {
  if (root.type === 'leaf') {
    return root.id === paneId ? root : null;
  }
  return findPane(root.first, paneId) || findPane(root.second, paneId);
}

/**
 * Count leaf panes in the tree.
 */
export function countLeaves(root: PaneNode): number {
  if (root.type === 'leaf') {
    return 1;
  }
  return countLeaves(root.first) + countLeaves(root.second);
}

/**
 * Get all leaf IDs in the tree (in-order traversal).
 */
export function getLeafIds(root: PaneNode): string[] {
  if (root.type === 'leaf') {
    return [root.id];
  }
  return [...getLeafIds(root.first), ...getLeafIds(root.second)];
}

/**
 * Update the ratio of a specific split node by ID.
 * Returns a new tree (immutable). If the splitId is not found, returns the original tree.
 */
export function updatePaneRatio(root: PaneNode, splitId: string, newRatio: number): PaneNode {
  if (root.type === 'leaf') return root;
  if (root.id === splitId) {
    const clampedRatio = Math.max(0.1, Math.min(0.9, newRatio));
    return { ...root, ratio: clampedRatio };
  }

  const newFirst = updatePaneRatio(root.first, splitId, newRatio);
  const newSecond = updatePaneRatio(root.second, splitId, newRatio);

  // If neither child changed, return the original node (referential equality for "not found")
  if (newFirst === root.first && newSecond === root.second) {
    return root;
  }

  return { ...root, first: newFirst, second: newSecond };
}
