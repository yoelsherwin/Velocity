import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the settings IPC module
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();

vi.mock('../lib/settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
}));

import SettingsModal from '../components/SettingsModal';

describe('SettingsModal', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Default: return default settings
    mockGetSettings.mockResolvedValue({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      azure_endpoint: undefined,
    });
    mockSaveSettings.mockResolvedValue(undefined);
  });

  it('test_SettingsModal_renders_form', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Provider dropdown
    expect(screen.getByTestId('settings-provider')).toBeInTheDocument();
    // API key input
    expect(screen.getByTestId('settings-api-key')).toBeInTheDocument();
    // Model dropdown
    expect(screen.getByTestId('settings-model')).toBeInTheDocument();
    // Save button
    expect(screen.getByTestId('settings-save-btn')).toBeInTheDocument();
    // Cancel button
    expect(screen.getByTestId('settings-cancel-btn')).toBeInTheDocument();
  });

  it('test_SettingsModal_loads_settings', async () => {
    mockGetSettings.mockResolvedValue({
      llm_provider: 'anthropic',
      api_key: 'sk-test-key',
      model: 'claude-sonnet-4-5-20250929',
      azure_endpoint: undefined,
    });

    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      const providerSelect = screen.getByTestId('settings-provider') as HTMLSelectElement;
      expect(providerSelect.value).toBe('anthropic');
    });

    const apiKeyInput = screen.getByTestId('settings-api-key') as HTMLInputElement;
    expect(apiKeyInput.value).toBe('sk-test-key');

    const modelSelect = screen.getByTestId('settings-model') as HTMLSelectElement;
    expect(modelSelect.value).toBe('claude-sonnet-4-5-20250929');
  });

  it('test_SettingsModal_save_calls_IPC', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Fill in the API key
    const apiKeyInput = screen.getByTestId('settings-api-key') as HTMLInputElement;
    fireEvent.change(apiKeyInput, { target: { value: 'my-api-key' } });

    // Click Save
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      expect(mockSaveSettings).toHaveBeenCalledWith({
        llm_provider: 'openai',
        api_key: 'my-api-key',
        model: 'gpt-4o-mini',
        azure_endpoint: undefined,
      });
    });
  });

  it('test_SettingsModal_azure_shows_endpoint', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Initially, Azure endpoint should not be visible
    expect(screen.queryByTestId('settings-azure-endpoint')).not.toBeInTheDocument();

    // Switch to Azure provider
    const providerSelect = screen.getByTestId('settings-provider');
    fireEvent.change(providerSelect, { target: { value: 'azure' } });

    // Now Azure endpoint should be visible
    expect(screen.getByTestId('settings-azure-endpoint')).toBeInTheDocument();
  });

  it('test_SettingsModal_cancel_closes', async () => {
    const onClose = vi.fn();
    render(<SettingsModal onClose={onClose} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('settings-cancel-btn'));

    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it('test_api_key_is_password_type', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    const apiKeyInput = screen.getByTestId('settings-api-key') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');
  });

  it('test_api_key_show_hide_toggle', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    const apiKeyInput = screen.getByTestId('settings-api-key') as HTMLInputElement;
    expect(apiKeyInput.type).toBe('password');

    // Click the toggle button to show the key
    const toggleBtn = screen.getByTestId('settings-api-key-toggle');
    fireEvent.click(toggleBtn);

    expect(apiKeyInput.type).toBe('text');

    // Click again to hide
    fireEvent.click(toggleBtn);
    expect(apiKeyInput.type).toBe('password');
  });

  it('test_changing_provider_updates_model_options', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Switch to Google provider
    const providerSelect = screen.getByTestId('settings-provider');
    fireEvent.change(providerSelect, { target: { value: 'google' } });

    // Model should reset to Google's default
    const modelSelect = screen.getByTestId('settings-model') as HTMLSelectElement;
    expect(modelSelect.value).toBe('gemini-2.0-flash');
  });
});
