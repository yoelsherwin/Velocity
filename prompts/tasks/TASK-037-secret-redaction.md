# Task 037: Secret Redaction (P1-W3)

## Context

Terminal output often contains sensitive data — API keys, tokens, passwords, connection strings. Currently these are displayed in plain text and can be copied/shared accidentally. This task adds automatic detection and masking of secrets in terminal output.

### What exists now

- **AnsiOutput.tsx**: Renders styled spans from ANSI-parsed output.
- **BlockView.tsx**: Has "Copy Output" action that uses `stripAnsi(block.output)`.
- **Block type**: `output` is a plain string with ANSI codes.

## Requirements

### Frontend only — no Rust changes.

1. **Secret detection**: Regex-based patterns to detect common secrets in output text:
   - API keys: `sk-[a-zA-Z0-9]{20,}` (OpenAI), `AKIA[A-Z0-9]{16}` (AWS), etc.
   - Tokens: `ghp_[a-zA-Z0-9]{36}` (GitHub PAT), `xoxb-[a-zA-Z0-9-]+` (Slack)
   - Generic: long hex strings (32+ chars), base64 strings that look like keys
   - Connection strings: `://user:password@`
   - Environment variable patterns: `API_KEY=`, `SECRET=`, `TOKEN=`, `PASSWORD=` followed by a value

2. **Masking**: Replace detected secrets with `••••••••` (8 bullet chars) in the rendered output. The original text is preserved in `block.output` — only the display is masked.

3. **Click to reveal**: Clicking on a masked secret temporarily shows the actual value for 3 seconds, then re-masks. Visual indicator: the revealed text has a yellow background.

4. **Copy behavior**: "Copy Output" copies the MASKED text by default. Add a "Copy Raw" option (or hold Shift while clicking Copy) to copy unmasked.

5. **Implementation**: Create a `useSecretRedaction` hook or utility that processes text and returns segments with redaction markers. Apply in AnsiOutput or BlockView.

6. **Performance**: Regex matching should only run once per output change (memoized), not on every render.

7. **No false positives for common patterns**: Don't mask git commit hashes (40 hex chars), UUIDs, or file paths that happen to be long.

## Tests

- [ ] `test_detects_openai_key`: `sk-abc123...` is masked.
- [ ] `test_detects_aws_key`: `AKIAIOSFODNN7EXAMPLE` is masked.
- [ ] `test_detects_github_pat`: `ghp_xxxx...` is masked.
- [ ] `test_detects_generic_env_secret`: `API_KEY=mysecretvalue` masks the value.
- [ ] `test_detects_connection_string_password`: `mysql://user:p4ssw0rd@host` masks the password.
- [ ] `test_preserves_git_hashes`: 40-char hex git hashes NOT masked.
- [ ] `test_preserves_uuids`: UUIDs NOT masked.
- [ ] `test_click_reveals_secret`: Clicking masked text reveals it.
- [ ] `test_reveal_auto_hides`: Revealed secret re-masks after timeout.
- [ ] `test_copy_output_copies_masked`: Copy action copies masked text.

## Acceptance Criteria
- [ ] Common API key patterns detected and masked
- [ ] Connection string passwords masked
- [ ] ENV=value secrets masked
- [ ] Git hashes and UUIDs NOT masked
- [ ] Click to reveal for 3 seconds
- [ ] Copy copies masked text by default
- [ ] No performance regression (memoized detection)
- [ ] All tests pass
- [ ] Commit: `feat: add automatic secret redaction in terminal output`

## Files to Read First
- `src/components/AnsiOutput.tsx` — Text rendering pipeline
- `src/components/blocks/BlockView.tsx` — Copy action, output rendering
- `src/lib/ansi.ts` — stripAnsi, AnsiSpan type
- `src/hooks/useIncrementalAnsi.ts` — Incremental parsing
- `src/App.css` — Styling patterns
