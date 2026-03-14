import { describe, it, expect } from 'vitest';
import { tokenize, Token } from '../lib/shell-tokenizer';

describe('Shell Tokenizer', () => {
  it('test_simple_command', () => {
    const tokens = tokenize('ls');
    expect(tokens).toEqual([{ type: 'command', value: 'ls' }]);
  });

  it('test_command_with_argument', () => {
    const tokens = tokenize('echo hello');
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'hello' },
    ]);
  });

  it('test_command_with_flag', () => {
    const tokens = tokenize('ls -la');
    expect(tokens).toEqual([
      { type: 'command', value: 'ls' },
      { type: 'whitespace', value: ' ' },
      { type: 'flag', value: '-la' },
    ]);
  });

  it('test_command_with_long_flag', () => {
    const tokens = tokenize('npm --version');
    expect(tokens).toEqual([
      { type: 'command', value: 'npm' },
      { type: 'whitespace', value: ' ' },
      { type: 'flag', value: '--version' },
    ]);
  });

  it('test_quoted_string_double', () => {
    const tokens = tokenize('echo "hello world"');
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'string', value: '"hello world"' },
    ]);
  });

  it('test_quoted_string_single', () => {
    const tokens = tokenize("echo 'hello'");
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'string', value: "'hello'" },
    ]);
  });

  it('test_pipe', () => {
    const tokens = tokenize('ls | grep foo');
    expect(tokens).toEqual([
      { type: 'command', value: 'ls' },
      { type: 'whitespace', value: ' ' },
      { type: 'pipe', value: '|' },
      { type: 'whitespace', value: ' ' },
      { type: 'command', value: 'grep' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'foo' },
    ]);
  });

  it('test_redirect', () => {
    const tokens = tokenize('echo hi > file.txt');
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'hi' },
      { type: 'whitespace', value: ' ' },
      { type: 'pipe', value: '>' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'file.txt' },
    ]);
  });

  it('test_multiline', () => {
    const tokens = tokenize('echo hello\necho world');
    // Each line's first token is a command
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'hello' },
      { type: 'whitespace', value: '\n' },
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'argument', value: 'world' },
    ]);
  });

  it('test_empty_input', () => {
    const tokens = tokenize('');
    expect(tokens).toEqual([]);
  });

  it('test_whitespace_preserved', () => {
    const tokens = tokenize('echo  hello');
    // The double space should be preserved as a whitespace token
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: '  ' },
      { type: 'argument', value: 'hello' },
    ]);
  });

  it('test_unclosed_double_quote', () => {
    const tokens = tokenize('echo "hello world');
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'string', value: '"hello world' },
    ]);
  });

  it('test_unclosed_single_quote', () => {
    const tokens = tokenize("echo 'hello world");
    expect(tokens).toEqual([
      { type: 'command', value: 'echo' },
      { type: 'whitespace', value: ' ' },
      { type: 'string', value: "'hello world" },
    ]);
  });
});
