import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock Tauri invoke
const mockInvoke = vi.fn();
vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import { translateCommand, classifyIntentLLM } from '../lib/llm';

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

describe('classifyIntentLLM', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_classifyIntentLLM_calls_invoke_with_correct_params', async () => {
    mockInvoke.mockResolvedValue('cli');

    const result = await classifyIntentLLM('something ambiguous', 'powershell');

    expect(mockInvoke).toHaveBeenCalledTimes(1);
    expect(mockInvoke).toHaveBeenCalledWith('classify_intent_llm', {
      input: 'something ambiguous',
      shellType: 'powershell',
    });
    expect(result).toBe('cli');
  });

  it('test_classifyIntentLLM_returns_natural_language', async () => {
    mockInvoke.mockResolvedValue('natural_language');

    const result = await classifyIntentLLM('do something', 'powershell');
    expect(result).toBe('natural_language');
  });

  it('test_classifyIntentLLM_defaults_to_cli_for_invalid_response', async () => {
    mockInvoke.mockResolvedValue('something_else');

    const result = await classifyIntentLLM('ambiguous', 'powershell');
    expect(result).toBe('cli');
  });

  it('test_classifyIntentLLM_propagates_errors', async () => {
    mockInvoke.mockRejectedValue('No API key configured.');

    await expect(
      classifyIntentLLM('ambiguous', 'powershell')
    ).rejects.toBe('No API key configured.');
  });
});
