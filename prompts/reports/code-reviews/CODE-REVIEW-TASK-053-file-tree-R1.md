# Code Review: TASK-053 File Tree Sidebar (Round 1)

**Reviewer**: Claude Code Review Agent
**Date**: 2026-03-24
**Commit**: `6953000` (feat: add built-in file tree sidebar)

---

## Test Results

| Suite | Result |
|-------|--------|
| Vitest (frontend) | 609/609 passed (59/60 files; 1 worker OOM -- pre-existing, not a test failure) |
| Cargo test (unit) | 165 passed, 0 failed, 1 ignored |
| Cargo test (integration) | 11 passed, 0 failed |

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/commands/mod.rs` | New `FileEntry` struct, `compute_list_directory` fn, `list_directory` Tauri command, 4 Rust tests |
| `src-tauri/src/lib.rs` | Register `list_directory` command |
| `src/components/layout/FileTree.tsx` | New `FileTree` and `FileTreeNode` components (lazy-loading tree) |
| `src/components/layout/TabManager.tsx` | Sidebar state, Ctrl+Shift+E toggle, file-click dispatch, layout wrapper |
| `src/lib/file-tree.ts` | `FileEntry` type + `listDirectory` IPC wrapper |
| `src/lib/commands.ts` | New `sidebar.toggle` command entry |
| `src/App.css` | File tree sidebar styles + `.tab-content-main` wrapper |
| `src/__tests__/FileTree.test.tsx` | 6 new frontend tests |

---

## Security Review

### Path Traversal / Arbitrary Enumeration

The `list_directory` command accepts an arbitrary `path: String` from the frontend and lists its contents. Key observations:

1. **No path validation or sandboxing**: The command does not restrict which directories can be listed. A compromised or malicious frontend call like `listDirectory("C:\\Users\\victim\\Documents")` would succeed.

2. **Acceptable for this application**: Since Velocity is a terminal emulator, the user already has full filesystem access via the shell. The file tree provides a convenience view, not a privilege escalation vector. The command does not read file contents, only lists directory entries.

3. **`is_dir()` check is present**: The command validates the path is actually a directory before listing, returning an error for files or nonexistent paths.

4. **`MAX_ENTRIES` cap (500)**: Prevents DoS from directories with enormous numbers of entries.

5. **Non-UTF8 filenames are skipped** (`.to_str()` returns `None`): Correct defensive behavior.

**Verdict**: The `list_directory` command is security-acceptable given the terminal context. No path traversal or symlink-following vulnerabilities exist beyond what the shell already permits.

---

## Findings

### [P2] No canonicalization of input path

The `compute_list_directory` function passes `path` directly to `Path::new()` without canonicalizing. While `is_dir()` prevents listing files, paths containing `..` segments (e.g., `C:\Users\..\..\Windows\System32`) will resolve implicitly via the OS. This is acceptable for a terminal app but inconsistent with how other commands (e.g., `get_cwd`) handle paths. Canonicalizing with `std::fs::canonicalize()` would normalize the path and resolve symlinks, making logs and error messages clearer.

**Recommendation**: Add canonicalization for clarity, not security:
```rust
let dir_path = std::fs::canonicalize(std::path::Path::new(path))
    .map_err(|e| format!("Invalid directory: {}", e))?;
if !dir_path.is_dir() {
    return Err(format!("Not a directory: {}", path));
}
```

### [P3] `.flatten()` on `read_dir` silently swallows per-entry errors

```rust
for entry in entries.flatten() {
```

If individual directory entries fail to read (e.g., due to permissions), they are silently skipped. This is likely intentional for a UI tree view, but a debug log would help troubleshooting.

**Recommendation**: Consider logging skipped entries at debug level, or accept as-is since silent skip is reasonable UX for a file explorer.

### [P3] `FileTreeNode` does not reset children when `entry.path` changes

If the parent component were to change the `entry` prop on a `FileTreeNode`, the stale `children` state from the previous entry would persist because `children` is local `useState` with no dependency on `entry.path`. Currently this cannot happen because React's `key={child.path}` ensures remounting, but it is fragile if keys ever change.

**Recommendation**: Add a `useEffect` cleanup:
```tsx
useEffect(() => {
  setChildren(null);
  setExpanded(false);
}, [entry.path]);
```

### [P3] Sidebar root path does not update when CWD changes

The sidebar root path is fetched once on mount via `get_cwd` but never updated when the user `cd`s to a different directory. The tree will always show the initial working directory.

**Recommendation**: Listen for CWD change events (if available) or re-fetch `get_cwd` when the active pane changes. This could be a follow-up task.

### [P4] `handleFileClick` dispatches a custom event but nothing listens for it

The `velocity:insert-text` custom event is dispatched when a file is clicked, but no component in the diff subscribes to this event. The click will silently do nothing.

**Recommendation**: Either add a listener in `Terminal.tsx` (or `InputEditor`) that handles `velocity:insert-text` by inserting the path into the input, or document this as a known TODO for a follow-up task.

### [P4] Empty `.file-tree-node` CSS rule

```css
.file-tree-node {
  /* container for item + children */
}
```

This empty rule serves no purpose.

**Recommendation**: Remove the empty rule or add actual styles.

---

## Summary

The implementation is clean and well-structured. The Rust backend is solid: proper error handling (no `unwrap()` on user data), entry-count capping, hidden-file detection (both Unix dot-prefix and Windows attribute), and correct use of `spawn_blocking` for filesystem I/O. The React frontend uses lazy-loading for subdirectories and a drag-to-resize handle with proper cleanup.

The main actionable finding is **P2** (path canonicalization for consistency). The **P4** about `velocity:insert-text` having no listener means clicking files currently does nothing visible, which should be wired up.

**Verdict**: PASS with minor findings. No blockers.
