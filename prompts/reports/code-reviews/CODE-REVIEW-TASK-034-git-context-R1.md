# Code Review: TASK-034 Git Context in Prompt (R1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-23
**Commit**: ade4a56 `feat: add git context in terminal prompt`

## Verdict: PASS (with minor findings)

No blocking issues. The implementation is secure, well-structured, and properly tested.

---

## Security Review

### Command Injection Safety: PASS

All git subprocesses use the safe `.arg()` builder pattern. No string interpolation of user input into command arguments:

- `Command::new("git").arg("rev-parse").arg("--is-inside-work-tree").current_dir(cwd_path)` -- safe
- `Command::new("git").arg("rev-parse").arg("--abbrev-ref").arg("HEAD").current_dir(cwd_path)` -- safe
- `Command::new("git").arg("status").arg("--porcelain").current_dir(cwd_path)` -- safe
- `Command::new("git").arg("rev-list").arg("--left-right").arg("--count").arg("HEAD...@{upstream}").current_dir(cwd_path)` -- safe

The `HEAD...@{upstream}` literal is a hardcoded string, not user input. No user-supplied data reaches git command arguments.

### CWD Validation: PASS

The `cwd` parameter is validated before use:
```rust
let cwd_path = std::path::Path::new(cwd);
if !cwd_path.is_dir() {
    return Err(format!("Invalid directory: {}", cwd));
}
```

The `cwd` value originates from `getCwd()` (Tauri process CWD), not from direct user input. Even if a malicious cwd were provided, it only becomes a `current_dir()` argument, which cannot cause command injection.

### IPC Input Validation: PASS

The Tauri command accepts a `String` cwd, validates it is a real directory, and returns structured data. No user-editable shell input reaches the git commands.

---

## Architecture Review

### Rust Side

1. **spawn_blocking usage**: Correct. `compute_git_info` runs synchronous `std::process::Command` calls, properly offloaded from the async runtime via `tokio::task::spawn_blocking`.

2. **Error handling**: Good. Uses `map_err` throughout, no `unwrap()` on user-derived data. The `unwrap_or(0)` on ahead/behind parsing is appropriate since those are git's own output.

3. **Testability**: The `compute_git_info` function is extracted from the Tauri command for direct unit testing. Three test cases cover: in-repo, outside-repo, and invalid-cwd.

4. **Struct design**: `GitInfo` derives `Serialize`, `Clone`, `Debug`, `PartialEq` -- appropriate for IPC and testing.

### Frontend Side

5. **GitContext component**: Clean, simple, renders null when `gitInfo` is null. Good use of `data-testid` attributes for testing.

6. **InputEditor integration**: `gitInfo` prop is optional (`GitInfo | null`), passed through with `gitInfo ?? null` fallback. No breaking change to existing callers.

7. **Terminal integration**: Git info is fetched alongside CWD in three locations:
   - Initial mount `useEffect`
   - `pty:output` handler on command completion
   - `pty:output-replace` handler on command completion

8. **lib/git.ts**: Thin wrapper around `invoke`, correctly typed.

### Test Coverage

- **Rust**: 3 unit tests (in-repo, outside-repo, invalid cwd)
- **Frontend**: 7 GitContext component tests (branch display, clean/dirty, ahead/behind combinations, null gitInfo)
- **Integration**: 1 Terminal test verifying git info fetch on mount

---

## Findings

### F-1: Minor -- Duplicated CWD+git fetch pattern (Non-blocking)

**Location**: `src/components/Terminal.tsx` lines 170-173, 216-219, 405-408

The pattern `getCwd().then((dir) => { setCwd(dir); getGitInfo(dir).then(setGitInfo).catch(() => setGitInfo(null)); }).catch(() => {})` is repeated three times. Consider extracting to a helper like `refreshCwdAndGit()` to reduce duplication.

**Severity**: Low (readability, not correctness)

### F-2: Minor -- git-not-installed returns Err, not None (Non-blocking)

**Location**: `src-tauri/src/commands/mod.rs` line 211

When git is not installed, the function returns `Err("Failed to run git: ...")`. On the frontend, this error is caught and `setGitInfo(null)` is called, so the UX is correct. However, conceptually "git not installed" is not an error state -- it's similar to "not in a repo." Returning `Ok(None)` would be more semantically consistent and would not require the frontend to catch.

**Severity**: Low (semantic, UX is already correct via catch handler)

### F-3: Info -- No stderr suppression on git commands

**Location**: `src-tauri/src/commands/mod.rs` lines 196-248

The git commands may write warnings to stderr (e.g., "warning: LF will be replaced by CRLF"). The stderr output is currently ignored (not captured or displayed), which is the correct behavior. No action needed.

### F-4: Info -- Detached HEAD handled correctly

When HEAD is detached, `git rev-parse --abbrev-ref HEAD` returns the literal string "HEAD". The component will display `[HEAD]` which is reasonable and informative. No special handling needed.

---

## Summary

The implementation follows security best practices (`.arg()` only, CWD validation, no unwrap on user data). The code is well-tested with 11 new tests across Rust and TypeScript. The architecture cleanly separates the Rust command from the React display component. Minor findings are non-blocking quality improvements.

**Recommendation**: PASS -- merge-ready.
