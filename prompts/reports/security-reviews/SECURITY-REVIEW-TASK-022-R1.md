# Security Review: TASK-022 Tab/Path Completions (R1)

- **Reviewer**: Security Agent
- **Date**: 2026-03-18
- **Commit range**: `9592e1c..dde12a2` (2 commits)
- **Task**: TASK-022 (Tab Completions for Paths and Commands)
- **Previous HEAD**: `9592e1c`
- **Verdict**: **PASS WITH FINDINGS** (no blockers, 2 medium, 2 low, 2 informational)

---

## 1. Attack Surface Summary

This task introduces a new Tauri IPC command `get_completions` exposed to the webview frontend. The command performs **read-only filesystem operations** (directory listing) and **in-memory command filtering**. No shell execution is involved.

### New IPC Endpoint

| Command | Parameters | Operation | Risk Level |
|---------|-----------|-----------|------------|
| `get_completions` | `partial: String, cwd: String, context: String` | Reads filesystem directories or filters cached commands | Medium |

### Changed Components

| File | Role | Security Relevance |
|------|------|-------------------|
| `src-tauri/src/commands/mod.rs` | New `get_completions` command + helpers | **PRIMARY** - filesystem access |
| `src-tauri/src/lib.rs` | Command registration | Minimal - wiring only |
| `src/hooks/useCompletions.ts` | Frontend completion orchestration | Passes user input to IPC |
| `src/lib/completion-context.ts` | Determines completion type from input | Token parsing, no IPC |
| `src/components/Terminal.tsx` | Integration of completions hook | State management |
| `src/components/editor/InputEditor.tsx` | Tab key handling, cursor tracking | UI interaction |

---

## 2. Findings

### FINDING-01: Unrestricted Directory Enumeration via Absolute Paths [MEDIUM]

**Location**: `src-tauri/src/commands/mod.rs`, `compute_path_completions()`, lines 208-229

**Description**: The `partial` parameter can be an absolute path (e.g., `C:\Windows\System32\config\`), allowing the frontend to enumerate the contents of any directory on the filesystem that the Tauri process has read access to. There is no allowlist, no scoping to the working directory, and no restriction on which paths may be enumerated.

**Attack vector**: If an attacker achieves arbitrary JavaScript execution in the webview (e.g., via XSS or a compromised dependency), they can call:
```javascript
invoke('get_completions', { partial: 'C:\\Users\\', cwd: 'C:\\', context: 'path' })
```
to enumerate user home directories, system configuration folders, SSH keys directories, etc.

**Code**:
```rust
if partial_path.is_absolute() {
    // Absolute path: use its parent as search dir
    if let Some(parent) = partial_path.parent() {
        // ... no validation of the path
        (parent.to_path_buf(), prefix, path_prefix)
    }
}
```

**Impact**: Information disclosure -- an attacker can discover file and directory names anywhere on the filesystem. File *contents* are not exposed, only names.

**Mitigating factors**:
- This is a terminal application that already executes arbitrary shell commands. Users with access to the shell can already do `dir C:\` at will.
- The Tauri CSP (`default-src 'self'`) significantly limits XSS vectors.
- MAX_RESULTS (50) limits how much can be enumerated per request, though repeated requests with different prefixes would bypass this.
- The application does not run as a network-exposed service.

**Recommendation**: For defense-in-depth, consider logging or rate-limiting completion requests to sensitive paths. In a future hardening pass, consider scoping path completions to the cwd and its descendants, or at minimum to user-owned directories. Given that this is a terminal application, this is an **accepted risk** for MVP but should be revisited if the IPC surface is ever exposed more broadly.

---

### FINDING-02: `cwd` Parameter Not Validated Against Actual Shell CWD [MEDIUM]

**Location**: `src-tauri/src/commands/mod.rs`, `compute_path_completions()`, lines 195-199

**Description**: The `cwd` parameter is accepted as-is from the frontend. The only validation is `cwd_path.is_dir()`. The frontend sends `cwd` based on `get_cwd()` which returns the Tauri **process** CWD (not the shell's CWD). However, a compromised frontend could pass any directory as `cwd`:

```javascript
invoke('get_completions', { partial: '', cwd: 'C:\\Windows\\System32\\config\\', context: 'path' })
```

This achieves the same directory enumeration as FINDING-01 but through the `cwd` parameter instead of `partial`.

**Code**:
```rust
let cwd_path = std::path::Path::new(cwd);
if !cwd_path.is_dir() {
    return Ok(Vec::new());
}
```

**Impact**: Same as FINDING-01 -- directory name disclosure. The `is_dir()` check prevents crashes on invalid paths but does not restrict scope.

**Mitigating factors**: Same as FINDING-01. The terminal itself can access the entire filesystem.

**Recommendation**: Same as FINDING-01. Consider binding `cwd` to the actual session working directory on the Rust side rather than trusting the frontend-supplied value. This would also fix the noted "MVP limitation" where the Tauri process CWD differs from the shell's CWD after `cd` commands.

---

### FINDING-03: Path Traversal via `..` Sequences Not Blocked [LOW]

**Location**: `src-tauri/src/commands/mod.rs`, `compute_path_completions()`, lines 231-256

**Description**: The `partial` parameter is not sanitized for path traversal sequences. A value like `..\..\..\..\Windows\System32\` would be resolved via `cwd_path.join(parent)` and used as the search directory. While this does not grant access beyond what FINDING-01 already allows, it means relative path traversal is unconstrained.

**Code**:
```rust
let full_dir = cwd_path.join(parent);
```

There is no canonicalization or check that the resolved path is still under `cwd`.

**Impact**: Low -- this is a subset of FINDING-01 but through a different mechanism. `std::path::Path::join` with `..` components will walk up the directory tree.

**Recommendation**: If scoping is implemented for FINDING-01/02, ensure `..` traversal is also blocked by canonicalizing the resolved path and checking it remains within the allowed scope.

---

### FINDING-04: No Input Length Validation on `partial` Parameter [LOW]

**Location**: `src-tauri/src/commands/mod.rs`, `get_completions()`, lines 345-356

**Description**: The `partial` parameter has no maximum length validation. An extremely long string (e.g., megabytes) would be cloned, passed through string operations, and used as a filesystem path. While `std::fs::read_dir` would fail gracefully on an invalid path, the string processing and allocation could consume memory.

**Code**:
```rust
pub async fn get_completions(
    partial: String,  // No length check
    cwd: String,      // No length check
    context: String,   // No length check
) -> Result<Vec<String>, String> {
    let p = partial.clone();  // Cloned
    let c = cwd.clone();       // Cloned
    let ctx = context.clone(); // Cloned
```

**Impact**: Low -- a compromised frontend could cause elevated memory usage but not a crash (the OS will cap path lengths). The `clone()` operations double memory usage for each parameter.

**Recommendation**: Add a reasonable upper bound on parameter lengths (e.g., `partial` and `cwd` capped at 4096 characters, `context` at 32 characters). Return an error if exceeded.

---

### FINDING-05: COMMAND_CACHE Poisoned Mutex Recovery [INFORMATIONAL]

**Location**: `src-tauri/src/commands/mod.rs`, `get_cached_commands()`, line 313

**Description**: The code uses `unwrap_or_else(|e| e.into_inner())` to recover from a poisoned mutex. This is correct defensive coding -- a panic in another thread holding the lock won't propagate here. However, the cached data after poison recovery may be in an inconsistent state (partially updated `Vec<String>`).

**Code**:
```rust
let mut cache = COMMAND_CACHE.lock().unwrap_or_else(|e| e.into_inner());
```

**Impact**: Informational -- in practice, `collect_known_commands()` cannot panic (all operations use safe error handling), so the mutex will never be poisoned. The recovery pattern is correct.

**Recommendation**: No action required. This is good defensive programming.

---

### FINDING-06: Return Type Leaks Internal Error Messages [INFORMATIONAL]

**Location**: `src-tauri/src/commands/mod.rs`, `get_completions()`, line 354

**Description**: The `map_err(|e| e.to_string())` on the `spawn_blocking` join error could leak internal Rust runtime error messages to the frontend. Similarly, `compute_completions` returns an error string for unknown context types that includes the user-supplied context value: `format!("Unknown completion context: {}", context)`.

**Code**:
```rust
tokio::task::spawn_blocking(move || compute_completions(&p, &c, &ctx))
    .await
    .map_err(|e| e.to_string())?
```

```rust
_ => Err(format!("Unknown completion context: {}", context)),
```

**Impact**: Informational -- error messages are returned to the same-origin frontend, not to external parties. However, reflecting user input in error messages is a bad habit that could become an issue if error strings are ever rendered as HTML.

**Recommendation**: Use static error messages where possible. For the unknown context error, consider `Err("Unknown completion context".to_string())` without echoing the input.

---

## 3. Code Quality & Safety Checks

### 3.1 `unwrap()` on User-Derived Data

| Location | Usage | Verdict |
|----------|-------|---------|
| Line 161: `unwrap_or(name)` | Safe -- `split('.').next()` always returns at least one element, and fallback is used | OK |
| Line 218: `unwrap_or_default()` | Safe -- returns empty string on None | OK |
| Line 240: `unwrap_or_default()` | Safe -- returns empty string on None | OK |
| Line 281: `unwrap_or(false)` | Safe -- treats file_type errors as non-directory | OK |
| Line 313: `unwrap_or_else(|e| e.into_inner())` | Safe -- recovers from poisoned mutex | OK |
| Test code: Multiple `unwrap()` | Acceptable in test code | OK |

**Verdict**: No `unwrap()` on user-derived data in production code. All fallible operations use safe error handling.

### 3.2 Unsafe Blocks

None found. The entire changeset uses safe Rust.

### 3.3 No Shell Execution

Confirmed: the `get_completions` command performs only `std::fs::read_dir` and in-memory filtering. No `Command::new()`, no shell invocation, no PTY interaction.

### 3.4 Tauri Configuration

- **No changes** to `tauri.conf.json` or `capabilities/default.json`.
- CSP remains restrictive: `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'`.
- Capabilities limited to `core:default` and `core:event:default`.
- The new command is registered as a custom Tauri command (not a plugin), which means it is accessible from the webview by default. This is by design for a terminal application.

### 3.5 Dependency Changes

No changes to `Cargo.toml`. No new dependencies introduced.

### 3.6 Frontend Security

- The `useCompletions` hook does not render completion results as HTML -- they are used as text values in the input editor.
- The `completion-context.ts` module performs pure string/token analysis with no side effects.
- IPC calls use `invoke()` which is Tauri's standard typed IPC mechanism with automatic serialization.
- Error handling: IPC failures are silently caught (`catch {}` in useCompletions), preventing error messages from surfacing to the user.

---

## 4. Threat Model Assessment

| Threat | Vector | Mitigated? | Notes |
|--------|--------|-----------|-------|
| Arbitrary file read | `get_completions` with crafted paths | **Partially** | Only directory names exposed, not file contents. Terminal can already read files. |
| Directory enumeration | Absolute paths or `..` traversal in `partial` | **No** | Accepted risk for terminal app. See FINDING-01, -03. |
| Shell injection | Completion results executed as commands | **N/A** | Completions populate the input editor, not executed directly. User must press Enter to execute. |
| Denial of service | Large `partial` parameter or rapid Tab spam | **Partially** | MAX_RESULTS (50) limits per-request. No rate limiting or input length cap. |
| Cache poisoning | Manipulating PATH env to inject malicious command names | **Low risk** | PATH is read from the Tauri process environment, not from user input. Commands are only displayed, not auto-executed. |
| XSS via completion results | Filename containing HTML/script | **Mitigated** | React escapes text content by default. Completions are set as `value` attribute of textarea, not rendered as HTML. |
| Symlink/junction following | `read_dir` on a directory containing symlinks | **Low risk** | `read_dir` lists entries without following symlinks. `file_type()` on entries does follow symlinks, but only to determine dir/file status. |

---

## 5. Positive Security Observations

1. **Read-only operations only**: The new command only lists directory contents and filters commands. No write, execute, or delete operations.
2. **Result limiting**: `MAX_RESULTS = 50` prevents unbounded responses.
3. **Command caching with TTL**: The 30-second cache prevents excessive PATH scanning without serving stale data indefinitely.
4. **Graceful error handling**: Permission denied, non-existent paths, and poisoned mutexes are all handled without panics.
5. **Case-insensitive matching**: Appropriate for Windows filesystem semantics.
6. **No new dependencies**: Attack surface from third-party code unchanged.
7. **spawn_blocking for filesystem I/O**: Prevents blocking the async runtime.
8. **Test coverage**: Both Rust unit tests and frontend tests cover the new functionality.

---

## 6. Recommendations Summary

| ID | Severity | Finding | Recommendation | Priority |
|----|----------|---------|---------------|----------|
| F-01 | Medium | Unrestricted directory enumeration via absolute paths | Consider scoping or logging in future hardening pass | Post-MVP |
| F-02 | Medium | `cwd` parameter not validated | Bind to actual session CWD on Rust side | Post-MVP |
| F-03 | Low | Path traversal via `..` not blocked | Block or canonicalize if scoping is added | Post-MVP |
| F-04 | Low | No input length validation | Add max length checks (4096 chars for paths) | Next sprint |
| F-05 | Info | Poisoned mutex recovery | No action needed | N/A |
| F-06 | Info | Error messages echo user input | Use static error messages | Nice-to-have |

---

## 7. Verdict

**PASS WITH FINDINGS**

The implementation is secure for a terminal application where the user already has full shell access. The findings are defense-in-depth concerns, not exploitable vulnerabilities in the current threat model. The code follows the project's security rules:

- No string interpolation of user input into shell commands (no shell commands at all)
- IPC inputs validated on Rust side (basic validation present)
- No `unwrap()` on user-derived data in production code
- No unsafe blocks

The medium-severity findings (F-01, F-02) relate to directory enumeration capabilities that are inherent to the application's purpose as a terminal. They should be addressed in a future hardening pass if the application's threat model evolves (e.g., if plugins or remote access features are added).

F-04 (input length validation) is the most actionable finding and should be addressed in the next development cycle as a quick win.
