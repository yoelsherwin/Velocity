# Code Review — TASK-001-bootstrap — R2

**Date:** 2026-03-11
**Commit:** `c98cfc8` — fix: address code review findings — enable CSP, fix gitignore, configure jest-dom
**Reviewer:** Code Review Agent

---

## Previous Round Resolution

- **[R1 #1] CSP disabled (`"csp": null`)**: RESOLVED — CSP now set to `"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"` in `src-tauri/tauri.conf.json:23`.
- **[R1 #2] `.gitignore` backslash path + missing newline**: RESOLVED — Redundant line removed, file ends with proper newline.
- **[R1 #3] `.expect()` in `lib.rs`**: STILL OPEN (accepted as-is in R1 — no action was required).
- **[R1 #4] Test assertions use `toBeDefined()`**: RESOLVED — Setup file created, assertions now use `toBeInTheDocument()`.
- **[R1 #5] `@ts-expect-error` in `vite.config.ts`**: STILL OPEN (accepted as low-priority in R1 — no action was required).
- **[R1 #6] Non-monospace fonts**: STILL OPEN (future work, no action needed now).
- **[R1 #7] Report directories not created**: RESOLVED — `prompts/reports/code-reviews/` now exists (report directory created on first use by R1 report itself).
- **[R1 #8] No Rust tests**: STILL OPEN (expected — no custom Rust code exists yet).

All R1 critical and important findings that required action have been addressed.

---

## Critical (Must fix)

None.

---

## Important (Should fix)

### 1. `settings.local.json` deleted from git history rather than just untracked

- **File**: `.claude/settings.local.json` (deleted in this commit)
- **Issue**: The R1 review recommended `git rm --cached` to untrack the file while keeping it on disk. The fix commit correctly untracked the file — it no longer appears in `git ls-files` and exists on disk as an untracked file. However, the diff shows it as a full deletion (`deleted file mode 100644`), meaning `git rm --cached` was used correctly (the file shows as "deleted" in the commit because it's removed from the index, not from disk). This is actually the correct behavior. **Upon closer inspection, this is working as intended.** The file is on disk, untracked, and `.gitignore` `*.local` pattern prevents re-addition. No issue here — downgrading this to informational.

**Verdict**: No action needed. The implementation is correct.

### 2. CSP may need `connect-src` for Tauri IPC

- **File**: `src-tauri/tauri.conf.json:23`
- **Issue**: The current CSP (`default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`) is good for the bootstrap state. However, once Tauri IPC (`invoke`, `listen`, `emit`) is used with `@tauri-apps/api`, the CSP may need `connect-src 'self' ipc: http://ipc.localhost` depending on the Tauri v2 IPC transport mechanism. Tauri v2 typically handles this automatically by injecting its own CSP rules, but this should be verified when the first IPC-using feature is implemented.
- **Fix**: No fix needed now. When implementing Pillar 1 (PTY Engine), test that `invoke()` calls work with this CSP. If they fail, add `connect-src` rules. Tauri v2 may handle this transparently.
- **Why**: Noting proactively so the first dev agent implementing IPC doesn't waste time debugging CSP errors.

---

## Suggestions (Nice to have)

### 3. Untracked `nul` file in working directory

- **File**: `nul` (root of project)
- **Issue**: `git status` shows an untracked file called `nul`. This is a Windows artifact — likely created when a shell command accidentally wrote to `NUL` (the Windows null device) in a case where the filesystem created a literal file instead. This file should be deleted and optionally added to `.gitignore`.
- **Fix**: Delete the file (`rm nul` or `del nul`). If it recurs, add `nul` to `.gitignore`.
- **Why**: Prevents accidental commits of this artifact file.

### 4. Prompt file changes are uncommitted

- **Issue**: `git status` shows 11 modified files in `.claude/commands/` and `prompts/` directories, plus `prompts/tasks/FIX-001-code-review-r1.md` as untracked. These contain the workflow improvements (TDD-first enforcement, report naming conventions, code review round numbering). These are valuable process improvements that should be committed separately.
- **Fix**: These should be committed in a dedicated commit, e.g., `chore: enhance workflow prompts with TDD enforcement and report naming conventions`.
- **Why**: Process documentation should be version-controlled. These changes improve the dev cycle significantly.

### 5. `security-reviews/` and `qa-reports/` directories don't exist yet

- **Issue**: The updated FLOW.md and prompt files reference `prompts/reports/security-reviews/` and `prompts/reports/qa-reports/`, but only `prompts/reports/code-reviews/` exists (created when R1 was written).
- **Fix**: Create these directories with `.gitkeep` files so the structure matches what the documentation describes.
- **Why**: Self-documenting directory structure. Minor but prevents confusion when agents try to write to non-existent paths.

---

## Summary

- **Total findings**: 0 critical, 0 important (1 initially flagged, then downgraded), 3 suggestions
- **Overall assessment**: **APPROVE**

All critical findings from R1 have been properly addressed:

1. **CSP**: Correctly set to a restrictive policy. The `'unsafe-inline'` for styles is justified (React needs it) and `script-src 'self'` blocks XSS.
2. **`.gitignore`**: Clean — redundant entry removed, file has proper newline.
3. **Test setup**: `jest-dom/vitest` properly configured via setup file, assertions use `toBeInTheDocument()`.
4. **`settings.local.json`**: Correctly untracked from git, still on disk, protected by `*.local` gitignore rule.

Tests pass (2/2). The bootstrap is clean and ready for feature development.

The suggestions (nul file cleanup, committing prompt changes, creating report subdirectories) are all non-blocking housekeeping items.
