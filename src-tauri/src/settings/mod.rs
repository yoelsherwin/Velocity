use serde::{Deserialize, Serialize};
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AppSettings {
    pub llm_provider: String,
    pub api_key: String,
    pub model: String,
    pub azure_endpoint: Option<String>,
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

/// Valid LLM provider identifiers.
const VALID_PROVIDERS: &[&str] = &["openai", "anthropic", "google", "azure"];

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
        };

        let result = validate_settings(&settings);
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("Azure endpoint cannot be empty"),
            "Should reject whitespace-only endpoint"
        );
    }
}
