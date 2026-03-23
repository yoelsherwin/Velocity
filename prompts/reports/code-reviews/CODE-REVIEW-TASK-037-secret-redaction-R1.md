# Code Review: TASK-037 Secret Redaction (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: a481e2b `feat: add automatic secret redaction in terminal output`

## Verdict: PASS (with findings)

No blocking issues. The implementation is well-structured and the security posture is strong for a display-layer redaction feature. Several minor findings noted below.

---

## Security Review

### Secret Detection Patterns: PASS (with observations)

The seven patterns cover the most common secret formats:
- OpenAI keys (`sk-`), AWS Access Keys (`AKIA`), GitHub PATs (`ghp_`, `github_pat_`), Slack tokens (`xox[bpar]-`), connection string passwords, and env var secrets (`API_KEY=`, `TOKEN=`, etc.).

**Potential false negatives** (acceptable for R1 but worth tracking):
- **Azure/GCP keys** are not detected. Azure Storage keys are base64 strings (no distinctive prefix). GCP service account keys are JSON -- neither is easily regex-detectable without high false-positive rates. Acceptable to defer.
- **Private keys** (e.g., `-----BEGIN RSA PRIVATE KEY-----`) are not detected. These are multi-line and would require different handling. Worth adding in a future iteration.
- **Bearer tokens** in HTTP headers (`Authorization: Bearer ...`) are not matched. The env-secret pattern would only catch `AUTH=...`, not header-style patterns.
- The `sk-` prefix pattern will match OpenAI keys including newer `sk-proj-` format since it requires 20+ chars after `sk-`. This is correct.

**No false negative for common patterns**: The existing patterns are well-tuned. The minimum-length constraints (20+ for OpenAI, 16 for AWS, 36 for GitHub PAT, 2+ for env values) are appropriate.

### Redaction Bypass Prevention: PASS

1. **Display layer only**: The `originalValue` field is stored in React component state (via `RedactedSegment`), not in DOM attributes. The rendered DOM shows `data-secret-id` (an opaque identifier like `secret-8-24`) but never the secret value itself.
2. **React DevTools exposure**: The `originalValue` IS accessible through React DevTools component props/state inspection. This is inherent to any React-based redaction and is acceptable -- React DevTools requires physical access or a browser extension. The alternative (keeping secrets only in a closure) would significantly complicate the architecture for minimal security gain.
3. **Click-to-reveal timer**: Properly auto-hides after 3 seconds. Timer is correctly cleaned up on unmount via the `useEffect` cleanup in `useSecretRedaction.ts` (line 63-68).

### Copy Output Behavior: PASS

- **"Copy Output" button** (line 40-44 in BlockView.tsx): Calls `maskSecrets(stripAnsi(block.output))`, which runs `detectSecrets` independently and masks all secrets. The clipboard receives masked text. This is correct.
- **"Copy Raw" button** (line 48-53): Copies the unmasked text. This is an intentional explicit action -- the button label makes the behavior clear. Acceptable.

### DOM Attribute Audit: PASS

The secret mask `<span>` elements contain:
- `data-testid="secret-mask"` -- safe, no secret data
- `data-secret-id={rSeg.secretId}` -- safe, contains opaque ID like `secret-8-24`
- `title="Click to reveal secret (3s)"` -- safe, no secret data
- No `data-original-value` or similar attributes that would leak the secret

When revealed, the secret value appears as text content only. No attributes change to contain the value.

---

## Architecture Review

### Pattern: GOOD

The three-layer design is clean:
1. `secretRedaction.ts` -- pure functions for detection and masking (no React dependency)
2. `useSecretRedaction.ts` -- React hook managing reveal state and memoization
3. `AnsiOutput.tsx` -- rendering integration with ANSI span splitting

This separation allows the detection logic to be tested independently and reused (e.g., `maskSecrets` for clipboard).

### Memoization: CORRECT

In `useSecretRedaction.ts`:
- `strippedText` is memoized on `[text]`
- `secrets` is memoized on `[strippedText]`
- `segments` is memoized on `[strippedText, secrets]`

The chain is correct -- `secrets` depends on `strippedText`, and `segments` depends on both. Since `useMemo` uses reference equality, and `strippedText` only changes when `text` changes, the memoization cascade works correctly. Verified by the `test_memoizes_detection` test.

The `revealSecret` callback uses `useCallback` with an empty dependency array `[]`, which is correct since it only uses `setRevealedIds` (stable) and `timersRef` (ref, stable).

### React.memo Comparison: MINOR ISSUE

`AnsiOutput` (line 346-367) has a custom `React.memo` comparator that checks `redactedSegments` and `revealedSecretIds` by reference equality. Since `useSecretRedaction` returns a new `Set` object on every state change (reveal/hide), but the `segments` array is memoized, this is correct behavior -- the component re-renders when reveal state changes but not on every parent render.

However, `revealedSecretIds` is a `useState` Set that gets replaced on each reveal/hide (lines 39-42, 51-54 in the hook). This means `AnsiOutput` re-renders for every reveal/hide across ALL secrets in the block, even if this particular output's secrets didn't change. For blocks with many secrets this could cause unnecessary re-renders. Minor concern -- not a performance issue at current scale.

---

## Code Quality Findings

### Finding 1: `applyRedaction` double-emit guard is fragile (LOW)

**File**: `src/components/AnsiOutput.tsx`, lines 214-217

```typescript
if (s.start >= segStart + pos || pos === 0) {
  const overlapEnd = Math.min(s.end, segEnd) - segStart;
  if (segStart + overlapStart <= s.start + 1) {
```

The condition `segStart + overlapStart <= s.start + 1` uses a `+1` fudge factor to handle boundary cases where a secret spans multiple ANSI spans. This works but is fragile. A cleaner approach would be to track a `lastEmittedSecretIdx` variable. Not blocking.

### Finding 2: `indexOf` for capture group offset could mismatch (LOW)

**File**: `src/lib/secretRedaction.ts`, line 170

```typescript
const groupOffset = match[0].indexOf(secretValue);
```

If a capture group's value appears more than once in the full match, `indexOf` returns the first occurrence, which may not be the correct one. Example: a connection string like `://pass:pass@host` would match the capture group `pass` but `indexOf('pass')` would find the first `pass` (in the username position), not the password position. In practice, the connection string regex captures `([^@\s]{2,})` between `:` and `@`, so the full match would be `:pass@` and `indexOf('pass')` would correctly find it at index 1. But this is pattern-dependent and could break with future patterns. Consider using `match.indices` (with the `d` flag) for precise group offsets in a future refactor.

### Finding 3: Regex `lastIndex` reset is correctly handled (GOOD)

Each pattern in `SECRET_PATTERNS` uses the `g` flag. The `detectSecrets` function correctly resets `pattern.regex.lastIndex = 0` before each `exec` loop (line 162). This prevents stale state between calls. Good practice.

### Finding 4: No `unwrap()` equivalent on user-derived data (PASS)

All code is TypeScript with proper null checks. The `!` non-null assertions in AnsiOutput.tsx (lines 310, 311) are used on `rSeg.secretId` which is guarded by the `if (rSeg.secretId)` check on line 299. Safe.

---

## Summary

| Category | Status |
|----------|--------|
| Secret detection patterns | PASS -- covers major formats, no false negatives for common patterns |
| Bypass prevention | PASS -- secrets not leaked via DOM attributes |
| Copy behavior | PASS -- Copy Output copies masked text |
| Memoization | PASS -- correctly chained |
| Timer cleanup | PASS -- cleaned up on unmount |
| Code quality | PASS -- two low-severity findings, no blockers |

**Recommendation**: Merge as-is. Track findings 1-2 for future cleanup. Consider adding `Bearer` token and PEM private key detection in a follow-up task.
