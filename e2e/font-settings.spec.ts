import { test, expect } from './fixtures';

test.describe('Font Settings', () => {
  test('test_e2e_font_settings_persist', async ({ appPage }) => {
    // Open settings modal
    const settingsBtn = appPage.getByTestId('settings-button');
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });
    await settingsBtn.click();

    const modal = appPage.getByTestId('settings-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // Change font size to 18
    const fontSizeInput = appPage.getByTestId('settings-font-size');
    await fontSizeInput.fill('18');

    // Save settings
    await appPage.getByTestId('settings-save-btn').click();
    await expect(modal).not.toBeVisible({ timeout: 5_000 });

    // Verify the CSS variable was applied
    const fontSizeValue = await appPage.evaluate(() =>
      document.documentElement.style.getPropertyValue('--terminal-font-size')
    );
    expect(fontSizeValue).toBe('18px');

    // Reload the app
    await appPage.reload();

    // Wait for the app to load
    await expect(appPage.getByTestId('settings-button')).toBeVisible({ timeout: 15_000 });

    // Verify the CSS variable was re-applied after reload
    // Wait a bit for settings to load and apply
    await appPage.waitForFunction(
      () => document.documentElement.style.getPropertyValue('--terminal-font-size') === '18px',
      { timeout: 10_000 },
    );

    const reloadedFontSize = await appPage.evaluate(() =>
      document.documentElement.style.getPropertyValue('--terminal-font-size')
    );
    expect(reloadedFontSize).toBe('18px');
  });
});
