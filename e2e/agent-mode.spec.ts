import { test, expect } from './fixtures';

test.describe('Agent Mode', () => {
  test('agent mode shows loading or error on # trigger', async ({ appPage }) => {
    // Wait for the terminal to be ready
    const textarea = appPage.getByTestId('editor-textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // Type a # prefixed command to trigger agent mode
    await textarea.fill('# list all typescript files');
    await textarea.press('Enter');

    // Should show either loading indicator or error (will likely be error
    // since no LLM API key is configured in test environment)
    const agentLoading = appPage.getByTestId('agent-loading');
    const agentError = appPage.getByTestId('agent-error');

    // Wait for either loading or error to appear (one must show up)
    await expect(agentLoading.or(agentError)).toBeVisible({ timeout: 15_000 });

    // If loading appeared, wait for it to resolve (into error since no API key)
    const isLoading = await agentLoading.isVisible().catch(() => false);
    if (isLoading) {
      // Eventually loading should disappear and error should appear
      await expect(agentError).toBeVisible({ timeout: 30_000 });
    }

    // Verify the error is displayed
    await expect(agentError).toBeVisible();

    // The input should NOT have been cleared (no auto-execute)
    // and writeToSession should not have been called with the NL input
    // We verify this indirectly: typing clears the error
    await textarea.fill('dir');
    await expect(agentError).not.toBeVisible({ timeout: 5_000 });
  });

  test('normal command executes without agent mode', async ({ appPage }) => {
    // Wait for the terminal to be ready
    const textarea = appPage.getByTestId('editor-textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // Type a normal CLI command (no # prefix)
    await textarea.fill('echo hello');
    await textarea.press('Enter');

    // Agent loading and error should NOT appear
    const agentLoading = appPage.getByTestId('agent-loading');
    const agentError = appPage.getByTestId('agent-error');

    // Wait a moment, then verify neither element is visible
    await appPage.waitForTimeout(1000);
    await expect(agentLoading).not.toBeVisible();
    await expect(agentError).not.toBeVisible();

    // The command should have been executed (output should appear)
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('echo hello', { timeout: 10_000 });
  });
});
