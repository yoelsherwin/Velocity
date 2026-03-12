export const SHELL_TYPES = ['powershell', 'cmd', 'wsl'] as const;
export type ShellType = typeof SHELL_TYPES[number];

export interface SessionInfo {
  sessionId: string;
  shellType: ShellType;
}
