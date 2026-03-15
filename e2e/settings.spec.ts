import { test, expect } from './fixtures';

test.describe('Settings Modal', () => {
  test('settings modal opens and closes', async ({ appPage }) => {
    // The settings button should be visible in the tab bar
    const settingsBtn = appPage.getByTestId('settings-button');
    await expect(settingsBtn).toBeVisible({ timeout: 15_000 });

    // Click the gear icon to open settings
    await settingsBtn.click();

    // The settings modal should appear
    const modal = appPage.getByTestId('settings-modal');
    await expect(modal).toBeVisible({ timeout: 5_000 });

    // The form elements should be visible
    await expect(appPage.getByTestId('settings-provider')).toBeVisible();
    await expect(appPage.getByTestId('settings-api-key')).toBeVisible();
    await expect(appPage.getByTestId('settings-model')).toBeVisible();
    await expect(appPage.getByTestId('settings-save-btn')).toBeVisible();
    await expect(appPage.getByTestId('settings-cancel-btn')).toBeVisible();

    // Click Cancel to close the modal
    await appPage.getByTestId('settings-cancel-btn').click();

    // The modal should disappear
    await expect(modal).not.toBeVisible({ timeout: 5_000 });
  });
});
