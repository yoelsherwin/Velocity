# Fix: Add conditional WSL E2E test

## Description
The E2E shell-switching tests cover PowerShell and CMD but not WSL. Add a WSL test that skips gracefully if WSL is not installed.

## Fix

In `e2e/shell-switching.spec.ts`, add a test:

```typescript
test('switch to WSL shell (skipped if unavailable)', async ({ appPage }) => {
    // Click WSL button
    await appPage.getByTestId('shell-btn-wsl').click();
    await expect(appPage.getByTestId('shell-btn-wsl')).toHaveAttribute('aria-selected', 'true');

    // Wait for either output (WSL available) or error (WSL not installed)
    // If WSL is not installed, the session creation will fail and show an error
    // Give it time to either succeed or fail
    const output = appPage.getByTestId('terminal-output');

    try {
        // Try to detect WSL prompt or error within timeout
        await expect(output).toContainText(/(\$|#|Failed to create session)/, { timeout: 15000 });
    } catch {
        test.skip(true, 'WSL does not appear to be available on this machine');
        return;
    }

    // If we got here and there's no error, WSL is working — run a command
    const outputText = await output.textContent();
    if (outputText?.includes('Failed to create session')) {
        test.skip(true, 'WSL is not installed');
        return;
    }

    const input = appPage.getByTestId('terminal-input');
    await input.fill('echo wsl-e2e-test');
    await input.press('Enter');
    await expect(output).toContainText('wsl-e2e-test', { timeout: 10000 });
});
```

The key: use `test.skip()` if WSL isn't available rather than failing.

## Acceptance Criteria
- [ ] WSL test added to `e2e/shell-switching.spec.ts`
- [ ] Test passes when WSL is installed (runs command, verifies output)
- [ ] Test skips gracefully when WSL is not installed (no failure)
- [ ] All existing E2E tests still pass
- [ ] All unit/integration tests still pass
- [ ] Clean commit: `feat: add conditional WSL E2E test`

## Files to Read First
- `e2e/shell-switching.spec.ts` — Add the test here
- `e2e/fixtures.ts` — Understand the fixture setup
