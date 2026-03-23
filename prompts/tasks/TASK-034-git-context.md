# Task 034: Git Context in Prompt (P1-U3)

## Context

Developers spend most of their terminal time in git repos. Showing the current branch, status (dirty/clean), and ahead/behind count gives essential context without needing to run `git status`. Warp and modern terminals show this.

### What exists now

- **InputEditor.tsx**: Has a `ModeIndicator` (CLI/AI) and prompt character `➯`. No git info.
- **Terminal.tsx**: Manages `cwd` state (fetched on mount and after commands). Could fetch git info alongside.
- **Rust commands**: Pattern established for new Tauri commands.

## Requirements

### Backend (Rust) + Frontend.

#### 1. New Tauri command: `get_git_info` (`src-tauri/src/commands/mod.rs`)

```rust
#[derive(Serialize)]
pub struct GitInfo {
    pub branch: String,       // e.g., "main", "feature/foo"
    pub is_dirty: bool,       // Any uncommitted changes
    pub ahead: u32,           // Commits ahead of upstream
    pub behind: u32,          // Commits behind upstream
}

#[tauri::command]
pub async fn get_git_info(cwd: String) -> Result<Option<GitInfo>, String>
```

- Returns `None` if `cwd` is not inside a git repo.
- Run `git` commands via `Command::new("git")`:
  - `git rev-parse --abbrev-ref HEAD` → branch name
  - `git status --porcelain` → dirty if any output
  - `git rev-list --left-right --count HEAD...@{upstream}` → ahead/behind (may fail if no upstream — default to 0/0)
- Use `spawn_blocking` for all I/O.
- Validate `cwd` is a real directory.
- Handle errors gracefully (git not installed → return error, not in repo → return None).

#### 2. Frontend: Git context chip (`src/components/editor/GitContext.tsx`)

A small component rendered in the InputEditor area (next to the ModeIndicator):

```
[main] ✓        — clean on main
[main] ● 3      — 3 dirty files on main
[feature/x] ↑2 ↓1 ● — ahead 2, behind 1, dirty
```

- Branch name in brackets
- `✓` if clean, `●` (or `*`) if dirty
- `↑N` if ahead, `↓N` if behind
- Muted text color (`var(--text-muted)`) with branch in accent color

#### 3. Integration in Terminal.tsx

- Fetch git info alongside CWD (on mount and after command completion)
- Pass git info to InputEditor or render GitContext directly
- Debounce: don't refetch on every keystroke — only on mount and command completion

#### 4. Register command

Add `get_git_info` to `lib.rs` command handler.

## Tests

### Rust Unit Tests
- [ ] `test_git_info_in_git_repo`: Run in the project's own repo, verify branch and dirty status.
- [ ] `test_git_info_outside_repo`: Run in a temp dir that's not a git repo, verify returns None.
- [ ] `test_git_info_invalid_cwd`: Invalid path returns error.

### Frontend Tests
- [ ] `test_git_context_renders_branch`: Component shows branch name.
- [ ] `test_git_context_clean_indicator`: Clean repo shows ✓.
- [ ] `test_git_context_dirty_indicator`: Dirty repo shows ● with count.
- [ ] `test_git_context_ahead_behind`: Shows ↑N ↓N when ahead/behind.
- [ ] `test_git_context_hidden_when_no_git`: Returns null when gitInfo is null.
- [ ] `test_terminal_fetches_git_info`: Git info fetched on mount.

## Acceptance Criteria
- [ ] Git branch shown next to input prompt
- [ ] Dirty/clean indicator
- [ ] Ahead/behind count when available
- [ ] Hidden when not in a git repo
- [ ] Refreshes after each command
- [ ] Graceful when git is not installed
- [ ] All tests pass
- [ ] Commit: `feat: add git context in terminal prompt`

## Files to Read First
- `src/components/editor/InputEditor.tsx` — Prompt area layout
- `src/components/editor/ModeIndicator.tsx` — Existing indicator pattern
- `src/components/Terminal.tsx` — CWD state, command completion detection
- `src-tauri/src/commands/mod.rs` — Tauri command patterns
- `src-tauri/src/lib.rs` — Command registration
