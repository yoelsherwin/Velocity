import { invoke } from '@tauri-apps/api/core';

export interface GitInfo {
  branch: string;
  is_dirty: boolean;
  ahead: number;
  behind: number;
}

/**
 * Returns git info for the given working directory, or null if not in a git repo.
 */
export async function getGitInfo(cwd: string): Promise<GitInfo | null> {
  return invoke<GitInfo | null>('get_git_info', { cwd });
}
