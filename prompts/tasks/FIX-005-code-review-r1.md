# Fix: Code Review Findings from TASK-005 R1

## Source
Code review report: `prompts/reports/code-reviews/CODE-REVIEW-TASK-005-block-model-R1.md`

## Fixes Required

### Fix 1: Make MAX_BLOCKS test meaningful (NC-2)

**File**: `src/__tests__/Terminal.test.tsx`
**Issue**: The `test_blocks_limited_to_max` test is `expect(50).toBe(50)` — a literal tautology that tests nothing.

**Fix**: Import `MAX_BLOCKS` from the Terminal module (export it as a named constant) and verify it:
```typescript
import { MAX_BLOCKS } from '../components/Terminal';

test("MAX_BLOCKS constant is 50", () => {
    expect(MAX_BLOCKS).toBe(50);
});
```

This requires exporting `MAX_BLOCKS` from `Terminal.tsx`. Add:
```typescript
export const MAX_BLOCKS = 50;
```

Alternatively, write a behavioral test that simulates submitting 51 commands and asserts only 50 blocks remain. The constant export approach is simpler and sufficient.

### Fix 2: Handle clipboard promise rejections (NC-4)

**File**: `src/components/blocks/BlockView.tsx`
**Issue**: `navigator.clipboard.writeText()` calls have no `.catch()`. If clipboard access is denied (e.g., document not focused, permissions policy), this produces unhandled promise rejection warnings.

**Fix**: Add `.catch()` to both handlers:
```typescript
const handleCopyCommand = () => {
    navigator.clipboard.writeText(block.command).catch(() => {
        // Clipboard write failed — silently ignore (user can manually select + copy)
    });
};

const handleCopyOutput = () => {
    navigator.clipboard.writeText(stripAnsi(block.output)).catch(() => {
        // Clipboard write failed — silently ignore
    });
};
```

### Fix 3: Extract shared submitCommand function (NC-3, non-blocking but quick)

**File**: `src/components/Terminal.tsx`
**Issue**: Block creation logic is duplicated between `handleKeyDown` and `handleRerun` (~25 lines).

**Fix**: Extract a `submitCommand(command: string)` function that both handlers call:
```typescript
const submitCommand = useCallback((command: string) => {
    if (!sessionIdRef.current || closed) return;
    const newBlock: Block = {
        id: crypto.randomUUID(),
        command,
        output: '',
        timestamp: Date.now(),
        status: 'running',
        shellType,
    };
    setBlocks(prev => {
        const updated = prev.map(b =>
            b.id === activeBlockIdRef.current ? { ...b, status: 'completed' as const } : b
        );
        const next = [...updated, newBlock];
        return next.length > MAX_BLOCKS ? next.slice(-MAX_BLOCKS) : next;
    });
    activeBlockIdRef.current = newBlock.id;
    writeToSession(sessionIdRef.current, command + '\r').catch(err => {
        setBlocks(prev => prev.map(b =>
            b.id === newBlock.id ? { ...b, output: b.output + `\n[Write error: ${err}]\n` } : b
        ));
    });
}, [closed, shellType]);
```

Then `handleKeyDown` calls `submitCommand(input); setInput('');` and `handleRerun` just calls `submitCommand(command)`.

## Acceptance Criteria

- [ ] `MAX_BLOCKS` exported from Terminal.tsx and tested with real import
- [ ] Clipboard write promises have `.catch()` handlers
- [ ] Block creation logic extracted into shared `submitCommand` function
- [ ] All existing tests still pass
- [ ] `npm run test` passes
- [ ] `cargo test` passes
- [ ] Clean commit: `fix: address code review findings for block model — tests, clipboard, dedup`

## Files to Read First

- `src/components/Terminal.tsx` — Export MAX_BLOCKS, extract submitCommand
- `src/components/blocks/BlockView.tsx` — Clipboard error handling
- `src/__tests__/Terminal.test.tsx` — Fix MAX_BLOCKS test
