# Investigation: Comprehensive QA Audit -- All Findings Across All Reports

**Date**: 2026-03-14
**Investigator**: Claude Opus 4.6 (Investigator Agent)
**Scope**: Every QA report, code review, and security review ever filed for Velocity
**Purpose**: Identify findings that were MISSED (never addressed, never tracked), TRACKED (in STATE.md Outstanding Issues), or FIXED (resolved in a commit)

---

## Reports Reviewed

### QA Reports (5)
1. `QA-REPORT-TASK-003-ansi-filter-R1.md` (2026-03-12)
2. `QA-REPORT-TASK-003-ansi-filter-R2.md` (2026-03-12)
3. `QA-REPORT-2026-03-12-R3.md` (Block Model)
4. `QA-REPORT-2026-03-13.md` (Input Editor / TASK-008)
5. `QA-REPORT-2026-03-13-R2.md` (Tabs / TASK-009)

### Code Reviews (12)
1. `CODE-REVIEW-TASK-001-bootstrap-R1.md`
2. `CODE-REVIEW-TASK-001-bootstrap-R2.md`
3. `CODE-REVIEW-TASK-002-pty-engine-R1.md`
4. `CODE-REVIEW-TASK-002-pty-engine-R2.md`
5. `CODE-REVIEW-TASK-003-ansi-filter-R1.md`
6. `CODE-REVIEW-TASK-003-ansi-filter-R2.md`
7. `CODE-REVIEW-TASK-004-lifecycle-and-shells-R1.md`
8. `CODE-REVIEW-TASK-004-lifecycle-and-shells-R2.md`
9. `CODE-REVIEW-TASK-005-block-model-R1.md`
10. `CODE-REVIEW-TASK-005-block-model-R2.md`
11. `CODE-REVIEW-TASK-006-test-coverage-R1.md`
12. `CODE-REVIEW-TASK-008-input-editor-R1.md`
13. `CODE-REVIEW-TASK-008-input-editor-R2.md`
14. `CODE-REVIEW-TASK-009-tabs-R1.md`
15. `CODE-REVIEW-TASK-009-tabs-R2.md`

### Security Reviews (5)
1. `SECURITY-REVIEW-TASK-001-bootstrap-R1.md`
2. `SECURITY-REVIEW-TASK-002-pty-engine-R1.md`
3. `SECURITY-REVIEW-TASK-003-ansi-filter-R1.md`
4. `SECURITY-REVIEW-TASK-004-lifecycle-and-shells-R1.md`
5. `SECURITY-REVIEW-TASK-005-block-model-R1.md`

### Other
- `INVESTIGATION-test-coverage-gaps.md`
- `prompts/STATE.md` (Outstanding Issues)
- Full git log (all commits)

---

## Methodology

For every finding identified in every report, I determined its status:

- **FIXED**: A git commit explicitly addressed this finding
- **TRACKED**: The finding appears in STATE.md Outstanding Issues
- **MISSED**: The finding was raised in a report but was NEVER fixed AND NEVER tracked in STATE.md

---

## Section 1: QA Bug Findings (BUG-001 through BUG-038)

| Bug ID | Severity | Title | Origin | Status | Evidence |
|--------|----------|-------|--------|--------|----------|
| BUG-001 | Low | Backspace handling deviates from task spec (intentional) | QA R1 | **FIXED** | Backspace explicitly stripped in `cc00770` |
| BUG-002 | Low | Reader thread blocks on read() ignoring shutdown flag | QA R1 | **ACCEPTED** | By design, mitigated by child.kill(). No fix needed. |
| BUG-003 | Low | close_session holds mutex during blocking cleanup | QA R1 | **ACCEPTED** | Future concern for multi-session. Deferred. |
| BUG-004 | Medium | Full output buffer re-parse on every PTY event (perf) | QA R1 | **TRACKED** | In STATE.md as BUG-004 |
| BUG-005 | Low | Relaxed memory ordering for cross-thread flag | QA R1 | **ACCEPTED** | Acceptable on x86, noted across multiple reviews |
| BUG-006 | Medium | No input validation for rows/cols (0 or extreme values) | QA R1 | **FIXED** | `validate_dimensions()` added in `85c34dd` |
| BUG-007 | Low | resize_session never called from frontend (missing feature) | QA R1 | **ACCEPTED** | Known missing feature, not a bug |
| BUG-008 | Medium | Race condition: old session output may flash during shell switch | QA R2 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-009 | Medium | Rapid shell switching creates orphaned sessions | QA R2 | **TRACKED** | In STATE.md as BUG-009 |
| BUG-010 | Low | Rapid restart clicks can create orphaned sessions | QA R2 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-011 | Low | Unmount during session creation can leak session | QA R2 | **PARTIALLY FIXED** | `startSessionIdRef` cancellation guard added (noted in QA R4) but not fully tracked |
| BUG-012 | N/A | slave PTY handle drop timing (not a bug) | QA R2 | **N/A** | Documented as non-bug |
| BUG-013 | N/A | vte::Parser take pattern (not a bug) | QA R2 | **N/A** | Documented as non-bug |
| BUG-014 | Low | Error messages rendered through ANSI parser without sanitization | QA R2 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-015 | Medium | Input field remains active after session creation failure | QA R3 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-016 | Low | Direct mutation of block object before entering state (code style) | QA R3 | **ACCEPTED** | Non-runtime issue, acceptable |
| BUG-017 | Low | Empty command submission creates welcome-like block | QA R3 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-018 | Low | Rerun has no visual indication vs fresh command (UX observation) | QA R3 | **ACCEPTED** | Noted as non-bug, UX observation |
| BUG-019 | N/A | Performance: full output re-parse (same as BUG-004) | QA R3 | **TRACKED** | Same as BUG-004 |
| BUG-020 | Medium | Welcome block retains 'running' status after session close | QA R3 | **TRACKED** | In STATE.md as BUG-020 |
| BUG-021 | Medium | handleCopyOutput uses stale block.output (analysis: not actually stale) | QA R3 | **N/A** | QA determined this is NOT actually a bug |
| BUG-022 | Medium | Rapid shell switching race (same as BUG-009, now affects blocks) | QA R3 | **TRACKED** | Same as BUG-009 |
| BUG-023 | Low | handleCopyCommand on welcome block has no guard | QA R3 | **ACCEPTED** | UI correctly hides the button; non-issue |
| BUG-024 | Low | formattedTime may display wrong timezone | QA R3 | **ACCEPTED** | Standard browser behavior, non-bug |
| BUG-025 | Medium | No per-block output size limit | QA R3 | **TRACKED** | In STATE.md as BUG-025 |
| BUG-026 | Medium | Multi-line command \n not converted to \r for PTY | QA R4 | **FIXED** | Fixed in `d306f4c` |
| BUG-027 | Low | Tab cursor position restoration via rAF timing issue | QA R4 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-028 | Low | Flag-like filenames after redirect misclassified by tokenizer | QA R4 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-029 | Low | Tokenizer doesn't recognize ; && || as command separators | QA R4 | **TRACKED** | In STATE.md as BUG-029 |
| BUG-030 | Medium | Overlay height mismatch with textarea | QA R4 | **FIXED** | Fixed in `d306f4c` |
| BUG-031 | Low | Overlay scroll desync on very long content | QA R4 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-032 | Low | Disabled state does not gate handleKeyDown | QA R4 | **MISSED** | Never fixed, never tracked in STATE.md |
| BUG-033 | Medium | Tab close -> closeSession is fire-and-forget with swallowed errors | QA R5 | **TRACKED** | In STATE.md as BUG-033 |
| BUG-034 | Medium | No frontend enforcement of MAX_SESSIONS=20 tab limit | QA R5 | **TRACKED** | In STATE.md as BUG-034 |
| BUG-035 | Low | autoFocus on hidden tab textareas (latent) | QA R5 | **TRACKED** | In STATE.md as BUG-035 |
| BUG-036 | N/A | Closing first tab selects index 0 (analysis: NOT a bug) | QA R5 | **N/A** | Verified correct behavior |
| BUG-037 | N/A | Tab counter not reset (informational, not a bug) | QA R5 | **N/A** | Informational only |
| BUG-038 | Low | Ctrl+W preventDefault fires even with 1 tab | QA R5 | **MISSED** | Never fixed, never tracked in STATE.md |

---

## Section 2: Code Review Findings

### TASK-001 Bootstrap
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-001-C1: CSP disabled | Critical | **FIXED** | Fixed in `c98cfc8` |
| CR-001-C2: .gitignore backslash path | Critical | **FIXED** | Fixed in `c98cfc8` |
| CR-001-I3: .expect() in lib.rs | Important | **ACCEPTED** | Framework boilerplate, not user-derived data |
| CR-001-I4: Tests use toBeDefined() | Important | **FIXED** | Fixed in `c98cfc8` |
| CR-001-I5: @ts-expect-error in vite.config | Important | **MISSED** | Never addressed. Low priority but was flagged. |
| CR-001-S6: Non-monospace fonts | Suggestion | **PARTIALLY FIXED** | Terminal output uses monospace now (via CSS in later tasks) |
| CR-001-S8: No Rust tests | Suggestion | **FIXED** | Rust tests added in later tasks |
| CR-001-R2-S3: Untracked `nul` file | Suggestion | **MISSED** | Never cleaned up, not tracked |
| CR-001-R2-I2: CSP may need connect-src for IPC | Important | **RESOLVED** | Tauri v2 handles this automatically; verified working |

### TASK-002 PTY Engine
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-002-C1: Mutex held across blocking I/O | Critical | **FIXED** | spawn_blocking added in `c65cc00` |
| CR-002-I1: Reader thread has no shutdown mechanism | Important | **FIXED** | Shutdown flag added in `c65cc00` |
| CR-002-I2: close_session doesn't wait for child exit | Important | **FIXED** | try_wait/wait added in `c65cc00` |
| CR-002-I3: act() warnings in tests | Important | **FIXED** | Tests made async in `c65cc00` |
| CR-002-I4: UTF-8 split across read boundaries | Important | **MISSED** | `String::from_utf8_lossy` still used. Deferred in R2 but NEVER tracked. |
| CR-002-I5: Terminal uses invoke directly | Important | **FIXED** | IPC wrappers used in `c65cc00` |
| CR-002-I6: No error handling for write failures | Important | **FIXED** | Write errors surfaced in `c65cc00` |
| CR-002-R2-I1: close_session 100ms sleep inefficiency | Important | **MISSED** | Accepted in R2 but never tracked or optimized |
| CR-002-R2-S1: Trivial AtomicBool tests | Suggestion | **MISSED** | Tests still exist, test std library not app logic |
| CR-002-R2-S2: closeSession error swallowed in cleanup | Suggestion | **MISSED** | Still uses `.catch(() => {})` -- no console.error |
| CR-002-R2-S3: Missing test for event listener registration | Suggestion | **MISSED** | Never addressed across any task |
| CR-002-R2-S4: Consider tokio::sync::Mutex | Suggestion | **ACCEPTED** | Future consideration, not a bug |

### TASK-003 ANSI Filter
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-003-C1: AnsiOutput re-parses entire buffer | Critical | **FIXED** | useMemo added in `cc00770` |
| CR-003-C2: Backspace passthrough | Critical | **FIXED** | Backspace stripped in `cc00770` |
| CR-003-I1: Untestable oversize SGR check | Important | **FIXED** | Documented as defense-in-depth in `cc00770` |
| CR-003-I2: Cross-module test placement | Important | **FIXED** | Moved to pty module in `cc00770` |
| CR-003-I3: Parser created per filter() call | Important | **FIXED** | Parser persisted in `cc00770` |
| CR-003-I4: AnsiOutput not memoized | Important | **FIXED** | React.memo added in `cc00770` |
| CR-003-I5: remove_empty option not used | Important | **FIXED** | Added in `cc00770` |
| CR-003-R2-S1: #[deny(unsafe_code)] on ansi module | Suggestion | **MISSED** | Suggested in BOTH R1 and R2, never addressed |
| CR-003-R2-S2: output.clone() allocation per filter call | Suggestion | **MISSED** | Never optimized |
| CR-003-R2-S3: Parser persistence test could be stricter | Suggestion | **MISSED** | Still uses `contains()` not exact equality |

### TASK-004 Lifecycle + Shells
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-004-C1: Race condition in handleShellSwitch | Critical | **FIXED** | sessionIdRef pattern in `4953590` |
| CR-004-C2: Unmount cleanup abuses setSessionId setter | Critical | **FIXED** | sessionIdRef pattern in `4953590` |
| CR-004-I1: startSession empty dependency array | Important | **FIXED** | Updated in `4953590` |
| CR-004-I2: Dual-path restart undocumented | Important | **MISSED** | No comment added. Noted as not addressed in R2. |
| CR-004-I3: Shell selector buttons lack proper ARIA roles | Important | **FIXED** | ARIA roles added in `4953590` |
| CR-004-I4: handleRestart/handleShellSwitch duplicate cleanup | Important | **FIXED** | resetAndStart extracted in `4953590` |
| CR-004-S1: validate_dimensions could use range syntax | Suggestion | **MISSED** | Still uses if/else, not range syntax |
| CR-004-S2: Consider disabling shell buttons during creation | Suggestion | **MISSED** | Never implemented. Related to BUG-009. |
| CR-004-S3: Test doesn't verify listener cleanup on switch | Suggestion | **MISSED** | Never addressed |
| CR-004-S4: pty.ts wrapper types don't enforce ShellType | Suggestion | **FIXED** | Fixed in `4953590` |
| CR-004-S5: Extract terminal dimension constants | Suggestion | **MISSED** | 24, 80 still hardcoded in multiple places |
| CR-004-R2-N1: Narrow race window remains | Observation | **TRACKED** | Same as BUG-009 in STATE.md |

### TASK-005 Block Model
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-005-NC1: OUTPUT_BUFFER_LIMIT removed without replacement | Low | **TRACKED** | Same as BUG-025 in STATE.md |
| CR-005-NC2: test_blocks_limited_to_max is tautology | Low | **FIXED** | Now imports MAX_BLOCKS in `5e6afb6` |
| CR-005-NC3: Duplicated block creation logic | Low | **FIXED** | submitCommand extracted in `5e6afb6` |
| CR-005-NC4: Clipboard promises unhandled | Low | **FIXED** | .catch() added in `5e6afb6` |
| CR-005-NC6: React.memo + onRerun ref instability | Low | **ACCEPTED** | Negligible impact, acceptable |

### TASK-006 Test Coverage Refactor
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-006-NC1: Debug eprintln! in reader thread | Low | **MISSED** | Debug prints still present in production code |
| CR-006-NC2: PtyEvent::Output sends empty strings | Low | **MISSED** | No `if !output.is_empty()` guard added |
| CR-006-NC5: Duplicate test_pty_event_variants | Informational | **MISSED** | Still duplicated in unit + integration tests |

### TASK-008 Input Editor
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-008-M1: shellType prop unused | Must Fix | **FIXED** | Removed in `2455f55` |
| CR-008-M2: fullMatch variable unused | Must Fix | **FIXED** | Renamed to _fullMatch in `2455f55` |
| CR-008-M3: Dead CSS rules | Must Fix | **FIXED** | Removed in `2455f55` |
| CR-008-S1: Unclosed quotes mishandled | Should Fix | **FIXED** | Regex updated in `2455f55` |
| CR-008-S2: Tab test is weak | Should Fix | **FIXED** | Rewritten in `2455f55` |
| CR-008-S3: Overlay scroll desync risk | Should Fix | **MISSED** | Not addressed (accepted as edge case) |
| CR-008-N1: No aria-label on textarea | Nice to Have | **MISSED** | Still missing, noted again in R2 |
| CR-008-N3: No data-testid on highlight overlay | Nice to Have | **MISSED** | Never added |

### TASK-009 Tabs
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| CR-009-F01: handleCloseTab stale closure | Medium | **FIXED** | activeTabIdRef pattern in `7d8975e` |
| CR-009-F02: Missing Ctrl+W test | Low | **FIXED** | Test added in `7d8975e` |
| CR-009-F03: .tab-panel missing display: flex | Nit | **MISSED** | Not addressed (works at runtime via inline style) |
| CR-009-F04: Unused closeButtons variable in test | Nit | **MISSED** | Never removed |
| CR-009-F09: No frontend tab limit (MAX_SESSIONS) | Future | **TRACKED** | In STATE.md as BUG-034 |

---

## Section 3: Security Review Findings

### TASK-001 Bootstrap Security
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| SEC-001-M1: unsafe-inline in style-src CSP | Medium | **ACCEPTED** | Repeatedly noted, accepted risk across all reviews |
| SEC-001-L1: .expect() in Tauri builder | Low | **ACCEPTED** | Framework boilerplate |
| SEC-001-L2: tauri-plugin-opener registered but unused | Low | **FIXED** | Removed in TASK-003 (`7ddb968`) |
| SEC-001-L3: .gitignore contains nul entry | Low | **MISSED** | Never cleaned up |

### TASK-002 PTY Engine Security
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| SEC-002-H1: Full parent environment inherited by shells | High | **ACCEPTED** | Inherent to terminal emulators. Documented. |
| SEC-002-M1: No rate limiting / session cap on create_session | Medium | **FIXED** | MAX_SESSIONS=20 added in TASK-003 |
| SEC-002-M2: unsafe-inline in style-src (carried) | Medium | **ACCEPTED** | Carried forward, accepted |
| SEC-002-M3: PTY output streamed raw/unsanitized | Medium | **FIXED** | ANSI filter added in TASK-003 |
| SEC-002-L1: Session IDs not validated on input (UUID format) | Low | **MISSED** | Never addressed across any task. Mentioned in EVERY security review. |
| SEC-002-L2: Ordering::Relaxed on shutdown flag | Low | **ACCEPTED** | Acceptable on x86 |
| SEC-002-L3: Reader thread buffer with no backpressure | Low | **ACCEPTED** | 100KB frontend cap mitigates |
| SEC-002-L4: tauri-plugin-opener still registered | Low | **FIXED** | Removed in TASK-003 |

### TASK-003 ANSI Filter Security
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| SEC-003-M1: Anser color strings flow unsanitized into CSS rgb() | Medium | **MISSED** | No frontend color string validation added. Never tracked. |
| SEC-003-M2: unsafe-inline in style-src (carried) | Medium | **ACCEPTED** | Carried forward |
| SEC-003-L1: No test for DCS sequences | Low | **MISSED** | Test never written |
| SEC-003-L2: No test for APC sequences | Low | **MISSED** | Test never written |
| SEC-003-L3: Bracketed paste mode test missing | Low | **MISSED** | Test never written |
| SEC-003-L4: Ordering::Relaxed (carried) | Low | **ACCEPTED** | Carried forward |
| SEC-003-L5: Session ID format not validated (carried) | Low | **MISSED** | Never addressed |

### TASK-004 Lifecycle Security
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| SEC-004-M1: Race condition in rapid shell switching | Medium | **TRACKED** | Same as BUG-009 |
| SEC-004-M2: Stale listeners during session transition | Medium | **MISSED** | Security review recommended reordering cleanupListeners before closeSession. Never done. |
| SEC-004-L1: Shell buttons not disabled during switch | Low | **MISSED** | Never implemented |
| SEC-004-L2: Mount/unmount race can orphan session | Low | **PARTIALLY FIXED** | startSessionIdRef added in TASK-008 |

### TASK-005 Block Model Security
| Finding | Severity | Status | Notes |
|---------|----------|--------|-------|
| SEC-005-M1: Rerun replays command without confirmation | Medium | **MISSED** | No confirmation dialog, no input pre-population. Never tracked. |
| SEC-005-M2: Unbounded per-block output accumulation | Medium | **TRACKED** | Same as BUG-025 |
| SEC-005-L1: stripAnsi regex only strips SGR (brittle) | Low | **MISSED** | No more comprehensive regex or documentation of coupling |
| SEC-005-L2: Command text in block header not length-bounded | Low | **MISSED** | No CSS overflow handling added |
| SEC-005-L3: Clipboard write errors silently swallowed | Low | **FIXED** | .catch() added in `5e6afb6` (but still silent -- no user feedback) |
| SEC-005-L4: crypto.randomUUID() availability not checked | Low | **ACCEPTED** | Non-issue in Tauri WebView2 |

---

## Section 4: Coverage Gap Findings from QA Reports

| Gap ID | Description | Risk | Status | Notes |
|--------|-------------|------|--------|-------|
| GAP-001 | No test for MAX_BLOCKS enforcement behavior | High | **PARTIALLY FIXED** | Constant test fixed in `5e6afb6` but no behavioral test for slice logic |
| GAP-002 | No test for output accumulation into active block | Medium | **MISSED** | Never addressed |
| GAP-003 | No test for block status transition (running -> completed) | Medium | **MISSED** | Never addressed |
| GAP-004 | No test for Copy Output button | Medium | **MISSED** | Never addressed |
| GAP-005 | No test that Copy Output strips ANSI | Medium | **MISSED** | Never addressed |
| GAP-006 | No test for rerun from Terminal (end-to-end) | Medium | **MISSED** | Never addressed |
| GAP-007 | No test that blocks are cleared on shell switch | Medium | **MISSED** | Never addressed |
| GAP-101 | No test for escaped characters in strings | Medium | **MISSED** | Never addressed |
| GAP-102 | No test for mixed quoting | Medium | **MISSED** | Never addressed |
| GAP-104 | No test for multi-line submit end-to-end | Medium | **MISSED** | Never addressed |
| GAP-105 | No test for Tab insertion at cursor mid-text | Medium | **MISSED** | Never addressed |
| GAP-111 | No test for overlay content matching textarea | Medium | **MISSED** | Never addressed |
| GAP-201 | No test for closing inactive (non-active) tab | Medium | **MISSED** | Never addressed |
| GAP-202 | No test for closeSession called on tab close | High | **FIXED** | Commit `9f4d988` explicitly addresses GAP-202 |
| GAP-203 | No test for tab limit (20+ tabs matching MAX_SESSIONS) | Medium | **MISSED** | Never addressed |
| GAP-206 | No test that output from Tab 1 does not appear in Tab 2 | Medium | **MISSED** | Never addressed |
| GAP-209 | No E2E tests for tab interactions | Medium | **MISSED** | E2E tests exist but not updated for tabs |

---

## Section 5: Summary -- All MISSED Findings

### MISSED Medium-Severity Findings (Require Attention)

These are findings that were explicitly raised in reports but were NEVER fixed AND NEVER tracked in STATE.md.

| # | Finding | Source | Severity | Recommendation |
|---|---------|--------|----------|----------------|
| 1 | **BUG-008**: Race condition -- old session output may flash during shell switch | QA R2 | Medium | Low practical impact due to React batching. **Track in STATE.md as Low.** |
| 2 | **BUG-015**: Input field remains active after session creation failure (confusing UX) | QA R3 | Medium | Easy fix: set `setClosed(true)` in catch block. **Should fix.** |
| 3 | **SEC-003-M1**: Anser color strings flow unsanitized into CSS rgb() values | Security R3 | Medium | Add a regex validation for color strings. **Should fix for defense-in-depth.** |
| 4 | **SEC-004-M2**: Stale event listeners can fire during session transition | Security R4 | Medium | Reorder `cleanupListeners()` before `closeSession()`. **Should fix -- one-line change.** |
| 5 | **SEC-005-M1**: Rerun action replays command without user confirmation | Security R5 | Medium | Industry standard (Warp has same pattern). **Track as accepted risk or add input pre-population.** |
| 6 | **CR-002-I4**: UTF-8 split across read boundaries (lossy conversion) | Code Review R2 | Important | Multi-byte chars split across reads produce replacement chars. **Track in STATE.md.** |

### MISSED Low-Severity Findings (Track or Accept)

| # | Finding | Source | Notes |
|---|---------|--------|-------|
| 7 | **BUG-010**: Rapid restart clicks can create orphaned sessions | QA R2 | Same class as BUG-009 (tracked). Should add to STATE.md. |
| 8 | **BUG-014**: Error messages rendered through ANSI parser | QA R2 | Defensive concern. Not exploitable. Track or accept. |
| 9 | **BUG-017**: Empty command submission creates welcome-like block | QA R3 | UX issue. Simple guard fix. Track. |
| 10 | **BUG-027**: Tab cursor restoration via rAF timing issue | QA R4 | Edge case. Accept. |
| 11 | **BUG-028**: Flag-like filenames after redirect misclassified | QA R4 | Visual only. Accept. |
| 12 | **BUG-031**: Overlay scroll desync on long content | QA R4 | Edge case. Accept for now. |
| 13 | **BUG-032**: Disabled state does not gate handleKeyDown | QA R4 | Parent guards prevent damage. Accept. |
| 14 | **BUG-038**: Ctrl+W preventDefault fires with 1 tab | QA R5 | Dev annoyance only. Accept. |
| 15 | **SEC-002-L1 / SEC-003-L5**: Session ID format not validated (UUID) | Security R2-R5 | Raised in EVERY security review, never addressed. Track. |
| 16 | **SEC-003-L1**: No test for DCS sequences | Security R3 | Implementation is correct but untested. Track. |
| 17 | **SEC-003-L2**: No test for APC sequences | Security R3 | Implementation is correct but untested. Track. |
| 18 | **SEC-003-L3**: No test for bracketed paste mode sequences | Security R3 | Implementation is correct but untested. Track. |
| 19 | **CR-003-R2-S1**: No `#[deny(unsafe_code)]` on ansi module | Code Review R1+R2 | Suggested twice, never done. |
| 20 | **CR-006-NC1**: Debug eprintln! left in reader thread | Code Review R6 | Production noise. Should clean up. |
| 21 | **CR-006-NC2**: PtyEvent::Output sends empty strings | Code Review R6 | Unnecessary state updates. Minor optimization. |
| 22 | **CR-008-N1**: No aria-label on textarea | Code Review R8 | Accessibility gap. Noted in both R1 and R2. |
| 23 | **SEC-005-L1**: stripAnsi regex only strips SGR (brittle coupling) | Security R5 | Correct now but fragile if Rust filter scope changes. |
| 24 | **SEC-005-L2**: Command text in block header not length-bounded | Security R5 | CSS overflow concern. |

### Significant Coverage Gaps Never Addressed

| # | Gap | Risk | Notes |
|---|-----|------|-------|
| 25 | No test for output accumulation into active block (GAP-002) | Medium | Core data flow untested |
| 26 | No test for block status transition (GAP-003) | Medium | Running indicator logic untested |
| 27 | No test for Copy Output button (GAP-004) | Medium | Clipboard + ANSI strip untested |
| 28 | No test for rerun end-to-end through Terminal (GAP-006) | Medium | submitCommand via rerun untested |
| 29 | No test for blocks cleared on shell switch (GAP-007) | Medium | Reset logic untested |
| 30 | No test for multi-line submit end-to-end (GAP-104) | Medium | Flagship feature untested |
| 31 | No test for closing inactive tab (GAP-201) | Medium | Active tab preservation untested |
| 32 | No test for output isolation between tabs (GAP-206) | Medium | Cross-tab contamination untested |

---

## Section 6: What IS Properly Tracked in STATE.md

The following bugs ARE in STATE.md Outstanding Issues and are properly deferred:

| Bug ID | Severity | Title |
|--------|----------|-------|
| BUG-034 | Medium | No frontend enforcement of MAX_SESSIONS=20 |
| BUG-033 | Medium | Tab close -> closeSession fire-and-forget |
| BUG-025 | Medium | No per-block output size limit |
| BUG-020 | Medium | Welcome block retains running status after close |
| BUG-009 | Medium | Rapid shell switching race creates orphaned sessions |
| BUG-004 | Medium | Full ANSI re-parse per PTY event (perf) |
| BUG-029 | Low | Tokenizer doesn't recognize ; && || |
| BUG-035 | Low | autoFocus on hidden tabs |

**Total tracked: 8 bugs (6 Medium, 2 Low)**

---

## Section 7: Recommendations

### Immediate Action Required (Medium+ Severity MISSED Items)

1. **BUG-015** (Medium): Add `setClosed(true)` in Terminal.tsx catch block when session creation fails. This is a simple one-liner that fixes confusing UX.

2. **SEC-004-M2** (Medium): Reorder `cleanupListeners()` to BEFORE `closeSession()` in `resetAndStart`. One-line reorder that eliminates cross-session data bleed window.

3. **SEC-003-M1** (Medium): Add color string validation in `src/lib/ansi.ts` before interpolating Anser color values into `rgb()`. A simple regex check like `/^\d{1,3}(,\s*\d{1,3}){2}$/` adds defense-in-depth.

### Should Track in STATE.md

The following MISSED findings should be added to STATE.md Outstanding Issues:

- **BUG-010 (Low)**: Rapid restart clicks can create orphaned sessions
- **BUG-014 (Low)**: Error messages rendered through ANSI parser
- **BUG-015 (Medium)**: Input field active after session creation failure
- **BUG-017 (Low)**: Empty command submission creates welcome-like block
- **CR-002-I4 (Medium)**: UTF-8 split across read boundaries
- **SEC-002-L1 (Low)**: Session ID format not validated (raised in 4+ reviews)
- **SEC-003-M1 (Medium)**: Anser color string validation missing
- **SEC-004-M2 (Medium)**: Stale listener ordering in resetAndStart
- **SEC-005-M1 (Medium)**: Rerun without confirmation (or accept explicitly)

### Can Accept (Low Risk, Documented)

The following MISSED findings are low severity and can be explicitly accepted:

- BUG-008, BUG-027, BUG-028, BUG-031, BUG-032, BUG-038
- CR-001-I5, CR-002-R2-S1/S2/S3, CR-003-R2-S1/S2/S3
- CR-004-S1/S3/S5, CR-006-NC1/NC2/NC5
- CR-008-N1/N3, CR-009-F03/F04
- SEC-001-L3, SEC-003-L1/L2/L3
- SEC-005-L1/L2

---

## Conclusion

**Total unique findings across all reports**: ~130+

**Properly FIXED**: ~40 findings resolved in fix commits
**Properly TRACKED**: 8 bugs in STATE.md Outstanding Issues
**ACCEPTED/N/A**: ~30 findings documented as non-bugs or accepted risk
**MISSED**: ~50+ findings never fixed AND never tracked

Of the missed findings:
- **6 are Medium severity** and should receive attention
- **~18 are Low severity** that should be tracked or explicitly accepted
- **~8 are significant test coverage gaps** that leave core functionality undertested
- **~20 are suggestions/nits** that can be safely deferred

The most concerning pattern is **SEC-002-L1 (session ID format validation)** which was flagged in EVERY security review (4 consecutive reviews: TASK-002, TASK-003, TASK-004, TASK-005) and was never addressed or tracked. Similarly, **SEC-003-M1 (Anser color string validation)** and **SEC-004-M2 (stale listener ordering)** were security review recommendations that fell through the cracks entirely.

The CTO's acknowledged miss of **GAP-202** has been confirmed as the only HIGH-priority coverage gap that was missed. It has since been fixed in commit `9f4d988`. No other HIGH-severity findings were missed.
