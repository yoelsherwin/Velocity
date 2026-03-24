import { useState, useEffect } from 'react';
import { AppSettings, LLM_PROVIDERS, LlmProviderId, BACKGROUND_EFFECTS, BackgroundEffect } from '../lib/types';
import { getSettings, saveSettings } from '../lib/settings';
import { applyFontSettings } from '../lib/font-settings';
import { THEMES, DEFAULT_THEME_ID, applyThemeById } from '../lib/themes';
import { applyBackgroundEffect } from '../lib/background-effects';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<LlmProviderId>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [azureEndpoint, setAzureEndpoint] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [theme, setTheme] = useState(DEFAULT_THEME_ID);
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState<string>('');
  const [lineHeight, setLineHeight] = useState<string>('');
  const [backgroundEffect, setBackgroundEffect] = useState<BackgroundEffect>('none');
  const [backgroundOpacity, setBackgroundOpacity] = useState<string>('1.0');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load existing settings on mount
  useEffect(() => {
    let cancelled = false;
    getSettings()
      .then((settings) => {
        if (cancelled) return;
        setProvider(settings.llm_provider);
        setApiKey(settings.api_key);
        setModel(settings.model);
        setAzureEndpoint(settings.azure_endpoint ?? '');
        setTheme(settings.theme ?? DEFAULT_THEME_ID);
        setFontFamily(settings.font_family ?? '');
        setFontSize(settings.font_size != null ? String(settings.font_size) : '');
        setLineHeight(settings.line_height != null ? String(settings.line_height) : '');
        setBackgroundEffect(settings.background_effect ?? 'none');
        setBackgroundOpacity(settings.background_opacity != null ? String(settings.background_opacity) : '1.0');
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const currentProviderConfig = LLM_PROVIDERS.find((p) => p.id === provider);

  const handleProviderChange = (newProvider: LlmProviderId) => {
    setProvider(newProvider);
    const config = LLM_PROVIDERS.find((p) => p.id === newProvider);
    if (config) {
      setModel(config.defaultModel);
    }
  };

  const handleThemeChange = (newThemeId: string) => {
    setTheme(newThemeId);
    // Apply preview immediately
    applyThemeById(newThemeId);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const parsedFontSize = fontSize ? Number(fontSize) : undefined;
    const parsedLineHeight = lineHeight ? Number(lineHeight) : undefined;
    const parsedOpacity = backgroundOpacity ? Number(backgroundOpacity) : undefined;
    const settings: AppSettings = {
      llm_provider: provider,
      api_key: apiKey,
      model,
      azure_endpoint: provider === 'azure' ? azureEndpoint || undefined : undefined,
      theme,
      font_family: fontFamily || undefined,
      font_size: parsedFontSize && !isNaN(parsedFontSize) ? parsedFontSize : undefined,
      line_height: parsedLineHeight && !isNaN(parsedLineHeight) ? parsedLineHeight : undefined,
      background_effect: backgroundEffect !== 'none' ? backgroundEffect : undefined,
      background_opacity: parsedOpacity && !isNaN(parsedOpacity) ? parsedOpacity : undefined,
    };
    try {
      await saveSettings(settings);
      applyFontSettings(settings);
      applyThemeById(settings.theme ?? DEFAULT_THEME_ID);
      applyBackgroundEffect(settings);
      onClose();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  };

  const handleOverlayClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) {
      onClose();
    }
  };

  return (
    <div
      className="settings-overlay"
      data-testid="settings-modal"
      onClick={handleOverlayClick}
    >
      <div className="settings-dialog">
        <h2 className="settings-title">Settings</h2>

        {loading ? (
          <div className="settings-loading">Loading settings...</div>
        ) : (
          <form
            className="settings-form"
            onSubmit={(e) => {
              e.preventDefault();
              handleSave();
            }}
          >
            {error && <div className="settings-error">{error}</div>}

            {/* Appearance */}
            <h3 style={{ color: 'var(--text-primary)', fontSize: '15px', fontWeight: 600, margin: '4px 0 0 0' }}>
              Appearance
            </h3>

            <label className="settings-label" htmlFor="settings-theme">
              Theme
            </label>
            <select
              id="settings-theme"
              data-testid="settings-theme"
              className="settings-select"
              value={theme}
              onChange={(e) => handleThemeChange(e.target.value)}
            >
              {THEMES.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </select>

            <label className="settings-label" htmlFor="settings-background-effect">
              Background Effect
            </label>
            <select
              id="settings-background-effect"
              data-testid="settings-background-effect"
              className="settings-select"
              value={backgroundEffect}
              onChange={(e) => setBackgroundEffect(e.target.value as BackgroundEffect)}
            >
              {BACKGROUND_EFFECTS.map((eff) => (
                <option key={eff} value={eff}>
                  {eff.charAt(0).toUpperCase() + eff.slice(1)}
                </option>
              ))}
            </select>

            {backgroundEffect !== 'none' && (
              <>
                <label className="settings-label" htmlFor="settings-background-opacity">
                  Background Opacity
                </label>
                <input
                  id="settings-background-opacity"
                  data-testid="settings-background-opacity"
                  className="settings-input"
                  type="range"
                  min={0.5}
                  max={1.0}
                  step={0.05}
                  value={backgroundOpacity}
                  onChange={(e) => setBackgroundOpacity(e.target.value)}
                />
                <span
                  data-testid="settings-opacity-value"
                  style={{ color: 'var(--text-secondary)', fontSize: '12px', marginTop: '-8px' }}
                >
                  {Number(backgroundOpacity).toFixed(2)}
                </span>
              </>
            )}

            <label className="settings-label" htmlFor="settings-font-family">
              Font Family
            </label>
            <input
              id="settings-font-family"
              data-testid="settings-font-family"
              className="settings-input"
              type="text"
              value={fontFamily}
              onChange={(e) => setFontFamily(e.target.value)}
              placeholder="'Cascadia Code', 'Consolas', 'Courier New', monospace"
            />

            <label className="settings-label" htmlFor="settings-font-size">
              Font Size (px)
            </label>
            <input
              id="settings-font-size"
              data-testid="settings-font-size"
              className="settings-input"
              type="number"
              min={8}
              max={32}
              step={1}
              value={fontSize}
              onChange={(e) => setFontSize(e.target.value)}
              placeholder="14"
            />

            <label className="settings-label" htmlFor="settings-line-height">
              Line Height
            </label>
            <input
              id="settings-line-height"
              data-testid="settings-line-height"
              className="settings-input"
              type="number"
              min={1.0}
              max={3.0}
              step={0.1}
              value={lineHeight}
              onChange={(e) => setLineHeight(e.target.value)}
              placeholder="1.4"
            />

            {/* Font Preview */}
            <div
              data-testid="font-preview"
              style={{
                fontFamily: fontFamily || "'Cascadia Code', 'Consolas', 'Courier New', monospace",
                fontSize: fontSize ? `${fontSize}px` : '14px',
                lineHeight: lineHeight || '1.4',
                padding: '8px 12px',
                backgroundColor: 'var(--bg-surface)',
                borderRadius: '4px',
                color: 'var(--text-primary)',
                whiteSpace: 'pre',
              }}
            >
              {'$ echo "Hello, World!"'}
            </div>

            <div style={{ borderBottom: '1px solid var(--border-color)', margin: '4px 0' }} />

            {/* Provider */}
            <label className="settings-label" htmlFor="settings-provider">
              LLM Provider
            </label>
            <select
              id="settings-provider"
              data-testid="settings-provider"
              className="settings-select"
              value={provider}
              onChange={(e) => handleProviderChange(e.target.value as LlmProviderId)}
            >
              {LLM_PROVIDERS.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>

            {/* API Key */}
            <label className="settings-label" htmlFor="settings-api-key">
              API Key
            </label>
            <div className="settings-api-key-row">
              <input
                id="settings-api-key"
                data-testid="settings-api-key"
                className="settings-input"
                type={showApiKey ? 'text' : 'password'}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Enter your API key"
                autoComplete="off"
              />
              <button
                type="button"
                data-testid="settings-api-key-toggle"
                className="settings-toggle-btn"
                onClick={() => setShowApiKey((prev) => !prev)}
                title={showApiKey ? 'Hide API key' : 'Show API key'}
              >
                {showApiKey ? 'Hide' : 'Show'}
              </button>
            </div>

            {/* Model */}
            <label className="settings-label" htmlFor="settings-model">
              Model
            </label>
            <select
              id="settings-model"
              data-testid="settings-model"
              className="settings-select"
              value={model}
              onChange={(e) => setModel(e.target.value)}
            >
              {currentProviderConfig?.models.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>

            {/* Azure Endpoint (only when Azure selected) */}
            {provider === 'azure' && (
              <>
                <label className="settings-label" htmlFor="settings-azure-endpoint">
                  Azure Endpoint URL
                </label>
                <input
                  id="settings-azure-endpoint"
                  data-testid="settings-azure-endpoint"
                  className="settings-input"
                  type="text"
                  value={azureEndpoint}
                  onChange={(e) => setAzureEndpoint(e.target.value)}
                  placeholder="https://your-instance.openai.azure.com"
                />
              </>
            )}

            {/* Buttons */}
            <div className="settings-actions">
              <button
                type="button"
                data-testid="settings-cancel-btn"
                className="settings-btn settings-btn-cancel"
                onClick={onClose}
              >
                Cancel
              </button>
              <button
                type="submit"
                data-testid="settings-save-btn"
                className="settings-btn settings-btn-save"
                disabled={saving}
              >
                {saving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default SettingsModal;
