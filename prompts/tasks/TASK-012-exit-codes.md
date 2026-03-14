# Task 012: Exit Codes Per Block via Shell Marker Injection

## Context

Blocks currently show "running" or "completed" status but no exit code. This task adds exit code detection by injecting a marker command after each user command.

### Current State
- **`src/components/Terminal.tsx`**: `submitCommand` sends `command.replace(/\n/g, '\r') + '\r'` to the PTY.
- **`src/lib/types.ts`**: `Block` has `status: 'running' | 'completed'` but no `exitCode` field.
- **`src/components/blocks/BlockView.tsx`**: Shows status but no exit code.

### Approach: Shell Marker Injection

After the user's command, automatically append a special echo that outputs the exit code in a detectable format. The frontend parses the marker from the output, strips it, and sets the block's exit code.

**Markers by shell type:**
- PowerShell: `; Write-Output "VELOCITY_EXIT:$LASTEXITCODE"`
- CMD: `& echo VELOCITY_EXIT:%ERRORLEVEL%`
- WSL/bash: `; echo "VELOCITY_EXIT:$?"`

The marker format is `VELOCITY_EXIT:<code>` on its own line. The frontend detects this pattern in the output stream and:
1. Extracts the exit code number
2. Strips the marker line from the displayed output
3. Sets `block.exitCode` on the current block

## Requirements

### Frontend Changes

#### 1. Update Block type
In `src/lib/types.ts`:
```typescript
export interface Block {
  id: string;
  command: string;
  output: string;
  timestamp: number;
  status: 'running' | 'completed';
  exitCode?: number | null;  // NEW
  shellType: ShellType;
}
```

#### 2. Update submitCommand in Terminal.tsx

When sending a command, append the appropriate exit code marker based on shell type:

```typescript
function getExitCodeMarker(shellType: ShellType): string {
  switch (shellType) {
    case 'powershell': return '; Write-Output "VELOCITY_EXIT:$LASTEXITCODE"';
    case 'cmd': return '& echo VELOCITY_EXIT:%ERRORLEVEL%';
    case 'wsl': return '; echo "VELOCITY_EXIT:$?"';
  }
}

// In submitCommand:
const markerSuffix = getExitCodeMarker(shellType);
writeToSession(sessionIdRef.current, command.replace(/\n/g, '\r') + markerSuffix + '\r');
```

#### 3. Parse exit code from output stream

Create `src/lib/exit-code-parser.ts`:

```typescript
const EXIT_CODE_REGEX = /VELOCITY_EXIT:(-?\d+)\r?\n?/;

export function extractExitCode(output: string): { cleanOutput: string; exitCode: number | null } {
  const match = output.match(EXIT_CODE_REGEX);
  if (match) {
    const exitCode = parseInt(match[1], 10);
    const cleanOutput = output.replace(EXIT_CODE_REGEX, '');
    return { cleanOutput, exitCode };
  }
  return { cleanOutput: output, exitCode: null };
}
```

#### 4. Update output event handler in Terminal.tsx

In the `pty:output` event handler, check each output chunk for the marker:

```typescript
// In the output event listener:
setBlocks(prev => prev.map(b => {
  if (b.id === activeBlockIdRef.current) {
    const newOutput = b.output + event.payload;
    const { cleanOutput, exitCode } = extractExitCode(newOutput);
    return {
      ...b,
      output: cleanOutput,
      ...(exitCode !== null ? { exitCode, status: 'completed' as const } : {}),
    };
  }
  return b;
}));
```

Note: The marker might arrive split across multiple chunks. Process the full accumulated output, not just the new chunk.

#### 5. Update BlockView to show exit code

In `src/components/blocks/BlockView.tsx`, show the exit code in the header:

```tsx
// In the block header, next to timestamp:
{block.exitCode !== undefined && block.exitCode !== null && (
  <span className={`block-exit-code ${block.exitCode === 0 ? 'exit-success' : 'exit-failure'}`}>
    {block.exitCode === 0 ? '✓' : `✗ ${block.exitCode}`}
  </span>
)}
```

Styles:
```css
.exit-success { color: #a6e3a1; }  /* green */
.exit-failure { color: #f38ba8; }  /* red */
```

### Backend (Rust)
No Rust changes needed.

## Tests (Write These FIRST)

### Exit Code Parser Tests (`src/__tests__/exit-code-parser.test.ts`)
- [ ] **`test_extracts_exit_code_zero`**: Input `"output\nVELOCITY_EXIT:0\n"` → exitCode 0, cleanOutput `"output\n"`
- [ ] **`test_extracts_nonzero_exit_code`**: Input `"error\nVELOCITY_EXIT:1\n"` → exitCode 1
- [ ] **`test_extracts_negative_exit_code`**: Input `"VELOCITY_EXIT:-1\n"` → exitCode -1
- [ ] **`test_no_marker_returns_null`**: Input `"just output"` → exitCode null, cleanOutput unchanged
- [ ] **`test_strips_marker_from_output`**: Verify the marker line is removed from cleanOutput

### BlockView Tests (`src/__tests__/BlockView.test.tsx`)
- [ ] **`test_shows_success_indicator`**: Block with exitCode 0 shows ✓
- [ ] **`test_shows_failure_indicator`**: Block with exitCode 1 shows ✗ 1
- [ ] **`test_no_exit_code_shows_nothing`**: Block with no exitCode shows no indicator

### Terminal Integration
- [ ] **`test_exit_marker_appended_to_command`**: Verify writeToSession is called with the marker suffix

## Acceptance Criteria
- [ ] Exit code marker injected after each command (shell-specific)
- [ ] Marker parsed from output, exit code extracted
- [ ] Marker stripped from displayed output
- [ ] Exit code shown in block header (✓ green for 0, ✗ red for non-zero)
- [ ] All tests pass
- [ ] Clean commit: `feat: add exit code detection via shell marker injection`

## Security Notes
- The marker is appended to the user's command string. It doesn't introduce new attack surface — the user already controls what's sent to the shell.
- The marker output is in the PTY stream and goes through the ANSI filter (safe).

## Files to Read First
- `src/components/Terminal.tsx` — submitCommand (append marker)
- `src/lib/types.ts` — Block type (add exitCode)
- `src/components/blocks/BlockView.tsx` — Display exit code
