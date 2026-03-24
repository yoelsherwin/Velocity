import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the settings IPC module
const mockGetSettings = vi.fn();
const mockSaveSettings = vi.fn();
const mockSetWindowEffect = vi.fn();

vi.mock('../lib/settings', () => ({
  getSettings: (...args: unknown[]) => mockGetSettings(...args),
  saveSettings: (...args: unknown[]) => mockSaveSettings(...args),
  setWindowEffect: (...args: unknown[]) => mockSetWindowEffect(...args),
}));

// Mock background-effects module to avoid real IPC calls
vi.mock('../lib/background-effects', () => ({
  applyBackgroundEffect: vi.fn(),
}));

import SettingsModal from '../components/SettingsModal';

describe('SettingsModal - Background Effects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetSettings.mockResolvedValue({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      azure_endpoint: undefined,
    });
    mockSaveSettings.mockResolvedValue(undefined);
    mockSetWindowEffect.mockResolvedValue(undefined);
  });

  it('test_background_effect_setting_renders', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Background effect dropdown should be visible
    const effectSelect = screen.getByTestId('settings-background-effect') as HTMLSelectElement;
    expect(effectSelect).toBeInTheDocument();
    expect(effectSelect.value).toBe('none');

    // Should have 4 options: none, transparent, acrylic, mica
    expect(effectSelect.options.length).toBe(4);
  });

  it('test_opacity_slider_renders', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Opacity slider should NOT be visible when effect is "none"
    expect(screen.queryByTestId('settings-background-opacity')).not.toBeInTheDocument();

    // Switch to transparent
    const effectSelect = screen.getByTestId('settings-background-effect');
    fireEvent.change(effectSelect, { target: { value: 'transparent' } });

    // Now opacity slider should be visible
    expect(screen.getByTestId('settings-background-opacity')).toBeInTheDocument();
    expect(screen.getByTestId('settings-opacity-value')).toBeInTheDocument();
  });

  it('test_background_setting_persists', async () => {
    mockGetSettings.mockResolvedValue({
      llm_provider: 'openai',
      api_key: '',
      model: 'gpt-4o-mini',
      background_effect: 'acrylic',
      background_opacity: 0.85,
    });

    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      const effectSelect = screen.getByTestId('settings-background-effect') as HTMLSelectElement;
      expect(effectSelect.value).toBe('acrylic');
    });

    // Opacity slider should be visible and show the loaded value
    const opacitySlider = screen.getByTestId('settings-background-opacity') as HTMLInputElement;
    expect(opacitySlider.value).toBe('0.85');

    const opacityValue = screen.getByTestId('settings-opacity-value');
    expect(opacityValue.textContent).toBe('0.85');
  });

  it('saves background settings correctly', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Select acrylic effect
    const effectSelect = screen.getByTestId('settings-background-effect');
    fireEvent.change(effectSelect, { target: { value: 'acrylic' } });

    // Adjust opacity
    const opacitySlider = screen.getByTestId('settings-background-opacity');
    fireEvent.change(opacitySlider, { target: { value: '0.75' } });

    // Save
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      expect(savedSettings.background_effect).toBe('acrylic');
      expect(savedSettings.background_opacity).toBe(0.75);
    });
  });

  it('saves no background fields when effect is none', async () => {
    render(<SettingsModal onClose={vi.fn()} />);

    await waitFor(() => {
      expect(screen.getByTestId('settings-modal')).toBeInTheDocument();
    });

    // Leave effect as "none" (default)
    fireEvent.click(screen.getByTestId('settings-save-btn'));

    await waitFor(() => {
      expect(mockSaveSettings).toHaveBeenCalledTimes(1);
      const savedSettings = mockSaveSettings.mock.calls[0][0];
      expect(savedSettings.background_effect).toBeUndefined();
    });
  });
});
