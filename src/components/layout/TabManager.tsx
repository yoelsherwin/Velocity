import { useState, useEffect, useCallback, useRef } from 'react';
import { Tab, PaneDirection, PaneNode } from '../../lib/types';
import { splitPane, closePane, countLeaves, getLeafIds, updatePaneRatio } from '../../lib/pane-utils';
import TabBar from './TabBar';
import PaneContainer from './PaneContainer';

const MAX_PANES_TOTAL = 20;

/**
 * Find the new pane ID that was created by a split operation.
 * Compares leaf IDs before and after splitting to identify the new one.
 */
function findNewPaneId(oldRoot: PaneNode, newRoot: PaneNode): string | null {
  const oldIds = new Set(getLeafIds(oldRoot));
  const newIds = getLeafIds(newRoot);
  for (const id of newIds) {
    if (!oldIds.has(id)) return id;
  }
  return null;
}

function TabManager() {
  const tabCounterRef = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const initialPaneId = crypto.randomUUID();
    const initialTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
      paneRoot: { type: 'leaf', id: initialPaneId },
      focusedPaneId: initialPaneId,
    };
    return [initialTab];
  });
  const tabsRef = useRef(tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);

  // Derive focusedPaneId from the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const focusedPaneId = activeTab?.focusedPaneId ?? null;

  // Keep a ref in sync for keyboard shortcut handlers
  const focusedPaneIdRef = useRef(focusedPaneId);
  useEffect(() => {
    focusedPaneIdRef.current = focusedPaneId;
  }, [focusedPaneId]);

  // Keep tabsRef in sync with tabs state
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  const updateActiveTabId = useCallback((id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);

  const handleNewTab = useCallback(() => {
    tabCounterRef.current += 1;
    const initialPaneId = crypto.randomUUID();
    const newTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
      paneRoot: { type: 'leaf', id: initialPaneId },
      focusedPaneId: initialPaneId,
    };
    setTabs((prev) => [...prev, newTab]);
    updateActiveTabId(newTab.id);
  }, [updateActiveTabId]);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // Don't close the last tab

        const index = prev.findIndex((t) => t.id === tabId);
        const newTabs = prev.filter((t) => t.id !== tabId);

        // If closing the active tab, switch to an adjacent tab
        if (tabId === activeTabIdRef.current) {
          // Prefer the previous tab; if closing the first, go to next
          const newActiveIndex = index > 0 ? index - 1 : 0;
          const nextTab = newTabs[newActiveIndex];
          updateActiveTabId(nextTab.id);
          // The next tab already has its own focusedPaneId preserved
        }

        return newTabs;
      });
    },
    [updateActiveTabId],
  );

  const handleFocusPane = useCallback(
    (paneId: string) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === activeTabIdRef.current ? { ...t, focusedPaneId: paneId } : t,
        ),
      );
    },
    [],
  );

  const handleSplitPane = useCallback(
    (tabId: string, paneId: string, direction: PaneDirection) => {
      setTabs((prev) => {
        // Guard: check total pane count across ALL tabs against the limit
        const totalPanes = prev.reduce((sum, t) => sum + countLeaves(t.paneRoot), 0);
        if (totalPanes >= MAX_PANES_TOTAL) return prev;

        return prev.map((tab) => {
          if (tab.id !== tabId) return tab;
          const newRoot = splitPane(tab.paneRoot, paneId, direction);
          // Auto-focus the new pane created by the split
          const newPaneId = findNewPaneId(tab.paneRoot, newRoot);
          return {
            ...tab,
            paneRoot: newRoot,
            focusedPaneId: newPaneId ?? tab.focusedPaneId,
          };
        });
      });
    },
    [],
  );

  const handleClosePane = useCallback(
    (tabId: string, paneId: string) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab;

          // Don't close the last pane
          if (countLeaves(tab.paneRoot) <= 1) return tab;

          const newRoot = closePane(tab.paneRoot, paneId);
          if (newRoot === null) return tab; // Should not happen since we checked count

          // If the closed pane was focused, focus the first remaining leaf
          let newFocusedPaneId = tab.focusedPaneId;
          if (tab.focusedPaneId === paneId) {
            const leafIds = getLeafIds(newRoot);
            newFocusedPaneId = leafIds.length > 0 ? leafIds[0] : null;
          }

          return { ...tab, paneRoot: newRoot, focusedPaneId: newFocusedPaneId };
        }),
      );
    },
    [],
  );

  const handleResizePane = useCallback(
    (tabId: string, splitId: string, newRatio: number) => {
      setTabs((prev) =>
        prev.map((t) =>
          t.id === tabId ? { ...t, paneRoot: updatePaneRatio(t.paneRoot, splitId, newRatio) } : t,
        ),
      );
    },
    [],
  );

  // When switching tabs, just update activeTabId — focusedPaneId is per-tab
  const handleSelectTab = useCallback(
    (tabId: string) => {
      updateActiveTabId(tabId);
      // No need to update focusedPaneId; it's stored per-tab and will be
      // derived automatically from the new active tab
    },
    [updateActiveTabId],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ctrl+T: New tab
      if (e.ctrlKey && !e.shiftKey && e.key === 't') {
        e.preventDefault();
        handleNewTab();
      }
      // Ctrl+W: Close tab (without shift)
      if (e.ctrlKey && !e.shiftKey && e.key === 'w') {
        e.preventDefault();
        handleCloseTab(activeTabIdRef.current);
      }
      // Ctrl+Shift+Right or Ctrl+\: Split focused pane horizontally
      if (
        (e.ctrlKey && e.shiftKey && e.key === 'ArrowRight') ||
        (e.ctrlKey && e.key === '\\')
      ) {
        e.preventDefault();
        if (focusedPaneIdRef.current) {
          handleSplitPane(activeTabIdRef.current, focusedPaneIdRef.current, 'horizontal');
        }
      }
      // Ctrl+Shift+Down: Split focused pane vertically
      if (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') {
        e.preventDefault();
        if (focusedPaneIdRef.current) {
          handleSplitPane(activeTabIdRef.current, focusedPaneIdRef.current, 'vertical');
        }
      }
      // Ctrl+Shift+W: Close focused pane
      if (e.ctrlKey && e.shiftKey && (e.key === 'W' || e.key === 'w')) {
        e.preventDefault();
        if (focusedPaneIdRef.current) {
          handleClosePane(activeTabIdRef.current, focusedPaneIdRef.current);
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewTab, handleCloseTab, handleSplitPane, handleClosePane]);

  return (
    <div className="tab-manager">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={handleSelectTab}
        onCloseTab={handleCloseTab}
        onNewTab={handleNewTab}
      />
      <div className="tab-content">
        {tabs.map((tab) => (
          <div
            key={tab.id}
            className="tab-panel"
            style={{ display: tab.id === activeTabId ? 'flex' : 'none' }}
            data-testid={`tab-panel-${tab.id}`}
          >
            <PaneContainer
              node={tab.paneRoot}
              focusedPaneId={tab.id === activeTabId ? focusedPaneId : tab.focusedPaneId}
              onFocusPane={handleFocusPane}
              onSplitPane={(paneId, dir) => handleSplitPane(tab.id, paneId, dir)}
              onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
              onResizePane={(splitId, newRatio) => handleResizePane(tab.id, splitId, newRatio)}
              isOnlyPane={countLeaves(tab.paneRoot) === 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TabManager;
