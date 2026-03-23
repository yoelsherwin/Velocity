# QA Report: TASK-034 Git Context in Prompt (R1)

**Tester**: Claude QA Agent
**Date**: 2026-03-23
**Commit**: ade4a56 `feat: add git context in terminal prompt`

## Test Results: ALL PASS

### Automated Tests

| Suite | Tests | Status |
|-------|-------|--------|
| Frontend (Vitest) | 443 passed, 0 failed | PASS |
| Rust (cargo test) | 119 unit + 11 integration passed, 0 failed | PASS |

All pre-existing tests continue to pass. No regressions detected.

---

### New Test Coverage

**Rust unit tests (3)**:
- `test_git_info_in_git_repo` -- verifies branch name returned in a real git repo
- `test_git_info_outside_repo` -- verifies `Ok(None)` for non-repo directory
- `test_git_info_invalid_cwd` -- verifies `Err` for nonexistent path

**Frontend component tests (7)**:
- `test_git_context_renders_branch` -- displays `[main]`
- `test_git_context_clean_indicator` -- shows checkmark with `git-status-clean` class
- `test_git_context_dirty_indicator` -- shows dot with `git-status-dirty` class
- `test_git_context_ahead_behind` -- displays up/down arrows with counts
- `test_git_context_hidden_when_no_git` -- renders nothing when `gitInfo` is null
- `test_git_context_no_ahead_behind_when_zero` -- hides ahead/behind when 0
- `test_git_context_shows_only_ahead` / `shows_only_behind` -- partial display

**Frontend integration test (1)**:
- `test_terminal_fetches_git_info` -- Terminal fetches git info on mount and renders component

---

## Bug Hunt Results

### Scenario 1: Stale git info after command completion

**Analysis**: Git info is refreshed in the `pty:output` and `pty:output-replace` event handlers when `commandCompleted` is true (lines 169-173, 215-219 of Terminal.tsx). After every command completes, `getGitInfo` is re-invoked with the current CWD.

**Finding**: The refresh is tied to CWD fetch. If `getCwd()` fails (the `.catch(() => {})` path), git info will NOT be refreshed. This is acceptable because if CWD is unavailable, git info would also be unreliable.

**Potential gap**: If the user runs `git checkout feature-branch`, the CWD doesn't change, so git info IS refreshed (CWD fetch succeeds, git info is re-fetched). This works correctly.

**Verdict**: NO BUG. Git info refreshes reliably after command completion.

### Scenario 2: Git not installed

**Analysis**: When `git` is not on PATH, `std::process::Command::new("git")` returns `Err` from `.output()`. The Rust code returns `Err("Failed to run git: ...")`. The frontend catches this in `.catch(() => setGitInfo(null))`, resulting in the GitContext component rendering nothing (returns null).

**Verdict**: NO BUG. Graceful degradation -- no git context shown, no error displayed to user.

### Scenario 3: Not in a git repo

**Analysis**: `git rev-parse --is-inside-work-tree` returns non-zero exit code. The Rust code returns `Ok(None)`. The frontend sets `gitInfo` to `null`. GitContext renders nothing.

**Verdict**: NO BUG. Handled correctly.

### Scenario 4: Detached HEAD

**Analysis**: `git rev-parse --abbrev-ref HEAD` returns the literal string `"HEAD"` when in detached HEAD state. The component will display `[HEAD]`. The dirty status and ahead/behind still work (ahead/behind will default to 0/0 since there's no upstream for a detached HEAD).

**Verdict**: NO BUG. Displays `[HEAD]` which is correct and informative.

### Scenario 5: No upstream configured

**Analysis**: The `git rev-list --left-right --count HEAD...@{upstream}` command fails when no upstream is set. The code uses `if let Ok(output) = revlist_output` and checks `output.status.success()`, defaulting to 0/0 on failure.

**Verdict**: NO BUG. Ahead/behind gracefully default to 0 when no upstream is configured.

### Scenario 6: Race condition -- rapid command execution

**Analysis**: If multiple commands complete rapidly, multiple `getGitInfo` calls may be in-flight. React's `setGitInfo` will apply the last resolved promise. Since all calls target the same CWD, the last result is the most current.

**Verdict**: NO BUG. React state setter ensures eventual consistency. No visual flicker since updates replace the full state.

### Scenario 7: Very long branch name

**Analysis**: The branch name is displayed inside `[branchname]` with no truncation. A branch like `feature/very-long-descriptive-branch-name-for-jira-ticket-12345` would render fully. The CSS has `flex-shrink: 0` on `.git-context`, which means it won't shrink to accommodate other elements.

**Verdict**: MINOR UX CONCERN. Very long branch names could push the prompt chevron off-screen or cause layout overflow. Not a functional bug. Consider adding `max-width` and `text-overflow: ellipsis` in a future task.

---

## Summary

All automated tests pass (443 frontend + 130 Rust). No regressions. The bug hunt identified no functional issues across all six risk scenarios (stale info, git missing, not-in-repo, detached HEAD, no upstream, race conditions). One minor UX concern noted regarding very long branch names.

**Verdict**: PASS -- ready for merge.
