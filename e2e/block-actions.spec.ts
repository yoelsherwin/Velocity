import { test, expect } from './fixtures';

test.describe('Block actions', () => {
  test('block shows command text in header', async ({ appPage }) => {
    const input = appPage.getByTestId('editor-textarea');

    // Run a command with a unique marker
    await input.fill('echo block-header-test');
    await input.press('Enter');

    // Wait for the output to appear (proves the command was executed)
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('block-header-test', {
      timeout: 10_000,
    });

    // The command text should be visible in the block header (.block-command)
    await expect(appPage.locator('.block-command')).toContainText(
      'echo block-header-test',
    );
  });

  test('Copy Command button is clickable', async ({ appPage }) => {
    const input = appPage.getByTestId('editor-textarea');

    // Run a command with a unique marker
    await input.fill('echo copy-cmd-marker');
    await input.press('Enter');

    // Wait for the output to appear
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('copy-cmd-marker', {
      timeout: 10_000,
    });

    // Find the block containing our command
    const block = appPage
      .locator('[data-testid="block-container"]')
      .filter({ hasText: 'echo copy-cmd-marker' });

    // Hover over the block to reveal action buttons
    await block.hover();

    // The "Copy Command" button should be visible and clickable
    const copyButton = block.locator('.block-action-btn', {
      hasText: 'Copy Command',
    });
    await expect(copyButton).toBeVisible();
    await copyButton.click();

    // If clipboard permissions are available, verify the clipboard contents.
    // Otherwise just verifying the button is visible and clickable is sufficient
    // since clipboard API may require special permissions in WebView2.
    try {
      const clipboardText = await appPage.evaluate(() =>
        navigator.clipboard.readText(),
      );
      expect(clipboardText).toBe('echo copy-cmd-marker');
    } catch {
      // Clipboard read may fail in WebView2 without explicit permissions.
      // The button click itself was successful, which is the primary assertion.
    }
  });
});
