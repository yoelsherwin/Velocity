import { invoke } from '@tauri-apps/api/core';
import { ShellType, PaneNode } from './types';

export interface SavedPane {
  id: string;
  shellType: ShellType;
  cwd: string;
  history: string[];
}

export interface SavedTab {
  id: string;
  title: string;
  shellType: ShellType;
  paneRoot: PaneNode;
  focusedPaneId: string | null;
  panes: SavedPane[];
}

export interface SessionState {
  version: 1;
  tabs: SavedTab[];
  activeTabId: string;
}

export async function saveSessionState(state: SessionState): Promise<void> {
  const json = JSON.stringify(state);
  return invoke<void>('save_session', { state: json });
}

/**
 * Validates that a CWD path does not contain shell metacharacters that could
 * enable command injection when the path is interpolated into a `cd` command.
 */
export function isValidCwdPath(path: string): boolean {
  return !/[;&|`$(){}[\]\n\r]/.test(path);
}

export async function loadSessionState(): Promise<SessionState | null> {
  const json = await invoke<string | null>('load_session');
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as SessionState;
    if (parsed.version !== 1 || !Array.isArray(parsed.tabs) || !parsed.activeTabId) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
