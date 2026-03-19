import { test, expect } from './fixtures';

test.describe('LLM Intent Fallback', () => {
  test('test_e2e_ambiguous_input_classified', async ({ appPage }) => {
    // Wait for the terminal to be ready
    const textarea = appPage.getByTestId('editor-textarea');
    await expect(textarea).toBeVisible({ timeout: 15_000 });

    // Type an ambiguous input (unknown single word -> low confidence CLI)
    await textarea.fill('foobar');

    // Mode indicator should show uncertainty (CLI? with question mark)
    const indicator = appPage.getByTestId('mode-indicator');
    await expect(indicator).toBeVisible({ timeout: 5_000 });
    await expect(indicator).toContainText('CLI?');

    // Press Enter — this should trigger the LLM classification fallback
    await textarea.press('Enter');

    // Since no API key is configured in the test environment, the LLM call
    // will fail and fall back to the heuristic result. We verify:
    // 1. The loading state appears briefly (Classifying...) or
    // 2. The command is executed directly (fallback to heuristic CLI)
    const agentLoading = appPage.getByTestId('agent-loading');

    // The loading indicator may flash briefly or not appear at all if the
    // fallback is instant. Either way, the command should be submitted.
    // Wait for the command to appear in the output (executed as CLI)
    const output = appPage.getByTestId('terminal-output');
    await expect(output).toContainText('foobar', { timeout: 15_000 });

    // The agent-loading should NOT remain visible after fallback
    await expect(agentLoading).not.toBeVisible({ timeout: 5_000 });
  });
});
