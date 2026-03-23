import { useState } from 'react';
import { Tab } from '../../lib/types';

interface TabBarProps {
  tabs: Tab[];
  activeTabId: string;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onNewTab: () => void;
  onOpenSettings?: () => void;
  onReorderTabs?: (fromIndex: number, toIndex: number) => void;
}

function TabBar({ tabs, activeTabId, onSelectTab, onCloseTab, onNewTab, onOpenSettings, onReorderTabs }: TabBarProps) {
  const showClose = tabs.length > 1;
  const [draggingIndex, setDraggingIndex] = useState<number | null>(null);
  const [dropTargetIndex, setDropTargetIndex] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/plain', String(index));
    e.dataTransfer.effectAllowed = 'move';
    setDraggingIndex(index);
  };

  const handleDragEnd = () => {
    setDraggingIndex(null);
    setDropTargetIndex(null);
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDropTargetIndex(index);
  };

  const handleDragLeave = () => {
    setDropTargetIndex(null);
  };

  const handleDrop = (e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('text/plain'), 10);
    if (!isNaN(fromIndex) && fromIndex !== toIndex && onReorderTabs) {
      onReorderTabs(fromIndex, toIndex);
    }
    setDraggingIndex(null);
    setDropTargetIndex(null);
  };

  return (
    <div className="tab-bar" role="tablist" data-testid="tab-bar">
      {tabs.map((tab, index) => (
        <button
          key={tab.id}
          role="tab"
          draggable="true"
          className={[
            'tab-button',
            tab.id === activeTabId ? 'tab-button-active' : '',
            draggingIndex === index ? 'tab-dragging' : '',
            dropTargetIndex === index && draggingIndex !== index ? 'tab-drop-indicator' : '',
          ].filter(Boolean).join(' ')}
          data-testid={`tab-button-${tab.id}`}
          aria-selected={tab.id === activeTabId}
          onClick={() => onSelectTab(tab.id)}
          onDragStart={(e) => handleDragStart(e, index)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, index)}
          onDragLeave={handleDragLeave}
          onDrop={(e) => handleDrop(e, index)}
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
      <div className="tab-bar-spacer" />
      <button
        className="tab-settings-btn"
        data-testid="settings-button"
        onClick={onOpenSettings}
        title="Settings"
        aria-label="Settings"
      >
        &#9881;
      </button>
    </div>
  );
}

export default TabBar;
