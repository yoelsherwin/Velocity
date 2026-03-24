export interface Command {
  id: string;
  title: string;
  shortcut?: string;
  category: string;
  keywords?: string[];
}

export const COMMANDS: Command[] = [
  { id: 'window.new', title: 'New Window', shortcut: 'Ctrl+Shift+N', category: 'Window', keywords: ['create', 'open'] },
  { id: 'window.toggle', title: 'Toggle Window', shortcut: 'Ctrl+`', category: 'Window', keywords: ['quake', 'summon', 'hide', 'show', 'hotkey', 'global'] },
  { id: 'tab.new', title: 'New Tab', shortcut: 'Ctrl+T', category: 'Tab', keywords: ['create', 'add'] },
  { id: 'tab.close', title: 'Close Tab', shortcut: 'Ctrl+W', category: 'Tab', keywords: ['remove', 'delete'] },
  { id: 'pane.splitRight', title: 'Split Pane Right', shortcut: 'Ctrl+Shift+Right', category: 'Pane', keywords: ['horizontal', 'divide'] },
  { id: 'pane.splitDown', title: 'Split Pane Down', shortcut: 'Ctrl+Shift+Down', category: 'Pane', keywords: ['vertical', 'divide'] },
  { id: 'pane.close', title: 'Close Pane', shortcut: 'Ctrl+Shift+W', category: 'Pane', keywords: ['remove', 'delete'] },
  { id: 'block.prev', title: 'Previous Block', shortcut: 'Ctrl+Up', category: 'Navigation', keywords: ['navigate', 'scroll', 'block'] },
  { id: 'block.next', title: 'Next Block', shortcut: 'Ctrl+Down', category: 'Navigation', keywords: ['navigate', 'scroll', 'block'] },
  { id: 'block.collapseAll', title: 'Collapse All Blocks', category: 'Block', keywords: ['collapse', 'fold', 'hide'] },
  { id: 'block.expandAll', title: 'Expand All Blocks', category: 'Block', keywords: ['expand', 'unfold', 'show'] },
  { id: 'block.toggleCollapse', title: 'Toggle Block Collapse', category: 'Block', keywords: ['collapse', 'expand', 'fold', 'toggle'] },
  { id: 'block.filter', title: 'Filter Block Output', category: 'Block', keywords: ['filter', 'grep', 'search', 'lines'] },
  { id: 'block.toggleBookmark', title: 'Toggle Bookmark', shortcut: 'Ctrl+B', category: 'Block', keywords: ['bookmark', 'star', 'flag', 'mark'] },
  { id: 'block.nextBookmark', title: 'Next Bookmark', category: 'Navigation', keywords: ['bookmark', 'jump', 'next'] },
  { id: 'block.prevBookmark', title: 'Previous Bookmark', category: 'Navigation', keywords: ['bookmark', 'jump', 'previous'] },
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
  { id: 'notifications.test', title: 'Test Notification', category: 'Terminal', keywords: ['notify', 'desktop', 'alert'] },
  { id: 'history.search', title: 'Search History', shortcut: 'Ctrl+R', category: 'Navigation', keywords: ['reverse', 'history', 'find', 'command'] },
  { id: 'theme.select', title: 'Change Theme', category: 'Appearance', keywords: ['theme', 'color', 'dark', 'light'] },
  { id: 'theme.catppuccin-mocha', title: 'Theme: Catppuccin Mocha', category: 'Appearance', keywords: ['theme', 'dark'] },
  { id: 'theme.catppuccin-latte', title: 'Theme: Catppuccin Latte', category: 'Appearance', keywords: ['theme', 'light'] },
  { id: 'theme.dracula', title: 'Theme: Dracula', category: 'Appearance', keywords: ['theme', 'dark'] },
  { id: 'theme.one-dark', title: 'Theme: One Dark', category: 'Appearance', keywords: ['theme', 'dark'] },
  { id: 'theme.solarized-dark', title: 'Theme: Solarized Dark', category: 'Appearance', keywords: ['theme', 'dark'] },
];
