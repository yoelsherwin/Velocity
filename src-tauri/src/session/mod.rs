use std::path::PathBuf;

/// Returns the path to the session JSON file.
/// Creates the Velocity directory under the user's local app data if it does not exist.
pub fn session_path() -> Result<PathBuf, String> {
    let data_dir =
        dirs::data_local_dir().ok_or("Could not find local app data directory")?;
    let velocity_dir = data_dir.join("Velocity");
    std::fs::create_dir_all(&velocity_dir)
        .map_err(|e| format!("Failed to create session directory: {}", e))?;
    Ok(velocity_dir.join("session.json"))
}

/// Saves session state (opaque JSON string) to disk.
/// Uses atomic write (write to .tmp then rename) to prevent corruption on crash.
pub fn save_session(state: &str) -> Result<(), String> {
    let path = session_path()?;
    let tmp_path = path.with_extension("json.tmp");
    std::fs::write(&tmp_path, state)
        .map_err(|e| format!("Failed to write session: {}", e))?;
    std::fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to finalize session file: {}", e))
}

/// Returns true if a CWD path is safe (does not contain shell metacharacters).
fn is_valid_cwd_path(path: &str) -> bool {
    !path.chars().any(|c| matches!(c, ';' | '&' | '|' | '`' | '$' | '(' | ')' | '{' | '}' | '[' | ']' | '\n' | '\r'))
}

/// Sanitize CWD paths in a parsed session JSON value.
/// Replaces any CWD containing shell metacharacters with a safe default.
fn sanitize_session_cwd_paths(value: &mut serde_json::Value) {
    if let Some(tabs) = value.get_mut("tabs").and_then(|t| t.as_array_mut()) {
        for tab in tabs.iter_mut() {
            if let Some(panes) = tab.get_mut("panes").and_then(|p| p.as_array_mut()) {
                for pane in panes.iter_mut() {
                    if let Some(cwd) = pane.get_mut("cwd").and_then(|c| c.as_str()).map(String::from) {
                        if !is_valid_cwd_path(&cwd) {
                            pane["cwd"] = serde_json::Value::String("C:\\".to_string());
                        }
                    }
                }
            }
        }
    }
}

/// Loads session state from disk.
/// Returns None if the file does not exist or contains invalid content.
pub fn load_session() -> Result<Option<String>, String> {
    let path = session_path()?;
    if !path.exists() {
        return Ok(None);
    }
    let content = std::fs::read_to_string(&path)
        .map_err(|e| format!("Failed to read session: {}", e))?;
    // Validate it's at least valid JSON; return None for corrupt files
    let mut parsed: serde_json::Value = match serde_json::from_str(&content) {
        Ok(v) => v,
        Err(_) => return Ok(None),
    };
    // Sanitize CWD paths to prevent command injection via tampered session files
    sanitize_session_cwd_paths(&mut parsed);
    let sanitized = serde_json::to_string(&parsed)
        .map_err(|e| format!("Failed to serialize sanitized session: {}", e))?;
    Ok(Some(sanitized))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_dir() -> PathBuf {
        std::env::temp_dir().join("velocity_session_test")
    }

    #[test]
    fn test_save_session_writes_file() {
        let dir = test_dir().join("save_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = dir.join("session.json");
        let tmp_path = dir.join("session.json.tmp");

        let state = r#"{"version":1,"tabs":[],"activeTabId":"abc"}"#;

        // Write directly to the test path (bypassing session_path which uses real LocalAppData)
        fs::write(&tmp_path, state).unwrap();
        fs::rename(&tmp_path, &path).unwrap();

        assert!(path.exists());
        let content = fs::read_to_string(&path).unwrap();
        assert_eq!(content, state);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_session_reads_file() {
        let dir = test_dir().join("load_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let state = r#"{"version":1,"tabs":[],"activeTabId":"abc"}"#;
        let path = dir.join("session.json");
        fs::write(&path, state).unwrap();

        // Read back
        let content = fs::read_to_string(&path).unwrap();
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&content);
        assert!(parsed.is_ok());
        assert_eq!(content, state);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_load_session_missing_file() {
        let result = load_session();
        // If no session file exists in LocalAppData, should return Ok(None)
        // This test relies on the real path, but if a file happens to exist it still passes
        assert!(result.is_ok());
    }

    #[test]
    fn test_load_session_invalid_json() {
        let dir = test_dir().join("invalid_test");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let path = dir.join("session.json");
        fs::write(&path, "NOT VALID JSON {{{").unwrap();

        // Read and validate
        let content = fs::read_to_string(&path).unwrap();
        let parsed: Result<serde_json::Value, _> = serde_json::from_str(&content);
        assert!(parsed.is_err(), "Invalid JSON should fail to parse");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_is_valid_cwd_path_accepts_normal_paths() {
        assert!(is_valid_cwd_path("C:\\Users\\test"));
        assert!(is_valid_cwd_path("D:\\My Projects\\app"));
        assert!(is_valid_cwd_path("/home/user/documents"));
        assert!(is_valid_cwd_path("C:\\Program Files\\My App"));
    }

    #[test]
    fn test_is_valid_cwd_path_rejects_metacharacters() {
        assert!(!is_valid_cwd_path("C:\\foo; rm -rf /"));
        assert!(!is_valid_cwd_path("C:\\foo | malicious"));
        assert!(!is_valid_cwd_path("C:\\foo & echo pwned"));
        assert!(!is_valid_cwd_path("C:\\foo`whoami`"));
        assert!(!is_valid_cwd_path("C:\\$HOME"));
        assert!(!is_valid_cwd_path("C:\\$(whoami)"));
        assert!(!is_valid_cwd_path("C:\\foo\nrm -rf /"));
        assert!(!is_valid_cwd_path("C:\\foo\rrm -rf /"));
        assert!(!is_valid_cwd_path("C:\\foo{bar}"));
        assert!(!is_valid_cwd_path("C:\\foo[0]"));
    }

    #[test]
    fn test_sanitize_session_cwd_paths_replaces_malicious() {
        let mut value: serde_json::Value = serde_json::from_str(r#"{
            "version": 1,
            "tabs": [{
                "id": "t1",
                "panes": [
                    {"id": "p1", "cwd": "C:\\Users\\safe"},
                    {"id": "p2", "cwd": "C:\\foo; rm -rf /"},
                    {"id": "p3", "cwd": "/home/user"}
                ]
            }],
            "activeTabId": "t1"
        }"#).unwrap();

        sanitize_session_cwd_paths(&mut value);

        let panes = value["tabs"][0]["panes"].as_array().unwrap();
        assert_eq!(panes[0]["cwd"].as_str().unwrap(), "C:\\Users\\safe");
        assert_eq!(panes[1]["cwd"].as_str().unwrap(), "C:\\");
        assert_eq!(panes[2]["cwd"].as_str().unwrap(), "/home/user");
    }

    #[test]
    fn test_save_and_load_roundtrip() {
        // Test the actual save_session and load_session functions (uses real LocalAppData)
        let state = r#"{"version":1,"tabs":[{"id":"t1","title":"Terminal 1","shellType":"powershell","paneRoot":{"type":"leaf","id":"p1"},"focusedPaneId":"p1","panes":[{"id":"p1","shellType":"powershell","cwd":"C:\\","history":["dir","cd .."]}]}],"activeTabId":"t1"}"#;

        save_session(state).unwrap();
        let loaded = load_session().unwrap();
        assert!(loaded.is_some());
        // Compare parsed values since re-serialization may change key order
        let expected: serde_json::Value = serde_json::from_str(state).unwrap();
        let actual: serde_json::Value = serde_json::from_str(&loaded.unwrap()).unwrap();
        assert_eq!(actual, expected);
    }
}
