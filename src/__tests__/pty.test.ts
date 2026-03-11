import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { createSession, writeToSession, resizeSession, closeSession } from '../lib/pty';

const mockedInvoke = vi.mocked(invoke);

describe('IPC Wrapper: pty.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_createSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce('test-session-id');
    await createSession('powershell', 24, 80);
    expect(mockedInvoke).toHaveBeenCalledWith('create_session', {
      shell_type: 'powershell',
      rows: 24,
      cols: 80,
    });
  });

  it('test_writeToSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await writeToSession('abc-123', 'dir\r');
    expect(mockedInvoke).toHaveBeenCalledWith('write_to_session', {
      session_id: 'abc-123',
      data: 'dir\r',
    });
  });

  it('test_createSession_defaults', async () => {
    mockedInvoke.mockResolvedValueOnce('test-session-id');
    await createSession();
    expect(mockedInvoke).toHaveBeenCalledWith('create_session', {
      shell_type: undefined,
      rows: undefined,
      cols: undefined,
    });
  });

  it('test_resizeSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await resizeSession('abc-123', 40, 120);
    expect(mockedInvoke).toHaveBeenCalledWith('resize_session', {
      session_id: 'abc-123',
      rows: 40,
      cols: 120,
    });
  });

  it('test_closeSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await closeSession('abc-123');
    expect(mockedInvoke).toHaveBeenCalledWith('close_session', {
      session_id: 'abc-123',
    });
  });
});
