use crate::llm;
use crate::pty::SessionManager;
use crate::settings::{self, AppSettings};
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub session_manager: Arc<Mutex<SessionManager>>,
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    shell_type: Option<String>,
    rows: Option<u16>,
    cols: Option<u16>,
) -> Result<String, String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let shell = shell_type.as_deref().unwrap_or("powershell");
        let r = rows.unwrap_or(24);
        let c = cols.unwrap_or(80);

        let mut mgr = manager
            .lock()
            .map_err(|e| format!("Failed to lock session manager: {}", e))?;

        mgr.create_session(shell, r, c)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn start_reading(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
    session_id: String,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager
            .lock()
            .map_err(|e| format!("Failed to lock session manager: {}", e))?;

        mgr.start_reading(&session_id, app_handle)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn write_to_session(
    state: State<'_, AppState>,
    session_id: String,
    data: String,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager
            .lock()
            .map_err(|e| format!("Failed to lock session manager: {}", e))?;

        mgr.write_to_session(&session_id, &data)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn resize_session(
    state: State<'_, AppState>,
    session_id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager
            .lock()
            .map_err(|e| format!("Failed to lock session manager: {}", e))?;

        mgr.resize_session(&session_id, rows, cols)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn close_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    let manager = state.session_manager.clone();
    tokio::task::spawn_blocking(move || {
        let mut mgr = manager
            .lock()
            .map_err(|e| format!("Failed to lock session manager: {}", e))?;

        mgr.close_session(&session_id)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_settings() -> Result<AppSettings, String> {
    settings::load_settings()
}

#[tauri::command]
pub async fn save_app_settings(settings: AppSettings) -> Result<(), String> {
    settings::validate_settings(&settings)?;
    settings::save_settings(&settings)
}

#[tauri::command]
pub async fn get_cwd() -> Result<String, String> {
    std::env::current_dir()
        .map(|p| p.to_string_lossy().to_string())
        .map_err(|e| format!("Failed to get CWD: {}", e))
}

#[tauri::command]
pub async fn get_known_commands() -> Result<Vec<String>, String> {
    tokio::task::spawn_blocking(collect_known_commands)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn translate_command(
    input: String,
    shell_type: String,
    cwd: String,
) -> Result<String, String> {
    let settings = settings::load_settings()?;
    let request = llm::TranslationRequest {
        prompt: input,
        shell_type,
        cwd,
    };
    let response = llm::translate_command(&settings, &request).await?;
    Ok(response.command)
}

/// Collect known commands (PATH scan + builtins). Extracted for reuse by completions.
fn collect_known_commands() -> Vec<String> {
    let mut commands = Vec::new();

    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        let base = name.split('.').next().unwrap_or(name).to_lowercase();
                        if !base.is_empty() {
                            commands.push(base);
                        }
                    }
                }
            }
        }
    }

    let builtins = vec![
        "cd", "dir", "echo", "set", "cls", "exit", "type", "copy", "move", "del",
        "mkdir", "rmdir", "ren", "pushd", "popd", "call", "start", "where", "assoc",
        "ftype", "path", "prompt", "title", "color", "ver", "vol", "pause",
    ];
    commands.extend(builtins.iter().map(|s| s.to_string()));

    commands.sort();
    commands.dedup();
    commands
}

/// Core logic for `get_completions` — extracted for testability without Tauri runtime.
pub fn compute_completions(partial: &str, cwd: &str, context: &str) -> Result<Vec<String>, String> {
    match context {
        "path" => compute_path_completions(partial, cwd),
        "command" => compute_command_completions(partial),
        _ => Err(format!("Unknown completion context: {}", context)),
    }
}

fn compute_path_completions(partial: &str, cwd: &str) -> Result<Vec<String>, String> {
    const MAX_RESULTS: usize = 50;

    // Validate that cwd is a real directory
    let cwd_path = std::path::Path::new(cwd);
    if !cwd_path.is_dir() {
        return Ok(Vec::new());
    }

    // Normalize partial: replace forward slashes with backslashes for Windows consistency
    let normalized_partial = partial.replace('/', "\\");

    // Determine the directory to list and the prefix to filter by
    let (search_dir, file_prefix, path_prefix) = if normalized_partial.is_empty() {
        // Empty partial: list cwd contents
        (cwd_path.to_path_buf(), String::new(), String::new())
    } else {
        let partial_path = std::path::Path::new(&normalized_partial);

        // Check if partial is an absolute path
        if partial_path.is_absolute() {
            // Absolute path: use its parent as search dir
            if let Some(parent) = partial_path.parent() {
                let prefix = partial_path
                    .file_name()
                    .map(|f| f.to_string_lossy().to_string())
                    .unwrap_or_default();
                // Reconstruct the path prefix (everything before the file_name)
                let parent_str = parent.to_string_lossy().to_string();
                let path_prefix = if parent_str.ends_with('\\') {
                    parent_str
                } else {
                    format!("{}\\", parent_str)
                };
                (parent.to_path_buf(), prefix, path_prefix)
            } else {
                return Ok(Vec::new());
            }
        } else {
            // Relative path: resolve against cwd
            if normalized_partial.contains('\\') {
                // Has directory component: split into dir prefix and file prefix
                let partial_path = std::path::Path::new(&normalized_partial);
                if let Some(parent) = partial_path.parent() {
                    let full_dir = cwd_path.join(parent);
                    let file_prefix = partial_path
                        .file_name()
                        .map(|f| f.to_string_lossy().to_string())
                        .unwrap_or_default();
                    // Reconstruct the relative path prefix using forward slashes from original input
                    // to preserve the user's slash style
                    let original_sep = if partial.contains('/') { '/' } else { '\\' };
                    let parent_str = parent.to_string_lossy().to_string();
                    let parent_with_original_sep = parent_str.replace('\\', &original_sep.to_string());
                    let path_prefix = format!("{}{}", parent_with_original_sep, original_sep);
                    (full_dir, file_prefix, path_prefix)
                } else {
                    return Ok(Vec::new());
                }
            } else {
                // Simple filename prefix: list cwd and filter
                (cwd_path.to_path_buf(), normalized_partial.clone(), String::new())
            }
        }
    };

    // Read the directory
    let entries = match std::fs::read_dir(&search_dir) {
        Ok(entries) => entries,
        Err(_) => return Ok(Vec::new()), // Permission denied, etc.
    };

    let prefix_lower = file_prefix.to_lowercase();

    let mut dirs: Vec<String> = Vec::new();
    let mut files: Vec<String> = Vec::new();

    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };

        // Filter by prefix (case-insensitive on Windows)
        if !prefix_lower.is_empty() && !name.to_lowercase().starts_with(&prefix_lower) {
            continue;
        }

        // Determine if directory or file
        let is_dir = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

        let completion = if is_dir {
            format!("{}{}\\", path_prefix, name)
        } else {
            format!("{}{}", path_prefix, name)
        };

        if is_dir {
            dirs.push(completion);
        } else {
            files.push(completion);
        }
    }

    // Sort: directories first (alphabetically), then files (alphabetically)
    dirs.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    files.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));

    let mut results = dirs;
    results.extend(files);

    // Limit to MAX_RESULTS
    results.truncate(MAX_RESULTS);

    Ok(results)
}

fn compute_command_completions(partial: &str) -> Result<Vec<String>, String> {
    const MAX_RESULTS: usize = 50;

    let commands = collect_known_commands();
    let partial_lower = partial.to_lowercase();

    let mut results: Vec<String> = commands
        .into_iter()
        .filter(|cmd| cmd.to_lowercase().starts_with(&partial_lower))
        .collect();

    results.sort_by(|a, b| a.to_lowercase().cmp(&b.to_lowercase()));
    results.dedup();
    results.truncate(MAX_RESULTS);

    Ok(results)
}

#[tauri::command]
pub async fn get_completions(
    partial: String,
    cwd: String,
    context: String,
) -> Result<Vec<String>, String> {
    let p = partial.clone();
    let c = cwd.clone();
    let ctx = context.clone();
    tokio::task::spawn_blocking(move || compute_completions(&p, &c, &ctx))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn test_path_completions_lists_directory() {
        let dir = std::env::temp_dir().join("velocity_test_list_dir");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("alpha.txt"), "").unwrap();
        fs::write(dir.join("beta.txt"), "").unwrap();

        let result = compute_completions("", &dir.to_string_lossy(), "path").unwrap();
        assert!(result.contains(&"alpha.txt".to_string()));
        assert!(result.contains(&"beta.txt".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_completions_filters_by_prefix() {
        let dir = std::env::temp_dir().join("velocity_test_filter_prefix");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("alpha.txt"), "").unwrap();
        fs::write(dir.join("beta.txt"), "").unwrap();

        let result = compute_completions("al", &dir.to_string_lossy(), "path").unwrap();
        assert_eq!(result, vec!["alpha.txt".to_string()]);
        assert!(!result.contains(&"beta.txt".to_string()));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_completions_directories_have_separator() {
        let dir = std::env::temp_dir().join("velocity_test_dir_sep");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::create_dir_all(dir.join("subdir")).unwrap();
        fs::write(dir.join("file.txt"), "").unwrap();

        let result = compute_completions("", &dir.to_string_lossy(), "path").unwrap();
        // Directory should have trailing separator
        let has_subdir_with_sep = result.iter().any(|r| r == "subdir\\");
        assert!(has_subdir_with_sep, "Directory entry should have trailing backslash, got: {:?}", result);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_completions_relative_path() {
        let dir = std::env::temp_dir().join("velocity_test_relative");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(dir.join("src")).unwrap();
        fs::create_dir_all(dir.join("src").join("components")).unwrap();
        fs::create_dir_all(dir.join("src").join("configs")).unwrap();

        let result = compute_completions("src/comp", &dir.to_string_lossy(), "path").unwrap();
        assert!(result.contains(&"src/components\\".to_string()), "Should contain src/components\\, got: {:?}", result);

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_path_completions_nonexistent_returns_empty() {
        let result = compute_completions(
            "",
            "C:\\this_path_does_not_exist_velocity_999",
            "path",
        ).unwrap();
        assert!(result.is_empty());
    }

    #[test]
    fn test_path_completions_limited_to_50() {
        let dir = std::env::temp_dir().join("velocity_test_limit50");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        for i in 0..100 {
            fs::write(dir.join(format!("file_{:03}.txt", i)), "").unwrap();
        }

        let result = compute_completions("", &dir.to_string_lossy(), "path").unwrap();
        assert!(result.len() <= 50, "Expected at most 50 results, got {}", result.len());

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_command_completions_filters_by_prefix() {
        // The command completion uses the known commands logic
        // We test that filtering by prefix works
        let result = compute_completions("ec", "C:\\", "command").unwrap();
        // Should contain "echo" since it's a builtin
        assert!(result.contains(&"echo".to_string()), "Should contain 'echo', got: {:?}", result);
    }

    #[test]
    fn test_command_completions_case_insensitive() {
        let result = compute_completions("EC", "C:\\", "command").unwrap();
        // Should match "echo" case-insensitively on Windows
        assert!(result.contains(&"echo".to_string()), "Should contain 'echo' for case-insensitive match, got: {:?}", result);
    }

    #[test]
    fn test_get_cwd_returns_string() {
        let cwd = std::env::current_dir();
        assert!(cwd.is_ok());
        let cwd_str = cwd.unwrap().to_string_lossy().to_string();
        assert!(!cwd_str.is_empty());
    }

    #[test]
    fn test_get_known_commands_returns_nonempty() {
        // Directly test the logic used in get_known_commands without the Tauri runtime
        let mut commands = Vec::new();

        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(';') {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            let base = name.split('.').next().unwrap_or(name).to_lowercase();
                            if !base.is_empty() {
                                commands.push(base);
                            }
                        }
                    }
                }
            }
        }

        let builtins = vec![
            "cd", "dir", "echo", "set", "cls", "exit", "type", "copy", "move", "del",
            "mkdir", "rmdir", "ren", "pushd", "popd", "call", "start", "where", "assoc",
            "ftype", "path", "prompt", "title", "color", "ver", "vol", "pause",
        ];
        commands.extend(builtins.iter().map(|s| s.to_string()));

        commands.sort();
        commands.dedup();

        assert!(!commands.is_empty(), "Known commands list should not be empty");
        // Should contain at least some builtins
        assert!(commands.contains(&"cd".to_string()), "Should contain 'cd' builtin");
        assert!(commands.contains(&"echo".to_string()), "Should contain 'echo' builtin");
        assert!(commands.contains(&"dir".to_string()), "Should contain 'dir' builtin");
    }
}
