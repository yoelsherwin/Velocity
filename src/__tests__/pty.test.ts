import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn(),
}));

import { invoke } from '@tauri-apps/api/core';
import { createSession, writeToSession, resizeSession, closeSession, startReading } from '../lib/pty';

const mockedInvoke = vi.mocked(invoke);

describe('IPC Wrapper: pty.ts', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_createSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce('test-session-id');
    await createSession('powershell', 24, 80);
    expect(mockedInvoke).toHaveBeenCalledWith('create_session', {
      shellType: 'powershell',
      rows: 24,
      cols: 80,
    });
  });

  it('test_writeToSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await writeToSession('abc-123', 'dir\r');
    expect(mockedInvoke).toHaveBeenCalledWith('write_to_session', {
      sessionId: 'abc-123',
      data: 'dir\r',
    });
  });

  it('test_createSession_defaults', async () => {
    mockedInvoke.mockResolvedValueOnce('test-session-id');
    await createSession();
    expect(mockedInvoke).toHaveBeenCalledWith('create_session', {
      shellType: undefined,
      rows: undefined,
      cols: undefined,
    });
  });

  it('test_resizeSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await resizeSession('abc-123', 40, 120);
    expect(mockedInvoke).toHaveBeenCalledWith('resize_session', {
      sessionId: 'abc-123',
      rows: 40,
      cols: 120,
    });
  });

  it('test_closeSession_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await closeSession('abc-123');
    expect(mockedInvoke).toHaveBeenCalledWith('close_session', {
      sessionId: 'abc-123',
    });
  });

  it('test_startReading_calls_invoke_correctly', async () => {
    mockedInvoke.mockResolvedValueOnce(undefined);
    await startReading('abc-123');
    expect(mockedInvoke).toHaveBeenCalledWith('start_reading', {
      sessionId: 'abc-123',
    });
  });
});
