import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { levenshteinDistance, suggestCorrection, detectCommonPatterns } from '../lib/command-corrections';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Mock the LLM module to prevent actual calls
vi.mock('../lib/llm', () => ({
  suggestFix: vi.fn().mockResolvedValue({ suggested_command: '', explanation: '' }),
  translateCommand: vi.fn(),
  classifyIntentLLM: vi.fn(),
}));

describe('Levenshtein Distance', () => {
  it('test_levenshtein_distance', () => {
    expect(levenshteinDistance('git', 'gti')).toBe(1);
    expect(levenshteinDistance('git', 'git')).toBe(0);
    expect(levenshteinDistance('npm', 'nmp')).toBe(1);
    expect(levenshteinDistance('cargo', 'carg')).toBe(1);
    expect(levenshteinDistance('cargo', 'cargoo')).toBe(1);
    expect(levenshteinDistance('', 'abc')).toBe(3);
    expect(levenshteinDistance('abc', '')).toBe(3);
  });
});

describe('suggestCorrection', () => {
  it('test_suggest_closest_command', () => {
    const known = new Set(['git', 'go', 'npm', 'node']);
    const result = suggestCorrection('gti', known);
    expect(result).not.toBeNull();
    expect(result!.correctedCommand).toBe('git');
  });

  it('test_no_suggestion_for_large_distance', () => {
    const known = new Set(['git', 'go', 'npm', 'node']);
    const result = suggestCorrection('xyz', known);
    expect(result).toBeNull();
  });

  it('test_suggest_npm_typo', () => {
    const known = new Set(['git', 'npm', 'node']);
    const result = suggestCorrection('nmp', known);
    expect(result).not.toBeNull();
    expect(result!.correctedCommand).toBe('npm');
  });

  it('test_no_suggestion_for_exact_match', () => {
    const known = new Set(['git', 'npm']);
    const result = suggestCorrection('git', known);
    expect(result).toBeNull();
  });
});

describe('Common Patterns', () => {
  it('test_common_pattern_cd_no_space', () => {
    const result = detectCommonPatterns('cd..');
    expect(result).toBe('cd ..');
  });

  it('test_common_pattern_cd_path_no_space', () => {
    const result = detectCommonPatterns('cd/home');
    expect(result).toBe('cd /home');
  });

  it('test_common_pattern_ls_la', () => {
    const result = detectCommonPatterns('ls-la');
    expect(result).toBe('ls -la');
  });

  it('test_common_pattern_ls_al', () => {
    const result = detectCommonPatterns('ls-al');
    expect(result).toBe('ls -al');
  });

  it('test_no_pattern_for_normal_command', () => {
    const result = detectCommonPatterns('git status');
    expect(result).toBeNull();
  });
});

describe('Typo Correction in BlockView', () => {
  const mockOnRerun = vi.fn();
  const mockOnUseFix = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_typo_correction_shown_in_ui', () => {
    const failedBlock: Block = {
      id: 'block-typo-1',
      command: 'gti status',
      output: "'gti' is not recognized as an internal or external command",
      timestamp: Date.now(),
      status: 'completed',
      exitCode: 1,
      shellType: 'powershell',
    };

    render(
      <BlockView
        block={failedBlock}
        isActive={false}
        onRerun={mockOnRerun}
        onUseFix={mockOnUseFix}
        isMostRecentFailed={true}
        knownCommands={new Set(['git', 'go', 'npm'])}
      />,
    );

    // Should show typo correction
    expect(screen.getByTestId('typo-correction')).toBeInTheDocument();
    expect(screen.getByTestId('typo-correction-command')).toHaveTextContent('git status');
  });

  it('test_typo_overrides_ai_suggestion', () => {
    const failedBlock: Block = {
      id: 'block-typo-2',
      command: 'gti status',
      output: "'gti' is not recognized as an internal or external command",
      timestamp: Date.now(),
      status: 'completed',
      exitCode: 1,
      shellType: 'powershell',
    };

    render(
      <BlockView
        block={failedBlock}
        isActive={false}
        onRerun={mockOnRerun}
        onUseFix={mockOnUseFix}
        hasApiKey={true}
        isMostRecentFailed={true}
        knownCommands={new Set(['git', 'go', 'npm'])}
      />,
    );

    // Should show typo correction
    expect(screen.getByTestId('typo-correction')).toBeInTheDocument();
    // Should NOT show AI suggestion loading
    expect(screen.queryByTestId('error-suggestion-loading')).not.toBeInTheDocument();
  });

  it('test_use_button_calls_onUseFix', () => {
    const failedBlock: Block = {
      id: 'block-typo-3',
      command: 'gti status',
      output: "'gti' is not recognized as an internal or external command",
      timestamp: Date.now(),
      status: 'completed',
      exitCode: 1,
      shellType: 'powershell',
    };

    render(
      <BlockView
        block={failedBlock}
        isActive={false}
        onRerun={mockOnRerun}
        onUseFix={mockOnUseFix}
        isMostRecentFailed={true}
        knownCommands={new Set(['git', 'go', 'npm'])}
      />,
    );

    fireEvent.click(screen.getByTestId('typo-correction-use'));
    expect(mockOnUseFix).toHaveBeenCalledWith('git status');
  });
});
