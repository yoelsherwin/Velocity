import { test, expect } from './fixtures';

test.describe('Intent Classifier + Mode Indicator', () => {
  test('test_mode_indicator_visible', async ({ appPage }) => {
    // Wait for the terminal to be ready
    const textarea = appPage.getByTestId('editor-textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // Mode indicator should be visible in the DOM
    const indicator = appPage.getByTestId('mode-indicator');
    await expect(indicator).toBeVisible({ timeout: 5_000 });

    // Should default to CLI mode
    await expect(indicator).toContainText('CLI');
  });

  test('test_mode_indicator_toggles_on_click', async ({ appPage }) => {
    // Wait for the terminal to be ready
    const textarea = appPage.getByTestId('editor-textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    const indicator = appPage.getByTestId('mode-indicator');
    await expect(indicator).toBeVisible({ timeout: 5_000 });

    // Get initial text
    const initialText = await indicator.textContent();

    // Click to toggle
    await indicator.click();

    // The indicator text should change (CLI -> AI or vice versa)
    const newText = await indicator.textContent();
    expect(newText).not.toBe(initialText);
  });
});
