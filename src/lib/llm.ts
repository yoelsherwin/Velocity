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
