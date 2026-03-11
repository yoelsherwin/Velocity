# Security Review — 2026-03-11

## Scope
- **Commit range**: `c98cfc8..c65cc00` (PTY engine implementation + code review fixes)
- **Tasks covered**: TASK-002 (PTY engine), FIX-002 (code review R1 fixes)
- **HEAD at time of review**: `c65cc00`

## Previous Review Status
- **R1 bootstrap (c98cfc8)**: All findings LOW/MEDIUM. No critical or high issues. M-1 (`unsafe-inline` in `style-src`) remains as accepted risk. L-1 (`.expect()` in builder) noted. L-2 (`opener` plugin) still present. L-3 (`.gitignore nul`) cosmetic.

## Attack Surface Map

The application now has a **live attack surface**. The PTY engine introduces:

1. **IPC entry point — `create_session`**: `src-tauri/src/commands/mod.rs:10-31` — Frontend can spawn shell processes (PowerShell, CMD, WSL)
2. **IPC entry point — `write_to_session`**: `src-tauri/src/commands/mod.rs:34-49` — Frontend can send arbitrary data to a running shell process
3. **IPC entry point — `resize_session`**: `src-tauri/src/commands/mod.rs:52-68` — Frontend can resize PTY dimensions
4. **IPC entry point — `close_session`**: `src-tauri/src/commands/mod.rs:71-85` — Frontend can terminate shell sessions
5. **Process spawning**: `src-tauri/src/pty/mod.rs:65-75` — Hardcoded shell executables (`powershell.exe`, `cmd.exe`, `wsl.exe`) spawned via `CommandBuilder`
6. **Shell type validation**: `src-tauri/src/pty/mod.rs:10-15` — Allowlist of shell types
7. **PTY output streaming**: `src-tauri/src/pty/mod.rs:97-122` — Reader thread emits raw output to frontend via Tauri events
8. **User input to PTY writer**: `src-tauri/src/pty/mod.rs:137-153` — Frontend data written to PTY master as raw bytes
9. **Frontend output rendering**: `src/components/Terminal.tsx:89-91` — PTY output rendered in `<pre>` element as text content
10. **Frontend event listeners**: `src/components/Terminal.tsx:28-44` — Listens for `pty:output:{id}`, `pty:error:{id}`, `pty:closed:{id}`
11. **Output buffer management**: `src/components/Terminal.tsx:5,29-34` — 100KB cap with tail truncation
12. **Environment variable inheritance**: `src-tauri/src/pty/mod.rs:65-75` — `CommandBuilder` inherits full parent environment by default
13. **Capability permissions**: `src-tauri/capabilities/default.json:9` — `core:event:default` added to support event streaming

## Findings

### CRITICAL

None.

### HIGH

**H-1: Full parent environment inherited by spawned shell processes**

- **Vector**: Environment Variable Leakage (#5)
- **Location**: `src-tauri/src/pty/mod.rs:65-75`
- **Description**: The `CommandBuilder::new()` used for all three shell types inherits the **complete environment** of the Velocity process. This means every environment variable set in the parent process — including `TAURI_*` internal variables, any API keys or tokens the user has set in their shell profile, `PATH`, and potentially sensitive CI/CD variables — are visible to the spawned shell. While this is often *desired* behavior for a terminal emulator (users expect shells to have their environment), it becomes a risk because:
  1. The shell output is streamed over Tauri events to the WebView. Any environment variable printed by the shell (e.g., `echo $env:SECRET_KEY` in PowerShell) will transit through the IPC boundary.
  2. There is no filtering or redaction on the output path.
  3. If a future XSS vulnerability exists in the WebView, all environment data accessible through the shell could be exfiltrated.
- **Exploit Scenario**: A malicious ANSI sequence or future XSS in the terminal output rendering could call `writeToSession(sid, "echo $env:API_KEY\r")` via the exposed IPC commands, then exfiltrate the echoed value from the `pty:output` event. This requires a WebView compromise first, but the blast radius is the user's entire environment.
- **Recommended Fix**: This is an inherent property of terminal emulators and **not fixable without breaking user expectations**. However, mitigations are possible:
  1. Document this as an accepted risk in the security model
  2. When Agent Mode is implemented, ensure LLM-generated commands are sanitized and cannot dump environment variables without explicit user consent
  3. Consider a `VELOCITY_SAFE_ENV` mode that strips sensitive env vars (configurable allowlist/blocklist) for environments where this matters
- **Severity Justification**: HIGH because environment variables frequently contain secrets (API keys, tokens, credentials), and the output path from shell → IPC event → WebView has no sanitization layer. Requires WebView compromise for remote exploitation, but local exploitation is trivial (any code running in the shell can access the environment — this is by design).

### MEDIUM

**M-1: No rate limiting or session cap on `create_session` IPC command**

- **Vector**: Denial of Service (#9), Process Lifecycle Abuse (#6)
- **Location**: `src-tauri/src/commands/mod.rs:10-31`, `src-tauri/src/pty/mod.rs:45-135`
- **Description**: The `create_session` command has no limit on how many sessions can be created. A compromised WebView (or a bug in the React frontend) could call `create_session` in a tight loop, spawning hundreds of PowerShell processes. Each session spawns a shell process and a reader thread, consuming OS handles, memory, and CPU. The `SessionManager` uses a `HashMap` with no size cap.
- **Exploit Scenario**: Malicious JavaScript in the WebView calls `invoke('create_session', {})` in a loop 1000 times. Each call spawns a `powershell.exe` process and a reader thread. The system exhausts available process handles or memory, potentially causing system-wide DoS beyond just the Velocity application.
- **Recommended Fix**: Add a `MAX_SESSIONS` constant (e.g., 20) and check `self.sessions.len()` at the start of `create_session`. Return an error if the limit is reached.
- **Severity Justification**: Medium. Requires WebView compromise or a severe frontend bug. Local exploitation is the most likely vector — not remotely exploitable. But the impact (system-wide DoS via process exhaustion) is significant.

**M-2: `unsafe-inline` in `style-src` CSP (carried from R1 M-1)**

- **Vector**: Defense-in-depth
- **Location**: `src-tauri/tauri.conf.json:23`
- **Description**: Now **more relevant** than in R1 because terminal output is being rendered in the WebView. The `unsafe-inline` in `style-src` means any XSS that achieves HTML injection could use inline styles for UI redressing. However, the current rendering uses `<pre>{output}</pre>` with React's text content escaping, which mitigates this.
- **Recommended Fix**: No change needed while using React's JSX text interpolation `{output}`. If the rendering changes to use `dangerouslySetInnerHTML` or HTML-based ANSI rendering in the future, this CSP gap becomes exploitable. Monitor during ANSI parser implementation.
- **Severity Justification**: Medium. The attack requires both an XSS vector AND the inline style to be useful for exploitation. Currently mitigated by React's output escaping.

**M-3: PTY output streamed as raw, unsanitized text to frontend**

- **Vector**: Terminal Escape Injection (#3)
- **Location**: `src-tauri/src/pty/mod.rs:105-110`
- **Description**: The reader thread converts PTY output bytes to a string with `String::from_utf8_lossy` and emits it directly to the frontend without any sanitization or ANSI filtering. Currently, the frontend renders this in a `<pre>` tag as text content (React escapes HTML entities), so raw ANSI escapes are visible as garbled characters but not executable. However:
  1. Raw escape sequences like `\x1b]0;FAKE TITLE\x07` (OSC title set) are passed through
  2. `\x1b]1337;File=...` (iTerm2-style file write) sequences are passed through
  3. `\x1b[6n` (device status report) is passed through
  4. Extremely long sequences are passed without length limits (per-read is capped at 4096 bytes, but a sequence could span multiple reads)

  None of these are exploitable with the **current** `<pre>` text rendering. But when ANSI parsing is implemented (Pillar 1 scope), if the parser interprets any of these sequences, they become attack vectors.
- **Exploit Scenario (future)**: A malicious program writes `\x1b]0;Important: Run sudo rm -rf /\x07` to stdout. If a future ANSI parser renders OSC title-set sequences, the terminal window title could display misleading information. More dangerously, if iTerm2-style file-write sequences are implemented, a process could write arbitrary files through the terminal emulator.
- **Recommended Fix**: No change needed for current MVP rendering. When implementing the ANSI parser:
  1. Implement an ANSI sequence allowlist (only render known-safe display sequences)
  2. Strip all OSC sequences except basic title-set (and even title-set should be opt-in)
  3. Never implement file-write OSC sequences
  4. Bound maximum sequence length (reject sequences > 256 bytes)
- **Severity Justification**: Medium. Not currently exploitable. Becomes HIGH/CRITICAL when ANSI parsing is implemented without proper filtering. This is a **preemptive finding** to ensure the ANSI parser task spec includes security requirements.

### LOW

**L-1: Session IDs are UUIDs but not validated on input**

- **Vector**: IPC Command Abuse (#2)
- **Location**: `src-tauri/src/commands/mod.rs:36,54,73` — `session_id: String` parameter
- **Description**: The `write_to_session`, `resize_session`, and `close_session` commands accept `session_id` as an arbitrary `String`. While the `SessionManager` performs a HashMap lookup that will fail for invalid IDs, there is no format validation of the session ID before the lookup. This means the error message `"Session not found: {user_input}"` will reflect back any string the frontend sends, including potentially long strings or strings containing control characters.
- **Exploit Scenario**: Frontend sends `session_id` as a multi-megabyte string. The error message allocates a formatted string containing this input. Low impact — only affects the error path, and the string lives only briefly in the Rust side before being serialized back to the frontend.
- **Recommended Fix**: Validate that `session_id` matches UUID format before the HashMap lookup. This prevents error message inflation and ensures IDs follow expected format.
- **Severity Justification**: Low. The HashMap lookup is O(1) and fails fast. The reflected string is returned to the same caller that sent it. No privilege escalation or cross-session impact.

**L-2: `Ordering::Relaxed` on shutdown flag**

- **Vector**: Process Lifecycle Abuse (#6)
- **Location**: `src-tauri/src/pty/mod.rs:100,182`
- **Description**: The shutdown `AtomicBool` uses `Ordering::Relaxed` for both loads and stores. On x86 (Windows primary target), this is effectively equivalent to `SeqCst` due to the strong memory model, so this is not a bug on the current target platform. However, on ARM (potential future Windows on ARM), `Relaxed` could theoretically allow the reader thread to miss the shutdown signal for an arbitrarily long time. As noted in the code review, the shutdown flag is largely redundant because `kill()` causes the PTY read to return, so this is defense-in-depth only.
- **Recommended Fix**: Change to `Ordering::Release` for the store and `Ordering::Acquire` for the load. This costs nothing on x86 and ensures correctness on ARM.
- **Severity Justification**: Low. The kill() path handles shutdown regardless. The flag is supplementary. Only affects ARM platforms where Velocity doesn't currently run.

**L-3: Reader thread buffer is 4096 bytes with no backpressure**

- **Vector**: Denial of Service (#9)
- **Location**: `src-tauri/src/pty/mod.rs:98`
- **Description**: The reader thread reads in 4096-byte chunks and emits each chunk immediately via Tauri events. If a process produces output faster than the WebView can process it (e.g., `cat /dev/urandom` or a runaway `while(true)` print loop), events will queue up in the Tauri event system. The frontend has a 100KB output buffer cap (`OUTPUT_BUFFER_LIMIT = 100_000` at `Terminal.tsx:5`) which mitigates frontend memory exhaustion, but the Tauri event queue itself could grow unbounded.
- **Recommended Fix**: For MVP, the 100KB frontend cap is sufficient. For robustness, consider:
  1. A backpressure mechanism (pause reading when event queue exceeds threshold)
  2. Rate-limiting event emission from the reader thread (e.g., batch output over 16ms windows)
- **Severity Justification**: Low. The 100KB frontend cap limits visible impact. Tauri's event system is memory-efficient enough that this would need extreme output rates to cause issues. Process will eventually be killed when user closes the session.

**L-4: `tauri-plugin-opener` still registered (carried from R1 L-2)**

- **Vector**: IPC Command Abuse (#2)
- **Location**: `src-tauri/src/lib.rs:11`, `src-tauri/capabilities/default.json:8`
- **Description**: The `opener` plugin is registered but not used by any application code. The `opener:default` permission scope is restrictive, but it's unnecessary attack surface.
- **Recommended Fix**: Remove `tauri-plugin-opener` from `Cargo.toml`, `lib.rs`, and `capabilities/default.json` unless actively used.
- **Severity Justification**: Low. Default scope is restrictive. No code invokes it.

## Dependency Audit

### npm audit

```
found 0 vulnerabilities
```

**Result**: Clean.

### cargo audit

**Vulnerabilities found: 0**
**Warnings found: 18** (all `unmaintained` or `unsound` advisories)

| Advisory | Crate | Type | Relevance |
|----------|-------|------|-----------|
| RUSTSEC-2024-0429 | `glib 0.18.5` | Unsound | Linux only (GTK3). Not applicable on Windows. |
| RUSTSEC-2025-0057 | `fxhash 0.2.1` | Unmaintained | Transitive via `tauri-utils`. No security impact. |
| 16 others | GTK3 bindings | Unmaintained | Linux only. Tauri transitive deps. Not actionable. |

**New dependency**: `portable-pty 0.9` — This is the core PTY library. It is maintained and widely used. No advisories found. Uses `unsafe` internally for Windows `ConPTY` API calls, which is expected and necessary for PTY functionality.

**New dependency**: `uuid 1` — Standard UUID generation. No advisories. Minimal attack surface.

**New dependency**: `tokio 1` (features: `rt`) — Only the runtime feature is included. No network I/O features. Minimal attack surface.

**Assessment**: No new vulnerability-bearing dependencies introduced. `portable-pty` is the most security-critical new dependency and should be monitored for advisories.

## Tauri Config Review

| Check | Status | Notes |
|-------|--------|-------|
| Command permissions are minimal | PASS | `core:default`, `opener:default`, `core:event:default` |
| No overly broad file system access | PASS | No `fs:` permissions granted |
| CSP is configured | PASS | Same as R1. `unsafe-inline` in style-src remains accepted. |
| No unnecessary capabilities | WARN | `opener:default` still present but unused (L-4) |
| Window creation is restricted | PASS | Single window `"main"`, capabilities scoped to `["main"]` |
| `core:event:default` is appropriate | PASS | Required for PTY output streaming. Default scope allows app-internal events only. |
| Custom IPC commands are registered | REVIEWED | 4 commands: `create_session`, `write_to_session`, `resize_session`, `close_session`. All have input validation via `SessionManager`. |

**New finding**: The `core:event:default` permission was added. This allows the WebView to listen for events emitted by the Rust backend. In the current architecture, event names are `pty:output:{uuid}`, `pty:error:{uuid}`, `pty:closed:{uuid}`. The UUID namespace prevents cross-session event eavesdropping — a listener for `pty:output:abc` cannot receive events for `pty:output:def`. This is a **good** security pattern.

## Unsafe Code Review

**No `unsafe` blocks found in the Velocity application code.**

The `unsafe` code exists only in transitive dependencies:
- `portable-pty` uses `unsafe` for Windows `ConPTY` API calls (FFI)
- Tauri framework internals
- Standard library

This is expected and acceptable.

## Overall Risk Assessment

### Current State: **MODERATE RISK**

The PTY engine represents a significant increase in attack surface from the bootstrap phase:

**Strengths:**
- Shell type validation uses a strict allowlist (`"powershell" | "cmd" | "wsl"`)
- No command injection: shell executables are hardcoded, user input is passed through the PTY stream (not interpolated into commands)
- React text rendering (`{output}` in JSX) properly escapes HTML entities, preventing XSS from terminal output
- Output buffer capped at 100KB on the frontend
- Session IDs use UUID v4, preventing guessability
- Event namespacing per session prevents cross-session eavesdropping
- `spawn_blocking` correctly used for all PTY operations, preventing async runtime starvation
- No `unwrap()` on user-derived data in Rust

**Weaknesses:**
- Full environment inherited by shells (H-1) — inherent to terminal emulators but increases blast radius of WebView compromise
- No session count cap (M-1) — potential DoS vector
- Raw ANSI sequences passed through unsanitized (M-3) — not exploitable today but will be when ANSI parser is added
- No input validation on session_id format (L-1)
- Reader thread has no backpressure mechanism (L-3)

### Risk Trajectory

The security posture is **acceptable for the current MVP milestone** but will require significant hardening for the following upcoming tasks:

| Upcoming Feature | Security Concern | Required Mitigation |
|-----------------|------------------|---------------------|
| ANSI Parser | Escape injection becomes exploitable | ANSI sequence allowlist, length limits |
| Block Model | If blocks use HTML rendering | Ensure output remains text-only or sanitized |
| Agent Mode | LLM-generated commands | Command preview, user confirmation, env var protection |
| Multi-pane | Cross-pane isolation | Ensure session isolation, no shared state leakage |

### Pre-ANSI-Parser Security Checklist

Before implementing the ANSI parser (likely next task), the following must be addressed:

- [ ] Define an ANSI sequence allowlist (which sequences to render)
- [ ] Define maximum sequence length (reject oversized sequences)
- [ ] Decide on OSC handling policy (title-set only? none?)
- [ ] Ensure parser does not implement file-write sequences
- [ ] Plan for adversarial input fuzzing of the parser

---

**Reviewed by**: Security Review Agent
**Review date**: 2026-03-11
**Verdict**: **PASS with conditions** — No blocking issues for PTY engine MVP. H-1 is accepted risk for terminal emulators. M-1 (session cap) should be addressed before multi-pane implementation. M-3 (ANSI sanitization) must be addressed when the ANSI parser is implemented.
