import { Tab } from '../../lib/types';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
}

function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab }: TabBarProps) {
  const showClose = tabs.length > 1;

  return (
    <div className="tab-bar" role="tablist" data-testid="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          role="tab"
          className={`tab-button ${tab.id === activeTabId ? 'tab-button-active' : ''}`}
          data-testid={`tab-button-${tab.id}`}
          aria-selected={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
        >
          <span>{tab.title}</span>
          {showClose && (
            <span
              className="tab-close"
              data-testid={`tab-close-${tab.id}`}
              role="button"
              aria-label={`Close ${tab.title}`}
              onClick={(e) => {
                e.stopPropagation();
                onCloseTab(tab.id);
              }}
            >
              ✕
            </span>
          )}
        </button>
      ))}
      <button
        className="tab-new"
        data-testid="tab-new-button"
        aria-label="New tab"
        onClick={onNewTab}
      >
        +
      </button>
    </div>
  );
}

export default TabBar;
