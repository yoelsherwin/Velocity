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
  focusedPaneId: string | null;  // Per-tab focus: which pane is focused in this tab
}

export interface Block {
  id: string;
  command: string;          // The command text the user typed (empty for initial/welcome block)
  output: string;           // Accumulated output from PTY
  timestamp: number;        // Date.now() when command was submitted
  status: 'running' | 'completed';
  exitCode?: number | null; // Exit code from the shell (0 = success, non-zero = failure)
  shellType: ShellType;
}

// --- Settings / LLM Provider Types ---

export const CURSOR_SHAPES = ['bar', 'block', 'underline'] as const;
export type CursorShape = typeof CURSOR_SHAPES[number];

export interface AppSettings {
  llm_provider: LlmProviderId;
  api_key: string;
  model: string;
  azure_endpoint?: string;
  font_family?: string;
  font_size?: number;
  line_height?: number;
  theme?: string;
  cursor_shape?: CursorShape;
}

export const LLM_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] },
  { id: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-5-20250929', models: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-6-20250918'] },
  { id: 'google', name: 'Google (Gemini)', defaultModel: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-2.5-pro'] },
  { id: 'azure', name: 'Azure OpenAI', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] },
] as const;

export type LlmProviderId = typeof LLM_PROVIDERS[number]['id'];
