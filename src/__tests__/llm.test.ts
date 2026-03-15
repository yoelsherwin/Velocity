import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { translateCommand } from '../lib/llm';

describe('translateCommand', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_translateCommand_calls_invoke', async () => {
    mockInvoke.mockResolvedValue('dir /s');

    const result = await translateCommand('list files', 'powershell', 'C:\\');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('translate_command', {
      input: 'list files',
      shellType: 'powershell',
      cwd: 'C:\\',
    });
    expect(result).toBe('dir /s');
  });

  it('test_translateCommand_propagates_errors', async () => {
    mockInvoke.mockRejectedValue('No API key configured. Open Settings to add one.');

    await expect(
      translateCommand('list files', 'powershell', 'C:\\')
    ).rejects.toBe('No API key configured. Open Settings to add one.');
  });
});
