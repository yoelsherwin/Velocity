# Code Review: TASK-055 — OS Keychain for API Keys

**Reviewer**: Claude (Security-focused review)
**Commit**: `40dd84a`
**Date**: 2026-03-24
**Verdict**: APPROVE WITH FINDINGS (2 medium, 2 low severity)

---

## Summary

This commit moves API key storage from plaintext in `settings.json` to the Windows Credential Manager via the `keyring` crate (v3, `windows-native` feature). It includes:

1. Three keychain primitives: `store_api_key`, `get_api_key`, `delete_api_key`
2. One-time migration: `migrate_api_key_to_keychain` detects plaintext keys in JSON on load and moves them to the keychain
3. `save_settings` now always strips `api_key` before writing JSON to disk
4. New `save_settings_with_key` stores the key in the keychain FIRST, then calls `save_settings` (which writes JSON without the key)
5. Graceful fallback: if keychain is unavailable, `save_settings_with_key` falls back to plaintext (with `eprintln` warning)
6. 7 new unit tests covering store/retrieve/delete/migration/strip behaviors
7. All 172 unit tests + 11 integration tests pass

---

## Security Checklist

### 1. API Keys Removed from settings.json After Migration — PASS

`save_settings` (line 184-196) clones settings, clears `api_key`, and writes the sanitized clone. This is defense-in-depth — even if `save_settings` is called directly with a populated `api_key`, the JSON file will never contain it.

`migrate_api_key_to_keychain` (line 40-67) stores in keychain first, then calls `save_settings` with the key cleared to flush the JSON file.

### 2. Keychain Calls Are Correct — PASS

- Uses `keyring::Entry::new("velocity", "api-key-{provider}")` — correct service/user pattern
- `set_password` for store, `get_password` for retrieve, `delete_credential` for delete
- `NoEntry` is handled gracefully (returns `None` for get, succeeds silently for delete)
- `keyring` v3 with `windows-native` feature uses Windows Credential Manager (DPAPI-backed)

### 3. Fallback Does NOT Silently Leak Keys — PASS (with caveat)

- When keychain is unavailable during `save_settings_with_key`, the fallback writes the key in plaintext to JSON and logs a warning via `eprintln`
- When keychain is unavailable during migration, the key is left in plaintext (existing behavior, not a regression)
- The `eprintln` warnings are only visible in dev mode — **see Finding M1**

### 4. save_settings_with_key Stores in Keychain BEFORE Clearing from JSON — PASS

Lines 201-217: `store_api_key` is called first. Only on success does execution flow to `save_settings` (which strips the key). On keychain failure, the fallback path writes the full settings including key. No data loss path exists.

### 5. No Race Conditions in Migration — PASS (with caveat)

Migration flow: keychain write -> JSON write -> restore in-memory key. If the process crashes between keychain write and JSON write, the key exists in both locations. On next load, `load_settings` detects the non-empty `api_key` in JSON and re-runs migration, which is idempotent. **See Finding M2 for a subtle issue.**

---

## Findings

### M1 (Medium): Fallback warnings are invisible to users

**Location**: Lines 59-63 (`migrate_api_key_to_keychain`), line 205 (`save_settings_with_key`)

When the keychain is unavailable and the fallback writes keys in plaintext, warnings are sent to `eprintln`. In a Tauri release build, stderr is not visible to the user. The user has no way to know their key is stored insecurely.

**Recommendation**: Return a structured response that the frontend can display as a warning toast, e.g. `Ok(SaveResult::FallbackPlaintext)` or propagate the warning string through IPC. At minimum, log to a file.

### M2 (Medium): Provider-key binding creates orphaned keychain entries

**Location**: Lines 165, 202

Keys are stored under `api-key-{provider}`. When a user:
1. Saves an OpenAI key (stored as `api-key-openai`)
2. Switches to Anthropic and saves a new key (stored as `api-key-anthropic`)
3. Switches back to OpenAI

Step 3 works correctly — `load_settings` fetches `api-key-openai` from the keychain. However:

- When `save_settings_with_key` is called with an empty `api_key` (line 218-221), it only deletes the key for the *current* provider. Old provider keys remain in the keychain forever.
- There is no "clear all keys" or "list keys" functionality.

This is not a security vulnerability per se (orphaned keys are still protected by DPAPI), but it is a data hygiene issue. Users who cycle through providers will accumulate stale credentials.

**Recommendation**: Consider adding a cleanup function that removes keys for all known providers, or track which providers have stored keys in the JSON settings.

### L1 (Low): Migration test does not verify JSON file is actually cleared

**Location**: Test `test_migration_from_plaintext` (line 978-1008)

The test creates a temp directory and a settings file, but `migrate_api_key_to_keychain` calls `save_settings` which writes to `settings_path()` (the real AppData path), not the temp file. The test verifies the keychain state and in-memory state, but never reads back the real JSON file to confirm the plaintext key was removed.

**Recommendation**: After calling `migrate_api_key_to_keychain`, read the file at `settings_path()` and assert `api_key` is empty. This is partially covered by `test_save_settings_strips_api_key_from_json`, but the migration-specific path should also verify the end-to-end result.

### L2 (Low): `api_key` field still present in JSON (as empty string)

**Location**: Line 188 (`disk_settings.api_key = String::new()`)

The `api_key` field still appears in `settings.json` as `"api_key": ""`. While it contains no secret, it is a vestigial field that:
- Signals to anyone reading the file that an API key concept exists
- Could cause confusion about where the key actually lives

**Recommendation**: Consider using `#[serde(skip_serializing_if = "String::is_empty")]` on the `api_key` field to omit it entirely from JSON output when empty. This also provides backward compatibility — `serde(default)` on deserialization handles the missing field.

---

## Test Results

```
test result: ok. 172 passed; 0 failed; 1 ignored; 0 measured
test result: ok. 11 passed; 0 failed; 0 ignored (integration)
```

Doc-tests fail due to a pre-existing issue (missing `regex` crate for `danger.rs`) — unrelated to this task.

---

## Code Quality Notes

- Atomic write pattern (write .tmp then rename) is preserved — good
- `keyring` v3 with `windows-native` uses Windows Credential Manager — appropriate for the target platform
- The `zeroize` dependency in `keyring`'s Cargo.lock suggests credentials are zeroed from memory after use — good
- No `unwrap()` on user-derived data — compliant with security rules
- Error messages do not leak the actual key value — good

---

## Verdict

**APPROVE** — The core security objective is met: API keys are stored in the OS keychain instead of plaintext JSON, migration is correct and idempotent, and the fallback path does not silently lose keys. The two medium findings (invisible fallback warnings, orphaned keychain entries) should be addressed in a follow-up task but are not blockers.
