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
const mockAnalyzeCommandDanger = vi.fn();

vi.mock('../lib/llm', () => ({
  translateCommand: (...args: unknown[]) => mockTranslateCommand(...args),
  classifyIntentLLM: (...args: unknown[]) => mockClassifyIntentLLM(...args),
  analyzeCommandDanger: (...args: unknown[]) => mockAnalyzeCommandDanger(...args),
}));

const mockGetCwd = vi.fn();

vi.mock('../lib/cwd', () => ({
  getCwd: (...args: unknown[]) => mockGetCwd(...args),
}));

const mockGetGitInfo = vi.fn();

vi.mock('../lib/git', () => ({
  getGitInfo: (...args: unknown[]) => mockGetGitInfo(...args),
}));

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: (...args: unknown[]) => mockInvoke(...args),
}));

import Terminal from '../components/Terminal';

describe('Danger Warning', () => {
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
    mockGetGitInfo.mockResolvedValue({ branch: 'main', is_dirty: false, ahead: 0, behind: 0 });
    mockAnalyzeCommandDanger.mockResolvedValue({ is_dangerous: false, reason: '', danger_level: '' });
    mockInvoke.mockImplementation((cmd: string) => {
      if (cmd === 'get_known_commands') {
        return Promise.resolve(['git', 'dir', 'echo', 'npm', 'docker', 'kubectl', 'cd', 'cls', 'find']);
      }
      return Promise.reject(`Unknown command: ${cmd}`);
    });
  });

  it('test_warning_shown_for_dangerous_translation', async () => {
    // Translate returns a dangerous command
    mockTranslateCommand.mockResolvedValue('rm -rf /');
    mockAnalyzeCommandDanger.mockResolvedValue({
      is_dangerous: true,
      reason: 'Recursive force delete command',
      danger_level: 'high',
    });

    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    // Type a natural language command (use # prefix for agent mode)
    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: '#delete everything' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Wait for translation and danger check
    await waitFor(() => {
      expect(screen.getByTestId('danger-warning')).toBeInTheDocument();
    });

    expect(screen.getByTestId('danger-warning')).toHaveTextContent('Recursive force delete command');
  });

  it('test_no_warning_for_safe_translation', async () => {
    mockTranslateCommand.mockResolvedValue('dir /s');
    mockAnalyzeCommandDanger.mockResolvedValue({
      is_dangerous: false,
      reason: '',
      danger_level: '',
    });

    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: '#list all files' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    // Wait for translation to complete
    await waitFor(() => {
      expect(mockAnalyzeCommandDanger).toHaveBeenCalled();
    });

    // No warning should appear
    expect(screen.queryByTestId('danger-warning')).not.toBeInTheDocument();
  });

  it('test_warning_dismissible', async () => {
    mockTranslateCommand.mockResolvedValue('rm -rf /');
    mockAnalyzeCommandDanger.mockResolvedValue({
      is_dangerous: true,
      reason: 'Recursive force delete command',
      danger_level: 'high',
    });

    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: '#delete everything' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('danger-warning')).toBeInTheDocument();
    });

    // Click dismiss
    fireEvent.click(screen.getByTestId('danger-warning-dismiss'));

    // Warning should disappear
    expect(screen.queryByTestId('danger-warning')).not.toBeInTheDocument();
  });

  it('test_warning_cleared_on_input_change', async () => {
    mockTranslateCommand.mockResolvedValue('rm -rf /');
    mockAnalyzeCommandDanger.mockResolvedValue({
      is_dangerous: true,
      reason: 'Recursive force delete command',
      danger_level: 'high',
    });

    render(<Terminal />);
    await waitFor(() => {
      expect(mockCreateSession).toHaveBeenCalled();
    });

    const textarea = screen.getByTestId('editor-textarea');
    fireEvent.change(textarea, { target: { value: '#delete C drive' } });
    fireEvent.keyDown(textarea, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.getByTestId('danger-warning')).toBeInTheDocument();
    });

    // Change input — warning should be cleared
    fireEvent.change(textarea, { target: { value: 'echo safe' } });
    expect(screen.queryByTestId('danger-warning')).not.toBeInTheDocument();
  });
});
