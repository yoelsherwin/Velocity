import { invoke } from '@tauri-apps/api/core';
import { ShellType } from './types';

export async function createSession(
  shellType?: ShellType,
  rows?: number,
  cols?: number,
): Promise<string> {
  return invoke<string>('create_session', {
    shellType,
    rows,
    cols,
  });
}

export async function writeToSession(
  sessionId: string,
  data: string,
): Promise<void> {
  return invoke<void>('write_to_session', {
    sessionId,
    data,
  });
}

export async function resizeSession(
  sessionId: string,
  rows: number,
  cols: number,
): Promise<void> {
  return invoke<void>('resize_session', {
    sessionId,
    rows,
    cols,
  });
}

export async function closeSession(sessionId: string): Promise<void> {
  return invoke<void>('close_session', {
    sessionId,
  });
}

export async function startReading(sessionId: string): Promise<void> {
  return invoke<void>('start_reading', {
    sessionId,
  });
}
