import { invoke } from '@tauri-apps/api/core';

export interface FileEntry {
  name: string;
  path: string;
  is_directory: boolean;
  is_hidden: boolean;
}

export async function listDirectory(path: string): Promise<FileEntry[]> {
  return invoke<FileEntry[]>('list_directory', { path });
}
