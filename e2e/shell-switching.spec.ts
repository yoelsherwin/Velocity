import { test, expect } from './fixtures';

test.describe('Shell switching', () => {
  test('switch to CMD shell', async ({ appPage }) => {
    // Click the CMD shell button
    await appPage.getByTestId('shell-btn-cmd').click();

    // CMD button should now be the active/selected tab
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wait for CMD prompt to appear — CMD typically shows a path with ">"
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('>', { timeout: 15_000 });
  });

  test('switch back to PowerShell after CMD', async ({ appPage }) => {
    // Switch to CMD first
    await appPage.getByTestId('shell-btn-cmd').click();
    await expect(appPage.getByTestId('shell-btn-cmd')).toHaveAttribute(
      'aria-selected',
      'true',
    );

    // Wait for CMD to be ready
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('>', { timeout: 15_000 });

    // Switch back to PowerShell
    await appPage.getByTestId('shell-btn-powershell').click();
    await expect(
      appPage.getByTestId('shell-btn-powershell'),
    ).toHaveAttribute('aria-selected', 'true');

    // Should be able to run a PowerShell command successfully
    const input = appPage.getByTestId('terminal-input');
    await input.fill('echo ps-after-switch');
    await input.press('Enter');
    await expect(output).toContainText('ps-after-switch', {
      timeout: 10_000,
    });
  });
});
