# Security Review — 2026-03-11

## Scope
- **Commit range**: `ca1902d..c98cfc8` (full codebase — first security review)
- **Tasks covered**: TASK-001 (bootstrap), FIX-001 (code review fixes)
- **HEAD at time of review**: `c98cfc8d1b8655126a121b784eb9c69a33d03f11`

## Attack Surface Map

The application is in **bootstrap phase**. All security-critical modules (PTY, ANSI parsing, commands, sessions) are placeholder directories containing only `.gitkeep` files. The current attack surface is minimal:

1. **Tauri IPC entry points**: None defined (no `#[tauri::command]` handlers)
2. **Process spawning**: None (no `Command::new`, no PTY code)
3. **Shell output rendering**: None (no ANSI parsing, no terminal output)
4. **File path handling**: None (no `fs::`, `File::`, `Path::` usage)
5. **Environment variable access**: `process.env.TAURI_DEV_HOST` in `vite.config.ts:5` (dev-time only, not a security concern)
6. **Process lifecycle management**: None (no child processes)
7. **Tauri plugin**: `tauri-plugin-opener` registered in `src-tauri/src/lib.rs:4`
8. **Webview entry point**: `index.html` loads `src/main.tsx` (static React app)
9. **CSP configuration**: `src-tauri/tauri.conf.json:23`
10. **Capability permissions**: `src-tauri/capabilities/default.json`

## Findings

### CRITICAL

None.

### HIGH

None.

### MEDIUM

**M-1: `unsafe-inline` in `style-src` CSP directive**

- **Vector**: N/A (defense-in-depth)
- **Location**: `src-tauri/tauri.conf.json:23`
- **Description**: The CSP includes `style-src 'self' 'unsafe-inline'`, which allows inline styles. While this is commonly required for React/CSS-in-JS frameworks, it weakens the CSP by allowing inline style injection. If an attacker achieves XSS (e.g., through terminal output rendering in future), inline styles could be used for UI redressing attacks — making dangerous commands appear benign.
- **Exploit Scenario**: In a future version where terminal output is rendered as HTML, a malicious ANSI sequence could inject an inline style that visually hides a dangerous command or overlays fake UI elements.
- **Recommended Fix**: Acceptable for now. When implementing terminal output rendering, ensure output is rendered as plain text (not HTML) so this vector cannot be exploited. Consider migrating to CSS Modules or a stylesheet-based approach to eventually remove `'unsafe-inline'`.
- **Severity Justification**: Medium because the vulnerability requires future code that doesn't exist yet, and `unsafe-inline` for styles is standard practice in React applications. Elevated from LOW because this is a terminal emulator where output rendering is a primary attack surface.

### LOW

**L-1: `.expect()` call in Tauri builder initialization**

- **Vector**: Denial of Service (local)
- **Location**: `src-tauri/src/lib.rs:5`
- **Description**: The line `.expect("error while running tauri application")` will panic if Tauri fails to initialize. While this is standard Tauri boilerplate and only triggers on catastrophic framework failure, it's worth noting for the project's no-`unwrap()` policy stated in CLAUDE.md.
- **Recommended Fix**: No action needed for bootstrap phase. This is the standard Tauri pattern and the panic occurs only if the entire framework fails to start. However, be mindful of this pattern when implementing custom Rust code — use `Result` propagation instead of `.expect()`/`.unwrap()`.
- **Severity Justification**: Low. This is framework boilerplate, not user-derived data, so it doesn't violate the security rule "No `unwrap()` on user-derived data in Rust."

**L-2: `tauri-plugin-opener` is registered but not restricted**

- **Vector**: IPC Command Abuse
- **Location**: `src-tauri/src/lib.rs:4`, `src-tauri/capabilities/default.json:8`
- **Description**: The `opener:default` permission is granted. This plugin allows the frontend to open URLs and files using the system's default application. While the default scope is restricted, as the application grows, a compromised or malicious webview could potentially use this to open arbitrary URLs or local files.
- **Recommended Fix**: When implementing pane/session functionality, audit whether `opener` is still needed. If it is, restrict its scope to specific URL patterns or file types in the capabilities config. Consider removing it if not actively used.
- **Severity Justification**: Low. The default Tauri `opener` scope is restrictive, and the current frontend has no code that invokes it.

**L-3: `.gitignore` contains `nul` entry on line 36**

- **Vector**: N/A (code quality)
- **Location**: `.gitignore:36`
- **Description**: The `.gitignore` contains a bare `nul` entry, which appears to be the Windows `NUL` device name. This is non-standard and while harmless, could indicate accidental file creation during development. The `nul` file is a Windows reserved device name that can't actually exist as a real file, so this line has no effect.
- **Recommended Fix**: Remove the `nul` entry from `.gitignore` to reduce confusion.
- **Severity Justification**: Low. No security impact. Cosmetic issue.

## Dependency Audit

### npm audit

```
found 0 vulnerabilities
```

**Result**: Clean. No known vulnerabilities in frontend dependencies.

### cargo audit

```
Scanning Cargo.lock for vulnerabilities (514 crate dependencies)
```

**Vulnerabilities found: 0**
**Warnings found: 18** (all `unmaintained` or `unsound` advisories)

#### Significant Warning

| Advisory | Crate | Type | Impact |
|----------|-------|------|--------|
| RUSTSEC-2024-0429 | `glib 0.18.5` | **Unsound** | Unsoundness in `Iterator` and `DoubleEndedIterator` impls for `glib::VariantStrIter`. Could potentially lead to undefined behavior if `VariantStrIter` is used. |

**Assessment**: The `glib` unsoundness advisory (RUSTSEC-2024-0429) is relevant only on Linux (GTK3 backend). On Windows, Tauri uses WebView2, not GTK. The affected code path (`VariantStrIter`) is unlikely to be triggered by Velocity's usage. All other warnings are `unmaintained` advisories for GTK3 bindings which are Tauri's transitive dependencies for Linux support — not controllable by Velocity and not applicable on the Windows target platform.

#### Unmaintained GTK3 Bindings (Linux-only, 17 warnings)

All related to `gtk-rs` GTK3 bindings being deprecated in favor of GTK4. These are transitive dependencies pulled in by Tauri's `wry`/`tao` runtime. Not actionable by Velocity — requires upstream Tauri migration.

- `atk 0.18.2` (RUSTSEC-2024-0413)
- `atk-sys 0.18.2` (RUSTSEC-2024-0416)
- `fxhash 0.2.1` (RUSTSEC-2025-0057)
- `gdk 0.18.2` (RUSTSEC-2024-0412)
- `gdk-sys 0.18.2` (RUSTSEC-2024-0418)
- `gdkwayland-sys 0.18.2` (RUSTSEC-2024-0411)
- `gdkx11 0.18.2` (RUSTSEC-2024-0417)
- `gdkx11-sys 0.18.2` (RUSTSEC-2024-0414)
- `gtk 0.18.2` (RUSTSEC-2024-0415)
- `gtk-sys 0.18.2` (RUSTSEC-2024-0420)
- `gtk3-macros 0.18.2` (RUSTSEC-2024-0419)
- `proc-macro-error 1.0.4` (RUSTSEC-2024-0370)
- `unic-char-property 0.9.0` (RUSTSEC-2025-0081)
- `unic-char-range 0.9.0` (RUSTSEC-2025-0075)
- `unic-common 0.9.0` (RUSTSEC-2025-0080)
- `unic-ucd-ident 0.9.0` (RUSTSEC-2025-0100)
- `unic-ucd-version 0.9.0` (RUSTSEC-2025-0098)

**Recommendation**: Monitor Tauri releases for GTK4 migration. No action available for Velocity.

## Tauri Config Review

| Check | Status | Notes |
|-------|--------|-------|
| Command permissions are minimal | PASS | Only `core:default` and `opener:default` |
| No overly broad file system access | PASS | No `fs:` permissions granted |
| CSP is configured | PASS | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'` |
| No unnecessary capabilities | PASS | Minimal set. `opener` may be removable later (see L-2) |
| Window creation is restricted | PASS | Single window `"main"` defined, capabilities scoped to `["main"]` |
| No dangerous plugins | PASS | Only `tauri-plugin-opener` (standard) |
| Identifier is properly scoped | PASS | `com.velocity.app` |
| No remote content loading | PASS | `frontendDist: "../dist"` (local bundle) |

## Unsafe Code Review

**No `unsafe` blocks found in the Velocity codebase.**

The only `unsafe` code exists in transitive dependencies (Tauri framework, system crate bindings). This is expected and not auditable at the application level.

## Overall Risk Assessment

### Current State: **LOW RISK**

The bootstrap codebase is well-configured from a security perspective:

- **CSP is enabled** and appropriately restrictive for a React + Tauri application
- **Capabilities are minimal** — only `core:default` and `opener:default`
- **No custom Rust code** means zero application-level attack surface
- **No process spawning, file access, or IPC commands** exist yet
- **TypeScript strict mode** is enabled, reducing type-related bugs
- **Dependency audit is clean** (no exploitable vulnerabilities)

### Future State: **HIGH RISK** (when PTY engine is implemented)

When Pillar 1 (Process Interfacing Engine) is implemented, the security posture will change dramatically. The following must be reviewed with each implementation task:

1. **Every `#[tauri::command]` handler** — validate all inputs on the Rust side
2. **PTY spawning code** — use `Command::new().arg()` pattern, never string interpolation
3. **ANSI parsing** — sanitize sequences before rendering, handle adversarial input
4. **Output streaming** — bound buffer sizes, handle infinite output, sanitize before DOM injection
5. **Capability additions** — review each new permission for minimal scope

### Pre-Implementation Security Checklist

Before starting Pillar 1, ensure:

- [ ] Define an IPC allowlist schema (which commands, which parameters, which types)
- [ ] Establish ANSI sequence whitelist (which sequences to render, which to strip)
- [ ] Plan output buffer management (max sizes, backpressure, memory limits)
- [ ] Design process lifecycle management (spawn, monitor, kill, cleanup)
- [ ] Document path validation strategy (working directories, no traversal)
- [ ] Plan environment variable inheritance (whitelist approach)

---

**Reviewed by**: Security Review Agent
**Review date**: 2026-03-11
**Verdict**: **PASS** — No blocking issues for bootstrap phase. Security foundation is solid.
