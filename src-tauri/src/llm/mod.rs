use crate::settings::AppSettings;
use reqwest::Client;
use serde_json::Value;
use std::sync::OnceLock;

/// Shared HTTP client with reasonable defaults, created once and reused.
fn http_client() -> &'static Client {
    static CLIENT: OnceLock<Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        Client::builder()
            .timeout(std::time::Duration::from_secs(30))
            .user_agent("Velocity/0.1")
            .build()
            .expect("Failed to build HTTP client")
    })
}

/// A request to translate natural language into a shell command.
pub struct TranslationRequest {
    pub prompt: String,
    pub shell_type: String,
    pub cwd: String,
}

/// The result of a successful translation.
#[derive(Debug)]
pub struct TranslationResponse {
    pub command: String,
}

/// Builds the system prompt with shell type and CWD context.
fn build_system_prompt(shell_type: &str, cwd: &str) -> String {
    format!(
        r#"You are a shell command translator. Convert the user's natural language request into a single executable shell command.

Rules:
- Output ONLY the command. No explanations, no markdown, no code fences.
- Target shell: {} on Windows
- Current working directory: {}
- If the request is ambiguous, make a reasonable assumption.
- If you cannot translate the request, output: ERROR: <reason>

Examples:
User: list all files
Command: dir

User: find typescript files modified this week
Command: Get-ChildItem -Recurse -Filter *.ts | Where-Object {{ $_.LastWriteTime -gt (Get-Date).AddDays(-7) }}

User: show disk usage
Command: Get-PSDrive -PSProvider FileSystem"#,
        shell_type, cwd
    )
}

/// Strips markdown code fences and trims whitespace from LLM responses.
fn clean_response(raw: &str) -> String {
    let trimmed = raw.trim();
    // Strip markdown code fences if present
    if trimmed.starts_with("```") && trimmed.ends_with("```") {
        let inner = trimmed
            .strip_prefix("```")
            .unwrap_or(trimmed)
            .strip_suffix("```")
            .unwrap_or(trimmed)
            .trim();
        // Remove optional language tag on first line
        if let Some(newline_pos) = inner.find('\n') {
            let first_line = &inner[..newline_pos];
            if first_line
                .chars()
                .all(|c| c.is_alphanumeric() || c == '-')
            {
                return inner[newline_pos + 1..].trim().to_string();
            }
        }
        return inner.to_string();
    }
    trimmed.to_string()
}

/// Translates a natural language prompt into a shell command using the configured LLM provider.
pub async fn translate_command(
    settings: &AppSettings,
    request: &TranslationRequest,
) -> Result<TranslationResponse, String> {
    if settings.api_key.is_empty() {
        return Err("No API key configured. Open Settings to add one.".to_string());
    }

    let system_prompt = build_system_prompt(&request.shell_type, &request.cwd);
    let user_message = &request.prompt;

    match settings.llm_provider.as_str() {
        "openai" => {
            call_openai(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "anthropic" => {
            call_anthropic(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "google" => {
            call_google(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "azure" => {
            call_azure(
                &settings.api_key,
                &settings.model,
                settings.azure_endpoint.as_deref(),
                &system_prompt,
                user_message,
            )
            .await
        }
        _ => Err(format!("Unknown provider: {}", settings.llm_provider)),
    }
}

/// Calls the OpenAI Chat Completions API.
async fn call_openai(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<TranslationResponse, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.1,
        "max_tokens": 500
    });

    let response = http_client()
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("OpenAI API error ({}): {}", status, error_msg));
    }

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Failed to extract response from OpenAI")?;

    Ok(TranslationResponse {
        command: clean_response(content),
    })
}

/// Calls the Anthropic Messages API.
async fn call_anthropic(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<TranslationResponse, String> {
    let body = serde_json::json!({
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": 500,
        "temperature": 0.1
    });

    let response = http_client()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("Anthropic API error ({}): {}", status, error_msg));
    }

    let content = json["content"][0]["text"]
        .as_str()
        .ok_or("Failed to extract response from Anthropic")?;

    Ok(TranslationResponse {
        command: clean_response(content),
    })
}

/// Calls the Google Gemini generateContent API.
async fn call_google(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<TranslationResponse, String> {
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        model, api_key
    );

    let body = serde_json::json!({
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_message}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 500}
    });

    let response = http_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("Google API error ({}): {}", status, error_msg));
    }

    let content = json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .ok_or("Failed to extract response from Google")?;

    Ok(TranslationResponse {
        command: clean_response(content),
    })
}

/// Calls the Azure OpenAI Chat Completions API.
async fn call_azure(
    api_key: &str,
    model: &str,
    endpoint: Option<&str>,
    system_prompt: &str,
    user_message: &str,
) -> Result<TranslationResponse, String> {
    let endpoint = endpoint.ok_or("Azure endpoint is required. Open Settings to configure it.")?;

    if !endpoint.starts_with("https://") {
        return Err("Azure endpoint must use HTTPS.".to_string());
    }

    let url = format!(
        "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
        endpoint.trim_end_matches('/'),
        model
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.1,
        "max_tokens": 500
    });

    let response = http_client()
        .post(&url)
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("HTTP request failed: {}", e))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| format!("Failed to parse response: {}", e))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(format!("Azure API error ({}): {}", status, error_msg));
    }

    let content = json["choices"][0]["message"]["content"]
        .as_str()
        .ok_or("Failed to extract response from Azure")?;

    Ok(TranslationResponse {
        command: clean_response(content),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    // --- System prompt tests ---

    #[test]
    fn test_build_system_prompt_powershell() {
        let prompt = build_system_prompt("powershell", "C:\\Users\\test");
        assert!(
            prompt.contains("powershell"),
            "System prompt should contain shell type"
        );
        assert!(
            prompt.contains("C:\\Users\\test"),
            "System prompt should contain CWD"
        );
    }

    #[test]
    fn test_build_system_prompt_cmd() {
        let prompt = build_system_prompt("cmd", "C:\\Windows");
        assert!(
            prompt.contains("cmd"),
            "System prompt should contain shell type"
        );
        assert!(
            prompt.contains("C:\\Windows"),
            "System prompt should contain CWD"
        );
    }

    // --- Response cleaning tests ---

    #[test]
    fn test_clean_response_plain() {
        assert_eq!(clean_response("dir /s"), "dir /s");
    }

    #[test]
    fn test_clean_response_strips_code_fence() {
        assert_eq!(clean_response("```\ndir /s\n```"), "dir /s");
    }

    #[test]
    fn test_clean_response_strips_code_fence_with_lang() {
        assert_eq!(clean_response("```powershell\ndir /s\n```"), "dir /s");
    }

    #[test]
    fn test_clean_response_trims_whitespace() {
        assert_eq!(clean_response("  dir /s  \n"), "dir /s");
    }

    // --- Translation function error path tests ---

    #[tokio::test]
    async fn test_translate_fails_without_api_key() {
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
        };
        let request = TranslationRequest {
            prompt: "list files".to_string(),
            shell_type: "powershell".to_string(),
            cwd: "C:\\Users\\test".to_string(),
        };
        let result = translate_command(&settings, &request).await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("No API key"),
            "Error should mention missing API key"
        );
    }

    #[tokio::test]
    async fn test_translate_fails_with_unknown_provider() {
        let settings = AppSettings {
            llm_provider: "invalid".to_string(),
            api_key: "some-key".to_string(),
            model: "some-model".to_string(),
            azure_endpoint: None,
        };
        let request = TranslationRequest {
            prompt: "list files".to_string(),
            shell_type: "powershell".to_string(),
            cwd: "C:\\Users\\test".to_string(),
        };
        let result = translate_command(&settings, &request).await;
        assert!(result.is_err());
        let err = result.unwrap_err();
        assert!(
            err.contains("Unknown provider"),
            "Error should mention unknown provider, got: {}",
            err
        );
    }
}
