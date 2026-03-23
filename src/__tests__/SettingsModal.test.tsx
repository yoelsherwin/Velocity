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
        theme: 'catppuccin-mocha',
        font_family: undefined,
        font_size: undefined,
        line_height: undefined,
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

  it('test_settings_modal_renders_font_section', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Appearance section should be visible
    expect(screen.getByText('Appearance')).toBeInTheDocument();
    expect(screen.getByTestId('settings-font-family')).toBeInTheDocument();
    expect(screen.getByTestId('settings-font-size')).toBeInTheDocument();
    expect(screen.getByTestId('settings-line-height')).toBeInTheDocument();
    // Font preview should be visible
    expect(screen.getByTestId('font-preview')).toBeInTheDocument();
  });

  it('test_settings_modal_saves_font_settings', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Fill in font fields
    const fontFamilyInput = screen.getByTestId('settings-font-family') as HTMLInputElement;
    fireEvent.change(fontFamilyInput, { target: { value: 'Fira Code, monospace' } });

    const fontSizeInput = screen.getByTestId('settings-font-size') as HTMLInputElement;
    fireEvent.change(fontSizeInput, { target: { value: '16' } });

    const lineHeightInput = screen.getByTestId('settings-line-height') as HTMLInputElement;
    fireEvent.change(lineHeightInput, { target: { value: '1.6' } });

    // Click Save
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      expect(savedSettings.font_family).toBe('Fira Code, monospace');
      expect(savedSettings.font_size).toBe(16);
      expect(savedSettings.line_height).toBe(1.6);
    });
  });

  it('test_font_preview_updates_on_input', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    const fontFamilyInput = screen.getByTestId('settings-font-family') as HTMLInputElement;
    fireEvent.change(fontFamilyInput, { target: { value: 'Courier New' } });

    const preview = screen.getByTestId('font-preview') as HTMLElement;
    expect(preview.style.fontFamily).toContain('Courier New');
  });

  it('test_settings_modal_loads_font_settings', async () => {
    mockGetSettings.mockResolvedValue({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      font_family: 'JetBrains Mono',
      font_size: 18,
      line_height: 1.8,
    });

    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      const fontFamilyInput = screen.getByTestId('settings-font-family') as HTMLInputElement;
      expect(fontFamilyInput.value).toBe('JetBrains Mono');
    });

    const fontSizeInput = screen.getByTestId('settings-font-size') as HTMLInputElement;
    expect(fontSizeInput.value).toBe('18');

    const lineHeightInput = screen.getByTestId('settings-line-height') as HTMLInputElement;
    expect(lineHeightInput.value).toBe('1.8');
  });

  it('test_settings_modal_renders_theme_picker', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    const themeSelect = screen.getByTestId('settings-theme') as HTMLSelectElement;
    expect(themeSelect).toBeInTheDocument();
    // Default theme should be catppuccin-mocha
    expect(themeSelect.value).toBe('catppuccin-mocha');
    // Should have multiple theme options
    expect(themeSelect.options.length).toBeGreaterThanOrEqual(4);
  });

  it('test_theme_setting_persists', async () => {
    mockGetSettings.mockResolvedValue({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      theme: 'dracula',
    });

    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      const themeSelect = screen.getByTestId('settings-theme') as HTMLSelectElement;
      expect(themeSelect.value).toBe('dracula');
    });
  });

  it('test_theme_saves_with_settings', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Change theme
    const themeSelect = screen.getByTestId('settings-theme');
    fireEvent.change(themeSelect, { target: { value: 'one-dark' } });

    // Save
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      expect(savedSettings.theme).toBe('one-dark');
    });
  });
});
