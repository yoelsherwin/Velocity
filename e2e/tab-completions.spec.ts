import { test, expect } from './fixtures';

test.describe('Tab completions', () => {
  test('tab completes a file path in argument position', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Wait for shell to be ready
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // Type "dir sr" (assuming src/ directory exists in the app cwd)
    // We'll type a partial path and press Tab
    await textarea.fill('dir src');
    await textarea.press('Tab');

    // After Tab, the input should have been completed or ghost text should appear
    // Check that the editor has ghost text or the input value has changed
    const editor = appPage.getByTestId('input-editor');

    // Either the ghost text appears or the value has been updated
    // Give it a moment for async completions
    await appPage.waitForTimeout(500);

    // Check for ghost text element or changed input value
    const ghostText = await editor.locator('.ghost-text').count();
    const inputValue = await textarea.inputValue();

    // At least one of these should be true:
    // 1. Ghost text is shown (completion suggestion)
    // 2. Input was modified (completion accepted)
    const hasCompletion = ghostText > 0 || inputValue !== 'dir src';
    expect(hasCompletion).toBe(true);
  });
});
