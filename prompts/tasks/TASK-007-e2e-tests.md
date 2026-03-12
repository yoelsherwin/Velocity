# Task 007: E2E Tests with Playwright

## Context

The `e2e/` directory is empty. Playwright is installed and configured (`playwright.config.ts`), but zero E2E tests exist. Per `prompts/TESTING.md` (Layer 3), E2E tests drive the real Tauri app and test the complete user experience.

### Current State
- **`playwright.config.ts`**: testDir `./e2e`, 30s timeout, headless: true
- **`e2e/`**: Empty directory
- **Debug binary**: `src-tauri/target/debug/velocity.exe` exists
- **87 tests passing**: 35 Rust unit + 9 Rust integration + 43 Vitest frontend
- **App works**: PowerShell prompt appears, commands produce output in blocks

### Approach: Playwright + CDP to WebView2

Tauri v2 on Windows uses Edge WebView2 (Chromium-based). We can connect Playwright to it via Chrome DevTools Protocol (CDP):

1. Launch `velocity.exe` with the environment variable `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
2. Connect Playwright via `chromium.connectOverCDP('http://localhost:9222')`
3. Get the page from the browser context
4. Drive the app with standard Playwright selectors

Reference: [playwright-cdp for Tauri 2](https://github.com/Haprog/playwright-cdp)

## Requirements

### 1. E2E Test Fixture

Create `e2e/fixtures.ts` with a custom Playwright fixture that:
1. Builds the app (or uses the pre-built debug binary)
2. Launches `velocity.exe` with `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9222`
3. Waits for the app to be ready (poll the CDP endpoint)
4. Connects Playwright via `chromium.connectOverCDP`
5. Provides the `page` to tests
6. On teardown: closes the page, kills the app process

```typescript
import { test as base, chromium, Page } from '@playwright/test';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// Custom fixture that launches the Tauri app and connects via CDP
export const test = base.extend<{ appPage: Page }>({
    appPage: async ({}, use) => {
        const appPath = path.resolve('src-tauri/target/debug/velocity.exe');

        const app = spawn(appPath, [], {
            env: {
                ...process.env,
                WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: '--remote-debugging-port=9222',
            },
        });

        // Wait for CDP to be available
        await waitForCDP('http://localhost:9222', 15000);

        // Connect Playwright
        const browser = await chromium.connectOverCDP('http://localhost:9222');
        const context = browser.contexts()[0];
        const page = context.pages()[0] || await context.newPage();

        // Wait for the app to render
        await page.waitForSelector('[data-testid="shell-selector"]', { timeout: 10000 });

        await use(page);

        // Cleanup
        await browser.close();
        app.kill();
    },
});

async function waitForCDP(url: string, timeout: number): Promise<void> {
    const start = Date.now();
    while (Date.now() - start < timeout) {
        try {
            const response = await fetch(`${url}/json/version`);
            if (response.ok) return;
        } catch {}
        await new Promise(r => setTimeout(r, 500));
    }
    throw new Error(`CDP not available at ${url} after ${timeout}ms`);
}

export { expect } from '@playwright/test';
```

### 2. Update Playwright Config

Update `playwright.config.ts`:

```typescript
import { defineConfig } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e",
    timeout: 60000,  // 60s per test (app startup is slow)
    retries: 1,      // Retry once on failure (flakiness buffer)
    use: {
        // No browser launch — we connect via CDP
    },
    // Don't run the default browser — we launch the Tauri app ourselves
    projects: [
        {
            name: 'tauri',
            use: {},
        },
    ],
});
```

### 3. E2E Test Files

Create the following test files per `TESTING.md` Layer 3 guidance (5-10 critical user flows):

#### `e2e/terminal-basic.spec.ts` — Core terminal functionality

```typescript
import { test, expect } from './fixtures';

test('app loads with shell selector and input', async ({ appPage }) => {
    // Shell selector visible
    await expect(appPage.getByTestId('shell-selector')).toBeVisible();
    // PowerShell button active
    await expect(appPage.getByTestId('shell-btn-powershell')).toHaveAttribute('aria-selected', 'true');
    // Input field visible
    await expect(appPage.getByTestId('terminal-input')).toBeVisible();
});

test('PowerShell prompt appears in welcome block', async ({ appPage }) => {
    // Wait for output to appear in the terminal
    // The welcome block should eventually contain the PS prompt
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('PS', { timeout: 15000 });
});

test('type command and see output in block', async ({ appPage }) => {
    const input = appPage.getByTestId('terminal-input');

    // Type a command
    await input.fill('echo hello-e2e-test');
    await input.press('Enter');

    // Wait for output containing our marker
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('hello-e2e-test', { timeout: 10000 });
});

test('multiple commands create multiple blocks', async ({ appPage }) => {
    const input = appPage.getByTestId('terminal-input');

    // Run first command
    await input.fill('echo first-cmd');
    await input.press('Enter');
    await expect(appPage.getByTestId('terminal-output')).toContainText('first-cmd', { timeout: 10000 });

    // Run second command
    await input.fill('echo second-cmd');
    await input.press('Enter');
    await expect(appPage.getByTestId('terminal-output')).toContainText('second-cmd', { timeout: 10000 });

    // Both should be visible (in different blocks)
    await expect(appPage.getByTestId('terminal-output')).toContainText('first-cmd');
    await expect(appPage.getByTestId('terminal-output')).toContainText('second-cmd');
});
```

#### `e2e/shell-switching.spec.ts` — Shell switching and restart

```typescript
import { test, expect } from './fixtures';

test('switch to CMD shell', async ({ appPage }) => {
    // Click CMD button
    await appPage.getByTestId('shell-btn-cmd').click();

    // CMD button should now be active
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute('aria-selected', 'true');

    // CMD prompt should appear (contains ">" typically)
    const output = appPage.getByTestId('terminal-output');
    // CMD shows the working directory path
    await expect(output).toContainText('>', { timeout: 15000 });
});

test('switch back to PowerShell', async ({ appPage }) => {
    // Switch to CMD first
    await appPage.getByTestId('shell-btn-cmd').click();
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute('aria-selected', 'true');

    // Switch back to PowerShell
    await appPage.getByTestId('shell-btn-powershell').click();
    await expect(appPage.getByTestId('shell-btn-powershell')).toHaveAttribute('aria-selected', 'true');

    // Should be able to run a PowerShell command
    const input = appPage.getByTestId('terminal-input');
    await input.fill('echo ps-after-switch');
    await input.press('Enter');
    await expect(appPage.getByTestId('terminal-output')).toContainText('ps-after-switch', { timeout: 10000 });
});
```

#### `e2e/block-actions.spec.ts` — Block action buttons

```typescript
import { test, expect } from './fixtures';

test('block shows command text in header', async ({ appPage }) => {
    const input = appPage.getByTestId('terminal-input');

    await input.fill('echo block-header-test');
    await input.press('Enter');

    // Wait for output
    await expect(appPage.getByTestId('terminal-output')).toContainText('block-header-test', { timeout: 10000 });

    // The command should be visible in a block header
    // Look for the command text in a block-command element
    await expect(appPage.locator('.block-command')).toContainText('echo block-header-test');
});
```

### 4. npm Script Update

Add/update the `test:e2e` script in `package.json`. The app must be built first:

```json
"test:e2e": "npx playwright test"
```

The user should build the debug binary before running E2E tests:
```bash
npm run tauri build -- --debug
# OR use the existing debug binary from `npm run tauri dev` builds
npx playwright test
```

### 5. Add `.gitkeep` removal

Remove `e2e/.gitkeep` if it exists (the directory now has real files).

## Tests (Write These FIRST)

Since this task IS about writing tests, the TDD cycle is: write the tests, run them against the real app, fix any issues.

### E2E Tests (Playwright)

- [ ] **`app loads with shell selector and input`**: Verify shell selector, PowerShell active, input field visible
- [ ] **`PowerShell prompt appears in welcome block`**: Wait for "PS" text in output area (proves full pipeline works)
- [ ] **`type command and see output in block`**: `echo hello-e2e-test` → output contains `hello-e2e-test`
- [ ] **`multiple commands create multiple blocks`**: Two commands both visible in output
- [ ] **`switch to CMD shell`**: Click CMD button, verify it's active, prompt appears
- [ ] **`switch back to PowerShell`**: CMD → PowerShell, run command, output appears
- [ ] **`block shows command text in header`**: Command text visible in block header

## Acceptance Criteria

- [ ] `e2e/fixtures.ts` — Custom Playwright fixture that launches Tauri app and connects via CDP
- [ ] `e2e/terminal-basic.spec.ts` — 4 core terminal tests
- [ ] `e2e/shell-switching.spec.ts` — 2 shell switching tests
- [ ] `e2e/block-actions.spec.ts` — 1 block action test
- [ ] `playwright.config.ts` updated for Tauri app testing
- [ ] All 7 E2E tests pass against the running app
- [ ] All existing tests still pass (`npm run test` + `cargo test`)
- [ ] Clean commit: `feat: add E2E tests with Playwright CDP connection to Tauri WebView2`

## Security Notes

- The CDP debug port (9222) is only used during testing. It is NOT enabled in production builds.
- The `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS` env var is set only by the test fixture, not in the app code.

## Files to Read First

- `prompts/TESTING.md` — Layer 3 E2E strategy
- `playwright.config.ts` — Current config (update)
- `e2e/` — Empty (create files)
- `src/components/Terminal.tsx` — data-testid attributes used by selectors
- `src/components/blocks/BlockView.tsx` — data-testid and CSS classes for block elements
- `package.json` — npm scripts
