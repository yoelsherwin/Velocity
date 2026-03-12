# Fix: Code Review Findings from TASK-004 R1

## Source
Code review report: `prompts/reports/code-reviews/CODE-REVIEW-TASK-004-lifecycle-and-shells-R1.md`

## Fixes Required

### Fix 1: Use useRef for session ID to prevent stale closure bugs (CRITICAL — C-1, C-2)

**File**: `src/components/Terminal.tsx`
**Issue**: Two related problems:
1. `handleShellSwitch` captures `sessionId` via closure — rapid shell switching reads stale values, leaking sessions.
2. Cleanup function uses `setSessionId((currentSid) => { closeSession(currentSid); return null; })` to read current state — fragile pattern that may fire multiple times in React concurrent mode.

**Fix**: Add a `useRef<string | null>(null)` alongside the `sessionId` state. Update both the ref and state whenever the session ID changes. Read the ref (not state) in all cleanup paths and `handleShellSwitch`:

```typescript
const sessionIdRef = useRef<string | null>(null);
const [sessionId, setSessionId] = useState<string | null>(null);

// When setting session ID:
const updateSessionId = (id: string | null) => {
    sessionIdRef.current = id;
    setSessionId(id);
};

// In cleanup:
return () => {
    mounted = false;
    cleanupListeners();
    if (sessionIdRef.current) {
        closeSession(sessionIdRef.current).catch(() => {});
    }
};

// In handleShellSwitch:
const handleShellSwitch = useCallback(async (shell: ShellType) => {
    if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});
    }
    cleanupListeners();
    // ... create new session
}, [/* no sessionId dependency needed — ref is always current */]);
```

This eliminates both the stale closure and the state-setter-as-getter pattern.

### Fix 2: Extract shared session reset function (I-4)

**File**: `src/components/Terminal.tsx`
**Issue**: `handleRestart` and `handleShellSwitch` duplicate the cleanup + create sequence.

**Fix**: Extract a `resetAndStart(shell: ShellType)` function that both handlers call:
```typescript
const resetAndStart = useCallback(async (shell: ShellType) => {
    if (sessionIdRef.current) {
        await closeSession(sessionIdRef.current).catch(() => {});
    }
    cleanupListeners();
    setOutput('');
    setClosed(false);
    await startSession(shell);
}, [cleanupListeners, startSession]);
```

Then `handleShellSwitch` and `handleRestart` both just call `resetAndStart`.

### Fix 3: Fix ARIA roles for shell selector (I-3)

**File**: `src/components/Terminal.tsx`
**Issue**: Buttons use `aria-selected` without `role="tab"` — invalid ARIA is worse than no ARIA for screen readers.

**Fix**: Add `role="tablist"` to the shell selector container and `role="tab"` to each button:
```tsx
<div className="shell-selector" role="tablist">
    {SHELL_TYPES.map((shell) => (
        <button
            key={shell}
            role="tab"
            aria-selected={shell === shellType}
            ...
        >
```

### Fix 4: Type-safe IPC wrapper for shell type (S-4)

**File**: `src/lib/pty.ts`
**Issue**: `createSession` accepts `shellType?: string` instead of `ShellType`, defeating the purpose of the type definition.

**Fix**: Import and use `ShellType`:
```typescript
import { ShellType } from './types';

export async function createSession(
    shellType?: ShellType,
    rows?: number,
    cols?: number,
): Promise<string> { ... }
```

## Acceptance Criteria

- [ ] `useRef` tracks authoritative session ID — no stale closures
- [ ] State setter no longer used as getter in cleanup
- [ ] Shared `resetAndStart` function eliminates duplication
- [ ] Shell selector has `role="tablist"`, buttons have `role="tab"`
- [ ] `createSession` IPC wrapper accepts `ShellType` not `string`
- [ ] All existing tests still pass
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `fix: address code review findings for lifecycle — session ref, ARIA, type safety`

## Files to Read First

- `src/components/Terminal.tsx` — Main component with all fixes
- `src/lib/pty.ts` — IPC wrapper type fix
- `src/lib/types.ts` — ShellType definition (for import)
- `src/__tests__/Terminal.test.tsx` — Ensure tests still pass after refactor
