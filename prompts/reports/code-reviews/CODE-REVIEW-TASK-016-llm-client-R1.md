# Code Review: TASK-016 Multi-Provider LLM Client (R1)

**Commit**: `eb32401 feat: add multi-provider LLM client for command translation`
**Reviewer**: Code Reviewer Agent
**Date**: 2026-03-15
**Verdict**: **NEEDS CHANGES**

---

## Summary

This commit introduces a multi-provider LLM client that translates natural language into shell commands. It adds a new `llm` module in Rust with support for OpenAI, Anthropic, Google Gemini, and Azure OpenAI APIs. A Tauri command `translate_command` is exposed to the frontend, and a thin TypeScript wrapper (`src/lib/llm.ts`) calls it. The implementation closely follows the task spec and is generally well-structured. However, there is one blocking security issue (API key leaked in Google URL), one medium-severity correctness issue, and several lower-severity findings.

All 8 Rust tests and 2 frontend tests pass.

---

## Files Changed

| File | Change |
|------|--------|
| `src-tauri/src/llm/mod.rs` | NEW: 421 lines -- LLM module with 4 provider implementations, system prompt builder, response cleaner, unit tests |
| `src-tauri/src/commands/mod.rs` | MODIFIED: +17 lines -- `translate_command` Tauri command |
| `src-tauri/src/lib.rs` | MODIFIED: +2 lines -- module declaration + command registration |
| `src-tauri/Cargo.toml` | MODIFIED: +1 feature -- `tokio` gains `macros` feature for `#[tokio::test]` |
| `src-tauri/Cargo.lock` | MODIFIED: +12 lines -- `tokio-macros` dependency added |
| `src/lib/llm.ts` | NEW: 21 lines -- TypeScript IPC wrapper |
| `src/__tests__/llm.test.ts` | NEW: 37 lines -- Frontend test with invoke mock |
| `prompts/tasks/TASK-016-llm-client.md` | NEW: 276 lines -- Task specification |

---

## Findings

### [F-01] BLOCK: Google Gemini API key exposed in URL query string

**File**: `src-tauri/src/llm/mod.rs`, lines 219-222

```rust
let url = format!(
    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
    model, api_key
);
```

The Google Gemini API key is placed directly in the URL as a query parameter. While this matches Google's official API design (they use `?key=` for authentication), it has security implications:

1. **URL logging**: URLs are commonly logged by proxies, CDNs, load balancers, and browser dev tools. If a user runs Velocity behind a corporate proxy, their API key could appear in proxy logs.
2. **reqwest error messages**: If the HTTP request fails, the error message from `reqwest` may include the full URL (with the key) in the error string, which would then propagate back to the frontend via the `map_err`.
3. **Consistency**: All other providers use HTTP headers for authentication, making this the odd one out from a security posture perspective.

**Severity**: BLOCKING. The error path in particular is a concrete leak vector -- if the HTTP request fails (network error, DNS failure, etc.), `reqwest` will format the URL into the error message, and that error is returned to the frontend as a `String`.

**Required fix**: Sanitize the error message from `reqwest` to strip the API key before returning it. At minimum:
```rust
.map_err(|e| {
    let msg = e.to_string();
    // Strip API key from error messages
    msg.replace(api_key, "[REDACTED]")
})?;
```

Google requires the key in the URL for this endpoint, so the URL itself cannot be changed. But the error path MUST be sanitized.

---

### [F-02] MEDIUM: `model` and `azure_endpoint` not sanitized in URL construction

**File**: `src-tauri/src/llm/mod.rs`, lines 219-222 and 277-280

```rust
// Google
let url = format!(
    "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
    model, api_key
);

// Azure
let url = format!(
    "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
    endpoint.trim_end_matches('/'),
    model
);
```

Both `model` and `azure_endpoint` are user-provided strings that are interpolated directly into URLs. A crafted `model` value like `../../../admin` or one containing `?` / `#` / `&` characters could alter the URL path or inject query parameters. Similarly, `azure_endpoint` is only checked for `https://` prefix but could contain path traversal or query injection.

**Severity**: Medium. The `model` value comes from settings stored on disk (not directly from IPC input), which reduces the attack surface. However, defensive URL encoding is a best practice.

**Required fix**: URL-encode the `model` parameter when interpolated into URLs. For Azure, additionally validate that `azure_endpoint` does not contain query strings or fragments:

```rust
// Use percent-encoding for model in URL paths
let encoded_model = urlencoding::encode(model);
```

Or at minimum, validate that model does not contain `/`, `?`, `#`, or `&`.

---

### [F-03] GOOD: No logging or printing of API keys

No `println!`, `eprintln!`, `dbg!`, `log::`, or `tracing::` calls exist anywhere in the module. API keys are passed by reference through the call chain and never formatted into log output. The `TranslationResponse` derives `Debug` but only contains the command (not the key). `TranslationRequest` does not derive `Debug` at all, preventing accidental debug-printing of the prompt (which is fine since it is just user text, not sensitive).

---

### [F-04] GOOD: Async correctness -- no `spawn_blocking` for reqwest

**File**: `src-tauri/src/commands/mod.rs`, lines 117-131

```rust
#[tauri::command]
pub async fn translate_command(
    input: String,
    shell_type: String,
    cwd: String,
) -> Result<String, String> {
    let settings = settings::load_settings()?;
    let request = llm::TranslationRequest { ... };
    let response = llm::translate_command(&settings, &request).await?;
    Ok(response.command)
}
```

The command is correctly `async` and directly `.await`s the reqwest call without wrapping it in `spawn_blocking`. This is correct because `reqwest` is natively async and runs on the Tokio runtime. The other PTY commands use `spawn_blocking` because they call synchronous `portable-pty` APIs, but that pattern would be wrong here.

**One concern**: `settings::load_settings()` performs synchronous file I/O (`std::fs::read_to_string`) on the async task. This is technically blocking the Tokio runtime thread. However, the file is tiny (a few hundred bytes of JSON from the local filesystem), so the practical impact is negligible. This is an observation, not a required change.

---

### [F-05] GOOD: HTTP client is properly shared via `OnceLock`

**File**: `src-tauri/src/llm/mod.rs`, lines 7-16

```rust
fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Velocity/0.1")
            .build()
            .expect("Failed to build HTTP client")
    })
}
```

Uses `std::sync::OnceLock` (stabilized in Rust 1.70) rather than `lazy_static` or `once_cell`. This is the idiomatic, zero-dependency approach. The 30-second timeout and custom User-Agent match the spec. The `.expect()` here is acceptable because `reqwest::Client::builder().build()` only fails if TLS backend initialization fails, which is a fatal startup condition.

---

### [F-06] GOOD: System prompt construction is safe

**File**: `src-tauri/src/llm/mod.rs`, lines 34-59

The system prompt uses `format!()` with `{}` placeholders for `shell_type` and `cwd`. The double braces `{{ }}` in the PowerShell example are correctly escaped for Rust's `format!` macro (they produce literal `{ }` in the output). The shell type and CWD are embedded as descriptive context, not as executable code -- they instruct the LLM what shell to target, and the LLM's output is returned to the user for review, not auto-executed.

---

### [F-07] GOOD: Response cleaning handles edge cases

**File**: `src-tauri/src/llm/mod.rs`, lines 62-78

```rust
fn clean_response(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let inner = trimmed
            .strip_prefix("```").unwrap_or(trimmed)
            .strip_suffix("```").unwrap_or(trimmed)
            .trim();
        if let Some(newline_pos) = inner.find('\n') {
            let first_line = &inner[..newline_pos];
            if first_line.chars().all(|c| c.is_alphanumeric() || c == '-') {
                return inner[newline_pos + 1..].trim().to_string();
            }
        }
        return inner.to_string();
    }
    trimmed.to_string()
}
```

The `.unwrap_or(trimmed)` after `strip_prefix`/`strip_suffix` is defensive but unnecessary -- `starts_with` already guarantees the prefix exists. However, it does no harm and is a safe pattern.

The language-tag detection (`first_line.chars().all(...)`) works for common tags like `powershell`, `bash`, `cmd`, `shell`. It would misidentify a single-line command that happens to be all alphanumeric (e.g., `dir`) if the response were ````dir\n...\n```` -- but the logic only runs when the first line matches alphanumeric-only, AND there is a newline after it, so a single command `dir` without a newline would be returned as-is, which is correct.

---

### [F-08] LOW: Azure endpoint HTTPS validation can be bypassed with mixed case

**File**: `src-tauri/src/llm/mod.rs`, lines 270-272

```rust
if !endpoint.starts_with("https://") {
    return Err("Azure endpoint must use HTTPS.".to_string());
}
```

The check is case-sensitive. An endpoint like `HTTPS://evil.com` or `Https://evil.com` would be rejected, which is overly strict but safe (it errs on the side of caution). However, the more concerning case is that an endpoint like `https://evil.com?injected=param` would pass validation. The `trim_end_matches('/')` only strips trailing slashes, not query strings.

**Severity**: Low. The Azure endpoint is configured by the user in their own settings file, so they would only be attacking themselves. But for defense-in-depth, consider rejecting endpoints containing `?` or `#`.

---

### [F-09] LOW: Error responses may leak provider-side error details

**File**: `src-tauri/src/llm/mod.rs` (all provider functions)

```rust
if !status.is_success() {
    let error_msg = json["error"]["message"]
        .as_str()
        .unwrap_or("Unknown API error");
    return Err(format!("OpenAI API error ({}): {}", status, error_msg));
}
```

The error message from the provider API is passed through to the frontend verbatim. For most error cases (rate limit, invalid key, model not found), this is helpful. However, some provider error messages could theoretically contain internal information. This is a low-severity concern since the error goes to the local user, not to a third party.

---

### [F-10] GOOD: Frontend wrapper is minimal and correct

**File**: `src/lib/llm.ts`

```typescript
export async function translateCommand(
  input: string,
  shellType: string,
  cwd: string,
): Promise<string> {
  return invoke<string>('translate_command', {
    input,
    shellType,
    cwd,
  });
}
```

Clean, well-typed, properly documented. Parameter names use camelCase as Tauri's `invoke` serializer expects (it converts to snake_case for Rust). No unnecessary error handling wrapping -- errors from `invoke` propagate naturally as rejected promises.

---

### [F-11] GOOD: Frontend test mocking is correct

**File**: `src/__tests__/llm.test.ts`

The test correctly:
1. Mocks `@tauri-apps/api/core` with `vi.mock()` BEFORE importing the module under test.
2. Tests both the success path (mock resolves with `'dir /s'`) and the error path (mock rejects with the expected error string).
3. Verifies the exact arguments passed to `invoke`, including the command name and parameter object.
4. Clears mocks in `beforeEach` to prevent test pollution.

---

### [F-12] OBSERVATION: Missing test for `clean_response` with only opening fence

The `clean_response` function handles the case where input starts AND ends with triple backticks. But what about malformed LLM responses like:

- `````dir /s`` (opens but doesn't close)
- ````\ndir /s``` `` (trailing text after closing fence)

In both cases, the function falls through to the `trimmed.to_string()` return, which is correct behavior (it returns the raw text trimmed). This is fine, but a test documenting this expectation would strengthen the suite.

**Severity**: Observation (test coverage gap, not a bug).

---

### [F-13] OBSERVATION: `tokio::macros` feature added to production dependency

**File**: `src-tauri/Cargo.toml`

```toml
tokio = { version = "1", features = ["rt", "macros"] }
```

The `macros` feature is needed only for `#[tokio::test]` in the test module. It could be moved to `[dev-dependencies]` to avoid including proc-macro code in the production binary. However, Tauri itself likely pulls in `tokio` with the `macros` feature already, so the practical impact is zero.

**Severity**: Observation (no functional impact).

---

## Required Changes

| ID | Severity | Description |
|----|----------|-------------|
| F-01 | BLOCK | Sanitize reqwest error messages in `call_google` to strip the API key before returning errors to the frontend. The key appears in the URL, and reqwest may include the URL in error output. |
| F-02 | MEDIUM | Sanitize or validate `model` and `azure_endpoint` before interpolating into URLs. At minimum, reject model strings containing `/`, `?`, `#`, or `&`. |

## Optional Improvements

| ID | Severity | Description |
|----|----------|-------------|
| F-08 | Low | Reject Azure endpoints containing `?` or `#` characters to prevent query injection |
| F-09 | Low | Consider sanitizing provider error messages before returning to frontend |
| F-12 | Observation | Add tests for `clean_response` with malformed fence patterns (e.g., opening fence only) |
| F-13 | Observation | Move `tokio` `macros` feature to `[dev-dependencies]` if not needed by production code |

---

## Test Assessment

| Suite | Tests | Status | Notes |
|-------|-------|--------|-------|
| `llm::tests` (Rust) | 8 | PASS | System prompt (2), clean_response (4), error paths (2) |
| `llm.test.ts` (Vitest) | 2 | PASS | invoke call verification, error propagation |

**Coverage strengths**:
- System prompt construction tested for both powershell and cmd shell types.
- Response cleaning covers plain text, code fences, code fences with language tags, and whitespace.
- Error paths for missing API key and unknown provider are tested.
- Frontend invoke mock verifies exact parameter shape.

**Coverage gaps** (acceptable for unit tests without API access):
- No tests for HTTP request/response handling (would require mocking reqwest or a test server).
- No test for Azure HTTPS validation.
- No test for `clean_response` edge cases (partial fences, nested fences).
- No test for the `model` or `endpoint` URL interpolation behavior.

The missing HTTP-level tests are acknowledged in the task spec ("integration tests would require real API keys"). The unit tests cover all testable logic paths.

---

## Security Assessment

| Concern | Status | Notes |
|---------|--------|-------|
| API key logging | PASS | No logging calls anywhere in the module |
| API key in error messages | FAIL | Google API key appears in URL, reqwest errors may include URL |
| API key in HTTP headers | PASS | OpenAI, Anthropic, Azure all use headers correctly |
| Input validation | PARTIAL | Empty key checked; model/endpoint not sanitized for URL construction |
| HTTPS enforcement | PASS | All provider URLs use HTTPS; Azure endpoint validated for `https://` prefix |
| Response execution | PASS | LLM response is returned to user for review, not auto-executed |
| IPC surface | PASS | Single new command `translate_command`, no new event listeners |

---

## Verdict: NEEDS CHANGES

The implementation is well-structured and follows the task spec closely. Async handling is correct, the shared HTTP client is idiomatic, and test coverage is good for unit-testable paths. However, the API key leak vector in the Google error path (F-01) is a blocking security issue that must be fixed before merge. The URL injection concern (F-02) is medium severity and should also be addressed.

After fixing F-01 and F-02, this would be an APPROVE.
