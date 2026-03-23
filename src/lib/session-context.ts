import { createContext, useContext } from 'react';
import type { SavedPane, SessionState } from './session';
import type { PaneSessionData } from '../hooks/useSessionPersistence';

export interface SessionContextValue {
  /** Get saved pane data for restoration (initial render only). */
  getSavedPane: (paneId: string) => SavedPane | undefined;
  /** Report pane data for session persistence. */
  updatePaneData: (paneId: string, data: PaneSessionData) => void;
}

export const SessionContext = createContext<SessionContextValue>({
  getSavedPane: () => undefined,
  updatePaneData: () => {},
});

export function useSessionContext(): SessionContextValue {
  return useContext(SessionContext);
}

/** Build a pane ID → SavedPane lookup map from a session state. */
export function buildPaneLookup(session: SessionState | null): Map<string, SavedPane> {
  const map = new Map<string, SavedPane>();
  if (!session) return map;
  for (const tab of session.tabs) {
    for (const pane of tab.panes) {
      map.set(pane.id, pane);
    }
  }
  return map;
}
