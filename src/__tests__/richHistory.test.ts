import { renderHook, act } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { useCommandHistory, HistoryEntry } from '../hooks/useCommandHistory';

describe('Rich History', () => {
  it('test_stores_metadata_in_history_entries', () => {
    const { result } = renderHook(() => useCommandHistory());

    const entry: HistoryEntry = {
      command: 'git status',
      timestamp: Date.now(),
      exitCode: 0,
      cwd: 'C:\\Projects',
      gitBranch: 'main',
      shellType: 'powershell',
    };

    act(() => {
      result.current.addCommand(entry);
    });

    expect(result.current.history).toHaveLength(1);
    expect(result.current.history[0]).toMatchObject({
      command: 'git status',
      exitCode: 0,
      cwd: 'C:\\Projects',
      gitBranch: 'main',
      shellType: 'powershell',
    });
  });

  it('test_navigation_returns_command_strings', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand({
        command: 'ls',
        timestamp: Date.now(),
        shellType: 'powershell',
      });
      result.current.addCommand({
        command: 'pwd',
        timestamp: Date.now(),
        shellType: 'powershell',
      });
    });

    let value: string | null = null;
    act(() => {
      value = result.current.navigateUp();
    });
    expect(value).toBe('pwd');

    act(() => {
      value = result.current.navigateUp();
    });
    expect(value).toBe('ls');
  });

  it('test_backward_compat_with_string_initial_history', () => {
    const { result } = renderHook(() =>
      useCommandHistory(100, ['echo hello', 'dir']),
    );

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0].command).toBe('echo hello');
    expect(result.current.history[1].command).toBe('dir');

    let value: string | null = null;
    act(() => {
      value = result.current.navigateUp();
    });
    expect(value).toBe('dir');
  });

  it('test_search_matches_against_command_field', () => {
    const { result } = renderHook(() => useCommandHistory());

    act(() => {
      result.current.addCommand({
        command: 'git status',
        timestamp: Date.now(),
        exitCode: 0,
        cwd: 'C:\\Projects',
        shellType: 'powershell',
      });
      result.current.addCommand({
        command: 'npm install',
        timestamp: Date.now(),
        exitCode: 0,
        cwd: 'C:\\Projects',
        shellType: 'powershell',
      });
    });

    // History entries have .command field that can be searched
    const gitEntries = result.current.history.filter((e) =>
      e.command.includes('git'),
    );
    expect(gitEntries).toHaveLength(1);
    expect(gitEntries[0].command).toBe('git status');
    expect(gitEntries[0].cwd).toBe('C:\\Projects');
  });

  it('test_serialization_round_trip', () => {
    const entries: HistoryEntry[] = [
      {
        command: 'git status',
        timestamp: 1700000000000,
        exitCode: 0,
        cwd: 'C:\\Projects',
        gitBranch: 'main',
        shellType: 'powershell',
      },
      {
        command: 'npm test',
        timestamp: 1700000001000,
        exitCode: 1,
        cwd: 'C:\\Projects\\app',
        shellType: 'cmd',
      },
    ];

    const json = JSON.stringify(entries);
    const parsed: HistoryEntry[] = JSON.parse(json);

    const { result } = renderHook(() => useCommandHistory(100, parsed));

    expect(result.current.history).toHaveLength(2);
    expect(result.current.history[0]).toMatchObject({
      command: 'git status',
      exitCode: 0,
      gitBranch: 'main',
    });
    expect(result.current.history[1]).toMatchObject({
      command: 'npm test',
      exitCode: 1,
    });
  });
});
