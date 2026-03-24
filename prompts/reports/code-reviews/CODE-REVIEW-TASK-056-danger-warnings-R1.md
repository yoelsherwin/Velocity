# Code Review: TASK-056 Dangerous Command Warnings (R1)

**Reviewer**: Security Review Agent
**Commit**: `4bb2ce796d1440879136d0fdaf535c7a6a7cae1d`
**Date**: 2026-03-24
**Focus**: Security review -- pattern completeness, bypass vectors, execution safety

---

## Test Results

| Suite | Result |
|-------|--------|
| `cargo test` | 193 passed, 3 failed (pre-existing settings tests), 1 ignored |
| `npm run test` | 610 passed, 0 failed (OOM crash in runner, pre-existing infra issue) |
| Danger-specific Rust tests | 22/22 passed |
| Danger-specific frontend tests | 4/4 passed |

All TASK-056 tests pass. Failures are pre-existing and unrelated.

---

## Architecture Summary

- **Rust (`danger.rs`)**: Regex-based pattern matcher with `LazyLock` compiled patterns. Returns `DangerAnalysis { is_dangerous, reason, danger_level }`.
- **Tauri command (`commands/mod.rs`)**: Synchronous `analyze_command_danger` command exposes the Rust function to frontend.
- **Frontend (`llm.ts`)**: `analyzeCommandDanger()` wraps the IPC invoke.
- **UI (`Terminal.tsx`)**: Warning banner shown after LLM translation or fix suggestion. Dismissible. Cleared on input change.

---

## SECURITY FINDINGS

### S1 [HIGH] -- Danger check failure silently swallowed; no warning shown

**File**: `src/components/Terminal.tsx` lines 774-776 and 668-670

Both call sites catch errors from `analyzeCommandDanger` and silently continue. If the Rust backend fails (panic, IPC timeout, serialization error), the dangerous command is placed in the editor **with no warning**. The user sees a translated command ready to execute, but no danger banner.

**Recommendation**: On analysis failure, show a generic warning: "Could not verify command safety. Review carefully before executing." This is the fail-closed principle -- if you cannot determine safety, assume danger.

### S2 [HIGH] -- Missing bypass: semicolons, `&&`, backticks, and command chaining

The regex patterns match individual commands but do not account for command chaining. These all bypass detection:

- `echo hello; rm -rf /` -- semicolon chaining
- `echo hello && rm -rf /` -- conditional chaining
- `` `rm -rf /` `` -- backtick execution (bash)
- `$(rm -rf /)` -- subshell execution
- `cmd /c "del /s /q C:\"` -- nested shell invocation
- `powershell -c "Remove-Item -Recurse C:\"` -- nested powershell

While `rm -rf /` itself would still match within the larger string (since the regex has no start/end anchors), patterns like `cmd /c "format C:"` might get tricky depending on quoting. More critically:

- `echo test | rm -rf /` -- the `rm` is after a pipe, still matches (good)
- But `base64 -d <<< "cm0gLXJmIC8=" | bash` -- encoded payload, completely undetectable

**Recommendation**: Document the limitation that encoded/obfuscated payloads cannot be detected. Consider adding patterns for `cmd /c`, `powershell -c`, `bash -c` as wrappers that invoke sub-shells (medium risk).

### S3 [MEDIUM] -- `chown` flagged as dangerous is overly broad (false positive risk)

`chown user:group file` is a routine admin operation. Flagging all `chown` usage will train users to dismiss warnings habitually, reducing the effectiveness of real warnings (alert fatigue).

**Recommendation**: Only flag `chown` on sensitive paths (e.g., `/etc/`, `/bin/`, system directories) or with recursive flag `-R`. At minimum, lower to "low" severity.

### S4 [MEDIUM] -- `shutdown` pattern matches non-dangerous uses

`shutdown --help`, `shutdown -a` (abort), or even the word "shutdown" in an echo/comment would trigger. The regex `\bshutdown\b` has no context awareness.

**Recommendation**: Tighten to require flags like `/s`, `/r`, `-h`, `-r`, `now`, or at least exclude obvious safe suffixes like `--help`.

### S5 [MEDIUM] -- No protection against Unicode homoglyph bypass

An LLM could theoretically return commands using Unicode lookalike characters (e.g., Cyrillic `r` U+0433 instead of Latin `r`). The regex `\brm\b` would not match `гm`. This is a known attack vector in LLM-generated content.

**Recommendation**: Normalize the command to ASCII before pattern matching. Strip or reject non-ASCII characters in command strings, or at minimum add a warning for commands containing non-ASCII characters.

### S6 [LOW] -- `passwd` pattern uses `^` anchor, only matches at line start

```rust
(r"(?i)^\s*passwd\b", "Password change command", "medium"),
```

In a multi-command string like `echo test; passwd`, the `^` anchor prevents matching. All other patterns use `\b` word boundaries instead.

**Recommendation**: Replace `^\s*` with `\b` for consistency: `(?i)\bpasswd\b`.

### S7 [LOW] -- Missing patterns for additional dangerous commands

Not detected:
- `:(){ :|:& };:` -- fork bomb
- `> /dev/sda` or `> /dev/null` redirections to devices
- `mv / /dev/null` -- move root
- `chmod -R 000 /` -- recursive permission removal
- `iptables -F` -- flush firewall rules
- `visudo` -- sudoers editing
- PowerShell: `Clear-Content`, `Set-Content` on system files
- `reg add` -- registry modification (only `reg delete` is caught)
- `bcdedit` -- boot configuration editing
- `diskpart` -- Windows disk management

**Recommendation**: Add patterns for at least `reg add`, `bcdedit`, `diskpart`, and fork bomb patterns. These are high-impact Windows-relevant commands.

---

## NON-SECURITY FINDINGS

### N1 [MEDIUM] -- Command is NEVER auto-executed (VERIFIED CORRECT)

The security-critical property holds: after LLM translation, the command is placed into the editor via `setInput(translated)` at line 766. It is NOT passed to `submitCommand()`. The user must manually press Enter to execute. The danger check runs between translation and user action. This is correct.

Similarly, `handleUseFix` at line 658 only calls `setInput(command)` -- it does not execute.

### N2 [LOW] -- No race condition between check and display (VERIFIED CORRECT)

The `translationIdRef` staleness guard at line 771 ensures that if the user has moved on (typed new input, changed shells), a late-arriving danger result is discarded. The flow is:
1. Translation completes -> `setInput(translated)` (command visible in editor)
2. Danger check runs -> `setDangerWarning(danger)` (warning appears)

The command is visible before the warning appears, which is acceptable since the user cannot accidentally execute it during this gap (they would need to press Enter, and the warning state would be set by then in normal latency conditions). However, see S1 -- if the danger check fails entirely, no warning ever appears.

### N3 [LOW] -- `danger_level` is a `String`, not an enum

Using `String` for `danger_level` ("high", "medium") allows typos and makes exhaustive matching impossible. Consider using a Rust enum with `Serialize`.

### N4 [LOW] -- Warning cleared on ANY input change, even single character

At line 817, `setDangerWarning(null)` fires on every `onChange`. If a user accidentally presses a key and then undoes it, the warning is gone. This is technically correct (the command changed) but could surprise users who expect the warning to persist for the same command.

### N5 [INFO] -- `shell_type` parameter is accepted but unused

The `_shell_type` parameter in `analyze_command_danger` is documented as "for future shell-specific tuning" but currently ignored. This is fine for now but should be wired up when PowerShell-only vs. Unix-only patterns diverge.

---

## VERDICT: REQUEST CHANGES

The implementation is architecturally sound -- commands are never auto-executed, the warning UI is correctly wired, and the Rust pattern engine is well-structured. However, there are two high-severity security findings that should be addressed before merge:

1. **S1**: Fail-open on analysis error -- must show a generic safety warning when the check itself fails.
2. **S2**: Document known limitations around encoded/obfuscated commands. Add patterns for `cmd /c`, `powershell -c`, `bash -c` sub-shell wrappers.

Additionally, S6 (passwd anchor bug) is a clear defect that should be fixed.

### Required Changes
- [ ] S1: Show fallback warning on `analyzeCommandDanger` failure (both call sites)
- [ ] S2: Add sub-shell invocation patterns (`cmd /c`, `powershell -c`, `bash -c`)
- [ ] S6: Fix `passwd` regex to use `\b` instead of `^`

### Recommended Changes
- [ ] S3: Narrow `chown` pattern or lower severity
- [ ] S4: Tighten `shutdown` pattern to require action flags
- [ ] S5: Add ASCII normalization or non-ASCII character warning
- [ ] S7: Add missing patterns for `reg add`, `bcdedit`, `diskpart`
- [ ] N3: Use enum for `danger_level`
