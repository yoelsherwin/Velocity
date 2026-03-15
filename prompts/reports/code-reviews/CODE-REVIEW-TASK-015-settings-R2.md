# Code Review: TASK-015 Settings + TASK-016 LLM Client Fix (R2)

**Commit**: `3682504 fix: atomic settings write, API key redaction, URL validation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-15
**Verdict**: **APPROVE**

---

## Scope

This R2 review evaluates the fix commit `3682504` which addresses required changes from two R1 reviews:

- **CODE-REVIEW-TASK-015-settings-R1**: F-01 (atomic write), F-02 (Azure empty endpoint)
- **CODE-REVIEW-TASK-016-llm-client-R1**: F-01 (API key in Google URL error path), F-02 (model/endpoint URL injection)

---

## Previous Round Resolution

### F-01 (TASK-015): Non-atomic settings file write -- RESOLVED

**R1 finding**: `std::fs::write` truncates then writes, risking corruption on crash.

**Fix applied** (`src-tauri/src/settings/mod.rs`, lines 49-60):

```rust
/// Persists settings to disk as pretty-printed JSON.
/// Uses atomic write (write to .tmp then rename) to prevent corruption on crash.
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize settings file: {}", e))
}
```

**Assessment**: Correctly implements write-to-temp-then-rename. The temp file uses `.json.tmp` extension in the same directory, so the rename is same-filesystem (required for atomic rename semantics). Error messages for both the write and rename steps are distinct, aiding debugging. The doc comment is updated to document the atomic write strategy. **PASS**.

---

### F-02 (TASK-015): Azure endpoint validation accepts `Some("")` -- RESOLVED

**R1 finding**: `validate_settings` only checked `is_none()`, allowing `Some("")` through.

**Fix applied** (`src-tauri/src/settings/mod.rs`, lines 70-85):

```rust
pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    validate_provider(&settings.llm_provider)?;
    if settings.llm_provider == "azure" {
        match &settings.azure_endpoint {
            None => return Err("Azure provider requires an endpoint URL".to_string()),
            Some(ep) if ep.trim().is_empty() => {
                return Err("Azure endpoint cannot be empty".to_string())
            }
            _ => {}
        }
    }
    Ok(())
}
```

**Assessment**: The `match` pattern handles three cases cleanly: `None`, `Some("")` / `Some("   ")` (whitespace-only via `trim()`), and valid endpoints. The `ep.trim().is_empty()` check is more thorough than a bare `ep.is_empty()` because it also catches whitespace-only strings. Two new unit tests cover both empty-string and whitespace-only cases. **PASS**.

---

### F-01 (TASK-016): Google API key leak in error messages -- RESOLVED

**R1 finding**: reqwest error messages may include the full Google URL (with API key in query string) when HTTP requests fail.

**Fix applied** (`src-tauri/src/llm/mod.rs`, lines 83-90):

```rust
fn sanitize_error(error: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return error.to_string();
    }
    error.replace(api_key, "[REDACTED]")
}
```

Applied consistently to ALL four provider functions (OpenAI, Anthropic, Google, Azure) across all three error paths per provider:
1. HTTP request failure (`send().await.map_err(...)`)
2. Response parse failure (`json().await.map_err(...)`)
3. API error response (`!status.is_success()`)

That is 12 error paths total, all sanitized. This is defense-in-depth -- while only Google embeds the key in the URL, other providers could theoretically leak keys through redirect URLs or error bodies.

**Assessment**: The implementation is simple and correct. `String::replace` handles multiple occurrences. The empty-key early return avoids replacing empty strings (which would be a no-op in `replace` but the early return is clearer). Three dedicated unit tests cover: single occurrence redaction, empty key passthrough, and multiple occurrence redaction. **PASS**.

---

### F-02 (TASK-016): Model/endpoint URL injection -- RESOLVED

**R1 finding**: `model` and `azure_endpoint` interpolated into URLs without sanitization.

**Fix applied** -- two complementary defenses:

1. **Model validation** (`src-tauri/src/llm/mod.rs`, lines 94-102):

```rust
fn validate_model_for_url(model: &str) -> Result<(), String> {
    if model.is_empty() {
        return Err("Model name cannot be empty".to_string());
    }
    if model.contains('?') || model.contains('#') || model.contains('&') {
        return Err("Model name contains invalid URL characters".to_string());
    }
    Ok(())
}
```

2. **URL encoding** for model in path segments (applied to both Google and Azure):

```rust
validate_model_for_url(model)?;
let encoded_model = url_encode(model);
```

3. **Azure endpoint validation** (lines 308-310):

```rust
if endpoint.contains('?') || endpoint.contains('#') {
    return Err("Azure endpoint must not contain query parameters or fragments".to_string());
}
```

**Assessment**: The approach uses belt-and-suspenders: validate first (reject known-bad characters), then encode regardless. The `urlencoding` crate (v2.1.3) is a well-known, minimal dependency (one file, no transitive dependencies). `validate_model_for_url` is called for Google and Azure (the two providers that interpolate model into URLs), but not OpenAI or Anthropic (where model goes into the JSON body, not the URL). This is correct scoping. Three unit test groups cover: normal model names accepted, query-injection characters rejected, empty model rejected. Two async integration tests verify Azure endpoint rejection with query params and fragments. **PASS**.

---

## New Code Analysis

### [N-01] GOOD: `sanitize_error` applied uniformly to all providers

The developer could have applied key redaction only to Google (where the URL leak was identified). Instead, they applied it to all 12 error paths across all 4 providers. This is the correct security posture -- defense in depth. If a future provider change introduces a URL-based auth pattern, the sanitization is already in place.

---

### [N-02] GOOD: `validate_model_for_url` does not over-restrict

The validation rejects only `?`, `#`, and `&` -- characters that can alter URL structure. It accepts dots (needed for `gemini-2.0-flash`), hyphens, colons (if any model uses them), and other benign characters. Combined with `url_encode`, this provides safe handling of model names containing spaces or special characters without breaking legitimate model identifiers.

---

### [N-03] GOOD: Test coverage for fix items is thorough

New tests added in this commit:

| Suite | Test | Verifies |
|-------|------|----------|
| `settings::tests` | `test_azure_endpoint_rejects_empty_string` | `Some("")` rejected |
| `settings::tests` | `test_azure_endpoint_rejects_whitespace_only` | `Some("   ")` rejected |
| `llm::tests` | `test_sanitize_error_redacts_key` | Single key occurrence redacted |
| `llm::tests` | `test_sanitize_error_empty_key_passthrough` | Empty key = no replacement |
| `llm::tests` | `test_sanitize_error_multiple_occurrences` | All occurrences redacted |
| `llm::tests` | `test_validate_model_for_url_accepts_normal` | 3 real model names pass |
| `llm::tests` | `test_validate_model_for_url_rejects_query_chars` | `?`, `#`, `&` rejected |
| `llm::tests` | `test_validate_model_for_url_rejects_empty` | Empty string rejected |
| `llm::tests` | `test_azure_endpoint_rejects_query_params` | `?foo=bar` in endpoint rejected |
| `llm::tests` | `test_azure_endpoint_rejects_fragment` | `#frag` in endpoint rejected |

10 new tests. All directly test the specific fix behaviors. The Azure endpoint integration tests exercise the full `translate_command` path (not just the validator), confirming the validation is actually wired into the call chain.

---

### [N-04] OBSERVATION: `validate_model_for_url` does not reject `/` (path traversal)

The R1 finding mentioned path traversal (`../../../admin`) as a concern. The validation rejects `?`, `#`, `&` but not `/`. A model name like `models/../admin` would pass validation. However, `url_encode` handles this correctly -- `/` is encoded as `%2F`, so the resulting URL path would contain a literal `%2F` rather than a path separator. The URL encoding is the actual defense here; the validation is an additional belt. No action required.

---

### [N-05] OBSERVATION: `STATE.md` cleanup is significant but benign

The diff includes a substantial rewrite of `prompts/STATE.md` -- condensing bug descriptions to IDs only, simplifying the pillar status table, removing notes, and adding the Pillar 5 plan. This is housekeeping, not functional code. The condensed format is more maintainable. No concerns.

---

## Low-Severity Items from R1 -- Status Check

| R1 ID | Description | Status in Fix |
|-------|-------------|---------------|
| TASK-015 F-03 | Max-length validation on model/api_key | Not addressed (optional, acceptable) |
| TASK-015 F-05 | Escape key to close modal | Not addressed (optional, acceptable) |
| TASK-016 F-08 | Azure endpoint `?`/`#` rejection | **Addressed** in this fix (promoted from optional to implemented) |
| TASK-016 F-09 | Sanitize provider error messages | **Addressed** via `sanitize_error` on all provider error paths |

Two of the four optional items from R1 were addressed in this fix. The remaining two (max-length validation, Escape key) remain optional and do not affect the verdict.

---

## Test Assessment

| Suite | New Tests | Existing Tests | Status |
|-------|-----------|----------------|--------|
| `settings::tests` | +2 | 8 | 10 total |
| `llm::tests` | +8 | 8 | 16 total |
| Frontend (Vitest) | 0 | unchanged | No frontend changes in this commit |

All new tests directly cover the fix behaviors with clear assertion messages. No existing tests were modified, indicating no regressions in behavior.

---

## Security Assessment

| Concern | R1 Status | R2 Status | Notes |
|---------|-----------|-----------|-------|
| API key in error messages | FAIL | **PASS** | `sanitize_error` applied to all 12 error paths |
| URL injection via model | FAIL | **PASS** | `validate_model_for_url` + `url_encode` |
| URL injection via Azure endpoint | PARTIAL | **PASS** | HTTPS check + `?`/`#` rejection |
| Azure empty endpoint bypass | FAIL | **PASS** | `trim().is_empty()` check in `validate_settings` |
| Atomic settings persistence | FAIL | **PASS** | Write-to-temp-then-rename |
| API key in HTTP headers | PASS | PASS | Unchanged |
| No logging of secrets | PASS | PASS | Unchanged |

---

## Verdict: APPROVE

All four required changes from the R1 reviews (TASK-015 F-01, F-02; TASK-016 F-01, F-02) are correctly implemented with appropriate test coverage. The fix is well-scoped -- it addresses exactly what was requested, applies defense-in-depth where appropriate (sanitizing all providers, not just Google), and adds 10 targeted tests. No new issues introduced.

The TASK-015 settings system and TASK-016 LLM client are now clear from a code review perspective.
