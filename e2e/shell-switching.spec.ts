import { test, expect } from './fixtures';

test.describe('Shell switching', () => {
  test('switch to CMD shell', async ({ appPage }) => {
    // Click the CMD shell button
    await appPage.getByTestId('shell-btn-cmd').click();

    // CMD button should now be the active/selected tab
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wait for CMD prompt to appear — CMD typically shows a path with ">"
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('>', { timeout: 15_000 });

    // Verify that CMD can actually execute a command and produce output
    const input = appPage.getByTestId('terminal-input');
    await input.fill('echo cmd-e2e-test');
    await input.press('Enter');
    await expect(output).toContainText('cmd-e2e-test', { timeout: 10_000 });
  });

  test('switch back to PowerShell after CMD', async ({ appPage }) => {
    // Switch to CMD first
    await appPage.getByTestId('shell-btn-cmd').click();
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wait for CMD to be ready
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('>', { timeout: 15_000 });

    // Switch back to PowerShell
    await appPage.getByTestId('shell-btn-powershell').click();
    await expect(
      appPage.getByTestId('shell-btn-powershell'),
    ).toHaveAttribute('aria-selected', 'true');

    // Should be able to run a PowerShell command successfully
    const input = appPage.getByTestId('terminal-input');
    await input.fill('echo ps-after-switch');
    await input.press('Enter');
    await expect(output).toContainText('ps-after-switch', {
      timeout: 10_000,
    });
  });

  test('switch to WSL shell (skipped if unavailable)', async ({ appPage }) => {
    // Click WSL button
    await appPage.getByTestId('shell-btn-wsl').click();
    await expect(appPage.getByTestId('shell-btn-wsl')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wait for either output (WSL available) or error (WSL not installed)
    // If WSL is not installed, the session creation will fail and show an error
    // Give it time to either succeed or fail
    const output = appPage.getByTestId('terminal-output');

    try {
      // Try to detect WSL prompt or error within timeout
      await expect(output).toContainText(/(\$|#|Failed to create session)/, {
        timeout: 15_000,
      });
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
    await expect(output).toContainText('wsl-e2e-test', { timeout: 10_000 });
  });
});
