import { test, expect } from './fixtures';

test.describe('Find in Output (Ctrl+Shift+F)', () => {
  test('test_e2e_find_in_output', async ({ appPage }) => {
    const textarea = appPage.getByTestId('editor-textarea');
    const output = appPage.getByTestId('terminal-output');

    // Run a command that produces distinctive output
    await textarea.fill('echo findme-test-marker-abc');
    await textarea.press('Enter');

    // Wait for output to appear
    await expect(output).toContainText('findme-test-marker-abc', {
      timeout: 10_000,
    });

    // Open search bar with Ctrl+Shift+F
    await appPage.keyboard.press('Control+Shift+f');

    // Search bar should appear with an input
    const searchInput = appPage.getByPlaceholder('Find in output...');
    await expect(searchInput).toBeVisible({ timeout: 5_000 });

    // Type search term
    await searchInput.fill('findme-test-marker-abc');

    // Wait for match counter to show results
    const matchCounter = appPage.locator('.search-match-count');
    await expect(matchCounter).toContainText(/\d+ of \d+/, { timeout: 5_000 });

    // Press Enter to navigate to next match
    await searchInput.press('Enter');

    // Current highlight should be visible
    const currentHighlight = appPage.locator('.search-highlight-current');
    await expect(currentHighlight).toBeVisible({ timeout: 5_000 });

    // Press Escape to close search bar
    await searchInput.press('Escape');

    // Search bar should be gone
    await expect(searchInput).not.toBeVisible({ timeout: 3_000 });

    // Highlights should be cleared
    const highlights = appPage.locator('.search-highlight');
    await expect(highlights).toHaveCount(0, { timeout: 3_000 });
  });
});
