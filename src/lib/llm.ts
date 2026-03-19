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
