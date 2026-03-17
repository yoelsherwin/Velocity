import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * Tracks which block IDs are currently visible (or near-visible) in the viewport.
 *
 * Uses IntersectionObserver with rootMargin to include blocks slightly outside
 * the viewport, so they're already rendered when the user scrolls to them.
 *
 * Usage:
 *   const { visibleIds, observeBlock } = useBlockVisibility();
 *   // In each BlockView: ref={el => observeBlock(block.id, el)}
 *   // Then: isVisible={visibleIds.has(block.id)}
 */
export function useBlockVisibility() {
  const [visibleIds, setVisibleIds] = useState<Set<string>>(new Set());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const elementMapRef = useRef<Map<string, Element>>(new Map());
  const idMapRef = useRef<Map<Element, string>>(new Map());

  useEffect(() => {
    const observer = new IntersectionObserver(
      (entries) => {
        setVisibleIds((prev) => {
          const next = new Set(prev);
          let changed = false;
          for (const entry of entries) {
            const blockId = idMapRef.current.get(entry.target);
            if (!blockId) continue;
            if (entry.isIntersecting && !prev.has(blockId)) {
              next.add(blockId);
              changed = true;
            } else if (!entry.isIntersecting && prev.has(blockId)) {
              next.delete(blockId);
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      },
      {
        // Include blocks 500px above and below the viewport for pre-rendering
        rootMargin: '500px 0px 500px 0px',
        threshold: 0,
      },
    );

    observerRef.current = observer;

    return () => {
      observer.disconnect();
      observerRef.current = null;
    };
  }, []);

  const observeBlock = useCallback((blockId: string, element: HTMLElement | null) => {
    const observer = observerRef.current;
    if (!observer) return;

    // Unobserve the old element for this blockId if it changed
    const oldElement = elementMapRef.current.get(blockId);
    if (oldElement && oldElement !== element) {
      observer.unobserve(oldElement);
      idMapRef.current.delete(oldElement);
      elementMapRef.current.delete(blockId);
    }

    if (element) {
      elementMapRef.current.set(blockId, element);
      idMapRef.current.set(element, blockId);
      observer.observe(element);
    }
  }, []);

  return { visibleIds, observeBlock };
}

/**
 * Estimate the height of a block's output for the placeholder when not visible.
 * This prevents layout shift when blocks come into / go out of view.
 *
 * Uses a counting loop instead of split('\n') to avoid allocating a large
 * string array on outputs up to 500KB. Short-circuits after 50 newlines
 * since the height is capped at 50 lines anyway.
 */
export function estimateBlockHeight(output: string): number {
  let lines = 1;
  for (let i = 0; i < output.length && lines < 50; i++) {
    if (output[i] === '\n') lines++;
  }
  const lineHeight = 19.6; // 14px font * 1.4 line-height
  const headerHeight = 32;
  return headerHeight + lines * lineHeight;
}
