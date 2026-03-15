import { describe, it, expect } from 'vitest';
import { classifyIntent, stripHashPrefix } from '../lib/intent-classifier';

describe('classifyIntent', () => {
  it('test_hash_prefix_is_natural_language', () => {
    expect(classifyIntent('# find files')).toBe('natural_language');
  });

  it('test_hash_with_no_space', () => {
    expect(classifyIntent('#find files')).toBe('natural_language');
  });

  it('test_command_with_flags_is_cli', () => {
    expect(classifyIntent('ls -la')).toBe('cli');
  });

  it('test_command_with_pipe_is_cli', () => {
    expect(classifyIntent('ps | grep node')).toBe('cli');
  });

  it('test_empty_is_cli', () => {
    expect(classifyIntent('')).toBe('cli');
  });

  it('test_simple_command_is_cli', () => {
    expect(classifyIntent('dir')).toBe('cli');
  });

  it('test_path_is_cli', () => {
    expect(classifyIntent('./script.sh')).toBe('cli');
  });

  it('test_relative_path_with_backslash_is_cli', () => {
    expect(classifyIntent('.\\script.ps1')).toBe('cli');
  });

  it('test_whitespace_only_is_cli', () => {
    expect(classifyIntent('   ')).toBe('cli');
  });

  it('test_hash_with_leading_whitespace', () => {
    expect(classifyIntent('  # find files')).toBe('natural_language');
  });

  it('test_command_with_redirect_is_cli', () => {
    expect(classifyIntent('echo hello > file.txt')).toBe('cli');
  });
});

describe('stripHashPrefix', () => {
  it('test_stripHashPrefix_with_space', () => {
    expect(stripHashPrefix('# find files')).toBe('find files');
  });

  it('test_stripHashPrefix_no_space', () => {
    expect(stripHashPrefix('#find files')).toBe('find files');
  });

  it('test_stripHashPrefix_multiple_hashes', () => {
    // Only strip the first # prefix
    expect(stripHashPrefix('# # test')).toBe('# test');
  });

  it('test_stripHashPrefix_empty_after_hash', () => {
    expect(stripHashPrefix('#')).toBe('');
  });

  it('test_stripHashPrefix_no_hash', () => {
    expect(stripHashPrefix('hello world')).toBe('hello world');
  });
});
