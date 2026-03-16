import { describe, it, expect } from 'vitest';
import { classifyIntent, stripHashPrefix, ClassificationResult } from '../lib/intent-classifier';

describe('classifyIntent', () => {
  // Default known commands set for most tests
  const defaultKnown = new Set(['git', 'dir', 'echo', 'docker', 'npm', 'kubectl', 'cd', 'cls', 'find']);

  // Helper to assert both intent and confidence
  function expectResult(
    result: ClassificationResult,
    intent: ClassificationResult['intent'],
    confidence: ClassificationResult['confidence'],
  ) {
    expect(result.intent).toBe(intent);
    expect(result.confidence).toBe(confidence);
  }

  // --- Backward compatibility: # prefix ---

  it('test_hash_prefix_is_nl_high', () => {
    expectResult(classifyIntent('# find files', defaultKnown), 'natural_language', 'high');
  });

  it('test_hash_with_no_space', () => {
    expectResult(classifyIntent('#find files', defaultKnown), 'natural_language', 'high');
  });

  it('test_hash_with_leading_whitespace', () => {
    expectResult(classifyIntent('  # find files', defaultKnown), 'natural_language', 'high');
  });

  // --- CLI signals: high confidence ---

  it('test_flags_are_cli_high', () => {
    expectResult(classifyIntent('ls -la', defaultKnown), 'cli', 'high');
  });

  it('test_pipe_is_cli_high', () => {
    expectResult(classifyIntent('ps | grep node', defaultKnown), 'cli', 'high');
  });

  it('test_redirect_is_cli_high', () => {
    expectResult(classifyIntent('echo hello > file.txt', defaultKnown), 'cli', 'high');
  });

  it('test_known_command_is_cli_high', () => {
    expectResult(classifyIntent('git status', defaultKnown), 'cli', 'high');
  });

  it('test_powershell_cmdlet_is_cli_high', () => {
    expectResult(classifyIntent('Get-ChildItem -Recurse', defaultKnown), 'cli', 'high');
  });

  it('test_path_is_cli_high', () => {
    expectResult(classifyIntent('./script.sh', defaultKnown), 'cli', 'high');
  });

  it('test_relative_path_with_backslash_is_cli', () => {
    expectResult(classifyIntent('.\\script.ps1', defaultKnown), 'cli', 'high');
  });

  it('test_windows_drive_path_is_cli_high', () => {
    expectResult(classifyIntent('C:\\Users\\test\\file.txt', defaultKnown), 'cli', 'high');
  });

  it('test_tilde_path_is_cli_high', () => {
    expectResult(classifyIntent('~/documents', defaultKnown), 'cli', 'high');
  });

  it('test_assignment_is_cli_high', () => {
    expectResult(classifyIntent('FOO=bar', defaultKnown), 'cli', 'high');
  });

  it('test_empty_is_cli_high', () => {
    expectResult(classifyIntent('', defaultKnown), 'cli', 'high');
  });

  it('test_whitespace_only_is_cli_high', () => {
    expectResult(classifyIntent('   ', defaultKnown), 'cli', 'high');
  });

  it('test_find_with_flags_is_cli', () => {
    expectResult(classifyIntent("find . -name '*.ts'", defaultKnown), 'cli', 'high');
  });

  it('test_docker_command_is_cli', () => {
    expectResult(classifyIntent('docker ps -a', defaultKnown), 'cli', 'high');
  });

  it('test_npm_install_is_cli', () => {
    expectResult(classifyIntent('npm install react', defaultKnown), 'cli', 'high');
  });

  it('test_kubectl_is_cli', () => {
    expectResult(classifyIntent('kubectl get pods', defaultKnown), 'cli', 'high');
  });

  it('test_git_known_command_takes_priority', () => {
    // "git" is a known command, so even multi-word input stays CLI
    expectResult(classifyIntent('git add .', defaultKnown), 'cli', 'high');
  });

  // --- NL signals: high confidence ---

  it('test_question_is_nl_high', () => {
    expectResult(classifyIntent('how do I find large files', defaultKnown), 'natural_language', 'high');
  });

  it('test_what_question_is_nl_high', () => {
    expectResult(classifyIntent('what is the disk usage of this folder', defaultKnown), 'natural_language', 'high');
  });

  it('test_help_request_is_nl_high', () => {
    expectResult(classifyIntent('help me find the config file', defaultKnown), 'natural_language', 'high');
  });

  it('test_please_request_is_nl_high', () => {
    expectResult(classifyIntent('please list all running processes', defaultKnown), 'natural_language', 'high');
  });

  it('test_sentence_with_articles_is_nl_high', () => {
    expectResult(classifyIntent('show me all the log files', defaultKnown), 'natural_language', 'high');
  });

  it('test_action_verb_multiword_is_nl_high', () => {
    // "delete" is NOT in defaultKnown, so NL signals win
    expectResult(classifyIntent('delete all temporary files', defaultKnown), 'natural_language', 'high');
  });

  it('test_find_natural_is_nl', () => {
    // With find NOT in the known commands set, NL signals should win
    const noFind = new Set(['git', 'dir', 'echo', 'docker', 'npm', 'kubectl']);
    expectResult(classifyIntent('find all typescript files modified today', noFind), 'natural_language', 'high');
  });

  it('test_natural_sentence_is_nl_high', () => {
    expectResult(classifyIntent('show me all the large files', defaultKnown), 'natural_language', 'high');
  });

  it('test_delete_sentence_is_nl_high', () => {
    expectResult(classifyIntent('delete all the temporary files', defaultKnown), 'natural_language', 'high');
  });

  // --- Ambiguous zone ---

  it('test_short_unknown_is_cli_low', () => {
    // "foobar" not in known commands, short input
    expectResult(classifyIntent('foobar', defaultKnown), 'cli', 'low');
  });

  it('test_multiword_unknown_is_nl_low', () => {
    // "foo bar baz" — no CLI signals, not in known commands, 3+ words
    expectResult(classifyIntent('foo bar baz', defaultKnown), 'natural_language', 'low');
  });

  // --- Return type shape ---

  it('test_returns_object_with_intent_and_confidence', () => {
    const result = classifyIntent('git status', defaultKnown);
    expect(result).toHaveProperty('intent');
    expect(result).toHaveProperty('confidence');
    expect(['cli', 'natural_language']).toContain(result.intent);
    expect(['high', 'low']).toContain(result.confidence);
  });

  // --- Empty known commands set (fallback) ---

  it('test_works_with_empty_known_commands', () => {
    const empty = new Set<string>();
    // Flags still detected as CLI
    expectResult(classifyIntent('ls -la', empty), 'cli', 'high');
    // Question still NL
    expectResult(classifyIntent('how do I list files', empty), 'natural_language', 'high');
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
