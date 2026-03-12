export const SHELL_TYPES = ['powershell', 'cmd', 'wsl'] as const;
export type ShellType = typeof SHELL_TYPES[number];

export interface SessionInfo {
  sessionId: string;
  shellType: ShellType;
}

export interface Block {
  id: string;
  command: string;          // The command text the user typed (empty for initial/welcome block)
  output: string;           // Accumulated output from PTY
  timestamp: number;        // Date.now() when command was submitted
  status: 'running' | 'completed';
  shellType: ShellType;
}
