import { invoke } from '@tauri-apps/api/core';

/**
 * Returns the app's current working directory from the Rust backend.
 *
 * Note: This returns the Rust process's CWD (the app's launch directory),
 * NOT the shell session's CWD (which changes with `cd`).
 * For MVP, this is a reasonable approximation.
 */
export async function getCwd(): Promise<string> {
  return invoke<string>('get_cwd');
}
