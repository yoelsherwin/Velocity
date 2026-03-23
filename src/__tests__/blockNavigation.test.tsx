import React from 'react';
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

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

const mockTranslateCommand = vi.fn();
const mockClassifyIntentLLM = vi.fn();

vi.mock('../lib/llm', () => ({
  translateCommand: (...args: unknown[]) => mockTranslateCommand(...args),
  classifyIntentLLM: (...args: unknown[]) => mockClassifyIntentLLM(...args),
}));

const mockGetCwd = vi.fn();

vi.mock('../lib/cwd', () => ({
  getCwd: (...args: unknown[]) => mockGetCwd(...args),
}));

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import Terminal from '../components/Terminal';

/**
 * Helper: render Terminal and wait for session, then emit output for N blocks
 * by simulating command submissions.
 */
async function renderWithBlocks(blockCount: number) {
  render(<Terminal />);

  // Wait for session to be fully established (listeners registered + startReading called)
  await waitFor(() => {
    expect(mockStartReading).toHaveBeenCalled();
  });

  const textarea = screen.getByTestId('editor-textarea');

  for (let i = 0; i < blockCount; i++) {
    await act(async () => {
      fireEvent.change(textarea, { target: { value: `cmd${i}` } });
      fireEvent.keyDown(textarea, { key: 'Enter' });
    });
  }

  // Wait for blocks to appear (welcome block + N command blocks)
  await waitFor(() => {
    const containers = document.querySelectorAll('[data-testid="block-container"]');
    // welcome block + blockCount command blocks
    expect(containers.length).toBeGreaterThanOrEqual(blockCount + 1);
  });

  return { textarea };
}

describe('Block Navigation (Ctrl+Up/Down)', () => {
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
    mockTranslateCommand.mockResolvedValue('dir');
    mockClassifyIntentLLM.mockResolvedValue('cli');
    mockGetCwd.mockResolvedValue('C:\\Users\\test');
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_known_commands') {
        return Promise.resolve(['git', 'dir', 'echo', 'npm']);
      }
      return Promise.reject(`Unknown command: ${cmd}`);
    });

    // Mock scrollIntoView
    Element.prototype.scrollIntoView = vi.fn();
  });

  it('test_ctrl_down_focuses_first_block', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      expect(containers[0]).toHaveClass('block-focused');
    });
  });

  it('test_ctrl_down_advances_to_next', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');

    // First Ctrl+Down: focus block 0
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });
    // Second Ctrl+Down: focus block 1
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      expect(containers[1]).toHaveClass('block-focused');
      expect(containers[0]).not.toHaveClass('block-focused');
    });
  });

  it('test_ctrl_up_focuses_last_block', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');
    fireEvent.keyDown(outputEl, { key: 'ArrowUp', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      const last = containers[containers.length - 1];
      expect(last).toHaveClass('block-focused');
    });
  });

  it('test_ctrl_up_goes_to_previous', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');

    // Ctrl+Up from -1 => last block
    fireEvent.keyDown(outputEl, { key: 'ArrowUp', ctrlKey: true });
    // Ctrl+Up again => second to last
    fireEvent.keyDown(outputEl, { key: 'ArrowUp', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      const secondToLast = containers[containers.length - 2];
      expect(secondToLast).toHaveClass('block-focused');
    });
  });

  it('test_focus_resets_on_input', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');
    const textarea = screen.getByTestId('editor-textarea');

    // Focus a block
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      expect(containers[0]).toHaveClass('block-focused');
    });

    // Type in the editor — should reset focus
    fireEvent.change(textarea, { target: { value: 'something' } });

    await waitFor(() => {
      const focused = document.querySelectorAll('.block-focused');
      expect(focused.length).toBe(0);
    });
  });

  it('test_focused_block_has_css_class', async () => {
    await renderWithBlocks(2);

    const outputEl = screen.getByTestId('terminal-output');
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const focused = document.querySelectorAll('.block-focused');
      expect(focused.length).toBe(1);
    });
  });

  it('test_no_wrap_at_boundaries', async () => {
    await renderWithBlocks(3);

    const outputEl = screen.getByTestId('terminal-output');

    // Navigate to first block
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      expect(containers[0]).toHaveClass('block-focused');
    });

    // Ctrl+Up at block 0 should stay at block 0
    fireEvent.keyDown(outputEl, { key: 'ArrowUp', ctrlKey: true });

    await waitFor(() => {
      const containers = document.querySelectorAll('[data-testid="block-container"]');
      expect(containers[0]).toHaveClass('block-focused');
    });

    // Navigate to last block
    const containers = document.querySelectorAll('[data-testid="block-container"]');
    const lastIdx = containers.length - 1;

    // Go to last by pressing Ctrl+Down enough times
    for (let i = 0; i < lastIdx; i++) {
      fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });
    }

    await waitFor(() => {
      const conts = document.querySelectorAll('[data-testid="block-container"]');
      expect(conts[conts.length - 1]).toHaveClass('block-focused');
    });

    // Ctrl+Down at last block stays at last
    fireEvent.keyDown(outputEl, { key: 'ArrowDown', ctrlKey: true });

    await waitFor(() => {
      const conts = document.querySelectorAll('[data-testid="block-container"]');
      expect(conts[conts.length - 1]).toHaveClass('block-focused');
    });
  });
});
