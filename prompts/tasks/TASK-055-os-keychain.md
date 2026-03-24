# Task 055: OS Keychain for API Key Storage (SEC-015-H1)

## Context
API keys are currently stored in plaintext in `settings.json`. This is a security risk — any program with file access can read them. This task moves API key storage to the OS credential manager (Windows Credential Manager).

## Requirements
### Backend (Rust).

1. **Add `keyring` crate**: `keyring = "3"` in Cargo.toml. This provides cross-platform access to OS credential stores (Windows Credential Manager, macOS Keychain, Linux Secret Service).

2. **Store API key in keychain**:
```rust
use keyring::Entry;

fn store_api_key(provider: &str, key: &str) -> Result<(), String> {
    let entry = Entry::new("velocity", &format!("api-key-{}", provider))
        .map_err(|e| e.to_string())?;
    entry.set_password(key).map_err(|e| e.to_string())?;
    Ok(())
}

fn get_api_key(provider: &str) -> Result<Option<String>, String> {
    let entry = Entry::new("velocity", &format!("api-key-{}", provider))
        .map_err(|e| e.to_string())?;
    match entry.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

fn delete_api_key(provider: &str) -> Result<(), String> {
    let entry = Entry::new("velocity", &format!("api-key-{}", provider))
        .map_err(|e| e.to_string())?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}
```

3. **Migration**: On `load_settings()`, if `api_key` field is non-empty in the JSON file, migrate it to the keychain and clear the field in the file. This is a one-time migration.

4. **Update settings flow**:
   - `save_app_settings`: Store API key in keychain, save settings JSON WITHOUT the key
   - `get_settings`: Load settings JSON, fetch API key from keychain, merge into returned settings
   - The frontend never knows the key is stored differently — same `AppSettings` type

5. **Fallback**: If keychain is unavailable (locked, not supported), fall back to plaintext with a warning log.

6. **Update LLM calls**: `translate_command`, `classify_intent_llm`, `suggest_fix` all call `load_settings()` which should now include the keychain key.

## Tests
### Rust
- [ ] `test_keychain_store_and_retrieve`: Store key, retrieve it, verify match.
- [ ] `test_keychain_delete`: Store key, delete it, verify gone.
- [ ] `test_migration_from_plaintext`: Settings with plaintext key → migrated to keychain, JSON cleared.
- [ ] `test_settings_load_merges_keychain`: load_settings returns key from keychain.
- [ ] `test_fallback_on_keychain_error`: Keychain failure → graceful fallback.

### Frontend
- [ ] `test_api_key_save_still_works`: Saving API key in settings modal still works (backend handles keychain transparently).

## Files to Read First
- `src-tauri/src/settings/mod.rs` — Settings storage, load/save
- `src-tauri/src/llm/mod.rs` — Where API keys are used
- `src-tauri/src/commands/mod.rs` — Settings commands
- `src-tauri/Cargo.toml` — Dependencies

## Acceptance Criteria
- [ ] API keys stored in OS keychain, not plaintext JSON
- [ ] One-time migration from plaintext to keychain
- [ ] Graceful fallback if keychain unavailable
- [ ] Frontend unchanged (transparent backend change)
- [ ] Settings JSON no longer contains API key after migration
- [ ] All tests pass
- [ ] Commit: `feat: store API keys in OS keychain instead of plaintext`
