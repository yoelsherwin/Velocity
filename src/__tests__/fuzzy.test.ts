import { describe, it, expect } from 'vitest';
import { fuzzyMatch } from '../lib/fuzzy';
import { COMMANDS } from '../lib/commands';

describe('Fuzzy Match', () => {
  it('test_fuzzy_empty_query_returns_all_commands', () => {
    const results = fuzzyMatch('', COMMANDS);
    expect(results).toHaveLength(COMMANDS.length);
    // All commands should be returned
    const ids = results.map((r) => r.command.id);
    for (const cmd of COMMANDS) {
      expect(ids).toContain(cmd.id);
    }
  });

  it('test_fuzzy_exact_match_scores_highest', () => {
    const results = fuzzyMatch('New Tab', COMMANDS);
    expect(results.length).toBeGreaterThan(0);
    // "New Tab" should be the first (highest score) result
    expect(results[0].command.id).toBe('tab.new');
  });

  it('test_fuzzy_partial_match', () => {
    // "ntab" has characters n, t, a, b which appear in order in "New Tab"
    const results = fuzzyMatch('ntab', COMMANDS);
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain('tab.new');
  });

  it('test_fuzzy_case_insensitive', () => {
    const results = fuzzyMatch('new tab', COMMANDS);
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].command.id).toBe('tab.new');
  });

  it('test_fuzzy_no_match_returns_empty', () => {
    const results = fuzzyMatch('zzzzz', COMMANDS);
    expect(results).toHaveLength(0);
  });

  it('test_fuzzy_keyword_match', () => {
    // "linux" is a keyword for "Switch to WSL"
    const results = fuzzyMatch('linux', COMMANDS);
    const ids = results.map((r) => r.command.id);
    expect(ids).toContain('shell.wsl');
  });

  it('test_fuzzy_matched_indices_correct', () => {
    // Searching for "NT" should match "New Tab" at indices 0 (N) and 4 (T)
    const results = fuzzyMatch('NT', COMMANDS);
    const newTabResult = results.find((r) => r.command.id === 'tab.new');
    expect(newTabResult).toBeDefined();
    expect(newTabResult!.matchedIndices).toBeDefined();
    // 'N' matches index 0, 'T' matches index 4 (start of "Tab")
    expect(newTabResult!.matchedIndices).toContain(0);
    expect(newTabResult!.matchedIndices).toContain(4);
  });

  it('test_fuzzy_word_start_bonus', () => {
    // "sp" should score "Split Pane Right" higher than "Restart Session"
    // because 's' and 'p' match at word starts in "Split Pane Right"
    const results = fuzzyMatch('sp', COMMANDS);
    const splitIndex = results.findIndex((r) => r.command.id === 'pane.splitRight');
    const restartIndex = results.findIndex((r) => r.command.id === 'terminal.restart');

    // Split Pane Right should appear, and if Restart Session also appears,
    // Split should rank higher
    expect(splitIndex).toBeGreaterThanOrEqual(0);
    if (restartIndex >= 0) {
      expect(splitIndex).toBeLessThan(restartIndex);
    }
  });
});
