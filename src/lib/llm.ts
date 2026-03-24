import { invoke } from '@tauri-apps/api/core';

/**
 * Translates a natural language prompt into a shell command using the configured LLM provider.
 *
 * @param input - The natural language text from the user
 * @param shellType - The target shell: "powershell", "cmd", or "wsl"
 * @param cwd - The current working directory
 * @returns The translated shell command as a string
 */
export async function translateCommand(
  input: string,
  shellType: string,
  cwd: string,
): Promise<string> {
  return invoke<string>('translate_command', {
    input,
    shellType,
    cwd,
  });
}

/**
 * The response from the suggest_fix command.
 */
export interface FixSuggestion {
  suggested_command: string;
  explanation: string;
}

/**
 * Suggests a fix for a failed command using the configured LLM provider.
 * Returns a suggested command and explanation, or throws if unavailable.
 *
 * @param command - The failed command
 * @param exitCode - The non-zero exit code
 * @param errorOutput - The error output (will be truncated to last 2000 chars on backend)
 * @param shellType - The target shell: "powershell", "cmd", or "wsl"
 * @param cwd - The current working directory
 */
export async function suggestFix(
  command: string,
  exitCode: number,
  errorOutput: string,
  shellType: string,
  cwd: string,
): Promise<FixSuggestion> {
  return invoke<FixSuggestion>('suggest_fix', {
    command,
    exitCode,
    errorOutput,
    shellType,
    cwd,
  });
}

/**
 * Result of analyzing a command for dangerous patterns.
 */
export interface DangerAnalysis {
  is_dangerous: boolean;
  reason: string;
  danger_level: string;
}

/**
 * Analyzes a command for dangerous patterns (destructive, exfiltration, etc.).
 * Called before displaying LLM-generated commands to warn the user.
 *
 * @param command - The command to analyze
 * @param shellType - The target shell: "powershell", "cmd", or "wsl"
 */
export async function analyzeCommandDanger(
  command: string,
  shellType: string,
): Promise<DangerAnalysis> {
  return invoke<DangerAnalysis>('analyze_command_danger', {
    command,
    shellType,
  });
}

/**
 * Classifies ambiguous user input as CLI or natural language using the configured LLM provider.
 * Only called on submit (Enter) when the heuristic classifier has low confidence.
 *
 * @param input - The user's input text
 * @param shellType - The target shell: "powershell", "cmd", or "wsl"
 * @returns "cli" or "natural_language"
 */
export async function classifyIntentLLM(
  input: string,
  shellType: string,
): Promise<'cli' | 'natural_language'> {
  const result = await invoke<string>('classify_intent_llm', {
    input,
    shellType,
  });
  // Type-safe: only accept valid intent values
  if (result === 'cli' || result === 'natural_language') {
    return result;
  }
  return 'cli'; // Fallback
}
