import { useState, useEffect, useCallback, useRef } from 'react';
import { Tab, PaneDirection } from '../../lib/types';
import { splitPane, closePane, countLeaves, getLeafIds } from '../../lib/pane-utils';
import TabBar from './TabBar';
import PaneContainer from './PaneContainer';

function TabManager() {
  const tabCounterRef = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const initialPaneId = crypto.randomUUID();
    const initialTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
      paneRoot: { type: 'leaf', id: initialPaneId },
    };
    return [initialTab];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);
  const [focusedPaneId, setFocusedPaneId] = useState<string | null>(() => {
    const firstTab = tabs[0];
    return firstTab.paneRoot.type === 'leaf' ? firstTab.paneRoot.id : null;
  });
  const focusedPaneIdRef = useRef(focusedPaneId);

  const updateActiveTabId = useCallback((id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);

  const updateFocusedPaneId = useCallback((id: string | null) => {
    focusedPaneIdRef.current = id;
    setFocusedPaneId(id);
  }, []);

  const handleNewTab = useCallback(() => {
    tabCounterRef.current += 1;
    const initialPaneId = crypto.randomUUID();
    const newTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
      paneRoot: { type: 'leaf', id: initialPaneId },
    };
    setTabs((prev) => [...prev, newTab]);
    updateActiveTabId(newTab.id);
    updateFocusedPaneId(initialPaneId);
  }, [updateActiveTabId, updateFocusedPaneId]);

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
          // Focus the first pane of the new active tab
          const leafIds = getLeafIds(nextTab.paneRoot);
          updateFocusedPaneId(leafIds.length > 0 ? leafIds[0] : null);
        }

        return newTabs;
      });
    },
    [updateActiveTabId, updateFocusedPaneId],
  );

  const handleFocusPane = useCallback(
    (paneId: string) => {
      updateFocusedPaneId(paneId);
    },
    [updateFocusedPaneId],
  );

  const handleSplitPane = useCallback(
    (tabId: string, paneId: string, direction: PaneDirection) => {
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab;
          const newRoot = splitPane(tab.paneRoot, paneId, direction);
          return { ...tab, paneRoot: newRoot };
        }),
      );
      // Focus stays on the original pane after split
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
          if (focusedPaneIdRef.current === paneId) {
            const leafIds = getLeafIds(newRoot);
            updateFocusedPaneId(leafIds.length > 0 ? leafIds[0] : null);
          }

          return { ...tab, paneRoot: newRoot };
        }),
      );
    },
    [updateFocusedPaneId],
  );

  // When switching tabs, update focused pane to first leaf of the new active tab
  const handleSelectTab = useCallback(
    (tabId: string) => {
      updateActiveTabId(tabId);
      // Find the new tab and focus its first pane
      setTabs((prev) => {
        const tab = prev.find((t) => t.id === tabId);
        if (tab) {
          const leafIds = getLeafIds(tab.paneRoot);
          updateFocusedPaneId(leafIds.length > 0 ? leafIds[0] : null);
        }
        return prev; // No mutation needed
      });
    },
    [updateActiveTabId, updateFocusedPaneId],
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
      // Ctrl+Shift+Down or Ctrl+-: Split focused pane vertically
      if (
        (e.ctrlKey && e.shiftKey && e.key === 'ArrowDown') ||
        (e.ctrlKey && e.key === '-')
      ) {
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
              focusedPaneId={focusedPaneId}
              onFocusPane={handleFocusPane}
              onSplitPane={(paneId, dir) => handleSplitPane(tab.id, paneId, dir)}
              onClosePane={(paneId) => handleClosePane(tab.id, paneId)}
              isOnlyPane={countLeaves(tab.paneRoot) === 1}
            />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TabManager;
