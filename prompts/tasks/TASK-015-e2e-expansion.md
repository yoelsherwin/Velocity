# Task 015: E2E Test Expansion — Full Feature Coverage

## Context

Only 8 E2E tests exist covering 25% of features. Pillars 3 (Input Editor) and 4 (Tabs + Panes) have zero E2E coverage. This task adds the missing must-have and should-have E2E tests.

### Current E2E Tests (8)
- `terminal-basic.spec.ts` (4): app loads, prompt appears, command output, multiple blocks
- `shell-switching.spec.ts` (3): CMD, back to PowerShell, WSL conditional
- `block-actions.spec.ts` (1): block header shows command

### Investigation Report
`prompts/reports/investigations/INVESTIGATION-e2e-coverage-gaps.md`

## Requirements

Add E2E tests organized into existing + new spec files. Use the fixture from `e2e/fixtures.ts` (launches Tauri app, connects via CDP).

### New spec file: `e2e/exit-codes.spec.ts`

- [ ] **`exit code shows success indicator for echo`**: Run `echo hello`, wait for output. Assert a success indicator (✓ or checkmark) is visible in the block.
- [ ] **`exit code shows failure indicator`**: Run a command that fails (e.g., `Get-Item nonexistent-path-xyz` in PowerShell). Assert a failure indicator (✗ or X with a number) is visible.

### New spec file: `e2e/process-lifecycle.spec.ts`

- [ ] **`restart after process exit`**: Type `exit` and press Enter. Wait for `[Process exited]` or restart button. Click Restart. Assert a new session starts (prompt reappears or input is available).
- [ ] **`blocks cleared on shell switch`**: Run `echo before-switch`, switch to CMD, assert the old output is gone (new session starts fresh).

### New spec file: `e2e/tabs.spec.ts`

- [ ] **`create new tab and switch`**: Click the `+` button. Assert two tabs exist. Click on the first tab. Assert the first tab is active.
- [ ] **`tab preserves terminal state`**: In tab 1, run `echo tab1-marker`. Create tab 2. Switch back to tab 1. Assert `tab1-marker` is still visible.
- [ ] **`close tab`**: Create 2 tabs. Close one. Assert only 1 tab remains.

### New spec file: `e2e/split-panes.spec.ts`

- [ ] **`split pane creates two terminals`**: Hover over the terminal area to reveal pane action buttons. Click the "split right" button. Assert two terminal areas are visible.
- [ ] **`split panes have independent output`**: After splitting, type `echo pane1-marker` in one pane (click it first to focus). Click the other pane to focus it. Type `echo pane2-marker`. Assert pane 1 contains `pane1-marker` and pane 2 contains `pane2-marker`.

### New spec file: `e2e/input-editor.spec.ts`

- [ ] **`multi-line input with Shift+Enter`**: Press Shift+Enter to add a newline. Type on the second line. Assert the textarea contains a newline character (or has multiple rows).
- [ ] **`command history with Up arrow`**: Run `echo history-test`, then run `echo second-cmd`. Press Up arrow twice. Assert the input shows `echo history-test`.
- [ ] **`rerun block action`**: Run `echo rerun-test`. Wait for output. Hover the block, click the Rerun button. Assert `rerun-test` appears again in a new block.

### Updates to existing specs

- [ ] In `block-actions.spec.ts`, add a test for **Copy Command** button (click it, verify clipboard or at least verify the button exists and is clickable).

### Implementation Notes

- Each test should use unique marker strings (e.g., `tab1-marker`, `pane1-marker`) to avoid false matches.
- For pane tests, clicking a pane to focus it requires clicking inside the terminal area.
- For split pane button hover, use `page.hover()` on the pane element to reveal action buttons.
- For exit codes, the marker `VELOCITY_EXIT:0` is stripped from output — look for ✓ or ✗ characters or `.exit-success` / `.exit-failure` CSS classes.
- For restart, look for the `[data-testid="restart-button"]` element.
- For tabs, look for `.tab-button` elements and the `+` button (`.tab-new`).
- Ghost text tests are deferred (hard to assert faded text in E2E). Command history is testable via Up arrow.
- Timeouts: shell commands need 10-15s timeout. App startup needs 15s.

## Acceptance Criteria

- [ ] All new E2E tests written and passing
- [ ] Existing 8 E2E tests still pass
- [ ] 5 new spec files created
- [ ] ~13 new E2E tests added (total ~21)
- [ ] All unit/integration tests still pass
- [ ] Clean commit: `feat: expand E2E tests to cover exit codes, tabs, panes, input editor, lifecycle`

## Files to Read First

- `e2e/fixtures.ts` — Understand the test fixture
- `e2e/terminal-basic.spec.ts` — Existing patterns for selectors and assertions
- `e2e/shell-switching.spec.ts` — Shell switching pattern
- `e2e/block-actions.spec.ts` — Block interaction pattern
- `prompts/reports/investigations/INVESTIGATION-e2e-coverage-gaps.md` — Full gap analysis
- `src/components/Terminal.tsx` — data-testid attributes
- `src/components/blocks/BlockView.tsx` — Block selectors and CSS classes
- `src/components/layout/TabBar.tsx` — Tab selectors
- `src/components/layout/PaneContainer.tsx` — Pane selectors
