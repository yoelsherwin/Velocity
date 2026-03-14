import { test, expect } from './fixtures';

test.describe('Input editor', () => {
  test('multi-line input with Shift+Enter', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');

    // Type first line
    await textarea.fill('echo line1');

    // Press Shift+Enter to add a newline (should NOT submit the command)
    await textarea.press('Shift+Enter');

    // Type second line
    await textarea.type('echo line2');

    // Verify the textarea value contains a newline (multi-line input)
    const value = await textarea.inputValue();
    expect(value).toContain('\n');
    expect(value).toContain('echo line1');
    expect(value).toContain('echo line2');

    // Now press Enter to submit the multi-line command
    await textarea.press('Enter');

    // Verify that a block was created with the command text
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('echo line1', { timeout: 10_000 });
  });

  test('command history with Up arrow', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Wait for shell to be ready
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // Run the first command
    await textarea.fill('echo history-first-marker');
    await textarea.press('Enter');
    await expect(output).toContainText('history-first-marker', {
      timeout: 10_000,
    });

    // Run the second command
    await textarea.fill('echo history-second-marker');
    await textarea.press('Enter');
    await expect(output).toContainText('history-second-marker', {
      timeout: 10_000,
    });

    // Press Up arrow once — should show the most recent command
    await textarea.press('ArrowUp');
    await expect(textarea).toHaveValue('echo history-second-marker');

    // Press Up arrow again — should show the first command
    await textarea.press('ArrowUp');
    await expect(textarea).toHaveValue('echo history-first-marker');
  });

  test('rerun block action', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Wait for shell to be ready
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // Run a command with a unique marker
    await textarea.fill('echo rerun-action-marker');
    await textarea.press('Enter');
    await expect(output).toContainText('rerun-action-marker', {
      timeout: 10_000,
    });

    // Find the block that contains our command and hover over it to reveal actions
    const block = appPage
      .locator('[data-testid="block-container"]')
      .filter({ hasText: 'echo rerun-action-marker' });
    await block.hover();

    // Click the "Rerun" button within that block
    const rerunButton = block.locator('.block-action-btn', { hasText: 'Rerun' });
    await rerunButton.click();

    // After rerun, a new block should appear with the same command in its header
    // Wait for multiple blocks with the same command text
    const blocksWithCommand = appPage
      .locator('.block-command')
      .filter({ hasText: 'echo rerun-action-marker' });
    await expect(blocksWithCommand).toHaveCount(2, { timeout: 10_000 });
  });
});
