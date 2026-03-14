# Fix: Batch Fix for Missed Findings from QA Audit

## Source
Investigation: `prompts/reports/investigations/INVESTIGATION-qa-audit.md`

## Fixes (Priority Order)

### Fix 1: BUG-015 — Input active after session creation failure
**File**: `src/components/Terminal.tsx` — in `startSession` catch block
**Issue**: If `createSession` fails, the input editor remains active. User can type but nothing happens.
**Fix**: Set `setClosed(true)` in the catch block so the restart button appears instead of the input field.

### Fix 2: SEC-004-M2 — Stale listeners during session transition
**File**: `src/components/Terminal.tsx` — in `resetAndStart`
**Issue**: `cleanupListeners()` is called AFTER `closeSession()`. During the async gap, old listeners can fire on the closing session.
**Fix**: Move `cleanupListeners()` to BEFORE `closeSession()`:
```typescript
const resetAndStart = useCallback(async (shell: ShellType) => {
    startSessionIdRef.current++;
    cleanupListeners();  // ← FIRST: stop listening
    if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});  // THEN close
    }
    // ... rest unchanged
```

### Fix 3: SEC-003-M1 — Validate Anser color strings before CSS interpolation
**File**: `src/lib/ansi.ts` — in `parseAnsi`
**Issue**: Anser's `fg`/`bg` values flow directly into `rgb()` CSS strings without validation.
**Fix**: Add a regex validation:
```typescript
function isValidRgb(value: string): boolean {
    return /^\d{1,3},\s?\d{1,3},\s?\d{1,3}$/.test(value);
}

// In parseAnsi:
if (entry.fg && isValidRgb(entry.fg)) {
    span.fg = `rgb(${entry.fg})`;
}
```

### Fix 4: SEC-002-L1 — Session ID format validation
**File**: `src-tauri/src/pty/mod.rs` — at the top of `write_to_session`, `resize_session`, `close_session`, `start_reading`
**Issue**: Session IDs not validated as UUID format before HashMap lookup. Flagged in ALL 4 security reviews.
**Fix**: Add a validation function:
```rust
fn validate_session_id(session_id: &str) -> Result<(), String> {
    if uuid::Uuid::parse_str(session_id).is_err() {
        return Err(format!("Invalid session ID format: {}", session_id));
    }
    Ok(())
}
```
Call at the top of each method that accepts a session_id.

### Fix 5: BUG-017 — Prevent empty command submission
**File**: `src/components/Terminal.tsx` — in `handleKeyDown`
**Issue**: Pressing Enter with empty input creates a block identical to the welcome block.
**Fix**: Guard against empty/whitespace-only input:
```typescript
if (e.key === 'Enter' && sessionIdRef.current && !closed) {
    const trimmed = input.trim();
    if (trimmed) {
        submitCommand(trimmed);
    }
    setInput('');
}
```

### Fix 6: Remove `nul` from .gitignore
**File**: `.gitignore`
**Issue**: SEC-001-L3 — `nul` entry is a Windows artifact, flagged since the very first security review.
**Fix**: Remove the `nul` line from `.gitignore`.

### Fix 7: Gate debug eprintln behind cfg(debug_assertions)
**File**: `src-tauri/src/pty/mod.rs` — reader thread diagnostic logging
**Issue**: CR-006-NC1 — Debug `eprintln!` statements log to stderr on every PTY read in production.
**Fix**: Wrap in `#[cfg(debug_assertions)]` or use a conditional:
```rust
if cfg!(debug_assertions) {
    eprintln!("[pty:{}] raw read: {} bytes", sid, n);
}
```

## Tests

- [ ] **`test_session_id_validation_rejects_invalid`**: Call `validate_session_id("not-a-uuid")` → error. Call with valid UUID → Ok.
- [ ] **`test_empty_input_not_submitted`**: Render Terminal, press Enter with empty input. Assert `submitCommand`/`writeToSession` was NOT called.
- [ ] **`test_isValidRgb_accepts_valid`**: `isValidRgb("255, 0, 128")` → true
- [ ] **`test_isValidRgb_rejects_invalid`**: `isValidRgb("url(evil)")` → false

## Acceptance Criteria
- [ ] All 7 fixes applied
- [ ] Tests for session ID validation, empty input guard, RGB validation
- [ ] All existing tests pass
- [ ] Clean commit: `fix: batch fix for missed findings — session validation, input guards, listener ordering`

## Files to Read First
- `prompts/reports/investigations/INVESTIGATION-qa-audit.md` — Full findings list
- `src/components/Terminal.tsx` — Fixes 1, 2, 5
- `src/lib/ansi.ts` — Fix 3
- `src-tauri/src/pty/mod.rs` — Fixes 4, 7
- `.gitignore` — Fix 6
