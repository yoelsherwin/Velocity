import { test, expect } from './fixtures';

test.describe('Split panes', () => {
  test('split pane creates two terminals', async ({ appPage }) => {
    // Initially there should be a single pane (leaf)
    await expect(appPage.locator('.pane-leaf')).toHaveCount(1);

    // Hover over the pane to reveal pane action buttons
    await appPage.locator('.pane-leaf').first().hover();

    // Click the "Split Right" button (|) to split horizontally
    await appPage.locator('.pane-action-btn[title="Split Right"]').click();

    // Assert two pane-leaf elements are now visible
    await expect(appPage.locator('.pane-leaf')).toHaveCount(2);

    // Both panes should contain a terminal (verify shell selector or input exists in each)
    const panes = appPage.locator('.pane-leaf');
    await expect(panes.nth(0).locator('[data-testid="shell-selector"]')).toBeVisible();
    await expect(panes.nth(1).locator('[data-testid="shell-selector"]')).toBeVisible();
  });

  test('split panes have independent output', async ({ appPage }) => {
    // Wait for the initial shell to be ready
    await expect(
      appPage.getByTestId('terminal-output'),
    ).toContainText('PS', { timeout: 15_000 });

    // Hover over the pane and split it
    await appPage.locator('.pane-leaf').first().hover();
    await appPage.locator('.pane-action-btn[title="Split Right"]').click();
    await expect(appPage.locator('.pane-leaf')).toHaveCount(2);

    // Wait for the second pane's shell to initialize
    const pane2 = appPage.locator('.pane-leaf').nth(1);
    await expect(pane2.locator('[data-testid="terminal-output"]')).toContainText(
      'PS',
      { timeout: 15_000 },
    );

    // Click the first pane to focus it and run a command
    const pane1 = appPage.locator('.pane-leaf').nth(0);
    await pane1.click();
    const pane1Textarea = pane1.locator('[data-testid="editor-textarea"]');
    await pane1Textarea.fill('echo pane1-independent-marker');
    await pane1Textarea.press('Enter');
    await expect(pane1.locator('[data-testid="terminal-output"]')).toContainText(
      'pane1-independent-marker',
      { timeout: 10_000 },
    );

    // Click the second pane to focus it and run a different command
    await pane2.click();
    const pane2Textarea = pane2.locator('[data-testid="editor-textarea"]');
    await pane2Textarea.fill('echo pane2-independent-marker');
    await pane2Textarea.press('Enter');
    await expect(pane2.locator('[data-testid="terminal-output"]')).toContainText(
      'pane2-independent-marker',
      { timeout: 10_000 },
    );

    // Verify isolation: pane 1 should NOT contain pane 2's marker
    await expect(pane1.locator('[data-testid="terminal-output"]')).not.toContainText(
      'pane2-independent-marker',
    );
    // And pane 2 should NOT contain pane 1's marker
    await expect(pane2.locator('[data-testid="terminal-output"]')).not.toContainText(
      'pane1-independent-marker',
    );
  });
});
