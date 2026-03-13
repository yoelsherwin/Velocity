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
});
