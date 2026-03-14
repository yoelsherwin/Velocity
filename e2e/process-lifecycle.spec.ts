import { test, expect } from './fixtures';

test.describe('Process lifecycle', () => {
  test('restart after process exit', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Wait for the initial shell prompt to appear
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // Type `exit` to terminate the shell session
    await textarea.fill('exit');
    await textarea.press('Enter');

    // Wait for the "[Process exited]" message to appear
    await expect(output).toContainText('[Process exited]', {
      timeout: 15_000,
    });

    // Verify the Restart button appears
    const restartButton = appPage.getByTestId('restart-button');
    await expect(restartButton).toBeVisible({ timeout: 10_000 });

    // Click Restart to start a new session
    await restartButton.click();

    // After restart, a new shell session should start — the input editor
    // should be available and a new prompt should appear
    await expect(appPage.getByTestId('editor-textarea')).toBeEnabled({
      timeout: 15_000,
    });

    // Verify the new session is functional by running a command
    const newTextarea = appPage.getByTestId('editor-textarea');
    await newTextarea.fill('echo restart-success-marker');
    await newTextarea.press('Enter');
    await expect(appPage.getByTestId('terminal-output')).toContainText(
      'restart-success-marker',
      { timeout: 10_000 },
    );
  });

  test('blocks cleared on shell switch', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Wait for PowerShell to be ready
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // Run a command in the current shell (PowerShell) with a unique marker
    await textarea.fill('echo before-switch-marker');
    await textarea.press('Enter');
    await expect(output).toContainText('before-switch-marker', {
      timeout: 10_000,
    });

    // Switch to CMD shell — this should clear all blocks and start fresh
    await appPage.getByTestId('shell-btn-cmd').click();

    // Wait for CMD to be ready (CMD prompt shows ">" character)
    await expect(output).toContainText('>', { timeout: 15_000 });

    // Assert the old output is gone — "before-switch-marker" should no longer be visible
    await expect(output).not.toContainText('before-switch-marker');

    // Verify the new CMD session works
    const newTextarea = appPage.getByTestId('editor-textarea');
    await newTextarea.fill('echo cmd-after-switch-marker');
    await newTextarea.press('Enter');
    await expect(output).toContainText('cmd-after-switch-marker', {
      timeout: 10_000,
    });
  });
});
