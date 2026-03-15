# Investigation: E2E Test Coverage Gaps

**Date**: 2026-03-15
**Investigator**: Audit Agent
**Scope**: E2E (Playwright) test coverage across all 4 implemented pillars

---

## 1. Current E2E Inventory

### Spec Files: 3 files, 8 tests total

**e2e/terminal-basic.spec.ts** (4 tests):
1. `app loads with shell selector and input` -- verifies shell selector, PowerShell default, input editor visible
2. `PowerShell prompt appears in welcome block` -- waits for "PS" text in output
3. `type command and see output in block` -- `echo hello-e2e-test`, sees output
4. `multiple commands create multiple blocks` -- two commands, both outputs visible

**e2e/shell-switching.spec.ts** (3 tests):
5. `switch to CMD shell` -- click CMD, verify aria-selected, run command
6. `switch back to PowerShell after CMD` -- CMD then back to PowerShell, run command
7. `switch to WSL shell (skipped if unavailable)` -- click WSL, handle unavailability

**e2e/block-actions.spec.ts** (1 test):
8. `block shows command text in header` -- run command, verify `.block-command` text

### Support Files:
- `e2e/fixtures.ts` -- dev server fixture, Tauri app launch via CDP, `appPage` fixture

---

## 2. Feature-by-Feature Coverage Matrix

| Feature | E2E Covered? | Existing Test(s) | Notes |
|---------|-------------|-------------------|-------|
| Terminal loads and shows prompt | YES | #1, #2 | |
| Type command, see output in block | YES | #3 | |
| Multiple commands create multiple blocks | YES | #4 | |
| Shell switching (PowerShell, CMD, WSL) | YES | #5, #6, #7 | |
| Block header shows command text | YES | #8 | |
| Block action: Copy Command | NO | -- | QA manual plan MT-013 |
| Block action: Copy Output | NO | -- | QA manual plan MT-013 |
| Block action: Rerun | NO | -- | QA manual plan MT-014 |
| Exit code indicators (checkmark/X) | NO | -- | QA manual plan Test 1-3 (TASK-012) |
| Tab creation (Ctrl+T or + button) | NO | -- | QA manual plan MT-033, MT-036 |
| Tab switching preserves terminal state | NO | -- | QA manual plan MT-035 |
| Tab close kills session | NO | -- | QA manual plan MT-034, MT-037 |
| Split pane creation | NO | -- | QA manual plan Test 1-3 (TASK-010) |
| Split pane independent output | NO | -- | QA manual plan Test 1 (TASK-010) |
| Pane divider resize | NO | -- | QA manual plan Test 6-10 (TASK-013) |
| Input editor multi-line (Shift+Enter) | NO | -- | QA manual plan MT-022, MT-025 |
| Syntax highlighting visible | NO | -- | QA manual plan MT-021 |
| Ghost text suggestions | NO | -- | No manual plan exists |
| Command history (Up/Down arrows) | NO | -- | No manual plan exists |
| Restart after process exit | NO | -- | QA manual plan MT-003 |

**Summary**: 5 of 20 features have E2E coverage. 15 features are completely untested at the E2E level.

---

## 3. Analysis of QA Manual Test Plans That Should Be Automated

Across 7 QA reports, there are 42 manual test plans (MT-001 through MT-042, plus 16 additional test plans in the TASK-010 and TASK-012/013/014 reports). These were written because the QA agent could not execute them -- they require a running app.

### High-Value Manual Tests to Automate

The following manual test plans describe core user flows that are most valuable as E2E tests:

| QA Plan | Description | Report |
|---------|-------------|--------|
| MT-003 | Restart after process exit: `exit`, see Restart button, click it, new session works | R2 |
| MT-011 | Block creation on command submit: welcome block, command block with header/timestamp | R3 |
| MT-013 | Copy Command / Copy Output: verify clipboard contents | R3 |
| MT-014 | Rerun command: click Rerun, new block created | R3 |
| MT-016 | Blocks cleared on shell switch | R3 |
| MT-020 | Block running indicator (pulsing dot) | R3 |
| MT-022 | Multi-line input: Shift+Enter, verify textarea grows | R4 |
| MT-025 | Enter submits, Shift+Enter does not | R4 |
| MT-033 | Tab creation and switching | R5 |
| MT-034 | Tab close behavior | R5 |
| MT-035 | Terminal state preservation across tab switches | R5 |
| MT-037 | Session cleanup on tab close | R5 |
| Test 1-3 (TASK-010) | Split pane creation (horizontal, vertical, nested) | TASK-010 |
| Test 4 (TASK-010) | Close pane | TASK-010 |
| Test 1-3 (TASK-012) | Exit code display (success, failure, marker not visible) | TASK-012/013/014 |
| Test 6-7 (TASK-013) | Pane resize: drag divider, clamp boundaries | TASK-012/013/014 |
| Test 11-12 (TASK-014) | Per-tab focus: preserved across tab switch, independent across tabs | TASK-012/013/014 |

---

## 4. Prioritized Missing E2E Tests

### Must Have (Core user flows that prove the app works end-to-end)

These tests validate the primary user experience. Without them, regressions in core functionality could ship undetected.

#### M1: Exit code indicators appear after command execution
```
1. Run `echo hello` (should succeed)
2. Verify: green checkmark (U+2713) appears in the block header (.exit-success)
3. Run a failing command (e.g., `Get-Item nonexistent_path_xyz`)
4. Verify: red X (U+2717) with exit code appears (.exit-failure)
5. Verify: "VELOCITY_EXIT" marker text is NOT visible in output
```
**Rationale**: Exit codes are the primary success/failure signal. The marker-injection system is fragile (shell-specific suffixes, regex stripping) and must work end-to-end.

#### M2: Restart after process exit
```
1. Type `exit` and press Enter
2. Verify: "[Process exited]" text appears in terminal-output
3. Verify: Restart button appears (data-testid="restart-button")
4. Click the Restart button
5. Verify: Output clears, new PS prompt appears
6. Run `echo restarted-ok` and verify output
```
**Rationale**: Covers the full session lifecycle including cleanup and re-creation. Validates QA plans MT-003 and MT-017.

#### M3: Tab creation and switching preserves terminal state
```
1. In Tab 1, run `echo tab1-marker`
2. Verify output contains "tab1-marker"
3. Press Ctrl+T to create Tab 2
4. In Tab 2, run `echo tab2-marker`
5. Verify output contains "tab2-marker"
6. Click Tab 1 to switch back
7. Verify Tab 1 still shows "tab1-marker" output
8. Click Tab 2 to switch again
9. Verify Tab 2 still shows "tab2-marker" output
```
**Rationale**: Tabs are a primary UX feature. State preservation across tab switches is the most important tab behavior. Validates MT-033 and MT-035.

#### M4: Tab close removes tab and cleans up
```
1. Press Ctrl+T to create a second tab
2. Verify 2 tab buttons are visible
3. Click the close button on the active tab
4. Verify only 1 tab remains
5. Verify the remaining tab's terminal still works (run a command)
6. Verify close button is hidden on the last remaining tab
```
**Rationale**: Tab closing is a destructive action that triggers session cleanup (PTY close, process kill). Validates MT-034.

#### M5: Split pane creation with independent output
```
1. Press Ctrl+Shift+Right to split horizontally
2. Verify: two pane-leaf elements are visible
3. In the first pane (click to focus), run `echo left-pane-marker`
4. Verify "left-pane-marker" appears in the first pane
5. Click the second pane to focus it
6. Run `echo right-pane-marker`
7. Verify "right-pane-marker" appears in the second pane
8. Verify "right-pane-marker" does NOT appear in the first pane
```
**Rationale**: Split panes with independent sessions are a flagship feature. Output isolation between panes is the key invariant. Validates TASK-010 Test 1.

#### M6: Block action: Rerun command
```
1. Run `echo rerun-test-marker`
2. Wait for output
3. Hover over the block to reveal action buttons
4. Click "Rerun" button
5. Verify: a new block appears with "echo rerun-test-marker" in its header
6. Verify: the new block receives output
```
**Rationale**: Rerun is a core block action that exercises submitCommand from a non-input source. Validates MT-014.

### Should Have (Important features risky without E2E coverage)

These tests cover features that are important but slightly less critical than the core flows above.

#### S1: Blocks cleared on shell switch
```
1. Run `echo before-switch-marker` in PowerShell
2. Verify output appears
3. Click the CMD shell button
4. Verify: "before-switch-marker" is no longer visible
5. Verify: CMD prompt or new welcome block appears
6. Run `echo cmd-after-switch` and verify output
```
**Rationale**: Shell switching resets all terminal state. If blocks leak across shell switches, users will see confusing output. Validates MT-016.

#### S2: Multi-line input with Shift+Enter
```
1. Type `echo line1`
2. Press Shift+Enter (should NOT submit)
3. Verify: input editor still contains "echo line1"
4. Type `echo line2`
5. Press Enter (should submit the multi-line text)
6. Verify: a block is created with the multi-line command
```
**Rationale**: Multi-line input is a core editor feature. The distinction between Enter (submit) and Shift+Enter (newline) is critical. Validates MT-022 and MT-025.

#### S3: Pane close collapses to single pane
```
1. Press Ctrl+Shift+Right to split
2. Verify: 2 panes visible
3. Press Ctrl+Shift+W to close the focused pane
4. Verify: back to 1 pane, remaining terminal still works
```
**Rationale**: Pane close must properly collapse the pane tree and clean up the closed pane's session. Validates TASK-010 Test 4.

#### S4: Command history with Up/Down arrows
```
1. Run `echo history-cmd-1`
2. Run `echo history-cmd-2`
3. Press Up arrow
4. Verify: input editor shows `echo history-cmd-2`
5. Press Up arrow again
6. Verify: input editor shows `echo history-cmd-1`
7. Press Down arrow
8. Verify: input editor shows `echo history-cmd-2`
```
**Rationale**: Command history is a fundamental terminal feature. No E2E or manual test plan exists for this. The hook is unit-tested but the integration with the InputEditor (cursor position gating, ArrowUp/ArrowDown interception) is not.

#### S5: Ghost text suggestions (Tab to accept)
```
1. Run `echo ghost-test-suggestion-marker`
2. Type `echo ghost-` in the input editor
3. Verify: ghost text suggestion appears (the remaining portion of the command)
4. Press Tab
5. Verify: the full command from history is now in the input editor
```
**Rationale**: Ghost text is a key UX feature built on top of command history. It is completely untested at the E2E level and has no QA manual test plan.

#### S6: Exit code -- CMD shell
```
1. Switch to CMD shell
2. Run `echo hello`
3. Verify: exit code indicator (green checkmark) appears
4. Run a failing command
5. Verify: failure indicator appears
```
**Rationale**: Exit code marker injection differs per shell type (`& echo VELOCITY_EXIT:%ERRORLEVEL%` for CMD vs. PowerShell's `$?`). QA report noted this gap (no test for CMD/WSL exit marker). Validates TASK-012 Test 4.

#### S7: Block action: Copy Command and Copy Output
```
1. Run `echo copy-test-marker`
2. Hover over the block
3. Click "Copy Command"
4. Read clipboard content
5. Verify clipboard contains "echo copy-test-marker"
6. Click "Copy Output"
7. Read clipboard content
8. Verify clipboard contains the output text (without ANSI escape codes)
```
**Rationale**: Copy actions are a core block feature. Clipboard verification requires a real browser context (not JSDOM). Validates MT-013. Note: Playwright clipboard API may need browser permissions.

### Nice to Have (Edge cases or visual polish)

These tests are valuable but cover edge cases, visual details, or features that are lower risk.

#### N1: Syntax highlighting visible in input editor
```
1. Type `echo "hello world" | grep -i hello`
2. Verify: `.token-command` span exists with "echo" text
3. Verify: `.token-string` span exists with "hello world" text
4. Verify: `.token-pipe` span exists
5. Verify: `.token-flag` span exists with "-i" text
```
**Rationale**: Syntax highlighting is visual polish. It is unit-tested via tokenizer tests, but no E2E test confirms the overlay renders correctly in the real browser. Validates MT-021.

#### N2: Pane divider resize by drag
```
1. Split a pane horizontally
2. Locate the `.pane-divider` element
3. Perform a mouse drag sequence (mousedown, mousemove, mouseup)
4. Verify: pane sizes changed (flex ratios updated)
```
**Rationale**: Pane resize is a UX feature. Mouse drag simulation in Playwright is straightforward. Validates TASK-013 Test 6.

#### N3: Per-tab focus preserved across tab switches
```
1. In Tab 1, split into 2 panes
2. Click the second pane (should get `.pane-focused` class)
3. Press Ctrl+T to create Tab 2
4. Click Tab 1 to switch back
5. Verify: the second pane in Tab 1 still has `.pane-focused`
```
**Rationale**: Per-tab focus was a deliberate enhancement (TASK-014). Worth verifying but lower risk since the data model is well-tested. Validates TASK-014 Test 11.

#### N4: Cannot close the last tab
```
1. With only 1 tab, verify close button is not visible
2. Press Ctrl+W
3. Verify: nothing happens, tab still exists
```
**Rationale**: Safety guard. Already unit-tested but worth a quick E2E confirmation.

#### N5: Cannot close the last pane
```
1. With a single pane, hover to check for close button
2. Verify: close button is not visible (hidden when isOnlyPane)
3. Press Ctrl+Shift+W
4. Verify: nothing happens, pane still exists
```
**Rationale**: Safety guard. Already unit-tested. Low risk.

#### N6: Vertical split pane
```
1. Press Ctrl+Shift+Down
2. Verify: two panes stacked vertically (check flex-direction or layout)
3. Both panes have working terminals
```
**Rationale**: Complements M5 (horizontal split). Validates TASK-010 Test 2.

#### N7: Block running indicator
```
1. Run a long-running command (e.g., `ping localhost -n 5`)
2. Verify: pulsing running indicator (block-running-indicator) appears
3. Wait for command to complete
4. Verify: running indicator disappears
```
**Rationale**: Visual indicator. Validates MT-020.

#### N8: Nested splits (3+ panes)
```
1. Split horizontally
2. Focus the right pane
3. Split vertically
4. Verify: 3 panes visible, all independent
```
**Rationale**: Tests the recursive pane tree rendering. Validates TASK-010 Test 3.

---

## 5. Summary

### Coverage Statistics
- **Features with E2E coverage**: 5 / 20 (25%)
- **Features WITHOUT E2E coverage**: 15 / 20 (75%)
- **QA manual test plans that could be automated**: 17+ high-value plans

### Coverage by Pillar

| Pillar | Features | E2E Covered | Gap |
|--------|----------|-------------|-----|
| 1. Process Interfacing (PTY, shell, ANSI) | 4 | 4 | Exit codes, restart |
| 2. Block Model | 4 | 1 (header text) | Copy, Rerun, exit indicators, running indicator |
| 3. Input Editor | 4 | 0 | Multi-line, syntax highlighting, ghost text, history |
| 4. Structural Layout (tabs + panes) | 8 | 0 | Tab create/switch/close, split/close pane, resize, focus |

### Priority Breakdown
- **Must Have**: 6 tests (M1-M6) -- Core flows: exit codes, restart, tabs, split panes, rerun
- **Should Have**: 7 tests (S1-S7) -- Shell switch clearing, multi-line, pane close, history, ghost text, CMD exit codes, copy actions
- **Nice to Have**: 8 tests (N1-N8) -- Syntax highlighting, pane resize drag, per-tab focus, safety guards, visual indicators

### Recommended Implementation Order
1. M1 (exit codes) + M2 (restart) -- Completes Pillar 1 E2E coverage
2. M3 (tab create/switch) + M4 (tab close) -- Establishes Pillar 4 baseline
3. M5 (split panes) -- Key Pillar 4 feature
4. M6 (rerun) -- Completes block actions coverage
5. S1-S7 in order -- Fills remaining gaps
6. N1-N8 as time permits

### Fixture Considerations
- The existing `appPage` fixture waits for `shell-selector` to be visible, which validates the basic app load. New tests for tabs and panes will need to account for the tab/pane DOM structure.
- Clipboard tests (S7) may require Playwright's `browserContext.grantPermissions(['clipboard-read', 'clipboard-write'])`.
- Long-running commands (N7) need appropriate timeouts.
- Tests involving Ctrl+T/W/Shift+Right/Down need to target the document (not a specific element) since the shortcuts are registered on `document.addEventListener`.
