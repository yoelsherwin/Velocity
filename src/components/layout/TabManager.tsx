import { useState, useEffect, useCallback, useRef } from 'react';
import { Tab } from '../../lib/types';
import TabBar from './TabBar';
import Terminal from '../Terminal';

function TabManager() {
  const tabCounterRef = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    const initialTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
    };
    return [initialTab];
  });
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0].id);
  const activeTabIdRef = useRef(activeTabId);

  const updateActiveTabId = useCallback((id: string) => {
    activeTabIdRef.current = id;
    setActiveTabId(id);
  }, []);

  const handleNewTab = useCallback(() => {
    tabCounterRef.current += 1;
    const newTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
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
          updateActiveTabId(newTabs[newActiveIndex].id);
        }

        return newTabs;
      });
    },
    [updateActiveTabId],
  );

  // Global keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 't') {
        e.preventDefault();
        handleNewTab();
      }
      if (e.ctrlKey && e.key === 'w') {
        e.preventDefault();
        handleCloseTab(activeTabIdRef.current);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewTab, handleCloseTab]);

  return (
    <div className="tab-manager">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={updateActiveTabId}
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
            <Terminal />
          </div>
        ))}
      </div>
    </div>
  );
}

export default TabManager;
