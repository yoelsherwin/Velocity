# Task 019: Scrollback Buffer + Large Output Performance

## Context

Two P0 bugs make large outputs freeze or crash the UI:
- **BUG-004**: Full ANSI re-parse per PTY output event. Every chunk triggers `parseAnsi()` on the ENTIRE block output (up to unbounded size).
- **BUG-025**: No per-block output size limit. A single `cat large-file.txt` can accumulate megabytes in one block.

Additionally, MAX_BLOCKS=50 is too low for daily use — users lose history quickly.

### Current State
- **`src/components/Terminal.tsx`**: Blocks stored as `Block[]` in state. Output appended via `setBlocks(prev => prev.map(b => ...))`. MAX_BLOCKS=50.
- **`src/components/blocks/BlockView.tsx`**: Renders `<AnsiOutput text={block.output} />` for the full output string.
- **`src/components/AnsiOutput.tsx`**: `useMemo(() => parseAnsi(text), [text])` — re-parses whenever text changes (which is every PTY chunk for the active block).
- **`src/lib/ansi.ts`**: `parseAnsi` calls `Anser.ansiToJson()` on the full text.

## Requirements

### Frontend (React/TypeScript)

#### 1. Per-block output cap

Add `OUTPUT_LIMIT_PER_BLOCK = 500_000` (500KB per block). When a block's output exceeds this:
- Truncate from the front (keep the most recent output)
- Prepend a marker: `[Output truncated — showing last 500KB]\n`

In Terminal.tsx, in the output event handler:
```typescript
const newOutput = b.output + event.payload;
if (newOutput.length > OUTPUT_LIMIT_PER_BLOCK) {
    return {
        ...b,
        output: '[Output truncated — showing last 500KB]\n' + newOutput.slice(-OUTPUT_LIMIT_PER_BLOCK),
    };
}
return { ...b, output: newOutput };
```

Export `OUTPUT_LIMIT_PER_BLOCK` for testing.

#### 2. Increase MAX_BLOCKS

Change `MAX_BLOCKS` from 50 to 500. With the per-block output cap, memory is now bounded: worst case ~500 blocks × 500KB = 250MB (unlikely — most blocks have small output).

#### 3. Virtualized block rendering

Only render blocks that are visible in the viewport. Use a lightweight virtualization approach:

**Option A (simplest)**: Use `react-window` (VariableSizeList) to virtualize the block list. Each block has variable height based on output length.

**Option B (simpler, good enough)**: Keep all blocks in DOM but only render the `<AnsiOutput>` for blocks that are near the viewport. Blocks outside the viewport show a placeholder with estimated height.

**Go with Option B** — it's simpler and avoids the complexity of variable-height virtualization with react-window. Implementation:

```typescript
// In BlockView.tsx:
function BlockView({ block, isActive, onRerun, isVisible }: BlockViewProps) {
    // ...
    return (
        <div className="block-container" ref={blockRef}>
            {/* Header always renders */}
            <div className="block-header">...</div>

            {/* Output: only parse ANSI if visible */}
            {isVisible ? (
                <pre className="block-output">
                    <AnsiOutput text={block.output} />
                </pre>
            ) : (
                <pre className="block-output block-output-placeholder"
                     style={{ height: estimatedHeight }}>
                    {/* Collapsed placeholder */}
                </pre>
            )}

            {/* Actions always render (small) */}
        </div>
    );
}
```

Use an `IntersectionObserver` to track which blocks are visible:

```typescript
// In Terminal.tsx or a custom hook:
function useVisibleBlocks(blockIds: string[]): Set<string> {
    const [visible, setVisible] = useState<Set<string>>(new Set());
    // Use IntersectionObserver with rootMargin to include blocks slightly outside viewport
    // ...
    return visible;
}
```

This means `AnsiOutput` (the expensive part) only runs for ~5-10 visible blocks, not all 500.

#### 4. Incremental ANSI parsing (fixes BUG-004)

The core performance fix: don't re-parse the entire block output on every PTY chunk. Instead, keep a cache of already-parsed spans and only parse the NEW chunk.

Create `src/hooks/useIncrementalAnsi.ts`:

```typescript
interface IncrementalAnsiState {
    parsedSpans: AnsiSpan[];
    parsedLength: number; // How much of the output has been parsed
}

export function useIncrementalAnsi(output: string): AnsiSpan[] {
    const cacheRef = useRef<IncrementalAnsiState>({ parsedSpans: [], parsedLength: 0 });

    return useMemo(() => {
        const cache = cacheRef.current;

        if (output.length === cache.parsedLength) {
            return cache.parsedSpans; // No change
        }

        if (output.length > cache.parsedLength && output.startsWith(/* check prefix matches */)) {
            // Incremental: only parse the new part
            const newPart = output.slice(cache.parsedLength);
            const newSpans = parseAnsi(newPart);
            const allSpans = [...cache.parsedSpans, ...newSpans];
            cache.parsedSpans = allSpans;
            cache.parsedLength = output.length;
            return allSpans;
        }

        // Full reparse (output was truncated or replaced)
        const spans = parseAnsi(output);
        cache.parsedSpans = spans;
        cache.parsedLength = output.length;
        return spans;
    }, [output]);
}
```

Update `AnsiOutput.tsx` to use this hook instead of raw `useMemo(() => parseAnsi(text), [text])`.

**Caveat**: ANSI state (current color) carries across chunks. A new chunk might start with text that should be colored from a previous SGR code. The incremental approach may lose this context at chunk boundaries. For MVP this is acceptable — the color resets frequently (most commands output `\x1b[0m` reset). If color bleeds are noticeable, we can carry the last SGR state forward.

#### 5. Estimated block height for placeholders

When a block is not visible, estimate its height:
```typescript
const estimateBlockHeight = (output: string): number => {
    const lines = output.split('\n').length;
    const lineHeight = 19.6; // 14px font * 1.4 line-height
    const headerHeight = 32;
    return headerHeight + Math.min(lines, 50) * lineHeight; // Cap at 50 lines for estimation
};
```

### Backend (Rust)

No Rust changes.

### IPC Contract

Unchanged.

## Tests (Write These FIRST)

### Frontend Tests (Vitest)

- [ ] **`test_output_truncated_when_exceeding_limit`**: Create a block with output > OUTPUT_LIMIT_PER_BLOCK. Assert output starts with truncation marker and length <= limit + marker length.
- [ ] **`test_output_limit_constant_is_500000`**: Assert `OUTPUT_LIMIT_PER_BLOCK === 500_000`.
- [ ] **`test_max_blocks_is_500`**: Assert `MAX_BLOCKS === 500`.
- [ ] **`test_incremental_parse_new_chunk`**: Call `useIncrementalAnsi` with "hello", then with "hello world". Assert only "world" part was newly parsed (check span count increased by expected amount).
- [ ] **`test_incremental_parse_full_on_truncation`**: Call with "abcdef", then with "def" (truncated). Assert full reparse happened.
- [ ] **`test_AnsiOutput_renders_with_incremental`**: Render AnsiOutput with color text. Assert spans render correctly (existing behavior preserved).

### E2E Tests (Playwright)

Skipped — no visible behavior change (performance improvement is internal). The existing E2E tests cover block rendering.

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] Per-block output capped at 500KB with truncation marker
- [ ] MAX_BLOCKS increased to 500
- [ ] Incremental ANSI parsing — only new chunks parsed, not full reparse
- [ ] Block visibility detection via IntersectionObserver
- [ ] Off-screen blocks show placeholder instead of rendered AnsiOutput
- [ ] BUG-004 fixed (no full re-parse per event)
- [ ] BUG-025 fixed (output size bounded)
- [ ] `npm run test` + `cargo test` pass
- [ ] Clean commit: `feat: add scrollback buffer with output limits and incremental ANSI parsing`

## Security Notes
- Output truncation doesn't affect the ANSI security filter — filtering happens in Rust before output reaches the frontend.
- IntersectionObserver is a standard DOM API with no security implications.

## Files to Read First
- `src/components/Terminal.tsx` — Output accumulation, MAX_BLOCKS
- `src/components/blocks/BlockView.tsx` — Block rendering, AnsiOutput usage
- `src/components/AnsiOutput.tsx` — Current parsing approach
- `src/lib/ansi.ts` — parseAnsi function
