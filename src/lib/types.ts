export const SHELL_TYPES = ['powershell', 'cmd', 'wsl'] as const;
export type ShellType = typeof SHELL_TYPES[number];

export interface SessionInfo {
  sessionId: string;
  shellType: ShellType;
}

export type PaneDirection = 'horizontal' | 'vertical';

export type PaneNode =
  | { type: 'leaf'; id: string }
  | { type: 'split'; id: string; direction: PaneDirection; first: PaneNode; second: PaneNode; ratio: number };

export interface Tab {
  id: string;
  title: string;       // Display name (e.g., "Terminal 1", "Terminal 2")
  shellType: ShellType; // Initial shell type for this tab
  paneRoot: PaneNode;  // Root of the pane tree
}

export interface Block {
  id: string;
  command: string;          // The command text the user typed (empty for initial/welcome block)
  output: string;           // Accumulated output from PTY
  timestamp: number;        // Date.now() when command was submitted
  status: 'running' | 'completed';
  shellType: ShellType;
}
