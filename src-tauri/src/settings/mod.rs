use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub llm_provider: String,
    pub api_key: String,
    pub model: String,
    pub azure_endpoint: Option<String>,
    #[serde(default)]
    pub font_family: Option<String>,
    #[serde(default)]
    pub font_size: Option<u16>,
    #[serde(default)]
    pub line_height: Option<f32>,
    #[serde(default)]
    pub theme: Option<String>,
    #[serde(default)]
    pub background_effect: Option<String>,
    #[serde(default)]
    pub background_opacity: Option<f64>,
}

impl Default for AppSettings {
    fn default() -> Self {
        AppSettings {
            llm_provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            font_family: None,
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        }
    }
}

/// Valid LLM provider identifiers.
const VALID_PROVIDERS: &[&str] = &["openai", "anthropic", "google", "azure"];

/// Valid background effect identifiers.
const VALID_BACKGROUND_EFFECTS: &[&str] = &["none", "transparent", "acrylic", "mica"];

/// Valid built-in theme identifiers.
const VALID_THEMES: &[&str] = &[
    "catppuccin-mocha",
    "catppuccin-latte",
    "dracula",
    "one-dark",
    "solarized-dark",
];

/// Returns the path to the settings JSON file.
/// Creates the Velocity directory under the user's local app data if it does not exist.
pub fn settings_path() -> Result<PathBuf, String> {
    let data_dir =
        dirs::data_local_dir().ok_or("Could not find local app data directory")?;
    let velocity_dir = data_dir.join("Velocity");
    std::fs::create_dir_all(&velocity_dir)
        .map_err(|e| format!("Failed to create settings directory: {}", e))?;
    Ok(velocity_dir.join("settings.json"))
}

/// Loads settings from disk. Returns defaults if the file does not exist.
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

/// Persists settings to disk as pretty-printed JSON.
/// Uses atomic write (write to .tmp then rename) to prevent corruption on crash.
pub fn save_settings(settings: &AppSettings) -> Result<(), String> {
    let path = settings_path()?;
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write settings: {}", e))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize settings file: {}", e))
}

/// Validates window effect name and opacity for the set_window_effect command.
pub fn validate_window_effect(effect: &str, opacity: f64) -> Result<(), String> {
    if !VALID_BACKGROUND_EFFECTS.contains(&effect) {
        return Err(format!("Invalid background effect: {}", effect));
    }
    if opacity < 0.5 || opacity > 1.0 {
        return Err(format!(
            "Background opacity must be between 0.5 and 1.0, got {}",
            opacity
        ));
    }
    Ok(())
}

/// Validates that the provider is one of the accepted values.
pub fn validate_provider(provider: &str) -> Result<(), String> {
    if !VALID_PROVIDERS.contains(&provider) {
        return Err(format!("Invalid provider: {}", provider));
    }
    Ok(())
}

/// Validates the full settings object.
/// - Provider must be one of: openai, anthropic, google, azure
/// - Azure provider requires a non-empty endpoint URL
/// - Font size must be between 8 and 32 (inclusive) if provided
/// - Line height must be between 1.0 and 3.0 if provided
/// - Font family must be non-empty and at most 200 chars if provided
pub fn validate_settings(settings: &AppSettings) -> Result<(), String> {
    validate_provider(&settings.llm_provider)?;
    if settings.llm_provider == "azure" {
        match &settings.azure_endpoint {
            None => return Err("Azure provider requires an endpoint URL".to_string()),
            Some(ep) if ep.trim().is_empty() => {
                return Err("Azure endpoint cannot be empty".to_string())
            }
            _ => {}
        }
    }

    if let Some(size) = settings.font_size {
        if size < 8 || size > 32 {
            return Err(format!("Font size must be between 8 and 32, got {}", size));
        }
    }

    if let Some(lh) = settings.line_height {
        if lh < 1.0 || lh > 3.0 {
            return Err(format!("Line height must be between 1.0 and 3.0, got {}", lh));
        }
    }

    if let Some(ref theme) = settings.theme {
        if !VALID_THEMES.contains(&theme.as_str()) {
            return Err(format!("Invalid theme: {}", theme));
        }
    }

    if let Some(ref effect) = settings.background_effect {
        if !VALID_BACKGROUND_EFFECTS.contains(&effect.as_str()) {
            return Err(format!("Invalid background effect: {}", effect));
        }
    }

    if let Some(opacity) = settings.background_opacity {
        if opacity < 0.5 || opacity > 1.0 {
            return Err(format!(
                "Background opacity must be between 0.5 and 1.0, got {}",
                opacity
            ));
        }
    }

    if let Some(ref family) = settings.font_family {
        if family.is_empty() {
            return Err("Font family cannot be empty".to_string());
        }
        if family.len() > 200 {
            return Err(format!("Font family too long ({} chars, max 200)", family.len()));
        }
        if !family.chars().all(|c| c.is_alphanumeric() || " ,'-._".contains(c)) {
            return Err("Font family contains invalid characters".to_string());
        }
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_default_settings() {
        let settings = AppSettings::default();
        assert_eq!(settings.llm_provider, "openai");
        assert_eq!(settings.api_key, "");
        assert_eq!(settings.model, "gpt-4o-mini");
        assert_eq!(settings.azure_endpoint, None);
    }

    #[test]
    fn test_settings_serialization_roundtrip() {
        let settings = AppSettings {
            llm_provider: "anthropic".to_string(),
            api_key: "sk-test-key-123".to_string(),
            model: "claude-sonnet-4-5-20250929".to_string(),
            azure_endpoint: None,
            font_family: None,
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };

        let json = serde_json::to_string_pretty(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings, deserialized);
    }

    #[test]
    fn test_settings_serialization_roundtrip_with_azure() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "azure-key-456".to_string(),
            model: "gpt-4o".to_string(),
            azure_endpoint: Some("https://my-instance.openai.azure.com".to_string()),
            font_family: None,
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };

        let json = serde_json::to_string_pretty(&settings).unwrap();
        let deserialized: AppSettings = serde_json::from_str(&json).unwrap();

        assert_eq!(settings, deserialized);
    }

    #[test]
    fn test_validate_provider_rejects_invalid() {
        let result = validate_provider("invalid");
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid provider: invalid"));
    }

    #[test]
    fn test_validate_provider_accepts_valid() {
        for provider in &["openai", "anthropic", "google", "azure"] {
            assert!(validate_provider(provider).is_ok(), "Provider '{}' should be valid", provider);
        }
    }

    #[test]
    fn test_validate_azure_requires_endpoint() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            ..Default::default()
        };

        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Azure provider requires an endpoint URL"));
    }

    #[test]
    fn test_validate_azure_with_endpoint_succeeds() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: Some("https://my-instance.openai.azure.com".to_string()),
            ..Default::default()
        };

        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn test_validate_settings_with_invalid_provider() {
        let settings = AppSettings {
            llm_provider: "deepseek".to_string(),
            api_key: "some-key".to_string(),
            model: "some-model".to_string(),
            azure_endpoint: None,
            ..Default::default()
        };

        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid provider: deepseek"));
    }

    #[test]
    fn test_validate_non_azure_ignores_endpoint() {
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: "key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            ..Default::default()
        };

        assert!(validate_settings(&settings).is_ok());
    }

    #[test]
    fn test_azure_endpoint_rejects_empty_string() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: Some("".to_string()),
            ..Default::default()
        };

        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Azure endpoint cannot be empty"),
            "Should reject empty string endpoint"
        );
    }

    #[test]
    fn test_azure_endpoint_rejects_whitespace_only() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: Some("   ".to_string()),
            ..Default::default()
        };

        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Azure endpoint cannot be empty"),
            "Should reject whitespace-only endpoint"
        );
    }

    #[test]
    fn test_settings_with_font_fields_deserialize() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini",
            "font_family": "JetBrains Mono, monospace",
            "font_size": 16,
            "line_height": 1.6
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.font_family, Some("JetBrains Mono, monospace".to_string()));
        assert_eq!(settings.font_size, Some(16));
        assert_eq!(settings.line_height, Some(1.6));
    }

    #[test]
    fn test_settings_without_font_fields_deserialize() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.font_family, None);
        assert_eq!(settings.font_size, None);
        assert_eq!(settings.line_height, None);
        assert_eq!(settings.llm_provider, "openai");
    }

    #[test]
    fn test_font_size_validation_bounds() {
        let base = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: "key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            font_family: None,
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };

        // 7 rejected
        let mut s = base.clone();
        s.font_size = Some(7);
        assert!(validate_settings(&s).is_err());

        // 8 accepted
        let mut s = base.clone();
        s.font_size = Some(8);
        assert!(validate_settings(&s).is_ok());

        // 32 accepted
        let mut s = base.clone();
        s.font_size = Some(32);
        assert!(validate_settings(&s).is_ok());

        // 33 rejected
        let mut s = base.clone();
        s.font_size = Some(33);
        assert!(validate_settings(&s).is_err());
    }

    #[test]
    fn test_line_height_validation_bounds() {
        let base = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: "key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            font_family: None,
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };

        // 0.9 rejected
        let mut s = base.clone();
        s.line_height = Some(0.9);
        assert!(validate_settings(&s).is_err());

        // 1.0 accepted
        let mut s = base.clone();
        s.line_height = Some(1.0);
        assert!(validate_settings(&s).is_ok());

        // 3.0 accepted
        let mut s = base.clone();
        s.line_height = Some(3.0);
        assert!(validate_settings(&s).is_ok());

        // 3.1 rejected
        let mut s = base.clone();
        s.line_height = Some(3.1);
        assert!(validate_settings(&s).is_err());
    }

    #[test]
    fn test_font_family_validation_empty() {
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: "key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            font_family: Some("".to_string()),
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn test_font_family_rejects_css_injection() {
        let dangerous_inputs = vec![
            "Consolas; background: red",
            "Mono} body { display: none",
            "Hack<script>alert(1)</script>",
            "Mono()",
            "Mono\\test",
            "Mono\"test",
            "Mono: bold",
            "Mono/test",
            "Mono!important",
            "Mono@import",
        ];
        for input in dangerous_inputs {
            let settings = AppSettings {
                llm_provider: "openai".to_string(),
                api_key: "key".to_string(),
                model: "gpt-4o-mini".to_string(),
                azure_endpoint: None,
                font_family: Some(input.to_string()),
                font_size: None,
                line_height: None,
                theme: None,
                background_effect: None,
                background_opacity: None,
            };
            let result = validate_settings(&settings);
            assert!(result.is_err(), "Should reject font_family: {:?}", input);
            assert!(
                result.unwrap_err().contains("invalid characters"),
                "Error message should mention invalid characters for: {:?}",
                input,
            );
        }
    }

    #[test]
    fn test_font_family_accepts_valid_names() {
        let valid_inputs = vec![
            "JetBrains Mono",
            "Consolas, 'Courier New', monospace",
            "Fira Code",
            "DejaVu Sans Mono",
            "Source Code Pro",
        ];
        for input in valid_inputs {
            let settings = AppSettings {
                llm_provider: "openai".to_string(),
                api_key: "key".to_string(),
                model: "gpt-4o-mini".to_string(),
                azure_endpoint: None,
                font_family: Some(input.to_string()),
                font_size: None,
                line_height: None,
                theme: None,
                background_effect: None,
                background_opacity: None,
            };
            assert!(validate_settings(&settings).is_ok(), "Should accept font_family: {:?}", input);
        }
    }

    #[test]
    fn test_font_family_validation_too_long() {
        let long_name = "A".repeat(201);
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: "key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            font_family: Some(long_name),
            font_size: None,
            line_height: None,
            theme: None,
            background_effect: None,
            background_opacity: None,
        };
        assert!(validate_settings(&settings).is_err());
    }

    #[test]
    fn test_settings_with_theme_deserialize() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini",
            "theme": "dracula"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.theme, Some("dracula".to_string()));
    }

    #[test]
    fn test_settings_without_theme_backward_compat() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.theme, None);
        assert_eq!(settings.llm_provider, "openai");
    }

    #[test]
    fn test_window_effect_validation() {
        // Valid effects accepted
        for effect in &["none", "transparent", "acrylic", "mica"] {
            assert!(
                validate_window_effect(effect, 0.8).is_ok(),
                "Effect '{}' should be valid",
                effect,
            );
        }

        // Invalid effect rejected
        let result = validate_window_effect("blur", 0.8);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid background effect: blur"));

        let result = validate_window_effect("", 0.8);
        assert!(result.is_err());
    }

    #[test]
    fn test_opacity_bounds() {
        // Below minimum rejected
        let result = validate_window_effect("transparent", 0.3);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("between 0.5 and 1.0"));

        // At minimum accepted
        assert!(validate_window_effect("transparent", 0.5).is_ok());

        // At maximum accepted
        assert!(validate_window_effect("transparent", 1.0).is_ok());

        // Above maximum rejected
        let result = validate_window_effect("transparent", 1.1);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("between 0.5 and 1.0"));
    }

    #[test]
    fn test_background_effect_setting_validation() {
        // Valid effect in settings
        let settings = AppSettings {
            background_effect: Some("acrylic".to_string()),
            background_opacity: Some(0.8),
            ..Default::default()
        };
        assert!(validate_settings(&settings).is_ok());

        // Invalid effect in settings
        let settings = AppSettings {
            background_effect: Some("invalid".to_string()),
            ..Default::default()
        };
        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid background effect"));

        // Invalid opacity in settings
        let settings = AppSettings {
            background_effect: Some("transparent".to_string()),
            background_opacity: Some(0.2),
            ..Default::default()
        };
        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Background opacity"));
    }

    #[test]
    fn test_settings_with_background_effect_deserialize() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini",
            "background_effect": "acrylic",
            "background_opacity": 0.85
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.background_effect, Some("acrylic".to_string()));
        assert_eq!(settings.background_opacity, Some(0.85));
    }

    #[test]
    fn test_settings_without_background_effect_backward_compat() {
        let json = r#"{
            "llm_provider": "openai",
            "api_key": "test-key",
            "model": "gpt-4o-mini"
        }"#;
        let settings: AppSettings = serde_json::from_str(json).unwrap();
        assert_eq!(settings.background_effect, None);
        assert_eq!(settings.background_opacity, None);
        assert_eq!(settings.llm_provider, "openai");
    }

    #[test]
    fn test_theme_validation() {
        // Valid themes accepted
        for theme in &["catppuccin-mocha", "catppuccin-latte", "dracula", "one-dark", "solarized-dark"] {
            let settings = AppSettings {
                theme: Some(theme.to_string()),
                ..Default::default()
            };
            assert!(validate_settings(&settings).is_ok(), "Theme '{}' should be valid", theme);
        }

        // Invalid theme rejected
        let settings = AppSettings {
            theme: Some("nonexistent-theme".to_string()),
            ..Default::default()
        };
        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid theme: nonexistent-theme"));

        // None theme is valid (uses default)
        let settings = AppSettings {
            theme: None,
            ..Default::default()
        };
        assert!(validate_settings(&settings).is_ok());
    }
}
