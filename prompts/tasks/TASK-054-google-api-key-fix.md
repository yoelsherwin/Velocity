# Task 054: Fix Google API Key in URL (SEC-015-H2)

## Context
The Google Gemini LLM provider passes the API key as a URL query parameter (`?key=API_KEY`). This is Google's required authentication method for the Gemini API, but it means the API key appears in URLs which could be logged by proxies, browser history, or error messages.

## Requirements
### Backend (Rust) only.

1. **Sanitize error messages**: In `src-tauri/src/llm/mod.rs`, the Google API call constructs a URL with the API key. If the request fails, the error message may contain the full URL (including the key). Ensure ALL error paths sanitize the URL to redact the API key before returning to the frontend.

2. **Review `sanitize_error`**: The existing `sanitize_error()` function redacts API keys from error messages. Verify it catches the Google URL pattern (`key=sk-...` or `key=AI...`). If not, extend it.

3. **Add specific test**: Test that a Google API error message with `?key=AIza...` in the URL has the key redacted in the returned error.

4. **Consider header-based auth**: Check if Google Gemini API supports `Authorization: Bearer` header as an alternative to URL query param. If so, switch to it. (Note: as of 2025, the Gemini API requires the `key` query parameter for some endpoints but supports `Authorization` header for v1beta endpoints.)

## Tests
### Rust
- [ ] `test_google_error_redacts_api_key_from_url`: Error containing `?key=AIza...` has key redacted.
- [ ] `test_sanitize_error_handles_google_url_pattern`: `sanitize_error` strips `key=...` from URLs.
- [ ] `test_google_translate_uses_header_auth`: If switched to header auth, verify URL has no key.

## Files to Read First
- `src-tauri/src/llm/mod.rs` — Google Gemini API calls, error handling, sanitize_error
- `src-tauri/src/commands/mod.rs` — How errors propagate to frontend

## Acceptance Criteria
- [ ] API key never appears in error messages returned to frontend
- [ ] sanitize_error handles Google URL pattern
- [ ] Preferably use header-based auth if API supports it
- [ ] All tests pass
- [ ] Commit: `fix: redact Google API key from error messages and URLs`
