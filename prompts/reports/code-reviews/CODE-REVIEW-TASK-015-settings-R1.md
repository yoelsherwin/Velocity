# Code Review: TASK-015 Settings System + API Key Management (R1)

**Commit**: `3723bf5 feat: add settings system with LLM provider and API key management`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-15
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit introduces the full settings infrastructure for Velocity: a Rust `settings` module with file I/O and validation, two Tauri IPC commands (`get_settings` / `save_app_settings`), a React `SettingsModal` component with provider/API-key/model/endpoint fields, integration into the `TabBar` and `TabManager`, comprehensive frontend unit tests (8 tests), Rust unit tests (8 tests), one E2E test, and associated types and CSS. The implementation is clean and well-structured. However, there are two medium-severity security/correctness issues that warrant changes before merge.

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/Cargo.toml` | MODIFIED: added `reqwest` 0.12 and `dirs` 6 dependencies |
| `src-tauri/Cargo.lock` | MODIFIED: lockfile update (+427 lines) |
| `src-tauri/src/settings/mod.rs` | NEW: `AppSettings` struct, file I/O, validation, 8 unit tests (185 lines) |
| `src-tauri/src/commands/mod.rs` | MODIFIED: added `get_settings` and `save_app_settings` commands |
| `src-tauri/src/lib.rs` | MODIFIED: registered `settings` module and new commands |
| `src/lib/types.ts` | MODIFIED: added `AppSettings`, `LLM_PROVIDERS`, `LlmProviderId` |
| `src/lib/settings.ts` | NEW: IPC wrappers `getSettings()` and `saveSettings()` (10 lines) |
| `src/components/SettingsModal.tsx` | NEW: modal component with form, loading, error handling (203 lines) |
| `src/components/layout/TabBar.tsx` | MODIFIED: added gear icon button with `onOpenSettings` prop |
| `src/components/layout/TabManager.tsx` | MODIFIED: settings modal state and rendering |
| `src/App.css` | MODIFIED: settings button and modal styles (+176 lines) |
| `src/__tests__/SettingsModal.test.tsx` | NEW: 8 unit tests for SettingsModal (172 lines) |
| `src/__tests__/TabBar.test.tsx` | MODIFIED: 1 new test for settings button |
| `e2e/settings.spec.ts` | NEW: 1 E2E test for modal open/close (29 lines) |
| `prompts/tasks/TASK-015-settings-system.md` | NEW: task specification (277 lines) |

---

## Findings

### [F-01] MEDIUM: Settings file written non-atomically -- corruption risk on crash

**File**: `src-tauri/src/settings/mod.rs`, line 54

```rust
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))
}
```

`std::fs::write` truncates the file and then writes the new content. If the process crashes (or the system loses power) between the truncate and the write completing, the settings file will be empty or partially written. On the next launch, `load_settings` will fail with a JSON parse error, and the user loses their API key.

The standard fix is write-to-temp-then-rename (atomic rename). On Windows, `std::fs::rename` is not fully atomic in all cases, but it is far more reliable than truncate-then-write:

```rust
let temp_path = path.with_extension("json.tmp");
std::fs::write(&temp_path, content)
    .map_err(|e| format!("Failed to write settings: {}", e))?;
std::fs::rename(&temp_path, &path)
    .map_err(|e| format!("Failed to finalize settings file: {}", e))?;
```

**Severity**: Medium. This is a data-loss scenario (user's API key gone), though the probability is low for an interactive desktop app that writes settings infrequently.

**Required**: Yes -- implement write-to-temp-then-rename.

---

### [F-02] MEDIUM: Azure endpoint validation accepts `Some("")` (empty string)

**File**: `src-tauri/src/settings/mod.rs`, lines 69-74

```rust
pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    validate_provider(&settings.llm_provider)?;
    if settings.llm_provider == "azure" && settings.azure_endpoint.is_none() {
        return Err("Azure provider requires an endpoint URL".to_string());
    }
    Ok(())
}
```

The validation only checks `is_none()`. A caller can pass `azure_endpoint: Some("")` and it will pass validation. The frontend partially addresses this (line 58 of `SettingsModal.tsx`):

```typescript
azure_endpoint: provider === 'azure' ? azureEndpoint || undefined : undefined,
```

The `azureEndpoint || undefined` coerces empty string to `undefined`, which serializes as the field being absent, so the Rust side receives `None`. This is correct for the normal UI flow. However, `CLAUDE.md` states: "Always validate IPC inputs on the Rust side." A malicious or buggy frontend could bypass the empty-string coercion and send `azure_endpoint: ""` directly via IPC. The Rust validation should be the authoritative guard.

**Severity**: Medium. Violates the project's security rule about Rust-side validation being authoritative.

**Required**: Yes -- add an empty-string check in `validate_settings`:

```rust
if settings.llm_provider == "azure" {
    match &settings.azure_endpoint {
        None => return Err("Azure provider requires an endpoint URL".to_string()),
        Some(ep) if ep.trim().is_empty() => {
            return Err("Azure endpoint URL cannot be empty".to_string())
        }
        _ => {}
    }
}
```

---

### [F-03] LOW: No validation of `model` or `api_key` on Rust side

**File**: `src-tauri/src/settings/mod.rs`

The `validate_settings` function validates `llm_provider` and `azure_endpoint`, but performs no validation on `model` or `api_key`. An empty `api_key` is saved without complaint, and any arbitrary `model` string is accepted.

For `api_key`, this is arguably acceptable -- the user may want to save provider/model settings before they have a key. However, `model` is completely unvalidated. A malicious IPC call could store arbitrary data in the `model` field that could later be sent to an LLM API endpoint.

**Severity**: Low. The `model` string will be sent as a request parameter to LLM APIs (in TASK-016). If the API rejects it, the user gets an error. No code execution risk. The current scope is MVP-appropriate.

**Recommendation**: Consider adding a maximum length check on `model` and `api_key` (e.g., 512 bytes) to prevent abuse, but this is not blocking.

---

### [F-04] LOW: `settings_path()` called on every load/save -- no caching

**File**: `src-tauri/src/settings/mod.rs`

Both `load_settings()` and `save_settings()` call `settings_path()`, which calls `dirs::data_local_dir()` and `std::fs::create_dir_all()` on every invocation. For a setting that changes infrequently, this is negligible overhead, but `create_dir_all` performs a syscall every time.

**Severity**: Low. No functional impact. Settings are loaded/saved rarely (once on modal open, once on save).

**Recommendation**: No action needed for MVP.

---

### [F-05] LOW: No Escape key handler to close modal

**File**: `src/components/SettingsModal.tsx`

The modal can be closed by clicking Cancel or clicking the overlay, but pressing Escape does nothing. This is a standard modal UX pattern that users will expect.

**Severity**: Low. UX polish, not a functional bug.

**Recommendation**: Add a `useEffect` that listens for Escape keydown and calls `onClose()`.

---

### [F-06] GOOD: Async effect cleanup in SettingsModal

**File**: `src/components/SettingsModal.tsx`, lines 20-38

```typescript
useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        // ...
      })
      .catch((err) => {
        if (cancelled) return;
        // ...
      });
    return () => {
      cancelled = true;
    };
  }, []);
```

Proper cleanup flag to prevent state updates after unmount. This avoids React "state update on unmounted component" warnings. Correct pattern.

---

### [F-07] GOOD: Provider change resets model to provider's default

**File**: `src/components/SettingsModal.tsx`, lines 43-49

```typescript
const handleProviderChange = (newProvider: LlmProviderId) => {
    setProvider(newProvider);
    const config = LLM_PROVIDERS.find((p) => p.id === newProvider);
    if (config) {
      setModel(config.defaultModel);
    }
};
```

When the user changes providers, the model dropdown resets to the new provider's default model instead of showing a stale model from the previous provider. This prevents the user from accidentally saving an OpenAI model with an Anthropic API key.

---

### [F-08] GOOD: Tauri command correctness -- validation before persistence

**File**: `src-tauri/src/commands/mod.rs`, lines 111-115

```rust
#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    settings::validate_settings(&settings)?;
    settings::save_settings(&settings)
}
```

Validation runs before `save_settings`, so invalid data never reaches disk. The `?` operator correctly propagates the validation error to the frontend as a `String` error. The command is `async` (required by Tauri v2 for IPC commands).

---

### [F-09] GOOD: `onOpenSettings` is optional in TabBar props

**File**: `src/components/layout/TabBar.tsx`, line 9

```typescript
onOpenSettings?: () => void;
```

The `onOpenSettings` prop is optional (`?`), which means existing tests that render `<TabBar>` without this prop continue to compile. The gear button calls `onClick={onOpenSettings}`, which is a no-op when `undefined` (clicking a button with `onClick={undefined}` does nothing). This is correct.

---

### [F-10] GOOD: `LLM_PROVIDERS` as `const` ensures type safety

**File**: `src/lib/types.ts`, lines 42-48

```typescript
export const LLM_PROVIDERS = [
  { id: 'openai', ... },
  { id: 'anthropic', ... },
  { id: 'google', ... },
  { id: 'azure', ... },
] as const;

export type LlmProviderId = typeof LLM_PROVIDERS[number]['id'];
```

Using `as const` narrows the `id` fields to literal types, and `LlmProviderId` is derived as `'openai' | 'anthropic' | 'google' | 'azure'`. This ensures the TypeScript type and the runtime data are always in sync. If a developer adds a new provider to the array, the union type automatically expands. Clean.

---

### [F-11] GOOD: API key field uses `type="password"` with show/hide toggle

**File**: `src/components/SettingsModal.tsx`, lines 120-138

The API key input defaults to `type="password"` (masked), with an explicit toggle button to reveal. Combined with `autoComplete="off"`, this prevents shoulder-surfing and browser autofill of the API key. The test `test_api_key_show_hide_toggle` verifies the toggle behavior.

---

### [F-12] GOOD: Overlay click-to-close with correct target check

**File**: `src/components/SettingsModal.tsx`, lines 70-74

```typescript
const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
};
```

The `e.target === e.currentTarget` check ensures that clicking inside the dialog (which is a child of the overlay) does not close the modal. Only clicks directly on the overlay background close it. Standard and correct.

---

### [F-13] OBSERVATION: `reqwest` 0.12 added as dependency for future use

**File**: `src-tauri/Cargo.toml`

```toml
reqwest = { version = "0.12", features = ["json"] }
```

The task spec notes: "reqwest is added now so the Cargo.lock is updated, but it won't be used until TASK-016." This adds ~427 lines to `Cargo.lock` and pulls in `native-tls`, `hyper`, `h2`, `ring`, `rustls`, etc. This is a large dependency tree for something not used in this commit.

**Severity**: Observation. The task spec explicitly requested this, and it was needed for TASK-016 which has already landed (commit `eb32401`). No action needed.

---

### [F-14] OBSERVATION: Plaintext API key storage -- acceptable for MVP

**File**: `src-tauri/src/settings/mod.rs`

API keys are stored in plaintext JSON at `%LOCALAPPDATA%\Velocity\settings.json`. The task spec acknowledges this: "This is the same approach as VS Code, Warp, and most desktop apps. For MVP this is acceptable."

The file inherits the user's default directory permissions. On Windows, `%LOCALAPPDATA%` is user-scoped and not readable by other users. No additional file permission restrictions are applied (e.g., no `SetFileAttributesW` to add `FILE_ATTRIBUTE_HIDDEN` or tighten ACLs).

**Severity**: Observation. Acceptable for MVP. A future task should integrate with Windows Credential Manager for production.

---

### [F-15] GOOD: Rust test coverage is thorough

The Rust module contains 8 tests covering:
- Default settings values
- Serialization round-trip (both with and without Azure endpoint)
- Provider validation (rejects invalid, accepts all valid)
- Azure endpoint requirement (missing endpoint fails, present endpoint passes)
- Invalid provider through full `validate_settings` path
- Non-Azure provider ignores endpoint

The tests do NOT exercise `load_settings`/`save_settings` (file I/O), which is reasonable -- those are thin wrappers over `serde_json` and `std::fs`, and testing them would require temp directory setup (or mocking the filesystem). The validation logic, which is the critical business logic, is well-covered.

---

### [F-16] GOOD: Frontend test quality

8 frontend tests cover:
- Form rendering (all elements present)
- Settings loading from IPC (pre-filled form)
- Save calls IPC with correct payload
- Azure provider shows endpoint input
- Cancel calls `onClose`
- API key defaults to password type
- Show/hide toggle works
- Provider change updates model options

The mock strategy (hoisting mock functions, using `vi.mock` with factory) is clean. The import of `SettingsModal` after `vi.mock` is correct for Vitest module mocking.

---

## Required Changes

| ID | Severity | Description |
|----|----------|-------------|
| F-01 | Medium | Implement atomic write (write-to-temp-then-rename) in `save_settings` to prevent settings file corruption on crash |
| F-02 | Medium | Add empty-string validation for `azure_endpoint` in `validate_settings` -- `Some("")` should be rejected |

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-03 | Low | Consider adding max-length validation on `model` and `api_key` fields |
| F-05 | Low | Add Escape key handler to close the settings modal |

---

## Test Assessment

| Suite | Tests | Notes |
|-------|-------|-------|
| `src-tauri/src/settings/mod.rs` | 8 | Default values, serialization, provider validation, Azure endpoint |
| `src/__tests__/SettingsModal.test.tsx` | 8 | Form rendering, loading, save IPC, Azure endpoint, cancel, password toggle, provider switch |
| `src/__tests__/TabBar.test.tsx` | 1 new | Settings button exists and fires callback |
| `e2e/settings.spec.ts` | 1 | Modal open/close via gear icon |

Total: 18 new tests. Coverage is comprehensive for the feature scope.

**Missing test coverage** (not blocking):
- No test for error display when `getSettings()` fails (the error UI code exists but is untested)
- No test for error display when `saveSettings()` rejects (backend validation error shown in modal)
- No test for overlay click-to-close behavior
- No Rust test for `save_settings`/`load_settings` file I/O round-trip (acceptable, see F-15)
- The new `validate_settings` check for `Some("")` (from F-02) will need a corresponding Rust test

---

## Verdict: NEEDS CHANGES

Two medium-severity issues require attention before merge:

1. **F-01**: Non-atomic file write risks settings corruption on crash. Implement write-to-temp-then-rename.
2. **F-02**: Azure endpoint validation accepts empty strings via IPC, violating the project's Rust-side validation rule. Add empty-string check.

The overall implementation quality is high -- the code is well-organized, the frontend is properly reactive, the Tauri commands follow established patterns, and the test coverage is thorough. Once the two required changes are addressed, this is ready to merge.
