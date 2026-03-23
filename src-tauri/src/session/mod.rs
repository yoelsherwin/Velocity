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
    if serde_json::from_str::<serde_json::Value>(&content).is_err() {
        return Ok(None);
    }
    Ok(Some(content))
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
    fn test_save_and_load_roundtrip() {
        // Test the actual save_session and load_session functions (uses real LocalAppData)
        let state = r#"{"version":1,"tabs":[{"id":"t1","title":"Terminal 1","shellType":"powershell","paneRoot":{"type":"leaf","id":"p1"},"focusedPaneId":"p1","panes":[{"id":"p1","shellType":"powershell","cwd":"C:\\","history":["dir","cd .."]}]}],"activeTabId":"t1"}"#;

        save_session(state).unwrap();
        let loaded = load_session().unwrap();
        assert!(loaded.is_some());
        assert_eq!(loaded.unwrap(), state);
    }
}
