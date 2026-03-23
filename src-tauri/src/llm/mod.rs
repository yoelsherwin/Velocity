use crate::settings::AppSettings;
use reqwest::Client;
use serde_json::Value;
use std::sync::OnceLock;
use urlencoding::encode as url_encode;

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

/// Sanitizes error messages by replacing API keys with [REDACTED].
/// Applied to all provider error paths as defense in depth.
fn sanitize_error(error: &str, api_key: &str) -> String {
    if api_key.is_empty() {
        return error.to_string();
    }
    error.replace(api_key, "[REDACTED]")
}

/// Validates that a model name is safe for URL path interpolation.
/// Rejects characters that could break URL structure.
fn validate_model_for_url(model: &str) -> Result<(), String> {
    if model.is_empty() {
        return Err("Model name cannot be empty".to_string());
    }
    if model.contains('?') || model.contains('#') || model.contains('&') {
        return Err("Model name contains invalid URL characters".to_string());
    }
    Ok(())
}

/// A request to classify user input as CLI or natural language.
pub struct ClassificationRequest {
    pub input: String,
    pub shell_type: String,
    pub known_commands: Vec<String>,
}

/// The result of a successful classification.
#[derive(Debug)]
pub struct ClassificationResponse {
    pub intent: String, // "cli" or "natural_language"
}

/// Builds the system prompt for intent classification.
fn build_classification_prompt(shell_type: &str, known_commands: &[String]) -> String {
    let commands_str = if known_commands.is_empty() {
        "(none provided)".to_string()
    } else {
        known_commands.iter().take(10).cloned().collect::<Vec<_>>().join(", ")
    };

    format!(
        r#"You are a terminal input classifier. Determine if the user's input is a CLI command or a natural language request.

Rules:
- Output ONLY "cli" or "natural_language". Nothing else.
- Shell type: {}
- Known commands on this system include: {}
- "cli" means the input is meant to be executed directly as a shell command
- "natural_language" means the input is a question or request in English

Examples:
Input: "git status" → cli
Input: "show me all running processes" → natural_language
Input: "docker compose up -d" → cli
Input: "what ports are open" → natural_language
Input: "netstat -an" → cli
Input: "create a new react project" → natural_language"#,
        shell_type, commands_str
    )
}

/// Parses a classification response, defaulting to "cli" for invalid responses.
fn parse_classification_response(raw: &str) -> String {
    let trimmed = raw.trim().to_lowercase();
    match trimmed.as_str() {
        "cli" => "cli".to_string(),
        "natural_language" => "natural_language".to_string(),
        _ => "cli".to_string(), // Default to CLI for safety
    }
}

/// Classifies user input as CLI or natural language using the configured LLM provider.
pub async fn classify_intent(
    settings: &AppSettings,
    request: &ClassificationRequest,
) -> Result<ClassificationResponse, String> {
    if settings.api_key.is_empty() {
        return Err("No API key configured. Open Settings to add one.".to_string());
    }

    let system_prompt = build_classification_prompt(&request.shell_type, &request.known_commands);
    let user_message = &request.input;

    let translation_result = match settings.llm_provider.as_str() {
        "openai" => {
            call_openai_classification(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "anthropic" => {
            call_anthropic_classification(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "google" => {
            call_google_classification(&settings.api_key, &settings.model, &system_prompt, user_message).await
        }
        "azure" => {
            call_azure_classification(
                &settings.api_key,
                &settings.model,
                settings.azure_endpoint.as_deref(),
                &system_prompt,
                user_message,
            )
            .await
        }
        _ => Err(format!("Unknown provider: {}", settings.llm_provider)),
    }?;

    let intent = parse_classification_response(&translation_result);
    Ok(ClassificationResponse { intent })
}

/// Calls the OpenAI Chat Completions API for classification (low max_tokens, temperature 0).
async fn call_openai_classification(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.0,
        "max_tokens": 10
    });

    let response = http_client()
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("OpenAI API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from OpenAI".to_string())
}

/// Calls the Anthropic Messages API for classification.
async fn call_anthropic_classification(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": 10,
        "temperature": 0.0
    });

    let response = http_client()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Anthropic API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Anthropic".to_string())
}

/// Calls the Google Gemini API for classification.
async fn call_google_classification(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        encoded_model, api_key
    );

    let body = serde_json::json!({
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_message}]}],
        "generationConfig": {"temperature": 0.0, "maxOutputTokens": 10}
    });

    let response = http_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Google API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Google".to_string())
}

/// Calls the Azure OpenAI API for classification.
async fn call_azure_classification(
    api_key: &str,
    model: &str,
    endpoint: Option<&str>,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let endpoint = endpoint.ok_or("Azure endpoint is required. Open Settings to configure it.")?;

    if !endpoint.starts_with("https://") {
        return Err("Azure endpoint must use HTTPS.".to_string());
    }

    if endpoint.contains('?') || endpoint.contains('#') {
        return Err("Azure endpoint must not contain query parameters or fragments".to_string());
    }

    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
        endpoint.trim_end_matches('/'),
        encoded_model
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.0,
        "max_tokens": 10
    });

    let response = http_client()
        .post(&url)
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Azure API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Azure".to_string())
}

/// Maximum number of characters of error output to send to the LLM.
const MAX_ERROR_OUTPUT_CHARS: usize = 2000;

/// A request to suggest a fix for a failed command.
pub struct FixRequest {
    pub command: String,
    pub exit_code: i32,
    pub error_output: String, // Last 2000 chars of output
    pub shell_type: String,
    pub cwd: String,
}

/// The result of a successful fix suggestion.
#[derive(Debug, Clone, serde::Serialize)]
pub struct FixResponse {
    pub suggested_command: String,
    pub explanation: String,
}

/// Truncates error output to the last MAX_ERROR_OUTPUT_CHARS characters.
fn truncate_error_output(output: &str) -> &str {
    if output.len() <= MAX_ERROR_OUTPUT_CHARS {
        output
    } else {
        &output[output.len() - MAX_ERROR_OUTPUT_CHARS..]
    }
}

/// Builds the system prompt for fix suggestion.
fn build_fix_prompt(shell_type: &str, cwd: &str) -> String {
    format!(
        r#"You are a shell command error analyzer. The user ran a command that failed.
Analyze the error and suggest a corrected command.

Rules:
- Output a JSON object with "command" and "explanation" fields
- "command": the corrected shell command to try
- "explanation": one sentence explaining what went wrong (max 100 chars)
- Target shell: {} on Windows
- Current directory: {}
- If you cannot determine a fix, set command to "" and explain why"#,
        shell_type, cwd
    )
}

/// Builds the user message for fix suggestion from a FixRequest.
fn build_fix_user_message(request: &FixRequest) -> String {
    let truncated_output = truncate_error_output(&request.error_output);
    format!(
        "Command: {}\nExit code: {}\nError output:\n{}",
        request.command, request.exit_code, truncated_output
    )
}

/// Parses a fix suggestion response from the LLM.
/// Handles JSON extraction, including stripping markdown code fences.
fn parse_fix_response(raw: &str) -> FixResponse {
    let cleaned = clean_response(raw);

    // Try to parse as JSON
    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&cleaned) {
        let command = value["command"]
            .as_str()
            .unwrap_or("")
            .to_string();
        let explanation = value["explanation"]
            .as_str()
            .unwrap_or("")
            .to_string();
        return FixResponse {
            suggested_command: command,
            explanation,
        };
    }

    // Malformed response: return empty suggestion
    FixResponse {
        suggested_command: String::new(),
        explanation: "Could not parse LLM response".to_string(),
    }
}

/// Suggests a fix for a failed command using the configured LLM provider.
pub async fn suggest_fix(
    settings: &AppSettings,
    request: &FixRequest,
) -> Result<FixResponse, String> {
    if settings.api_key.is_empty() {
        return Err("No API key configured. Open Settings to add one.".to_string());
    }

    let system_prompt = build_fix_prompt(&request.shell_type, &request.cwd);
    let user_message = build_fix_user_message(request);

    let raw_response = match settings.llm_provider.as_str() {
        "openai" => {
            call_openai_fix(&settings.api_key, &settings.model, &system_prompt, &user_message).await
        }
        "anthropic" => {
            call_anthropic_fix(&settings.api_key, &settings.model, &system_prompt, &user_message).await
        }
        "google" => {
            call_google_fix(&settings.api_key, &settings.model, &system_prompt, &user_message).await
        }
        "azure" => {
            call_azure_fix(
                &settings.api_key,
                &settings.model,
                settings.azure_endpoint.as_deref(),
                &system_prompt,
                &user_message,
            )
            .await
        }
        _ => Err(format!("Unknown provider: {}", settings.llm_provider)),
    }?;

    Ok(parse_fix_response(&raw_response))
}

/// Calls the OpenAI Chat Completions API for fix suggestions (temperature 0.3, max_tokens 200).
async fn call_openai_fix(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.3,
        "max_tokens": 200
    });

    let response = http_client()
        .post("https://api.openai.com/v1/chat/completions")
        .header("Authorization", format!("Bearer {}", api_key))
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("OpenAI API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from OpenAI".to_string())
}

/// Calls the Anthropic Messages API for fix suggestions.
async fn call_anthropic_fix(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let body = serde_json::json!({
        "model": model,
        "system": system_prompt,
        "messages": [{"role": "user", "content": user_message}],
        "max_tokens": 200,
        "temperature": 0.3
    });

    let response = http_client()
        .post("https://api.anthropic.com/v1/messages")
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Anthropic API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["content"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Anthropic".to_string())
}

/// Calls the Google Gemini API for fix suggestions.
async fn call_google_fix(
    api_key: &str,
    model: &str,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        encoded_model, api_key
    );

    let body = serde_json::json!({
        "systemInstruction": {"parts": [{"text": system_prompt}]},
        "contents": [{"parts": [{"text": user_message}]}],
        "generationConfig": {"temperature": 0.3, "maxOutputTokens": 200}
    });

    let response = http_client()
        .post(&url)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Google API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["candidates"][0]["content"]["parts"][0]["text"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Google".to_string())
}

/// Calls the Azure OpenAI API for fix suggestions.
async fn call_azure_fix(
    api_key: &str,
    model: &str,
    endpoint: Option<&str>,
    system_prompt: &str,
    user_message: &str,
) -> Result<String, String> {
    let endpoint = endpoint.ok_or("Azure endpoint is required. Open Settings to configure it.")?;

    if !endpoint.starts_with("https://") {
        return Err("Azure endpoint must use HTTPS.".to_string());
    }

    if endpoint.contains('?') || endpoint.contains('#') {
        return Err("Azure endpoint must not contain query parameters or fragments".to_string());
    }

    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
        endpoint.trim_end_matches('/'),
        encoded_model
    );

    let body = serde_json::json!({
        "model": model,
        "messages": [
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": user_message}
        ],
        "temperature": 0.3,
        "max_tokens": 200
    });

    let response = http_client()
        .post(&url)
        .header("api-key", api_key)
        .header("Content-Type", "application/json")
        .json(&body)
        .send()
        .await
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Azure API error ({}): {}", status, error_msg),
            api_key,
        ));
    }

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(|s| s.to_string())
        .ok_or_else(|| "Failed to extract response from Azure".to_string())
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
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("OpenAI API error ({}): {}", status, error_msg),
            api_key,
        ));
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
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Anthropic API error ({}): {}", status, error_msg),
            api_key,
        ));
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
    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "https://generativelanguage.googleapis.com/v1beta/models/{}:generateContent?key={}",
        encoded_model, api_key
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
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Google API error ({}): {}", status, error_msg),
            api_key,
        ));
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

    if endpoint.contains('?') || endpoint.contains('#') {
        return Err("Azure endpoint must not contain query parameters or fragments".to_string());
    }

    validate_model_for_url(model)?;
    let encoded_model = url_encode(model);
    let url = format!(
        "{}/openai/deployments/{}/chat/completions?api-version=2024-02-01",
        endpoint.trim_end_matches('/'),
        encoded_model
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
        .map_err(|e| sanitize_error(&format!("HTTP request failed: {}", e), api_key))?;

    let status = response.status();
    let json: Value = response
        .json()
        .await
        .map_err(|e| sanitize_error(&format!("Failed to parse response: {}", e), api_key))?;

    if !status.is_success() {
        let error_msg = json["error"]["message"]
            .as_str()
            .unwrap_or("Unknown API error");
        return Err(sanitize_error(
            &format!("Azure API error ({}): {}", status, error_msg),
            api_key,
        ));
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
            ..Default::default()
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
            ..Default::default()
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

    // --- Error sanitization tests ---

    #[test]
    fn test_sanitize_error_redacts_key() {
        let api_key = "sk-super-secret-key-12345";
        let error = format!("HTTP request failed: https://api.example.com?key={}", api_key);
        let sanitized = sanitize_error(&error, api_key);
        assert!(
            !sanitized.contains(api_key),
            "Sanitized error should not contain the API key"
        );
        assert!(
            sanitized.contains("[REDACTED]"),
            "Sanitized error should contain [REDACTED]"
        );
    }

    #[test]
    fn test_sanitize_error_empty_key_passthrough() {
        let error = "HTTP request failed: some error";
        let sanitized = sanitize_error(error, "");
        assert_eq!(sanitized, error, "Empty key should pass through unchanged");
    }

    #[test]
    fn test_sanitize_error_multiple_occurrences() {
        let api_key = "my-secret";
        let error = format!("Error: {} and also {}", api_key, api_key);
        let sanitized = sanitize_error(&error, api_key);
        assert!(
            !sanitized.contains(api_key),
            "All occurrences of key should be redacted"
        );
        assert_eq!(
            sanitized.matches("[REDACTED]").count(),
            2,
            "Should have two [REDACTED] placeholders"
        );
    }

    // --- URL validation tests ---

    #[test]
    fn test_validate_model_for_url_accepts_normal() {
        assert!(validate_model_for_url("gpt-4o-mini").is_ok());
        assert!(validate_model_for_url("claude-sonnet-4-5-20250929").is_ok());
        assert!(validate_model_for_url("gemini-2.0-flash").is_ok());
    }

    #[test]
    fn test_validate_model_for_url_rejects_query_chars() {
        assert!(validate_model_for_url("model?injection=true").is_err());
        assert!(validate_model_for_url("model#fragment").is_err());
        assert!(validate_model_for_url("model&extra=param").is_err());
    }

    #[test]
    fn test_validate_model_for_url_rejects_empty() {
        assert!(validate_model_for_url("").is_err());
    }

    // --- Azure endpoint validation tests ---

    #[tokio::test]
    async fn test_azure_endpoint_rejects_query_params() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: Some("https://my-instance.openai.azure.com?foo=bar".to_string()),
            ..Default::default()
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
            err.contains("must not contain query parameters"),
            "Should reject endpoint with query params, got: {}",
            err
        );
    }

    #[tokio::test]
    async fn test_azure_endpoint_rejects_fragment() {
        let settings = AppSettings {
            llm_provider: "azure".to_string(),
            api_key: "some-key".to_string(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: Some("https://my-instance.openai.azure.com#frag".to_string()),
            ..Default::default()
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
            err.contains("must not contain query parameters"),
            "Should reject endpoint with fragment, got: {}",
            err
        );
    }

    // --- Intent classification tests ---

    #[test]
    fn test_classify_intent_system_prompt_contains_shell_type() {
        let prompt = build_classification_prompt("powershell", &["git".to_string(), "docker".to_string()]);
        assert!(
            prompt.contains("powershell"),
            "Classification prompt should contain shell type"
        );
    }

    #[test]
    fn test_classify_intent_response_parsing_cli() {
        let result = parse_classification_response("cli");
        assert_eq!(result, "cli");
    }

    #[test]
    fn test_classify_intent_response_parsing_nl() {
        let result = parse_classification_response("natural_language");
        assert_eq!(result, "natural_language");
    }

    #[test]
    fn test_classify_intent_response_parsing_with_whitespace() {
        let result = parse_classification_response(" cli \n");
        assert_eq!(result, "cli");
    }

    #[test]
    fn test_classify_intent_response_invalid_defaults_to_cli() {
        let result = parse_classification_response("maybe");
        assert_eq!(result, "cli", "Invalid response should default to 'cli'");
    }

    #[tokio::test]
    async fn test_classify_intent_fails_without_api_key() {
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            ..Default::default()
        };
        let request = ClassificationRequest {
            input: "something ambiguous".to_string(),
            shell_type: "powershell".to_string(),
            known_commands: vec!["git".to_string()],
        };
        let result = classify_intent(&settings, &request).await;
        assert!(result.is_err());
        assert!(
            result.unwrap_err().contains("No API key"),
            "Error should mention missing API key"
        );
    }

    #[test]
    fn test_classification_prompt_contains_known_commands() {
        let commands = vec!["git".to_string(), "docker".to_string(), "npm".to_string()];
        let prompt = build_classification_prompt("powershell", &commands);
        assert!(prompt.contains("git"), "Prompt should contain known commands");
        assert!(prompt.contains("docker"), "Prompt should contain known commands");
        assert!(prompt.contains("npm"), "Prompt should contain known commands");
    }

    #[test]
    fn test_classification_prompt_limits_to_10_commands() {
        let commands: Vec<String> = (0..20).map(|i| format!("cmd{}", i)).collect();
        let prompt = build_classification_prompt("powershell", &commands);
        // Should contain cmd0 through cmd9 but not cmd10+
        assert!(prompt.contains("cmd0"), "Prompt should contain first commands");
        assert!(prompt.contains("cmd9"), "Prompt should contain up to 10th command");
        assert!(!prompt.contains("cmd10"), "Prompt should not contain 11th+ commands");
    }

    // --- Fix suggestion tests ---

    #[test]
    fn test_fix_suggestion_prompt_includes_context() {
        let prompt = build_fix_prompt("powershell", "C:\\Projects");
        assert!(prompt.contains("powershell"), "Fix prompt should contain shell type");
        assert!(prompt.contains("C:\\Projects"), "Fix prompt should contain CWD");
        assert!(prompt.contains("command"), "Fix prompt should mention command field");
        assert!(prompt.contains("explanation"), "Fix prompt should mention explanation field");
    }

    #[test]
    fn test_fix_response_parsing_valid() {
        let raw = r#"{"command": "git push --set-upstream origin main", "explanation": "No upstream branch was set"}"#;
        let response = parse_fix_response(raw);
        assert_eq!(response.suggested_command, "git push --set-upstream origin main");
        assert_eq!(response.explanation, "No upstream branch was set");
    }

    #[test]
    fn test_fix_response_parsing_invalid() {
        let raw = "This is not valid JSON at all";
        let response = parse_fix_response(raw);
        assert!(response.suggested_command.is_empty(), "Invalid JSON should result in empty command");
        assert!(!response.explanation.is_empty(), "Invalid JSON should have an explanation");
    }

    #[test]
    fn test_fix_response_strips_markdown() {
        let raw = "```json\n{\"command\": \"npm install\", \"explanation\": \"Missing dependencies\"}\n```";
        let response = parse_fix_response(raw);
        assert_eq!(response.suggested_command, "npm install");
        assert_eq!(response.explanation, "Missing dependencies");
    }

    #[test]
    fn test_error_output_truncated() {
        let long_output = "x".repeat(5000);
        let truncated = truncate_error_output(&long_output);
        assert_eq!(truncated.len(), MAX_ERROR_OUTPUT_CHARS, "Should truncate to MAX_ERROR_OUTPUT_CHARS");
        // Should keep the LAST 2000 chars
        assert!(truncated.chars().all(|c| c == 'x'));
    }

    #[test]
    fn test_error_output_short_not_truncated() {
        let short_output = "error: file not found";
        let truncated = truncate_error_output(short_output);
        assert_eq!(truncated, short_output, "Short output should not be truncated");
    }

    #[test]
    fn test_fix_user_message_contains_context() {
        let request = FixRequest {
            command: "git push".to_string(),
            exit_code: 1,
            error_output: "fatal: no upstream branch".to_string(),
            shell_type: "powershell".to_string(),
            cwd: "C:\\Projects".to_string(),
        };
        let message = build_fix_user_message(&request);
        assert!(message.contains("git push"), "User message should contain command");
        assert!(message.contains("1"), "User message should contain exit code");
        assert!(message.contains("fatal: no upstream branch"), "User message should contain error output");
    }

    #[tokio::test]
    async fn test_suggest_fix_fails_without_api_key() {
        let settings = AppSettings {
            llm_provider: "openai".to_string(),
            api_key: String::new(),
            model: "gpt-4o-mini".to_string(),
            azure_endpoint: None,
            ..Default::default()
        };
        let request = FixRequest {
            command: "git push".to_string(),
            exit_code: 1,
            error_output: "error".to_string(),
            shell_type: "powershell".to_string(),
            cwd: "C:\\".to_string(),
        };
        let result = suggest_fix(&settings, &request).await;
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("No API key"));
    }
}
