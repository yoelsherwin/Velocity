import { invoke } from '@tauri-apps/api/core';

export async function createSession(
  shellType?: string,
  rows?: number,
  cols?: number,
): Promise<string> {
  return invoke<string>('create_session', {
    shell_type: shellType,
    rows,
    cols,
  });
}

export async function writeToSession(
  sessionId: string,
  data: string,
): Promise<void> {
  return invoke<void>('write_to_session', {
    session_id: sessionId,
    data,
  });
}

export async function resizeSession(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return invoke<void>('resize_session', {
    session_id: sessionId,
    rows,
    cols,
  });
}

export async function closeSession(sessionId: string): Promise<void> {
  return invoke<void>('close_session', {
    session_id: sessionId,
  });
}
