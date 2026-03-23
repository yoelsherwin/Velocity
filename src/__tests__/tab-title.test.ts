import { describe, it, expect } from 'vitest';
import {
  getBasename,
  getCommandName,
  truncateTitle,
  computeTabTitle,
} from '../lib/tab-title';

describe('tab-title utilities', () => {
  describe('getBasename', () => {
    it('extracts basename from Windows path', () => {
      expect(getBasename('C:\\Users\\me\\velocity')).toBe('velocity');
    });

    it('extracts basename from Unix path', () => {
      expect(getBasename('/home/user/src')).toBe('src');
    });

    it('handles trailing slashes', () => {
      expect(getBasename('C:\\Users\\me\\velocity\\')).toBe('velocity');
    });

    it('handles root path', () => {
      expect(getBasename('C:\\')).toBe('C:');
    });
  });

  describe('getCommandName', () => {
    it('extracts first word from a command', () => {
      expect(getCommandName('npm install react')).toBe('npm');
    });

    it('returns the whole string if no space', () => {
      expect(getCommandName('ls')).toBe('ls');
    });

    it('handles leading whitespace', () => {
      expect(getCommandName('  git status')).toBe('git');
    });
  });

  describe('truncateTitle', () => {
    it('returns short titles unchanged', () => {
      expect(truncateTitle('velocity')).toBe('velocity');
    });

    it('truncates long titles to 20 chars with ellipsis', () => {
      const longTitle = 'a-very-long-directory-name-here';
      const result = truncateTitle(longTitle);
      expect(result.length).toBe(20);
      expect(result.endsWith('\u2026')).toBe(true);
    });

    it('returns exact 20 char titles unchanged', () => {
      const title = '12345678901234567890';
      expect(truncateTitle(title)).toBe(title);
    });
  });

  describe('computeTabTitle', () => {
    it('test_tab_title_updates_with_cwd: shows CWD basename when idle', () => {
      const title = computeTabTitle('C:\\Users\\me\\velocity', null, 'Terminal 1');
      expect(title).toBe('velocity');
    });

    it('test_tab_title_shows_running_command: shows command name while running', () => {
      const title = computeTabTitle('C:\\Users\\me\\velocity', 'npm install react', 'Terminal 1');
      expect(title).toBe('npm');
    });

    it('test_tab_title_truncated: long titles are truncated to 20 chars', () => {
      const longDir = 'C:\\some\\really-long-directory-name-that-exceeds-max';
      const title = computeTabTitle(longDir, null, 'Terminal 1');
      expect(title.length).toBeLessThanOrEqual(20);
      expect(title.endsWith('\u2026')).toBe(true);
    });

    it('test_tab_title_fallback: no CWD shows fallback', () => {
      const title = computeTabTitle(null, null, 'Terminal 1');
      expect(title).toBe('Terminal 1');
    });

    it('test_tab_title_fallback: empty CWD shows fallback', () => {
      const title = computeTabTitle('', null, 'Terminal 1');
      expect(title).toBe('Terminal 1');
    });

    it('test_tab_title_reverts_after_command: reverts to CWD when command finishes', () => {
      // While running
      const duringCmd = computeTabTitle('C:\\Users\\me\\src', 'cargo build', 'Terminal 1');
      expect(duringCmd).toBe('cargo');

      // After command completes (runningCommand is null)
      const afterCmd = computeTabTitle('C:\\Users\\me\\src', null, 'Terminal 1');
      expect(afterCmd).toBe('src');
    });

    it('running command takes precedence over CWD', () => {
      const title = computeTabTitle('/home/user/project', 'git push', 'Terminal 1');
      expect(title).toBe('git');
    });

    it('long command name is truncated', () => {
      const title = computeTabTitle('/home/user', 'some-very-long-command-name arg1 arg2', 'Terminal 1');
      expect(title.length).toBeLessThanOrEqual(20);
    });
  });
});
