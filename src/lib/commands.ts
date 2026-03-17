export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  category: string;
  keywords?: string[];
}

export const COMMANDS: Command[] = [
  { id: 'tab.new', title: 'New Tab', shortcut: 'Ctrl+T', category: 'Tab', keywords: ['create', 'add'] },
  { id: 'tab.close', title: 'Close Tab', shortcut: 'Ctrl+W', category: 'Tab', keywords: ['remove', 'delete'] },
  { id: 'pane.splitRight', title: 'Split Pane Right', shortcut: 'Ctrl+Shift+Right', category: 'Pane', keywords: ['horizontal', 'divide'] },
  { id: 'pane.splitDown', title: 'Split Pane Down', shortcut: 'Ctrl+Shift+Down', category: 'Pane', keywords: ['vertical', 'divide'] },
  { id: 'pane.close', title: 'Close Pane', shortcut: 'Ctrl+Shift+W', category: 'Pane', keywords: ['remove', 'delete'] },
  { id: 'search.find', title: 'Find in Output', shortcut: 'Ctrl+Shift+F', category: 'Search', keywords: ['search', 'grep'] },
  { id: 'settings.open', title: 'Open Settings', category: 'Settings', keywords: ['preferences', 'config'] },
  { id: 'shell.powershell', title: 'Switch to PowerShell', category: 'Terminal', keywords: ['shell'] },
  { id: 'shell.cmd', title: 'Switch to CMD', category: 'Terminal', keywords: ['shell', 'command prompt'] },
  { id: 'shell.wsl', title: 'Switch to WSL', category: 'Terminal', keywords: ['shell', 'linux', 'ubuntu'] },
  { id: 'terminal.restart', title: 'Restart Session', category: 'Terminal', keywords: ['reset'] },
  { id: 'terminal.toggleMode', title: 'Toggle AI/CLI Mode', category: 'Terminal', keywords: ['agent', 'natural language'] },
  { id: 'terminal.clear', title: 'Clear Terminal', category: 'Terminal', keywords: ['reset', 'clean'] },
  { id: 'terminal.copyLastCommand', title: 'Copy Last Command', category: 'Terminal', keywords: ['clipboard'] },
  { id: 'terminal.copyLastOutput', title: 'Copy Last Output', category: 'Terminal', keywords: ['clipboard'] },
  { id: 'palette.open', title: 'Command Palette', shortcut: 'Ctrl+Shift+P', category: 'General', keywords: ['commands', 'actions'] },
];
