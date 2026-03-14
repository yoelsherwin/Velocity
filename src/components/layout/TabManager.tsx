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

  const handleNewTab = useCallback(() => {
    tabCounterRef.current += 1;
    const newTab: Tab = {
      id: crypto.randomUUID(),
      title: `Terminal ${tabCounterRef.current}`,
      shellType: 'powershell',
    };
    setTabs((prev) => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  const handleCloseTab = useCallback(
    (tabId: string) => {
      setTabs((prev) => {
        if (prev.length <= 1) return prev; // Don't close the last tab

        const index = prev.findIndex((t) => t.id === tabId);
        const newTabs = prev.filter((t) => t.id !== tabId);

        // If closing the active tab, switch to an adjacent tab
        if (tabId === activeTabId) {
          // Prefer the previous tab; if closing the first, go to next
          const newActiveIndex = index > 0 ? index - 1 : 0;
          setActiveTabId(newTabs[newActiveIndex].id);
        }

        return newTabs;
      });
    },
    [activeTabId],
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
        handleCloseTab(activeTabId);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewTab, handleCloseTab, activeTabId]);

  return (
    <div className="tab-manager">
      <TabBar
        tabs={tabs}
        activeTabId={activeTabId}
        onSelectTab={setActiveTabId}
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
