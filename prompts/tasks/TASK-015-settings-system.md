# Task 015: Settings System + API Key Management

## Context

Pillar 5 (Agent Mode) requires LLM API keys. This task builds the settings infrastructure — a settings modal where the user configures their LLM provider and API key, persisted to disk.

### Current State
- **`src/components/layout/TabBar.tsx`**: Tab bar at the top — good place for a gear icon
- **`src/lib/types.ts`**: App type definitions
- **`src-tauri/src/commands/mod.rs`**: Tauri command handlers
- **`src-tauri/src/lib.rs`**: Command registration
- No settings system exists yet

## Requirements

### Backend (Rust)

#### 1. Dependencies

Add to `src-tauri/Cargo.toml`:
```toml
[dependencies]
reqwest = { version = "0.12", features = ["json"] }  # For future LLM API calls (TASK-016)
dirs = "6"  # For platform-specific app data directories
```

`reqwest` is added now so the Cargo.lock is updated, but it won't be used until TASK-016.

#### 2. Settings data structure

Create `src-tauri/src/settings/mod.rs`:

```rust
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppSettings {
    pub llm_provider: String,     // "openai", "anthropic", "google", "azure"
    pub api_key: String,          // The API key (stored in plaintext for MVP — same as VS Code)
    pub model: String,            // Model name (e.g., "gpt-4o-mini", "claude-sonnet-4-5-20250929", "gemini-2.0-flash")
    pub azure_endpoint: Option<String>,  // Only for Azure: the deployment endpoint URL
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            llm_provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
        }
    }
}
```

#### 3. Settings file I/O

In the same module, add functions:

```rust
use std::path::PathBuf;

pub fn settings_path() -> Result<PathBuf, String> {
    let data_dir = dirs::data_local_dir()
        .ok_or("Could not find local app data directory")?;
    let velocity_dir = data_dir.join("Velocity");
    std::fs::create_dir_all(&velocity_dir)
        .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    Ok(velocity_dir.join("settings.json"))
}

pub fn load_settings() -> Result<AppSettings, String> {
    let path = settings_path()?;
    if !path.exists() {
        return Ok(AppSettings::default());
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read settings: {}", e))?;
    serde_json::from_str(&content)
        .map_err(|e| format!("Failed to parse settings: {}", e))
}

pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    std::fs::write(&path, content)
        .map_err(|e| format!("Failed to write settings: {}", e))
}
```

#### 4. Tauri commands

Add to `src-tauri/src/commands/mod.rs` (or a new settings commands file):

```rust
#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    settings::load_settings()
}

#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    // Validate provider is one of: openai, anthropic, google, azure
    let valid_providers = ["openai", "anthropic", "google", "azure"];
    if !valid_providers.contains(&settings.llm_provider.as_str()) {
        return Err(format!("Invalid provider: {}", settings.llm_provider));
    }
    // Azure requires endpoint
    if settings.llm_provider == "azure" && settings.azure_endpoint.is_none() {
        return Err("Azure provider requires an endpoint URL".to_string());
    }
    settings::save_settings(&settings)
}
```

Register both in `lib.rs`.

#### 5. Wire module

Add `mod settings;` to `lib.rs`. Remove `.gitkeep` from `src-tauri/src/session/` if using it, or create the settings module as a new directory.

### Frontend (React/TypeScript)

#### 1. Settings types

Add to `src/lib/types.ts`:
```typescript
export interface AppSettings {
  llm_provider: 'openai' | 'anthropic' | 'google' | 'azure';
  api_key: string;
  model: string;
  azure_endpoint?: string;
}

export const LLM_PROVIDERS = [
  { id: 'openai', name: 'OpenAI', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] },
  { id: 'anthropic', name: 'Anthropic (Claude)', defaultModel: 'claude-sonnet-4-5-20250929', models: ['claude-sonnet-4-5-20250929', 'claude-haiku-4-5-20251001', 'claude-opus-4-6-20250918'] },
  { id: 'google', name: 'Google (Gemini)', defaultModel: 'gemini-2.0-flash', models: ['gemini-2.0-flash', 'gemini-2.5-pro'] },
  { id: 'azure', name: 'Azure OpenAI', defaultModel: 'gpt-4o-mini', models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'] },
] as const;

export type LlmProviderId = typeof LLM_PROVIDERS[number]['id'];
```

#### 2. Settings IPC wrappers

Create `src/lib/settings.ts`:
```typescript
import { invoke } from '@tauri-apps/api/core';
import { AppSettings } from './types';

export async function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>('get_settings');
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  return invoke<void>('save_app_settings', { settings });
}
```

#### 3. SettingsModal component

Create `src/components/SettingsModal.tsx`:

A modal/dialog that:
- Opens when the gear icon is clicked
- Shows a form with:
  - **Provider** dropdown (OpenAI, Anthropic, Google, Azure)
  - **API Key** input (password type, with show/hide toggle)
  - **Model** dropdown (populated based on selected provider)
  - **Azure Endpoint** input (only visible when Azure is selected)
- **Save** button → calls `saveSettings()` IPC
- **Cancel** button → closes without saving
- Loads existing settings on open via `getSettings()` IPC

Styling: dark modal overlay, form on dark background matching Catppuccin theme.

#### 4. Gear icon in TabBar

Add a gear icon button to `TabBar.tsx` (right side, after the `+` button):

```tsx
<button
  className="tab-settings-btn"
  data-testid="settings-button"
  onClick={onOpenSettings}
  title="Settings"
>
  ⚙
</button>
```

Add `onOpenSettings` prop to TabBar, managed by TabManager.

#### 5. Settings state in TabManager

TabManager manages the settings modal open/close state:
```typescript
const [settingsOpen, setSettingsOpen] = useState(false);

// Pass to TabBar:
<TabBar ... onOpenSettings={() => setSettingsOpen(true)} />

// Render modal:
{settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
```

### IPC Contract

```
get_settings() -> Result<AppSettings, String>
```
- Returns current settings (or defaults if no settings file exists)

```
save_app_settings(settings: AppSettings) -> Result<(), String>
```
- Validates and persists settings to disk
- `settings.llm_provider`: must be one of "openai", "anthropic", "google", "azure"
- `settings.api_key`: required (non-empty validated on frontend)
- `settings.azure_endpoint`: required when provider is "azure"

## Tests (Write These FIRST)

### Rust Unit Tests (`src-tauri/src/settings/mod.rs`)

- [ ] **`test_default_settings`**: `AppSettings::default()` returns provider "openai", empty api_key, model "gpt-4o-mini".
- [ ] **`test_settings_serialization_roundtrip`**: Create settings, serialize to JSON, deserialize back. Assert equality.
- [ ] **`test_validate_provider_rejects_invalid`**: Attempt to save with provider "invalid" → error.
- [ ] **`test_validate_azure_requires_endpoint`**: Save with provider "azure" and no endpoint → error.

### Frontend Tests (Vitest)

- [ ] **`test_SettingsModal_renders_form`**: Render `<SettingsModal>`. Assert provider dropdown, API key input, model dropdown, save/cancel buttons exist.
- [ ] **`test_SettingsModal_loads_settings`**: Mock `getSettings` to return custom settings. Assert form is pre-filled.
- [ ] **`test_SettingsModal_save_calls_IPC`**: Fill form, click Save. Assert `saveSettings` was called with correct values.
- [ ] **`test_SettingsModal_azure_shows_endpoint`**: Select Azure provider. Assert endpoint input appears.
- [ ] **`test_SettingsModal_cancel_closes`**: Click Cancel. Assert `onClose` was called.
- [ ] **`test_TabBar_has_settings_button`**: Render TabBar. Assert settings button exists.

### E2E Tests (Playwright)

- [ ] **`test_settings_modal_opens_and_closes`**: Click gear icon. Assert modal appears. Click Cancel. Assert modal closes.

## Acceptance Criteria

- [ ] All tests written and passing
- [ ] `AppSettings` struct in Rust with serialization
- [ ] Settings persisted to `%LOCALAPPDATA%/Velocity/settings.json`
- [ ] `get_settings` and `save_app_settings` Tauri commands
- [ ] Provider validation (openai/anthropic/google/azure only)
- [ ] Azure endpoint required when Azure selected
- [ ] SettingsModal component with provider, API key, model, endpoint fields
- [ ] Gear icon in TabBar opens settings
- [ ] Save persists, Cancel discards
- [ ] API key field is password type with show/hide toggle
- [ ] All existing tests pass
- [ ] `npm run test` + `cargo test` pass
- [ ] Clean commit: `feat: add settings system with LLM provider and API key management`

## Security Notes

- **API keys stored in plaintext** in a JSON file in AppData. This is the same approach as VS Code, Warp, and most desktop apps. For MVP this is acceptable. A future enhancement could use the OS keychain (Windows Credential Manager).
- The settings file is local to the user's machine — not shared or transmitted.
- API key input uses `type="password"` to prevent shoulder-surfing.
- Provider validation happens on the Rust side — the frontend cannot send arbitrary provider strings.

## Files to Read First

- `src-tauri/src/commands/mod.rs` — Existing command patterns
- `src-tauri/src/lib.rs` — Module + command registration
- `src-tauri/Cargo.toml` — Add dependencies
- `src/components/layout/TabBar.tsx` — Add gear icon
- `src/components/layout/TabManager.tsx` — Settings modal state
- `src/lib/types.ts` — Add AppSettings type
- `src/App.css` — Modal styles
