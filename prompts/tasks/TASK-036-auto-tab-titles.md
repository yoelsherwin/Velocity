# Task 036: Per-Tab Auto-Titles (P1-U8)

## Context

Tabs currently show generic titles like "Terminal 1", "Terminal 2". Users with multiple tabs can't tell them apart. Tabs should auto-update to show the current working directory basename or the running command name.

### What exists now

- **TabBar.tsx** (`src/components/layout/TabBar.tsx`): Renders tab buttons with `tab.title` text.
- **Tab type** (`src/lib/types.ts`): `{ id, title, shellType, paneRoot, focusedPaneId }`.
- **TabManager.tsx**: Creates tabs with `title: "Terminal N"`. No dynamic title updates.
- **Terminal.tsx**: Has `cwd` state (refreshed after commands), `shellType`, and `blocks` with running commands.

## Requirements

### Frontend only — no Rust changes.

1. **Dynamic title**: Tab title should auto-update based on:
   - **When idle**: Show the CWD basename (e.g., `velocity`, `src`, `home`)
   - **When running a command**: Show the command name (first word of the command, e.g., `npm`, `git`, `cargo`)
   - **Fallback**: "Terminal N" when no CWD available

2. **Title source**: Terminal.tsx knows the CWD and active command. It needs to communicate this up to TabManager for the tab title.

3. **Implementation**: Add an `onTitleChange` callback prop that flows from TabManager → PaneContainer → Terminal. Terminal calls it when CWD changes or a command starts/completes.

4. **Title format**: `"command"` while running, `"dirname"` when idle. Keep it short (max 20 chars, truncate with `…`).

5. **Shell type prefix**: Optionally prefix with shell icon/label: `"PS: velocity"`, `"CMD: src"`, `"WSL: home"`. Or just show the directory — simpler for MVP.

## Tests

- [ ] `test_tab_title_updates_with_cwd`: When CWD changes, tab title updates to directory basename.
- [ ] `test_tab_title_shows_running_command`: While a command is running, tab title shows command name.
- [ ] `test_tab_title_truncated`: Long titles are truncated to 20 chars.
- [ ] `test_tab_title_fallback`: No CWD → shows "Terminal N".
- [ ] `test_tab_title_reverts_after_command`: After command completes, title reverts to CWD.

## Acceptance Criteria
- [ ] Tab titles auto-update based on CWD/running command
- [ ] Titles truncated to reasonable length
- [ ] All tests pass
- [ ] Commit: `feat: add auto-updating tab titles`

## Files to Read First
- `src/components/layout/TabManager.tsx` — Tab state, title management
- `src/components/layout/TabBar.tsx` — Tab title rendering
- `src/components/layout/PaneContainer.tsx` — Prop flow to Terminal
- `src/components/Terminal.tsx` — CWD state, active command tracking
- `src/lib/types.ts` — Tab type
