import { test, expect } from './fixtures';

test.describe('Terminal — core functionality', () => {
  test('app loads with shell selector and input', async ({ appPage }) => {
    // Shell selector should be visible
    await expect(appPage.getByTestId('shell-selector')).toBeVisible();

    // PowerShell button should be active by default
    await expect(
      appPage.getByTestId('shell-btn-powershell'),
    ).toHaveAttribute('aria-selected', 'true');

    // Input field should be visible and enabled
    await expect(appPage.getByTestId('terminal-input')).toBeVisible();
    await expect(appPage.getByTestId('terminal-input')).toBeEnabled();
  });

  test('PowerShell prompt appears in welcome block', async ({ appPage }) => {
    // The welcome block receives output from PowerShell startup.
    // Wait for the "PS" prompt text to appear, which proves the full
    // pipeline works: PTY spawn → reader thread → Tauri event → React render.
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('PS', { timeout: 15_000 });
  });

  test('type command and see output in block', async ({ appPage }) => {
    const input = appPage.getByTestId('terminal-input');

    // Use a unique marker string to identify our output
    await input.fill('echo hello-e2e-test');
    await input.press('Enter');

    // Wait for the marker text to appear in the output area
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('hello-e2e-test', { timeout: 10_000 });
  });

  test('multiple commands create multiple blocks', async ({ appPage }) => {
    const input = appPage.getByTestId('terminal-input');
    const output = appPage.getByTestId('terminal-output');

    // Run first command with unique marker
    await input.fill('echo first-cmd-marker');
    await input.press('Enter');
    await expect(output).toContainText('first-cmd-marker', {
      timeout: 10_000,
    });

    // Run second command with different unique marker
    await input.fill('echo second-cmd-marker');
    await input.press('Enter');
    await expect(output).toContainText('second-cmd-marker', {
      timeout: 10_000,
    });

    // Both markers should be visible (in their respective blocks)
    await expect(output).toContainText('first-cmd-marker');
    await expect(output).toContainText('second-cmd-marker');
  });
});
