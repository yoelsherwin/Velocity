import { test, expect } from './fixtures';

test.describe('Exit codes', () => {
  test('exit code shows success indicator for echo', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');

    // Run a command that should succeed with exit code 0
    await textarea.fill('echo exit-success-marker');
    await textarea.press('Enter');

    // Wait for the output to appear (proves command executed)
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('exit-success-marker', {
      timeout: 15_000,
    });

    // Assert that a success indicator (green checkmark) is visible
    // The BlockView renders a .exit-success span with U+2713 for exit code 0
    await expect(appPage.locator('.exit-success')).toBeVisible({
      timeout: 10_000,
    });
  });

  test('exit code shows failure indicator', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');

    // Run a command that will fail in PowerShell
    await textarea.fill('Get-Item nonexistent-path-xyz-e2e');
    await textarea.press('Enter');

    // Wait for the command to produce output (error message)
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('nonexistent-path-xyz-e2e', {
      timeout: 15_000,
    });

    // Assert that a failure indicator (red X with exit code) is visible
    // The BlockView renders a .exit-failure span with U+2717 for non-zero exit codes
    await expect(appPage.locator('.exit-failure')).toBeVisible({
      timeout: 10_000,
    });
  });
});
