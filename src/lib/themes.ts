export interface Theme {
  id: string;
  name: string;
  colors: Record<string, string>;
}

/**
 * All CSS variable keys that every theme must define.
 */
export const THEME_CSS_VARIABLES = [
  // Base
  '--bg-base',
  '--bg-surface',
  '--bg-overlay',
  '--bg-deep',
  '--text-primary',
  '--text-secondary',
  '--text-muted',
  // Accent
  '--accent-blue',
  '--accent-green',
  '--accent-red',
  '--accent-yellow',
  '--accent-peach',
  '--accent-teal',
  // Syntax
  '--syntax-command',
  '--syntax-flag',
  '--syntax-string',
  '--syntax-pipe',
  '--syntax-argument',
  // UI
  '--border-color',
  '--scrollbar-thumb',
  '--selection-bg',
  // Search
  '--search-highlight-bg',
  '--search-highlight-current-bg',
  '--search-highlight-current-outline',
] as const;

export type ThemeCssVariable = typeof THEME_CSS_VARIABLES[number];

const catppuccinMocha: Theme = {
  id: 'catppuccin-mocha',
  name: 'Catppuccin Mocha',
  colors: {
    '--bg-base': '#1e1e2e',
    '--bg-surface': '#313244',
    '--bg-overlay': '#45475a',
    '--bg-deep': '#181825',
    '--text-primary': '#cdd6f4',
    '--text-secondary': '#a6adc8',
    '--text-muted': '#585b70',
    '--accent-blue': '#89b4fa',
    '--accent-green': '#a6e3a1',
    '--accent-red': '#f38ba8',
    '--accent-yellow': '#f9e2af',
    '--accent-peach': '#fab387',
    '--accent-teal': '#74c7ec',
    '--syntax-command': '#89b4fa',
    '--syntax-flag': '#f9e2af',
    '--syntax-string': '#a6e3a1',
    '--syntax-pipe': '#f38ba8',
    '--syntax-argument': '#cdd6f4',
    '--border-color': '#313244',
    '--scrollbar-thumb': '#585b70',
    '--selection-bg': 'rgba(137, 180, 250, 0.3)',
    '--search-highlight-bg': 'rgba(249, 226, 175, 0.3)',
    '--search-highlight-current-bg': 'rgba(249, 226, 175, 0.7)',
    '--search-highlight-current-outline': '#f9e2af',
  },
};

const catppuccinLatte: Theme = {
  id: 'catppuccin-latte',
  name: 'Catppuccin Latte',
  colors: {
    '--bg-base': '#eff1f5',
    '--bg-surface': '#ccd0da',
    '--bg-overlay': '#bcc0cc',
    '--bg-deep': '#e6e9ef',
    '--text-primary': '#4c4f69',
    '--text-secondary': '#5c5f77',
    '--text-muted': '#9ca0b0',
    '--accent-blue': '#1e66f5',
    '--accent-green': '#40a02b',
    '--accent-red': '#d20f39',
    '--accent-yellow': '#df8e1d',
    '--accent-peach': '#fe640b',
    '--accent-teal': '#04a5e5',
    '--syntax-command': '#1e66f5',
    '--syntax-flag': '#df8e1d',
    '--syntax-string': '#40a02b',
    '--syntax-pipe': '#d20f39',
    '--syntax-argument': '#4c4f69',
    '--border-color': '#ccd0da',
    '--scrollbar-thumb': '#9ca0b0',
    '--selection-bg': 'rgba(30, 102, 245, 0.2)',
    '--search-highlight-bg': 'rgba(223, 142, 29, 0.3)',
    '--search-highlight-current-bg': 'rgba(223, 142, 29, 0.6)',
    '--search-highlight-current-outline': '#df8e1d',
  },
};

const dracula: Theme = {
  id: 'dracula',
  name: 'Dracula',
  colors: {
    '--bg-base': '#282a36',
    '--bg-surface': '#44475a',
    '--bg-overlay': '#6272a4',
    '--bg-deep': '#21222c',
    '--text-primary': '#f8f8f2',
    '--text-secondary': '#bfbfbf',
    '--text-muted': '#6272a4',
    '--accent-blue': '#8be9fd',
    '--accent-green': '#50fa7b',
    '--accent-red': '#ff5555',
    '--accent-yellow': '#f1fa8c',
    '--accent-peach': '#ffb86c',
    '--accent-teal': '#8be9fd',
    '--syntax-command': '#8be9fd',
    '--syntax-flag': '#f1fa8c',
    '--syntax-string': '#50fa7b',
    '--syntax-pipe': '#ff79c6',
    '--syntax-argument': '#f8f8f2',
    '--border-color': '#44475a',
    '--scrollbar-thumb': '#6272a4',
    '--selection-bg': 'rgba(139, 233, 253, 0.3)',
    '--search-highlight-bg': 'rgba(241, 250, 140, 0.3)',
    '--search-highlight-current-bg': 'rgba(241, 250, 140, 0.7)',
    '--search-highlight-current-outline': '#f1fa8c',
  },
};

const oneDark: Theme = {
  id: 'one-dark',
  name: 'One Dark',
  colors: {
    '--bg-base': '#282c34',
    '--bg-surface': '#3e4451',
    '--bg-overlay': '#4b5263',
    '--bg-deep': '#21252b',
    '--text-primary': '#abb2bf',
    '--text-secondary': '#828997',
    '--text-muted': '#5c6370',
    '--accent-blue': '#61afef',
    '--accent-green': '#98c379',
    '--accent-red': '#e06c75',
    '--accent-yellow': '#e5c07b',
    '--accent-peach': '#d19a66',
    '--accent-teal': '#56b6c2',
    '--syntax-command': '#61afef',
    '--syntax-flag': '#e5c07b',
    '--syntax-string': '#98c379',
    '--syntax-pipe': '#e06c75',
    '--syntax-argument': '#abb2bf',
    '--border-color': '#3e4451',
    '--scrollbar-thumb': '#5c6370',
    '--selection-bg': 'rgba(97, 175, 239, 0.3)',
    '--search-highlight-bg': 'rgba(229, 192, 123, 0.3)',
    '--search-highlight-current-bg': 'rgba(229, 192, 123, 0.7)',
    '--search-highlight-current-outline': '#e5c07b',
  },
};

const solarizedDark: Theme = {
  id: 'solarized-dark',
  name: 'Solarized Dark',
  colors: {
    '--bg-base': '#002b36',
    '--bg-surface': '#073642',
    '--bg-overlay': '#586e75',
    '--bg-deep': '#00212b',
    '--text-primary': '#839496',
    '--text-secondary': '#657b83',
    '--text-muted': '#586e75',
    '--accent-blue': '#268bd2',
    '--accent-green': '#859900',
    '--accent-red': '#dc322f',
    '--accent-yellow': '#b58900',
    '--accent-peach': '#cb4b16',
    '--accent-teal': '#2aa198',
    '--syntax-command': '#268bd2',
    '--syntax-flag': '#b58900',
    '--syntax-string': '#859900',
    '--syntax-pipe': '#dc322f',
    '--syntax-argument': '#839496',
    '--border-color': '#073642',
    '--scrollbar-thumb': '#586e75',
    '--selection-bg': 'rgba(38, 139, 210, 0.3)',
    '--search-highlight-bg': 'rgba(181, 137, 0, 0.3)',
    '--search-highlight-current-bg': 'rgba(181, 137, 0, 0.7)',
    '--search-highlight-current-outline': '#b58900',
  },
};

export const THEMES: Theme[] = [
  catppuccinMocha,
  catppuccinLatte,
  dracula,
  oneDark,
  solarizedDark,
];

export const DEFAULT_THEME_ID = 'catppuccin-mocha';

/**
 * Find a theme by ID, falling back to the default theme.
 */
export function getThemeById(id: string): Theme {
  return THEMES.find((t) => t.id === id) ?? catppuccinMocha;
}

/**
 * Returns true if the given ID is a valid built-in theme.
 */
export function isValidThemeId(id: string): boolean {
  return THEMES.some((t) => t.id === id);
}

/**
 * Applies a theme by setting all its CSS variables on :root.
 */
export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  for (const [property, value] of Object.entries(theme.colors)) {
    root.style.setProperty(property, value);
  }
}

/**
 * Applies a theme by ID. Falls back to default if ID is invalid.
 */
export function applyThemeById(id: string): void {
  applyTheme(getThemeById(id));
}
