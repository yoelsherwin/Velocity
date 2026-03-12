import { describe, it, expect } from 'vitest';
import type { Block } from '../lib/types';
import { stripAnsi } from '../lib/ansi';

describe('Block data model', () => {
  it('test_block_has_required_fields', () => {
    const block: Block = {
      id: 'test-id-123',
      command: 'dir',
      output: 'file1.txt\nfile2.txt',
      timestamp: Date.now(),
      status: 'running',
      shellType: 'powershell',
    };

    expect(block.id).toBe('test-id-123');
    expect(typeof block.id).toBe('string');
    expect(block.command).toBe('dir');
    expect(typeof block.command).toBe('string');
    expect(block.output).toBe('file1.txt\nfile2.txt');
    expect(typeof block.output).toBe('string');
    expect(typeof block.timestamp).toBe('number');
    expect(block.status).toBe('running');
    expect(['running', 'completed']).toContain(block.status);
    expect(block.shellType).toBe('powershell');
  });
});

describe('stripAnsi', () => {
  it('test_stripAnsi_removes_sgr', () => {
    const result = stripAnsi('\x1b[31mred\x1b[0m');
    expect(result).toBe('red');
  });

  it('test_stripAnsi_preserves_plain_text', () => {
    const result = stripAnsi('hello world');
    expect(result).toBe('hello world');
  });

  it('test_stripAnsi_handles_empty', () => {
    const result = stripAnsi('');
    expect(result).toBe('');
  });
});
