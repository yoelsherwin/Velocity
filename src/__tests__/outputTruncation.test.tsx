import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';

const mockCreateSession = vi.fn();
const mockWriteToSession = vi.fn();
const mockCloseSession = vi.fn();
const mockStartReading = vi.fn();

vi.mock('../lib/pty', () => ({
  createSession: (...args: unknown[]) => mockCreateSession(...args),
  writeToSession: (...args: unknown[]) => mockWriteToSession(...args),
  closeSession: (...args: unknown[]) => mockCloseSession(...args),
  startReading: (...args: unknown[]) => mockStartReading(...args),
}));

type ListenerCallback = (event: { payload: unknown }) => void;
const eventListeners: Record<string, ListenerCallback> = {};
const mockListen = vi.fn();

vi.mock('@tauri-apps/api/event', () => ({
  listen: (...args: unknown[]) => mockListen(...args),
}));

vi.mock('../lib/llm', () => ({
  translateCommand: vi.fn().mockResolvedValue('dir'),
}));

vi.mock('../lib/cwd', () => ({
  getCwd: vi.fn().mockResolvedValue('C:\\Users\\test'),
}));

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import Terminal, { OUTPUT_LIMIT_PER_BLOCK } from '../components/Terminal';

describe('Output truncation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.keys(eventListeners).forEach((key) => delete eventListeners[key]);

    mockCreateSession.mockResolvedValue('test-session-id');
    mockListen.mockImplementation(
      async (eventName: string, callback: ListenerCallback) => {
        eventListeners[eventName] = callback;
        return vi.fn();
      },
    );
    mockWriteToSession.mockResolvedValue(undefined);
    mockCloseSession.mockResolvedValue(undefined);
    mockStartReading.mockResolvedValue(undefined);
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_known_commands') {
        return Promise.resolve(['git', 'dir', 'echo']);
      }
      return Promise.reject(`Unknown command: ${cmd}`);
    });
  });

  it('test_output_truncated_when_exceeding_limit', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Build a string that exceeds OUTPUT_LIMIT_PER_BLOCK (500KB)
    const largeChunk = 'x'.repeat(OUTPUT_LIMIT_PER_BLOCK + 1000);

    // Simulate PTY output event with the large chunk
    await act(async () => {
      const outputCallback = eventListeners['pty:output:test-session-id'];
      if (outputCallback) {
        outputCallback({ payload: largeChunk });
      }
    });

    // The output in the DOM should contain the truncation marker
    await waitFor(() => {
      const outputArea = document.querySelector('[data-testid="terminal-output"]');
      expect(outputArea).toBeTruthy();
      const text = outputArea!.textContent || '';
      expect(text).toContain('[Output truncated');
    });
  });

  it('test_truncation_keeps_most_recent_output', async () => {
    render(<Terminal />);

    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Build output: padding + a recognizable tail
    const tail = 'TAIL_MARKER_END';
    const padding = 'x'.repeat(OUTPUT_LIMIT_PER_BLOCK + 1000);
    const fullOutput = padding + tail;

    await act(async () => {
      const outputCallback = eventListeners['pty:output:test-session-id'];
      if (outputCallback) {
        outputCallback({ payload: fullOutput });
      }
    });

    // The tail marker should still be visible (truncation keeps the end)
    await waitFor(() => {
      const outputArea = document.querySelector('[data-testid="terminal-output"]');
      const text = outputArea!.textContent || '';
      expect(text).toContain(tail);
    });
  });
});
