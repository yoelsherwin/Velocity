import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Tab, PaneDirection, PaneNode } from '../../lib/types';
import { splitPane, closePane, countLeaves, getLeafIds, updatePaneRatio } from '../../lib/pane-utils';
import TabBar from './TabBar';
import PaneContainer from './PaneContainer';
import SettingsModal from '../SettingsModal';
import CommandPalette from '../CommandPalette';
import { getSettings, saveSettings } from '../../lib/settings';
import { applyFontSettings } from '../../lib/font-settings';
import { applyThemeById, isValidThemeId, DEFAULT_THEME_ID } from '../../lib/themes';
import { applyBackgroundEffect } from '../../lib/background-effects';
import { loadSessionState, SessionState, SavedPane } from '../../lib/session';
import { useSessionPersistence } from '../../hooks/useSessionPersistence';
import { SessionContext, buildPaneLookup } from '../../lib/session-context';
import { invoke } from '@tauri-apps/api/core';

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

// Cached session state loaded before first render — populated by loadInitialSession()
let cachedSessionState: SessionState | null = null;
let sessionLoadAttempted = false;

/** Pre-load session state. Call once before first render. */
export async function loadInitialSession(): Promise<void> {
  if (sessionLoadAttempted) return;
  sessionLoadAttempted = true;
  try {
    cachedSessionState = await loadSessionState();
  } catch {
    cachedSessionState = null;
  }
}

function createDefaultTabs(counter: { current: number }): Tab[] {
  const initialPaneId = crypto.randomUUID();
  const initialTab: Tab = {
    id: crypto.randomUUID(),
    title: `Terminal ${counter.current}`,
    shellType: 'powershell',
    paneRoot: { type: 'leaf', id: initialPaneId },
    focusedPaneId: initialPaneId,
  };
  return [initialTab];
}

function restoreTabsFromSession(session: SessionState, counter: { current: number }): Tab[] {
  if (!session.tabs || session.tabs.length === 0) {
    return createDefaultTabs(counter);
  }
  counter.current = session.tabs.length;
  return session.tabs.map((st) => ({
    id: st.id,
    title: st.title,
    shellType: st.shellType,
    paneRoot: st.paneRoot,
    focusedPaneId: st.focusedPaneId,
  }));
}

function TabManager() {
  const tabCounterRef = useRef(1);
  const [tabs, setTabs] = useState<Tab[]>(() => {
    if (cachedSessionState) {
      return restoreTabsFromSession(cachedSessionState, tabCounterRef);
    }
    return createDefaultTabs(tabCounterRef);
  });
  const tabsRef = useRef(tabs);
  const [activeTabId, setActiveTabId] = useState<string>(() => {
    if (cachedSessionState && cachedSessionState.activeTabId) {
      // Validate the active tab ID exists in restored tabs
      const restoredTabs = tabs;
      if (restoredTabs.some((t) => t.id === cachedSessionState!.activeTabId)) {
        return cachedSessionState!.activeTabId;
      }
    }
    return tabs[0].id;
  });
  const activeTabIdRef = useRef(activeTabId);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);

  // Session persistence
  const sessionPersistence = useSessionPersistence();
  const restoredSessionRef = useRef<SessionState | null>(cachedSessionState);
  const paneLookupRef = useRef(buildPaneLookup(cachedSessionState));

  const getSavedPane = useCallback((paneId: string): SavedPane | undefined => {
    return paneLookupRef.current.get(paneId);
  }, []);

  const sessionContextValue = useMemo(() => ({
    getSavedPane,
    updatePaneData: sessionPersistence.updatePaneData,
  }), [getSavedPane, sessionPersistence.updatePaneData]);

  // Map of tabId -> fallback title (e.g. "Terminal 1"), used when no CWD is available
  const fallbackTitlesRef = useRef<Map<string, string>>(new Map([[tabs[0].id, tabs[0].title]]));

  // Map of paneId -> latest dynamic title reported by that pane's Terminal
  const paneTitlesRef = useRef<Map<string, string>>(new Map());

  // Derive focusedPaneId from the active tab
  const activeTab = tabs.find((t) => t.id === activeTabId);
  const focusedPaneId = activeTab?.focusedPaneId ?? null;

  // Keep a ref in sync for keyboard shortcut handlers
  const focusedPaneIdRef = useRef(focusedPaneId);
  useEffect(() => {
    focusedPaneIdRef.current = focusedPaneId;
  }, [focusedPaneId]);

  // Load settings on startup and apply theme + fonts to CSS custom properties
  useEffect(() => {
    getSettings()
      .then((settings) => {
        applyThemeById(settings.theme ?? DEFAULT_THEME_ID);
        applyFontSettings(settings);
        applyBackgroundEffect(settings);
      })
      .catch(() => {
        // Ignore errors — CSS defaults remain in effect
      });
  }, []);

  // Keep tabsRef in sync with tabs state
  useEffect(() => {
    tabsRef.current = tabs;
  }, [tabs]);

  // Save session whenever tabs or activeTabId change (debounced)
  useEffect(() => {
    sessionPersistence.requestSave(tabs, activeTabId);
  }, [tabs, activeTabId, sessionPersistence]);

  // Save session immediately on window close
  useEffect(() => {
    const handleBeforeUnload = () => {
      sessionPersistence.saveNow(tabsRef.current, activeTabIdRef.current);
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [sessionPersistence]);

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
    fallbackTitlesRef.current.set(newTab.id, newTab.title);
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
        prev.map((t) => {
          if (t.id !== activeTabIdRef.current) return t;
          const updated = { ...t, focusedPaneId: paneId };
          // Update tab title to the newly focused pane's title
          const paneTitle = paneTitlesRef.current.get(paneId);
          if (paneTitle) {
            updated.title = paneTitle;
          }
          return updated;
        }),
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

  /**
   * Handle title change from a pane's Terminal.
   * Updates the tab title if the reporting pane is the tab's focused pane.
   */
  const handleTitleChange = useCallback(
    (tabId: string, paneId: string, title: string) => {
      // Store the pane's latest title
      paneTitlesRef.current.set(paneId, title);
      // Update the tab title if this pane is the tab's focused pane
      setTabs((prev) =>
        prev.map((tab) => {
          if (tab.id !== tabId) return tab;
          if (tab.focusedPaneId !== paneId) return tab;
          const fallback = fallbackTitlesRef.current.get(tabId) ?? tab.title;
          const newTitle = title || fallback;
          if (tab.title === newTitle) return tab;
          return { ...tab, title: newTitle };
        }),
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
      // Ctrl+Shift+N: New window
      if (e.ctrlKey && e.shiftKey && (e.key === 'N' || e.key === 'n')) {
        e.preventDefault();
        invoke('create_new_window').catch(() => {
          // Ignore errors (e.g. in test environment)
        });
      }
      // Ctrl+Shift+P: Toggle command palette
      if (e.ctrlKey && e.shiftKey && (e.key === 'P' || e.key === 'p')) {
        e.preventDefault();
        setPaletteOpen((prev) => !prev);
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleNewTab, handleCloseTab, handleSplitPane, handleClosePane]);

  /**
   * Dispatch an action from the command palette.
   * Tab/pane level actions are handled here; terminal-level actions
   * are dispatched via a custom DOM event to the focused terminal.
   */
  const dispatchToFocusedTerminal = useCallback((commandId: string) => {
    document.dispatchEvent(
      new CustomEvent('velocity:command', {
        detail: { commandId, paneId: focusedPaneIdRef.current },
      }),
    );
  }, []);

  const handlePaletteAction = useCallback(
    (commandId: string) => {
      switch (commandId) {
        case 'window.new':
          invoke('create_new_window').catch(() => {
            // Ignore errors (e.g. in test environment)
          });
          break;
        case 'tab.new':
          handleNewTab();
          break;
        case 'tab.close':
          handleCloseTab(activeTabIdRef.current);
          break;
        case 'pane.splitRight':
          if (focusedPaneIdRef.current) {
            handleSplitPane(activeTabIdRef.current, focusedPaneIdRef.current, 'horizontal');
          }
          break;
        case 'pane.splitDown':
          if (focusedPaneIdRef.current) {
            handleSplitPane(activeTabIdRef.current, focusedPaneIdRef.current, 'vertical');
          }
          break;
        case 'pane.close':
          if (focusedPaneIdRef.current) {
            handleClosePane(activeTabIdRef.current, focusedPaneIdRef.current);
          }
          break;
        case 'settings.open':
          setSettingsOpen(true);
          break;
        case 'theme.select':
          setSettingsOpen(true);
          break;
        case 'palette.open':
          // No-op: palette is already open
          break;
        default:
          // Handle theme.* quick-switch commands
          if (commandId.startsWith('theme.')) {
            const themeId = commandId.slice('theme.'.length);
            if (isValidThemeId(themeId)) {
              applyThemeById(themeId);
              // Persist the theme setting
              getSettings()
                .then((settings) => saveSettings({ ...settings, theme: themeId }))
                .catch(() => { /* ignore save errors */ });
              break;
            }
          }
          // Terminal-level actions dispatched via custom event
          dispatchToFocusedTerminal(commandId);
          break;
      }
    },
    [handleNewTab, handleCloseTab, handleSplitPane, handleClosePane, dispatchToFocusedTerminal],
  );

  return (
    <SessionContext.Provider value={sessionContextValue}>
      <div className="tab-manager">
        <TabBar
          tabs={tabs}
          activeTabId={activeTabId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onNewTab={handleNewTab}
          onOpenSettings={() => setSettingsOpen(true)}
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
                onTitleChange={(paneId, title) => handleTitleChange(tab.id, paneId, title)}
                isOnlyPane={countLeaves(tab.paneRoot) === 1}
              />
            </div>
          ))}
        </div>
        {paletteOpen && (
          <CommandPalette
            onExecute={handlePaletteAction}
            onClose={() => setPaletteOpen(false)}
          />
        )}
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </div>
    </SessionContext.Provider>
  );
}

export default TabManager;
