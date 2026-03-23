import { useCallback, useRef } from 'react';
import { Tab } from '../lib/types';
import { saveSessionState, SessionState, SavedPane } from '../lib/session';
import { getLeafIds } from '../lib/pane-utils';

const DEBOUNCE_MS = 2000;

export interface PaneSessionData {
  shellType: string;
  cwd: string;
  history: string[];
}

export interface UseSessionPersistence {
  /** Register or update per-pane data (cwd, history, shellType). */
  updatePaneData: (paneId: string, data: PaneSessionData) => void;
  /** Trigger a (debounced) session save. */
  requestSave: (tabs: Tab[], activeTabId: string) => void;
  /** Force an immediate save (e.g. on beforeunload). */
  saveNow: (tabs: Tab[], activeTabId: string) => void;
}

export function useSessionPersistence(): UseSessionPersistence {
  const paneDataRef = useRef<Map<string, PaneSessionData>>(new Map());
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<{ tabs: Tab[]; activeTabId: string } | null>(null);

  const doSave = useCallback((tabs: Tab[], activeTabId: string) => {
    const sessionState: SessionState = {
      version: 1,
      tabs: tabs.map((tab) => {
        const leafIds = getLeafIds(tab.paneRoot);
        const panes: SavedPane[] = leafIds.map((id) => {
          const data = paneDataRef.current.get(id);
          return {
            id,
            shellType: (data?.shellType as 'powershell' | 'cmd' | 'wsl') ?? tab.shellType,
            cwd: data?.cwd ?? 'C:\\',
            history: (data?.history ?? []).slice(-100),
          };
        });
        return {
          id: tab.id,
          title: tab.title,
          shellType: tab.shellType,
          paneRoot: tab.paneRoot,
          focusedPaneId: tab.focusedPaneId,
          panes,
        };
      }),
      activeTabId,
    };
    saveSessionState(sessionState).catch(() => {
      // Ignore save errors — session restoration is best-effort
    });
  }, []);

  const requestSave = useCallback(
    (tabs: Tab[], activeTabId: string) => {
      pendingRef.current = { tabs, activeTabId };
      if (timerRef.current === null) {
        timerRef.current = setTimeout(() => {
          timerRef.current = null;
          const pending = pendingRef.current;
          if (pending) {
            pendingRef.current = null;
            doSave(pending.tabs, pending.activeTabId);
          }
        }, DEBOUNCE_MS);
      }
    },
    [doSave],
  );

  const saveNow = useCallback(
    (tabs: Tab[], activeTabId: string) => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      pendingRef.current = null;
      doSave(tabs, activeTabId);
    },
    [doSave],
  );

  const updatePaneData = useCallback((paneId: string, data: PaneSessionData) => {
    paneDataRef.current.set(paneId, data);
  }, []);

  return { updatePaneData, requestSave, saveNow };
}
