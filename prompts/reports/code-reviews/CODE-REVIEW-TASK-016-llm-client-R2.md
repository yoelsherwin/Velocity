# Code Review: TASK-016 Multi-Provider LLM Client (R2 -- Fix Commit)

**Commit**: `3682504 fix: atomic settings write, API key redaction, URL validation`
**Base commit (R1)**: `eb32401 feat: add multi-provider LLM client for command translation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-15
**Verdict**: **APPROVE**

---

## Previous Round Resolution

### F-01 (BLOCK): Google Gemini API key exposed in error messages

**Status**: RESOLVED

The fix introduces `sanitize_error(error, api_key)` which calls `str::replace(api_key, "[REDACTED]")` on all error strings before they propagate to the frontend. The function is applied uniformly to every error path across all four providers (OpenAI, Anthropic, Google, Azure) -- not just Google. This is defense-in-depth: even though only Google places the key in the URL, header-based providers could theoretically have the key reflected in server error messages, and those are now redacted too.

The implementation is clean:
- Line 85-90: `sanitize_error` handles the empty-key edge case (returns unchanged).
- `String::replace` replaces all occurrences, not just the first (verified by `test_sanitize_error_multiple_occurrences`).
- Three unit tests cover: single occurrence, empty key passthrough, and multiple occurrences.
- All 12 error `map_err` paths and all 4 API-error `return Err` paths now wrap through `sanitize_error`.

No remaining leak vectors identified.

### F-02 (MEDIUM): URL injection via `model` and `azure_endpoint`

**Status**: RESOLVED

Two-layer fix applied:

1. **`validate_model_for_url(model)`** (lines 94-102): Rejects empty models and models containing `?`, `#`, or `&`. Called before URL construction in both `call_google` and `call_azure`. Three unit tests cover valid models, invalid characters, and empty string.

2. **`url_encode(model)`** via `urlencoding::encode` (lines 249, 313): The model is percent-encoded before interpolation into the URL path, so even if a model name contains `/` or other path-breaking characters, the URL structure remains intact. The `urlencoding` crate (v2.1.3) is a zero-dependency, well-established crate.

3. **Azure endpoint query/fragment rejection** (lines 308-309): Endpoints containing `?` or `#` are now rejected before URL construction, preventing query parameter injection. Two integration-style tests (`test_azure_endpoint_rejects_query_params`, `test_azure_endpoint_rejects_fragment`) validate this through the full `translate_command` call path.

---

## Additional Changes in Fix Commit

### Atomic settings write (`settings/mod.rs`)

The `save_settings` function now writes to a `.tmp` file and then renames it to the target path (lines 55-59). This is a standard atomic-write pattern that prevents a crash mid-write from corrupting the settings file. On Windows, `std::fs::rename` is atomic when source and destination are on the same volume, and since both paths are under `%LOCALAPPDATA%/Velocity/`, this holds.

**Assessment**: Good hardening. One minor note: on Windows, `std::fs::rename` will fail if the destination file is open by another process (unlike POSIX `rename`). This is acceptable because Velocity is the only consumer of this file.

### Azure empty endpoint validation (`settings/mod.rs`)

The `validate_settings` function now rejects `Some("")` and `Some("   ")` (whitespace-only) Azure endpoints (lines 75-83). Previously, `Some("")` would pass validation but then fail at the HTTPS check in `call_azure` with a confusing error. The new validation provides a clear error message earlier in the pipeline. Two new tests cover this.

**Assessment**: Good improvement. Fails fast with a descriptive message.

### STATE.md cleanup

The `STATE.md` file was significantly trimmed, consolidating verbose descriptions into concise references. This is a housekeeping change that does not affect functionality.

---

## Findings

### [F-01] OBSERVATION: `validate_model_for_url` does not block `/` characters

The R1 review mentioned `../../../admin` as a path traversal concern. The current `validate_model_for_url` blocks `?`, `#`, and `&` but not `/`. However, this is mitigated by the `url_encode` call that follows, which percent-encodes `/` to `%2F`, making path traversal impossible. The two-layer approach (reject structure-breaking chars + encode everything) is actually stronger than a deny-list alone.

**Severity**: Observation (no action needed). The `url_encode` layer handles this.

### [F-02] OBSERVATION: `sanitize_error` uses simple string replacement

The `sanitize_error` function uses `str::replace`, which is a literal substring match. If the API key contained regex-special or format-string-special characters, this would still work correctly because `replace` is not regex-based. The only theoretical edge case is an API key that is a substring of another word in the error message, which would result in over-redaction (e.g., key "error" would redact the word "error" in the message). In practice, API keys are sufficiently long and random that this is a non-issue.

**Severity**: Observation (no action needed).

### [F-03] OBSERVATION: `validate_model_for_url` error messages do not include the offending value

When model validation fails, the error message says "Model name contains invalid URL characters" without showing which characters were problematic. This is actually good from a security perspective (avoids reflecting potentially crafted input), but could make debugging harder for users who misconfigure their model name.

**Severity**: Observation (no action needed, current behavior is acceptable).

---

## Test Assessment

### New Tests Added (This Fix)

| Test | Location | What it verifies |
|------|----------|-----------------|
| `test_sanitize_error_redacts_key` | `llm::tests` | API key in error string is replaced with [REDACTED] |
| `test_sanitize_error_empty_key_passthrough` | `llm::tests` | Empty key does not corrupt error message |
| `test_sanitize_error_multiple_occurrences` | `llm::tests` | All instances of key are redacted, not just the first |
| `test_validate_model_for_url_accepts_normal` | `llm::tests` | Standard model names pass validation |
| `test_validate_model_for_url_rejects_query_chars` | `llm::tests` | `?`, `#`, `&` in model names are rejected |
| `test_validate_model_for_url_rejects_empty` | `llm::tests` | Empty model name is rejected |
| `test_azure_endpoint_rejects_query_params` | `llm::tests` | Azure endpoint with `?` is rejected (full call path) |
| `test_azure_endpoint_rejects_fragment` | `llm::tests` | Azure endpoint with `#` is rejected (full call path) |
| `test_azure_endpoint_rejects_empty_string` | `settings::tests` | `Some("")` Azure endpoint fails validation |
| `test_azure_endpoint_rejects_whitespace_only` | `settings::tests` | `Some("   ")` Azure endpoint fails validation |

### Full Test Results

| Suite | Tests | Status |
|-------|-------|--------|
| Rust unit tests | 63 passed, 1 ignored | PASS |
| Rust integration tests | 10 passed | PASS |
| Vitest (frontend) | 170 passed (18 files) | PASS |
| **Total** | **243 (+ 1 ignored)** | **ALL PASS** |

Test coverage for the fix is thorough. Every new function (`sanitize_error`, `validate_model_for_url`) has dedicated tests, and the Azure endpoint validation is tested both at the settings layer and through the full LLM call path.

---

## Security Assessment (Fix-Specific)

| Concern | R1 Status | R2 Status | Notes |
|---------|-----------|-----------|-------|
| API key in error messages | FAIL | **PASS** | `sanitize_error` applied to all 16 error paths across 4 providers |
| URL injection via `model` | FAIL | **PASS** | `validate_model_for_url` + `url_encode` on Google and Azure paths |
| URL injection via `azure_endpoint` | PARTIAL | **PASS** | HTTPS check + `?`/`#` rejection |
| Settings file corruption | N/A | **PASS** | Atomic write via tmp+rename |
| Azure empty endpoint bypass | N/A | **PASS** | Empty/whitespace now rejected at validation |

---

## Verdict: APPROVE

All blocking and medium-severity findings from R1 are fully resolved:

- **F-01 (API key in errors)**: Fixed with `sanitize_error` applied uniformly across all providers, with three unit tests.
- **F-02 (URL injection)**: Fixed with `validate_model_for_url` + `url_encode` for model names, and `?`/`#` rejection for Azure endpoints, with seven tests across both layers.

The fix also includes two bonus improvements (atomic settings write, empty endpoint rejection) that strengthen the codebase beyond what was strictly required. The `urlencoding` dependency is minimal (zero transitive dependencies) and appropriate.

No new blocking, medium, or low-severity issues identified. Ready for security review and QA.
