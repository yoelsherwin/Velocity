import { test, expect } from './fixtures';

test.describe('Tabs', () => {
  test('create new tab and switch', async ({ appPage }) => {
    // Initially there should be exactly one tab
    await expect(appPage.locator('.tab-button')).toHaveCount(1);

    // Click the "+" button to create a new tab
    await appPage.getByTestId('tab-new-button').click();

    // Assert two tabs now exist
    await expect(appPage.locator('.tab-button')).toHaveCount(2);

    // The new tab (second) should be active since creation auto-switches
    const secondTab = appPage.locator('.tab-button').nth(1);
    await expect(secondTab).toHaveClass(/tab-button-active/);

    // Click the first tab to switch back
    const firstTab = appPage.locator('.tab-button').nth(0);
    await firstTab.click();

    // Assert the first tab is now active
    await expect(firstTab).toHaveClass(/tab-button-active/);
    await expect(secondTab).not.toHaveClass(/tab-button-active/);
  });

  test('tab preserves terminal state', async ({ appPage }) => {
    const output = appPage.getByTestId('terminal-output');

    // Wait for the initial shell to be ready
    await expect(output).toContainText('PS', { timeout: 15_000 });

    // In tab 1, run a command with a unique marker
    const textarea = appPage.getByTestId('editor-textarea');
    await textarea.fill('echo tab1-preserve-marker');
    await textarea.press('Enter');
    await expect(output).toContainText('tab1-preserve-marker', {
      timeout: 10_000,
    });

    // Create tab 2 by clicking the "+" button
    await appPage.getByTestId('tab-new-button').click();
    await expect(appPage.locator('.tab-button')).toHaveCount(2);

    // Wait for tab 2's shell to initialize
    // Tab 2 is now active, so we need its terminal output
    // Each tab panel has its own terminal, so we look at the visible output
    const visibleOutput = appPage.getByTestId('terminal-output').first();
    await expect(visibleOutput).toContainText('PS', { timeout: 15_000 });

    // Switch back to tab 1
    await appPage.locator('.tab-button').nth(0).click();

    // Assert that tab 1 still shows the original output
    await expect(appPage.getByTestId('terminal-output').first()).toContainText(
      'tab1-preserve-marker',
      { timeout: 5_000 },
    );
  });

  test('close tab', async ({ appPage }) => {
    // Create a second tab
    await appPage.getByTestId('tab-new-button').click();
    await expect(appPage.locator('.tab-button')).toHaveCount(2);

    // Close the active (second) tab via its close button.
    // When there are 2 tabs, close buttons are visible on all tab buttons.
    const closeButton = appPage.locator('.tab-close').last();
    await closeButton.click();

    // Assert only 1 tab remains
    await expect(appPage.locator('.tab-button')).toHaveCount(1);

    // The remaining tab's terminal should still be functional
    const textarea = appPage.getByTestId('editor-textarea');
    await textarea.fill('echo tab-close-marker');
    await textarea.press('Enter');
    await expect(appPage.getByTestId('terminal-output').first()).toContainText(
      'tab-close-marker',
      { timeout: 10_000 },
    );
  });
});
