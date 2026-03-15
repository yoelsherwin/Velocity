# Fix: TASK-012 Exit Code Review Findings

## Bug Description

Code review of TASK-012 (exit code detection via shell marker injection) found 3 critical and 2 important issues. All three critical issues are correctness bugs in the exit code parser.

## Root Cause Analysis

### C-01: PowerShell `$LASTEXITCODE` is `$null` for cmdlets
The marker `; Write-Output "VELOCITY_EXIT:$LASTEXITCODE"` only works for native executables (.exe). For PowerShell cmdlets (the majority of PS usage), `$LASTEXITCODE` is `$null`, producing `VELOCITY_EXIT:` with no digits, which doesn't match the regex. Blocks never complete.

### C-02: Regex not line-anchored — false positive detection
The regex `/VELOCITY_EXIT:(-?\d+)\r?\n?/` matches the marker string anywhere on a line. If program output contains `VELOCITY_EXIT:42`, it triggers false exit code detection.

### C-03: Non-global replace only strips first occurrence
`String.replace()` with non-global regex strips only the first match. ConPTY echoes shell input back through the output stream, so the marker can appear twice (once echoed, once as actual output). The second occurrence leaks into displayed output.

### I-02: No test for split-chunk marker scenario
The marker can arrive split across two output events. The implementation handles this correctly, but there's no test proving it.

### I-03: `exit` command gets marker suffix appended
Typing `exit` sends `exit; Write-Output "VELOCITY_EXIT:..."` to the shell. After `exit` executes, the marker command either fails or produces garbled ConPTY echo.

## Required Fixes

### 1. Fix PowerShell marker (C-01)
In `src/lib/exit-code-parser.ts`, change the PowerShell marker:

```typescript
case 'powershell':
  return '; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }';
```

### 2. Anchor regex to line boundaries (C-02)
In `src/lib/exit-code-parser.ts`, change the detection regex:

```typescript
const EXIT_CODE_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?$/m;
```

The `m` flag makes `^`/`$` match line boundaries. This prevents matches inside longer strings.

### 3. Use global regex for stripping (C-03)
Add a separate global regex for stripping, since a global regex with `.match()` loses capture groups:

```typescript
const EXIT_CODE_STRIP_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?\n?/gm;
```

In `extractExitCode`, use the non-global regex for detection and the global regex for stripping:

```typescript
export function extractExitCode(output: string): { cleanOutput: string; exitCode: number | null } {
  const match = output.match(EXIT_CODE_REGEX);
  if (match) {
    const exitCode = parseInt(match[1], 10);
    const cleanOutput = output.replace(EXIT_CODE_STRIP_REGEX, '');
    return { cleanOutput, exitCode };
  }
  return { cleanOutput: output, exitCode: null };
}
```

Note: The global regex needs to be reset before each use since it has state (`lastIndex`). Alternatively, create it inline or use `replaceAll` with a non-global regex string.

### 4. Skip marker for `exit` command (I-03)
In `src/components/Terminal.tsx`, in the `submitCommand` function, detect exit and skip marker:

```typescript
const trimmedLower = command.trim().toLowerCase();
const isExitCommand = trimmedLower === 'exit' || trimmedLower.startsWith('exit ');
const markerSuffix = isExitCommand ? '' : getExitCodeMarker(shellType);
```

### 5. Add split-chunk test (I-02)
Add a test to `src/__tests__/Terminal.test.tsx` that sends the marker split across two output events and verifies the exit code is eventually extracted.

## Tests (Write/Update These FIRST)

### Exit Code Parser Tests — UPDATE existing tests
- [ ] **`test_anchored_regex_no_false_positive`**: Input `"some VELOCITY_EXIT:42 text\n"` → exitCode null (no match because marker is not at line start)
- [ ] **`test_strips_all_marker_occurrences`**: Input `"VELOCITY_EXIT:0\noutput\nVELOCITY_EXIT:0\n"` → cleanOutput `"output\n"` (both occurrences stripped)
- [ ] **Update PowerShell marker test**: `getExitCodeMarker('powershell')` should return the `$?` based marker, not the `$LASTEXITCODE` one

### Terminal Integration Tests — ADD
- [ ] **`test_exit_command_skips_marker`**: Submit `exit` command, verify `writeToSession` does NOT include marker suffix
- [ ] **`test_marker_split_across_chunks`**: Send two output events where `VELOCITY_EXIT:0` is split across them, verify exit code is extracted after the second chunk

## Acceptance Criteria
- [ ] PowerShell marker uses `$?` instead of `$LASTEXITCODE`
- [ ] Regex anchored to line boundaries (no false positives from embedded text)
- [ ] All marker occurrences stripped from output (global replace)
- [ ] `exit` command does not get marker suffix
- [ ] Split-chunk marker scenario tested
- [ ] All existing tests still pass (update assertions where needed)
- [ ] Clean commit: `fix: address exit code review findings`

## Files to Read First
- `src/lib/exit-code-parser.ts` — Fix regex and marker
- `src/components/Terminal.tsx` — Skip marker for exit
- `src/__tests__/exit-code-parser.test.ts` — Update/add tests
- `src/__tests__/Terminal.test.tsx` — Add integration tests
- `prompts/reports/code-reviews/CODE-REVIEW-TASK-012-exit-codes-R1.md` — Full review details
