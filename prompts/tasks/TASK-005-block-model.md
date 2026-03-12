# Task 005: Block Model — Command/Output Containers

## Context

Pillar 1 (Process Interfacing) is complete. Current state:

- **HEAD**: `4953590` on `main`
- **`src/components/Terminal.tsx`**: Shell selector (PowerShell/CMD/WSL), restart button, single `output` string buffer rendered in `<pre><AnsiOutput text={output} /></pre>`. Input field sends commands via `writeToSession`.
- **`src/components/AnsiOutput.tsx`**: Renders ANSI-styled text as `<span>` elements with `useMemo` + `React.memo`.
- **`src/lib/types.ts`**: `ShellType`, `SHELL_TYPES`, `SessionInfo`.
- **`src/lib/pty.ts`**: IPC wrappers for `createSession`, `writeToSession`, `closeSession`, `resizeSession`.
- **`src/lib/ansi.ts`**: `parseAnsi` function using `anser`.
- **56 tests passing** (25 frontend + 31 Rust).

Currently, all terminal output is a single continuous text stream. There's no visual distinction between different commands and their outputs. This task introduces the **Block Model** — grouping each command and its output into a visual container, like Jupyter notebook cells or Warp terminal blocks.

### Design Decisions

**Command boundary detection**: Frontend-driven. Since we control the input field (user types in our input, not directly in the PTY), we know exactly when a command is submitted. When the user presses Enter:
1. The current "active" block is finalized
2. A new block is created with the command text
3. All subsequent PTY output goes into the new block until the next command

**No exit codes for now**: Getting per-command exit codes requires shell integration (injecting `$?` queries or PROMPT_COMMAND hooks). That's a Pillar 2 enhancement, not the initial block model. For MVP, blocks show "running" or "completed" status.

**No Rust changes**: The block model is a purely frontend concern. The PTY still streams raw output — the frontend decides how to slice it into blocks.

**Output buffer strategy**: Cap at 50 blocks max. When exceeded, remove the oldest block. Each block's output is unbounded (the per-chunk streaming still works), but the total block count is bounded.

## Requirements

### Backend (Rust)

No Rust changes needed. The PTY engine and ANSI filter continue working as-is.

### Frontend (React/TypeScript)

#### 1. Block data structure

Add to `src/lib/types.ts`:

```typescript
export interface Block {
  id: string;
  command: string;          // The command text the user typed (empty for initial/welcome block)
  output: string;           // Accumulated output from PTY
  timestamp: number;        // Date.now() when command was submitted
  status: 'running' | 'completed';
  shellType: ShellType;
}
```

#### 2. Block component

Create `src/components/blocks/BlockView.tsx`:

A single block container. Structure:

```
┌──────────────────────────────────────────┐
│ $ dir                        12:34:56 PM │  ← header (command + timestamp)
│──────────────────────────────────────────│
│  Volume in drive C is OS                 │  ← output area (AnsiOutput)
│  Directory of C:\Users\...              │
│  ...                                     │
│──────────────────────────────────────────│
│  [Copy Command] [Copy Output] [Rerun]    │  ← action bar (only on hover/focus)
└──────────────────────────────────────────┘
```

Props:
```typescript
interface BlockViewProps {
  block: Block;
  isActive: boolean;        // true if this is the currently running block
  onRerun: (command: string) => void;
}
```

Behavior:
- Header shows the command text (monospace, slightly brighter color) and timestamp (right-aligned, dimmer)
- If `command` is empty (welcome block), hide the header
- Output area renders with `<AnsiOutput text={block.output} />`
- If `isActive` and `status === 'running'`, show a subtle pulsing dot or "●" indicator in the header
- Action bar appears on hover (CSS `:hover` on the block container):
  - **Copy Command**: copies `block.command` to clipboard via `navigator.clipboard.writeText()`
  - **Copy Output**: copies the raw `block.output` text (with ANSI stripped — use a utility to strip ANSI for clipboard)
  - **Rerun**: calls `onRerun(block.command)` which sends the command to the PTY

- For the welcome block (empty command), only show "Copy Output" in the action bar.

#### 3. Refactor Terminal.tsx — block list instead of single output

Replace the single `output: string` state with `blocks: Block[]` and `activeBlockId: string | null`.

**State changes:**
```typescript
// Remove:
const [output, setOutput] = useState('');

// Add:
const [blocks, setBlocks] = useState<Block[]>([]);
const activeBlockIdRef = useRef<string | null>(null);
```

**On session start** (in `startSession`):
- Create an initial "welcome" block: `{ id: uuid(), command: '', output: '', timestamp: Date.now(), status: 'running', shellType: shell }`
- Set it as the active block
- PTY output listener appends to the active block's output

**On PTY output event:**
```typescript
setBlocks(prev => prev.map(b =>
  b.id === activeBlockIdRef.current
    ? { ...b, output: b.output + event.payload }
    : b
));
```

Note: Use the ref for `activeBlockId` to avoid stale closures in the event listener.

**On Enter (command submission):**
1. Finalize the current active block: set its status to `'completed'`
2. Create a new block: `{ id: uuid(), command: inputText, output: '', timestamp: Date.now(), status: 'running', shellType }`
3. Set the new block as active
4. Send the command to the PTY via `writeToSession`
5. Clear the input field

**On session close/restart:**
- Clear blocks array
- Start fresh with a new welcome block

**Block count limit:**
```typescript
const MAX_BLOCKS = 50;

// When adding a new block, trim if needed:
setBlocks(prev => {
  const updated = [...prev, newBlock];
  return updated.length > MAX_BLOCKS ? updated.slice(-MAX_BLOCKS) : updated;
});
```

#### 4. Render block list

Replace the single `<pre>` output with a scrollable list of `<BlockView>` components:

```tsx
<div className="terminal-output" ref={outputRef} data-testid="terminal-output">
  {blocks.map(block => (
    <BlockView
      key={block.id}
      block={block}
      isActive={block.id === activeBlockIdRef.current}
      onRerun={handleRerun}
    />
  ))}
</div>
```

#### 5. Rerun handler

```typescript
const handleRerun = useCallback((command: string) => {
  if (!sessionId || closed) return;
  // Create a new block for the rerun
  const newBlock: Block = {
    id: crypto.randomUUID(),
    command,
    output: '',
    timestamp: Date.now(),
    status: 'running',
    shellType,
  };
  // Finalize current active block
  setBlocks(prev => {
    const updated = prev.map(b =>
      b.id === activeBlockIdRef.current ? { ...b, status: 'completed' as const } : b
    );
    return [...updated, newBlock];
  });
  activeBlockIdRef.current = newBlock.id;
  writeToSession(sessionId, command + '\r').catch(err => {
    setBlocks(prev => prev.map(b =>
      b.id === newBlock.id ? { ...b, output: b.output + `\n[Write error: ${err}]\n` } : b
    ));
  });
}, [sessionId, closed, shellType]);
```

#### 6. Strip ANSI utility for clipboard

Create a small utility in `src/lib/ansi.ts`:

```typescript
export function stripAnsi(text: string): string {
  // eslint-disable-next-line no-control-regex
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
```

This strips SGR sequences (the only ANSI that passes through our Rust filter) for clean clipboard copying.

#### 7. UUID generation

Use `crypto.randomUUID()` for block IDs. It's available in all modern browsers and Tauri's WebView2. No additional dependency needed.

#### 8. Styles

Add to `src/App.css`:

- `.block-container` — block wrapper with bottom border separator, slight left border accent for running blocks
- `.block-header` — flex row: command on left, timestamp on right
- `.block-command` — monospace, slightly brighter text (`#f5f5f5`)
- `.block-timestamp` — dim text (`#6c7086`), smaller font
- `.block-output` — the output area (inherits terminal-output styles)
- `.block-actions` — hidden by default, visible on `.block-container:hover`
- `.block-action-btn` — small, subtle buttons
- `.block-running-indicator` — pulsing dot animation for active block

### IPC Contract

No changes. Existing commands are sufficient.

## Tests (Write These FIRST)

### Frontend Tests — Block data model (`src/__tests__/blocks.test.ts`)

- [ ] **`test_block_has_required_fields`**: Create a Block object with all required fields. Assert all fields exist and have correct types.

- [ ] **`test_stripAnsi_removes_sgr`**: `stripAnsi("\x1b[31mred\x1b[0m")` → returns `"red"`.

- [ ] **`test_stripAnsi_preserves_plain_text`**: `stripAnsi("hello world")` → returns `"hello world"`.

- [ ] **`test_stripAnsi_handles_empty`**: `stripAnsi("")` → returns `""`.

### Frontend Tests — BlockView component (`src/__tests__/BlockView.test.tsx`)

- [ ] **`test_BlockView_renders_command`**: Render `<BlockView>` with a block that has `command: "dir"`. Assert "dir" is visible.

- [ ] **`test_BlockView_renders_output`**: Render `<BlockView>` with `output: "file1.txt\nfile2.txt"`. Assert the output text is visible.

- [ ] **`test_BlockView_renders_timestamp`**: Render `<BlockView>` with a known timestamp. Assert the formatted time is visible.

- [ ] **`test_BlockView_hides_header_for_welcome_block`**: Render `<BlockView>` with `command: ""`. Assert no command header is shown.

- [ ] **`test_BlockView_shows_running_indicator`**: Render `<BlockView>` with `status: "running"` and `isActive: true`. Assert a running indicator element is present.

- [ ] **`test_BlockView_copy_command_button`**: Render `<BlockView>` with `command: "dir"`. Find and click the "Copy Command" button. Assert `navigator.clipboard.writeText` was called with `"dir"`.

- [ ] **`test_BlockView_rerun_calls_handler`**: Render `<BlockView>` with `command: "dir"` and a mock `onRerun`. Click the "Rerun" button. Assert `onRerun` was called with `"dir"`.

### Frontend Tests — Terminal integration (`src/__tests__/Terminal.test.tsx`)

- [ ] **`test_initial_welcome_block_created`**: Render Terminal, wait for session creation. Assert at least one block exists in the output area.

- [ ] **`test_command_creates_new_block`**: Render Terminal, type a command, press Enter. Assert a new block with the command text appears.

- [ ] **`test_blocks_limited_to_max`**: This is harder to test directly — verify the MAX_BLOCKS constant exists and is 50.

## Acceptance Criteria

- [ ] All tests above are written and passing
- [ ] `Block` interface defined in `types.ts`
- [ ] `BlockView` component renders command, output, timestamp, actions
- [ ] Terminal component manages block list instead of single output string
- [ ] PTY output goes into the active block
- [ ] New block created on each command submission
- [ ] Welcome block captures initial shell output
- [ ] Action buttons: Copy Command, Copy Output (ANSI-stripped), Rerun
- [ ] Running indicator on active block
- [ ] MAX_BLOCKS = 50 cap enforced
- [ ] `stripAnsi` utility for clipboard
- [ ] Clean visual separation between blocks
- [ ] Existing shell selector and restart functionality still works
- [ ] `npm run test` passes
- [ ] `cargo test` passes (unchanged)
- [ ] Manual test: run 3-4 commands, see each in its own block with outputs separated
- [ ] Manual test: hover a block, see action buttons, click Copy Command
- [ ] Clean commit: `feat: implement block model with command/output containers`

## Security Notes

- Block output is rendered through the same `AnsiOutput` component — the ANSI security filter is unchanged.
- `navigator.clipboard.writeText` is used (not `document.execCommand`) — this is the modern, safe clipboard API.
- `stripAnsi` only strips SGR sequences (the only kind our Rust filter allows through). It doesn't need to handle dangerous sequences.
- `crypto.randomUUID()` is cryptographically random — block IDs are not guessable.
- No new Rust code, no new IPC commands, no new capabilities.

## Files to Read First

- `src/components/Terminal.tsx` — Main component to refactor (block list, active block tracking)
- `src/components/AnsiOutput.tsx` — Reused inside each BlockView
- `src/lib/types.ts` — Add Block interface
- `src/lib/ansi.ts` — Add stripAnsi utility
- `src/App.css` — Block styles
- `src/__tests__/Terminal.test.tsx` — Existing tests to update/maintain
