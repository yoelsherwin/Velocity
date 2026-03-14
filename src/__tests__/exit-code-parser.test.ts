import { describe, it, expect } from 'vitest';
import { extractExitCode, getExitCodeMarker } from '../lib/exit-code-parser';

describe('extractExitCode', () => {
  it('test_extracts_exit_code_zero', () => {
    const result = extractExitCode('output\nVELOCITY_EXIT:0\n');
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).toBe('output\n');
  });

  it('test_extracts_nonzero_exit_code', () => {
    const result = extractExitCode('error\nVELOCITY_EXIT:1\n');
    expect(result.exitCode).toBe(1);
    expect(result.cleanOutput).toBe('error\n');
  });

  it('test_extracts_negative_exit_code', () => {
    const result = extractExitCode('VELOCITY_EXIT:-1\n');
    expect(result.exitCode).toBe(-1);
    expect(result.cleanOutput).toBe('');
  });

  it('test_no_marker_returns_null', () => {
    const result = extractExitCode('just output');
    expect(result.exitCode).toBeNull();
    expect(result.cleanOutput).toBe('just output');
  });

  it('test_strips_marker_from_output', () => {
    const input = 'line1\nline2\nVELOCITY_EXIT:0\n';
    const result = extractExitCode(input);
    expect(result.cleanOutput).toBe('line1\nline2\n');
    expect(result.cleanOutput).not.toContain('VELOCITY_EXIT');
  });

  it('test_handles_carriage_return_newline', () => {
    const result = extractExitCode('output\r\nVELOCITY_EXIT:0\r\n');
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).not.toContain('VELOCITY_EXIT');
  });

  it('test_extracts_large_exit_code', () => {
    const result = extractExitCode('VELOCITY_EXIT:255\n');
    expect(result.exitCode).toBe(255);
  });

  it('test_handles_marker_without_trailing_newline', () => {
    const result = extractExitCode('output\nVELOCITY_EXIT:0');
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).toBe('output\n');
  });

  it('test_ignores_marker_not_at_line_start', () => {
    const result = extractExitCode('echo VELOCITY_EXIT:42\n');
    expect(result.exitCode).toBeNull();
    expect(result.cleanOutput).toBe('echo VELOCITY_EXIT:42\n');
  });

  it('test_strips_all_marker_occurrences', () => {
    const input = 'output\nVELOCITY_EXIT:0\nmore\nVELOCITY_EXIT:0\n';
    const result = extractExitCode(input);
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).not.toContain('VELOCITY_EXIT');
    expect(result.cleanOutput).toBe('output\nmore\n');
  });

  it('test_detects_marker_wrapped_in_sgr_reset', () => {
    // ConPTY may wrap the marker line in SGR reset sequences
    const result = extractExitCode('output\n\x1b[0mVELOCITY_EXIT:1\x1b[0m\n');
    expect(result.exitCode).toBe(1);
    expect(result.cleanOutput).not.toContain('VELOCITY_EXIT');
  });

  it('test_detects_marker_with_sgr_before_line', () => {
    // SGR code at the very start of the marker line
    const result = extractExitCode('output\n\x1b[0mVELOCITY_EXIT:0\n');
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).toBe('output\n');
  });

  it('test_detects_marker_with_multiple_sgr_sequences', () => {
    // Multiple SGR codes interspersed
    const result = extractExitCode('error\n\x1b[31m\x1b[0mVELOCITY_EXIT:2\x1b[0m\r\n');
    expect(result.exitCode).toBe(2);
    expect(result.cleanOutput).not.toContain('VELOCITY_EXIT');
  });

  it('test_preserves_sgr_in_non_marker_output', () => {
    // SGR codes in normal output should be preserved
    const result = extractExitCode('\x1b[31mred text\x1b[0m\nVELOCITY_EXIT:0\n');
    expect(result.exitCode).toBe(0);
    expect(result.cleanOutput).toBe('\x1b[31mred text\x1b[0m\n');
  });
});

describe('getExitCodeMarker', () => {
  it('test_powershell_marker', () => {
    const marker = getExitCodeMarker('powershell');
    expect(marker).toBe('; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }');
  });

  it('test_cmd_marker', () => {
    const marker = getExitCodeMarker('cmd');
    expect(marker).toBe('& echo VELOCITY_EXIT:%ERRORLEVEL%');
  });

  it('test_wsl_marker', () => {
    const marker = getExitCodeMarker('wsl');
    expect(marker).toBe('; echo "VELOCITY_EXIT:$?"');
  });
});
