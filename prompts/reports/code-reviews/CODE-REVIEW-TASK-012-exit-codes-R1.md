# Code Review: TASK-012 Exit Codes Per Block via Shell Marker Injection (R1)

**Commit**: `47dedf8 feat: add exit code detection via shell marker injection`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-14
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit adds exit code detection by injecting shell-specific marker commands after each user command. The frontend parses `VELOCITY_EXIT:<code>` from the PTY output stream, strips the marker from displayed output, and shows a green check or red X with the exit code in the block header. A new `exit-code-parser.ts` module encapsulates the regex parsing and marker generation. The `Block` type gains an `exitCode` field.

The implementation is clean, focused, and well-tested with 11 new parser tests and 7 new integration/component tests (150 total, all pass). The regex parsing, marker injection, and UI rendering are all straightforward and correct for the common cases. However, there are several edge cases around the regex that need attention, one unrelated change bundled in, and a correctness concern with how PowerShell reports exit codes.

---

## Files Changed

| File | Change |
|------|--------|
| `src/lib/exit-code-parser.ts` | NEW: `extractExitCode()` and `getExitCodeMarker()` functions |
| `src/lib/types.ts` | MODIFIED: Added `exitCode?: number \| null` to `Block`, added `focusedPaneId` to `Tab` |
| `src/components/Terminal.tsx` | MODIFIED: Marker injection in `submitCommand`, exit code parsing in output handler |
| `src/components/blocks/BlockView.tsx` | MODIFIED: Exit code indicator display in block header |
| `src/__tests__/exit-code-parser.test.ts` | NEW: 11 tests for parser and marker functions |
| `src/__tests__/BlockView.test.tsx` | MODIFIED: 4 new tests for exit code indicators |
| `src/__tests__/Terminal.test.tsx` | MODIFIED: 3 new tests for marker injection + parsing, existing tests updated |
| `prompts/tasks/TASK-012-exit-codes.md` | NEW: Task spec |

---

## Findings

### [F-01] BUG (Medium): Regex does not anchor to line start -- false positives possible

**File**: `src/lib/exit-code-parser.ts`, line 3

```typescript
const EXIT_CODE_REGEX = /VELOCITY_EXIT:(-?\d+)\r?\n?/;
```

The regex is unanchored, meaning it will match `VELOCITY_EXIT:0` anywhere on a line, including inside program output. For example, if a command's output happens to contain the string `VELOCITY_EXIT:42` (e.g., the user runs `echo VELOCITY_EXIT:42`), the parser will incorrectly extract it as an exit code and strip it.

While the string `VELOCITY_EXIT:` is unlikely to appear in organic output, the marker format is deterministic and user-discoverable. A user could also `cat` a file that contains this string, or an ANSI-colored line could have escape sequences around it.

**Recommendation**: Anchor the regex to match only at the start of a line, and optionally require the marker to be on its own line:

```typescript
const EXIT_CODE_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?\n?$/m;
```

The `m` (multiline) flag makes `^` and `$` match line boundaries. This significantly reduces false positive risk.

---

### [F-02] BUG (Medium): `String.replace()` with non-global regex only removes the first occurrence

**File**: `src/lib/exit-code-parser.ts`, line 16

```typescript
const cleanOutput = output.replace(EXIT_CODE_REGEX, '');
```

`String.replace()` with a non-global regex replaces only the first match. In practice, there should only be one marker per command, but if a split-chunk scenario results in the marker appearing twice in the accumulated output (unlikely but possible with echo'd content), only the first instance would be stripped.

More importantly, this interacts with F-01: if the regex is unanchored and the output contains a user-generated `VELOCITY_EXIT:0` before the real marker, the wrong occurrence gets stripped, and the real marker remains in the displayed output.

**Recommendation**: After anchoring the regex per F-01, add the `g` flag to strip all occurrences as a safety measure:

```typescript
const EXIT_CODE_REGEX = /^VELOCITY_EXIT:(-?\d+)\r?\n?$/gm;
```

Note: When using `g` flag with `.match()`, the capture groups are lost. Use `.exec()` or named groups instead, or use a separate regex for matching vs. stripping.

---

### [F-03] BUG (Medium): PowerShell `$LASTEXITCODE` only reflects native executable exit codes, not cmdlet failures

**File**: `src/lib/exit-code-parser.ts`, line 31

```typescript
case 'powershell':
  return '; Write-Output "VELOCITY_EXIT:$LASTEXITCODE"';
```

In PowerShell, `$LASTEXITCODE` is set only when a **native executable** (`.exe`) runs. For PowerShell cmdlets and scripts, `$LASTEXITCODE` retains its previous value (or is `$null` if no native command has run yet). For example:

- `Get-ChildItem NonExistent` will fail, but `$LASTEXITCODE` will still be `$null` or the previous native command's exit code.
- `cmd /c exit 1` correctly sets `$LASTEXITCODE` to 1.

When `$LASTEXITCODE` is `$null`, `Write-Output "VELOCITY_EXIT:$null"` will output `VELOCITY_EXIT:` (no digits), which won't match the regex `(-?\d+)`. This means the block will stay in `running` status forever for commands that don't invoke native executables.

**Recommendation**: Use `$?` (boolean success/failure) as a fallback. A more robust marker for PowerShell:

```powershell
; if ($?) { Write-Output "VELOCITY_EXIT:0" } else { Write-Output "VELOCITY_EXIT:1" }
```

Or combine both to preserve the actual exit code when available:

```powershell
; Write-Output "VELOCITY_EXIT:$(if ($LASTEXITCODE -ne $null) { $LASTEXITCODE } elseif ($?) { 0 } else { 1 })"
```

This is a real functional issue -- many PowerShell users primarily use cmdlets (e.g., `Get-Process`, `Set-Location`), not native executables, and their blocks will never transition to `completed` status.

---

### [F-04] HYGIENE (Low): Unrelated change bundled in commit -- `focusedPaneId` added to `Tab` interface

**File**: `src/lib/types.ts`, line 20

```typescript
focusedPaneId: string | null;  // Per-tab focus: which pane is focused in this tab
```

This change belongs to TASK-014 (per-tab focus), not TASK-012 (exit codes). The commit message says "add exit code detection via shell marker injection" but also includes an unrelated type change. While harmless (the field is already consumed by `TabManager.tsx` and `PaneContainer.tsx` from a prior commit), it violates the single-responsibility principle for commits.

**Recommendation**: This should have been in a separate commit. Since it's already committed and used by other code, it's not worth reverting, but flag it for future discipline.

---

### [F-05] GAP (Low): No test for marker split across output chunks

**File**: `src/__tests__/exit-code-parser.test.ts`

The task spec notes: "The marker might arrive split across multiple chunks. Process the full accumulated output, not just the new chunk." The implementation correctly accumulates output before parsing (`const newOutput = b.output + event.payload` on line 94 of Terminal.tsx). However, there is no test that simulates the marker arriving in two separate chunks, e.g.:

- Chunk 1: `"file1.txt\nVELOCITY_EXI"`
- Chunk 2: `"T:0\n"`

After chunk 1, the parser correctly returns `exitCode: null` (no match). After chunk 2, the accumulated output is `"file1.txt\nVELOCITY_EXIT:0\n"` and the parser correctly matches. This scenario works by construction, but an explicit integration test would document this guarantee and guard against future regressions.

**Recommendation**: Add a Terminal.test.tsx test that sends two output events where the marker is split across them, and verify the exit code is eventually extracted and the marker stripped.

---

### [F-06] GAP (Low): No test for CMD or WSL marker syntax in Terminal integration

**File**: `src/__tests__/Terminal.test.tsx`

The integration tests only exercise the default `powershell` shell type. There are no tests that switch to `cmd` or `wsl` and verify the correct marker is appended. While `getExitCodeMarker` is unit-tested for all three shell types, the integration path through `submitCommand` is only tested with PowerShell.

**Recommendation**: Add at least one test that switches to `cmd` or `wsl` and verifies the marker suffix in the `writeToSession` call.

---

### [F-07] NIT (Low): Exit code indicator uses literal Unicode characters

**File**: `src/components/blocks/BlockView.tsx`, lines 54-55

```typescript
{block.exitCode === 0 ? '\u2713' : `\u2717 ${block.exitCode}`}
```

Using `\u2713` (check mark) and `\u2717` (ballot X) via Unicode escapes is fine and explicit. The rendering depends on the font having these glyphs. Since the terminal uses `Cascadia Code` / `Consolas` / `Courier New` (from `App.css`), and these fonts do include basic Unicode symbols, this should render correctly. No action needed -- just noting for awareness.

---

### [F-08] GOOD: Output handler correctly accumulates before parsing

**File**: `src/components/Terminal.tsx`, lines 92-101

```typescript
if (b.id !== activeBlockIdRef.current) return b;
const newOutput = b.output + event.payload;
const { cleanOutput, exitCode } = extractExitCode(newOutput);
return {
  ...b,
  output: cleanOutput,
  ...(exitCode !== null ? { exitCode, status: 'completed' as const } : {}),
};
```

The implementation correctly:
1. Accumulates output (`b.output + event.payload`) before parsing.
2. Stores the cleaned output (marker stripped) back on the block.
3. Only sets `exitCode` and `status: 'completed'` when the marker is actually found.
4. Uses the spread pattern to conditionally add properties without clobbering other fields.

This handles the split-chunk scenario correctly by design.

---

### [F-09] GOOD: Marker injection is safe -- no new attack surface

**File**: `src/lib/exit-code-parser.ts`, lines 28-36

The marker suffix is a static string determined by shell type. It does not interpolate user input. The user's command is passed through `command.replace(/\n/g, '\r')` as before, and the marker is appended after. Since the user already controls what goes to the shell, the marker does not expand the attack surface. The marker output goes through the ANSI filter before rendering.

---

### [F-10] GOOD: BlockView handles all exit code states correctly

**File**: `src/components/blocks/BlockView.tsx`, lines 53-56

```typescript
{block.exitCode !== undefined && block.exitCode !== null && (
  <span className={`block-exit-code ${block.exitCode === 0 ? 'exit-success' : 'exit-failure'}`}>
    {block.exitCode === 0 ? '\u2713' : `\u2717 ${block.exitCode}`}
  </span>
)}
```

The guard `!== undefined && !== null` correctly handles:
- `exitCode` not set (field absent from object) -> `undefined` -> no indicator
- `exitCode: null` (explicitly null) -> no indicator
- `exitCode: 0` -> green check
- `exitCode: 1` (or any non-zero) -> red X with code

Tests cover all four cases. The CSS classes are properly defined.

---

### [F-11] GOOD: Test quality is comprehensive

The test suite covers:
- **exit-code-parser.test.ts** (11 tests): Zero, non-zero, negative, large exit codes; no marker; marker stripping; CRLF handling; no trailing newline; all three shell markers.
- **BlockView.test.tsx** (4 new tests): Success indicator, failure indicator, undefined exit code, null exit code.
- **Terminal.test.tsx** (3 new tests): Marker appended, PowerShell syntax, output parsing + stripping.

Existing tests were correctly updated to include the marker suffix in expected `writeToSession` calls. All 150 tests pass.

---

## Required Changes

| ID | Severity | Description |
|----|----------|-------------|
| F-01 | Medium | Anchor the `EXIT_CODE_REGEX` to match only at line boundaries to prevent false positives from program output containing the marker string |
| F-02 | Medium | Ensure all marker occurrences are stripped (or handle the interaction with F-01 properly) |
| F-03 | Medium | Fix PowerShell marker to handle cmdlet failures -- `$LASTEXITCODE` is `$null` for non-native commands, causing blocks to never complete |

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-04 | Low | Separate the `focusedPaneId` change into its own commit (TASK-014), or at minimum note it in the commit message |
| F-05 | Low | Add test for marker arriving split across two output chunks |
| F-06 | Low | Add integration test for CMD and WSL marker syntax |

---

## Test Assessment

| Suite | Tests | Status |
|-------|-------|--------|
| exit-code-parser.test.ts | 11 | All pass |
| BlockView.test.tsx | 11 (4 new) | All pass |
| Terminal.test.tsx | 26 (3 new) | All pass |
| All other suites | 102 | All pass |
| **Total** | **150** | **All pass** |

Tests are comprehensive for the common cases but lack coverage for the edge cases identified in F-01, F-03, F-05, and F-06.

---

## Verdict: NEEDS CHANGES

F-03 is a functional correctness issue that will affect the majority of PowerShell users -- cmdlet commands (the most common PowerShell usage) will never transition blocks to `completed` status because `$LASTEXITCODE` remains `$null`. F-01 is a correctness issue where user-controlled output can trigger false exit code detection. Both should be addressed before merge.
