import { useState, useEffect } from 'react';
import { AppSettings, LLM_PROVIDERS, LlmProviderId } from '../lib/types';
import { getSettings, saveSettings } from '../lib/settings';
import { applyFontSettings } from '../lib/font-settings';

interface SettingsModalProps {
  onClose: () => void;
}

function SettingsModal({ onClose }: SettingsModalProps) {
  const [provider, setProvider] = useState<LlmProviderId>('openai');
  const [apiKey, setApiKey] = useState('');
  const [model, setModel] = useState('gpt-4o-mini');
  const [azureEndpoint, setAzureEndpoint] = useState('');
  const [showApiKey, setShowApiKey] = useState(false);
  const [fontFamily, setFontFamily] = useState('');
  const [fontSize, setFontSize] = useState<string>('');
  const [lineHeight, setLineHeight] = useState<string>('');
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
        setFontFamily(settings.font_family ?? '');
        setFontSize(settings.font_size != null ? String(settings.font_size) : '');
        setLineHeight(settings.line_height != null ? String(settings.line_height) : '');
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

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    const parsedFontSize = fontSize ? Number(fontSize) : undefined;
    const parsedLineHeight = lineHeight ? Number(lineHeight) : undefined;
    const settings: AppSettings = {
      llm_provider: provider,
      api_key: apiKey,
      model,
      azure_endpoint: provider === 'azure' ? azureEndpoint || undefined : undefined,
      font_family: fontFamily || undefined,
      font_size: parsedFontSize && !isNaN(parsedFontSize) ? parsedFontSize : undefined,
      line_height: parsedLineHeight && !isNaN(parsedLineHeight) ? parsedLineHeight : undefined,
    };
    try {
      await saveSettings(settings);
      applyFontSettings(settings);
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
            <h3 style={{ color: '#cdd6f4', fontSize: '15px', fontWeight: 600, margin: '4px 0 0 0' }}>
              Appearance
            </h3>

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
                backgroundColor: '#313244',
                borderRadius: '4px',
                color: '#cdd6f4',
                whiteSpace: 'pre',
              }}
            >
              {'$ echo "Hello, World!"'}
            </div>

            <div style={{ borderBottom: '1px solid #313244', margin: '4px 0' }} />

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
