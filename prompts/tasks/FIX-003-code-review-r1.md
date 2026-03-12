# Fix: Code Review Findings from TASK-003 R1

## Source
Code review report: `prompts/reports/code-reviews/CODE-REVIEW-TASK-003-ansi-filter-R1.md`

## Fixes Required

### Fix 1: Memoize ANSI parsing in AnsiOutput (CRITICAL — C-1, I-4)

**Files**: `src/components/AnsiOutput.tsx`, `src/components/Terminal.tsx`
**Issue**: `AnsiOutput` calls `parseAnsi(text)` on every render. The `text` prop is the entire output buffer (up to 100K chars). Every new PTY chunk and every keystroke triggers a full re-parse. This makes the terminal unusable during fast output.

**Fix**:
1. In `AnsiOutput.tsx`, add `useMemo` for the spans:
   ```tsx
   import { useMemo } from 'react';

   function AnsiOutput({ text }: AnsiOutputProps) {
     const spans = useMemo(() => parseAnsi(text), [text]);
     // ... rest unchanged
   }
   ```
2. Wrap the default export with `React.memo`:
   ```tsx
   export default React.memo(AnsiOutput);
   ```

This ensures: (a) parsing only happens when `text` changes (not on input keystrokes), and (b) the component itself doesn't re-render when `Terminal` re-renders for unrelated state changes.

### Fix 2: Strip backspace in Rust ANSI filter (CRITICAL — C-2)

**File**: `src-tauri/src/ansi/mod.rs`
**Issue**: Backspace (0x08) passes through the filter, but the frontend does no terminal emulation — it just appends text. Raw `\b` characters accumulate invisibly in the DOM.

**Fix**: Remove `0x08` from the `execute` match arm:
```rust
fn execute(&mut self, byte: u8) {
    match byte {
        0x0A | 0x0D | 0x09 => self.output.push(byte as char),
        _ => {} // Strip bell, backspace, and other C0 controls
    }
}
```

Update the comment to note backspace is stripped since the frontend doesn't process it.

### Fix 3: Make vte::Parser persistent across filter() calls (I-3)

**File**: `src-tauri/src/ansi/mod.rs`
**Issue**: `filter()` creates a new `vte::Parser` on each call. PTY output is chunked at arbitrary 4096-byte boundaries, so SGR sequences split across chunks are silently dropped, causing intermittent missing colors.

**Fix**: Store the parser as a field on `AnsiFilter`:
```rust
pub struct AnsiFilter {
    output: String,
    parser: vte::Parser,
}

impl AnsiFilter {
    pub fn new() -> Self {
        AnsiFilter {
            output: String::new(),
            parser: vte::Parser::new(),
        }
    }

    pub fn filter(&mut self, raw: &[u8]) -> String {
        self.output.clear();
        self.parser.advance(self, raw);
        self.output.clone()
    }
}
```

Note: This requires checking that `vte::Parser::advance` works with `&mut self` as the performer when the parser is also on `self`. If there's a borrow conflict, you may need to temporarily take the parser out:
```rust
pub fn filter(&mut self, raw: &[u8]) -> String {
    self.output.clear();
    let mut parser = std::mem::take(&mut self.parser);
    parser.advance(self, raw);
    self.parser = parser;
    self.output.clone()
}
```
(This works because `vte::Parser` implements `Default`.)

### Fix 4: Move test_max_sessions_enforced to pty module (I-2)

**Files**: `src-tauri/src/ansi/mod.rs`, `src-tauri/src/pty/mod.rs`
**Issue**: `test_max_sessions_enforced` is in the ansi module but tests pty functionality. The `session_count()` method triggers a dead_code warning.

**Fix**:
1. Remove `test_max_sessions_enforced` from `src-tauri/src/ansi/mod.rs` tests
2. Add it to `src-tauri/src/pty/mod.rs` tests
3. Add `#[allow(dead_code)]` with a comment to `session_count()` in `pty/mod.rs`

### Fix 5: Document oversize SGR check as defense-in-depth (I-1)

**File**: `src-tauri/src/ansi/mod.rs`
**Issue**: `MAX_SEQUENCE_LENGTH` bound check can never be triggered via `vte` parser (it caps at 32 params). The existing test doesn't exercise the code path.

**Fix**:
1. Add a comment above the check explaining it's defense-in-depth:
   ```rust
   // Defense-in-depth: vte parser caps at 32 params (making this unreachable
   // through normal parsing), but we bound-check anyway as a safety net against
   // future parser changes or alternative code paths.
   if reconstructed.len() <= MAX_SEQUENCE_LENGTH {
       self.output.push_str(&reconstructed);
   }
   ```
2. Update the test to document this clearly in its assertion comments.

### Fix 6: Use anser remove_empty option (I-5)

**File**: `src/lib/ansi.ts`
**Issue**: Manual `.filter()` to remove empty entries when `anser` has a built-in option.

**Fix**:
```typescript
const parsed = Anser.ansiToJson(text, { use_classes: false, remove_empty: true });
return parsed.map(entry => {
    // ... (remove the .filter() call)
```

## Acceptance Criteria

- [ ] `AnsiOutput` uses `useMemo` for `parseAnsi` result
- [ ] `AnsiOutput` exported with `React.memo`
- [ ] Backspace (0x08) stripped in Rust filter
- [ ] `vte::Parser` is a persistent field on `AnsiFilter`
- [ ] `test_max_sessions_enforced` moved to `pty` module tests
- [ ] `session_count()` annotated with `#[allow(dead_code)]`
- [ ] Oversize SGR check documented as defense-in-depth
- [ ] `anser` uses `remove_empty: true` option
- [ ] `npm run test` passes
- [ ] `cargo test` passes (no warnings)
- [ ] Clean commit: `fix: address code review findings for ANSI filter — performance, safety, parser state`

## Files to Read First

- `src/components/AnsiOutput.tsx` — Memoization fixes
- `src-tauri/src/ansi/mod.rs` — Backspace, parser persistence, test relocation, oversize comment
- `src-tauri/src/pty/mod.rs` — Receive relocated test
- `src/lib/ansi.ts` — remove_empty option
