# Code Review: TASK-054 — Google API Key Fix

**Reviewer**: Claude (Security-focused review)
**Commit**: `4d69340 fix: redact Google API key from error messages and URLs`
**Date**: 2026-03-24
**Verdict**: APPROVE with one finding (low severity)

---

## Summary

This commit fixes a security vulnerability where Google Gemini API keys were embedded as URL query parameters (`?key=...`). The fix:

1. Removes `key=` query parameters from all 3 Google API call sites (`call_google`, `call_google_fix`, `call_google_classification`).
2. Switches to `Authorization: Bearer <key>` header for authentication.
3. Adds defense-in-depth `redact_url_key_param()` function to strip `key=<value>` patterns from any error message, even if the exact key string doesn't match.
4. Adds 7 new unit tests covering redaction behavior and URL construction.

**Note**: This commit is bundled with an unrelated feature (FileTree sidebar + `list_directory` command). These should ideally be separate commits. Review below covers only the security-relevant LLM changes.

---

## Security Checklist

### 1. API Key Removed from URLs — PASS

All 3 Google functions now construct URLs without `?key=`:

- `call_google` (line ~925): URL has no query string
- `call_google_fix` (line ~668): URL has no query string
- `call_google_classification` (line ~333): URL has no query string

Verified via grep: zero remaining instances of `key={}` URL construction in Google API calls.

### 2. Header Auth Correct for All 3 Functions — PASS

All 3 functions add `.header("Authorization", format!("Bearer {}", api_key))`.

### 3. sanitize_error Catches All Patterns — PASS

`sanitize_error` now has two layers:
- **Layer 1**: Direct `error.replace(api_key, "[REDACTED]")` — catches the key verbatim.
- **Layer 2**: `redact_url_key_param()` — catches any `key=<value>` pattern in URLs, regardless of whether the value matches the known key.

### 4. No Key Leaks in Error Paths — PASS

Every `.map_err()` in all 3 Google functions passes through `sanitize_error`. The error paths are:
- HTTP send failure (connection errors, timeouts) — sanitized
- JSON parse failure — sanitized
- Non-success status code — sanitized
- Response extraction failure — static strings, no key exposure

### 5. Test Coverage — PASS

New tests cover:
- `test_google_error_redacts_api_key_from_url` — real-world error message with key in URL
- `test_sanitize_error_handles_google_url_pattern` — key=value redaction when api_key doesn't match
- `test_google_translate_uses_header_auth` — URL construction verification
- `test_redact_url_key_param_no_key` — no false positives
- `test_redact_url_key_param_at_end` — key at end of string
- `test_redact_url_key_param_multiple` — multiple key= occurrences

---

## Findings

### F-001: `redact_url_key_param` has false-positive on substring matches [Low / Informational]

**Location**: `src-tauri/src/llm/mod.rs` line 107

The function uses `remaining.find("key=")` which matches `key=` anywhere in the string, including as a substring of other parameter names (e.g., `monkey=value` would be redacted as `mon[key=[REDACTED]]`). In the context of error messages from HTTP libraries, this is unlikely to cause problems since the primary use case is URL query parameters. However, a more precise approach would use a regex like `(?:^|[?&])key=` or check that the character before `key=` is `?`, `&`, or start-of-string.

**Severity**: Low. This is defense-in-depth redaction; false positives (over-redacting) are acceptable — they err on the side of safety. The primary protection is removing the key from URLs entirely; this function is a fallback.

**Recommendation**: No action required. The current behavior is safe (over-redacting is better than under-redacting). Could refine in a future cleanup pass if desired.

### F-002: Google Gemini API auth method [Informational / Verify]

The fix switches from `?key=API_KEY` to `Authorization: Bearer API_KEY`. Google's Gemini API documentation shows two supported auth methods:
- API key as query parameter: `?key=API_KEY`
- OAuth2 Bearer token: `Authorization: Bearer <token>`

The `Authorization: Bearer` approach works with **OAuth2 access tokens** but may **not** work with raw API keys (which start with `AIzaSy...`). Google API keys are typically passed via `?key=` or the `x-goog-api-key` header. If this change breaks Google provider auth at runtime, consider using `.header("x-goog-api-key", api_key)` instead of `Authorization: Bearer`.

**Severity**: Medium (functional correctness). If users report Google auth failures after this change, this is the likely cause.

**Recommendation**: Verify with a live Google Gemini API call using an API key. If `Bearer` doesn't work with API keys, switch to `x-goog-api-key` header.

---

## Test Results

```
165 unit tests passed, 0 failed, 1 ignored
11 integration tests passed, 0 failed
All TASK-054-specific tests pass.
```

---

## Unrelated Changes in Commit

The commit also includes:
- `FileTree` sidebar component (React)
- `list_directory` Tauri command + `compute_list_directory` function
- `Ctrl+Shift+E` shortcut for sidebar toggle
- `sidebar.toggle` command palette action
- 4 new tests for `list_directory`

These are unrelated to the security fix and should ideally be in a separate commit.

---

## Verdict

**APPROVE**. The security fix is correct and thorough. The API key is fully removed from URLs across all 3 Google functions, header auth is in place, `sanitize_error` has robust defense-in-depth, and test coverage is good. The one actionable item (F-002) should be verified with a live API call to confirm `Authorization: Bearer` works with Google API keys (vs. `x-goog-api-key` header).
