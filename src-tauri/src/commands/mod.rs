use crate::danger;
use crate::llm;
use crate::pty::SessionManager;
use crate::session;
use crate::settings::{self, AppSettings};
use serde::Serialize;
use std::sync::{Arc, Mutex};
use std::time::Instant;
use tauri::State;
use tauri::Manager;

/// Cached known commands with TTL to avoid re-scanning PATH on every Tab press.
static COMMAND_CACHE: std::sync::LazyLock<Mutex<Option<(Instant, Vec<String>)>>> =
    std::sync::LazyLock::new(|| Mutex::new(None));

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
    settings::save_settings_with_key(&settings)
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

#[derive(Serialize, Clone, Debug)]
pub struct FixSuggestion {
    pub suggested_command: String,
    pub explanation: String,
}

#[tauri::command]
pub async fn suggest_fix(
    command: String,
    exit_code: i32,
    error_output: String,
    shell_type: String,
    cwd: String,
) -> Result<FixSuggestion, String> {
    let settings = settings::load_settings()?;
    let request = llm::FixRequest {
        command,
        exit_code,
        error_output,
        shell_type,
        cwd,
    };
    let response = llm::suggest_fix(&settings, &request).await?;
    Ok(FixSuggestion {
        suggested_command: response.suggested_command,
        explanation: response.explanation,
    })
}

#[tauri::command]
pub async fn classify_intent_llm(
    input: String,
    shell_type: String,
) -> Result<String, String> {
    let settings = settings::load_settings()?;
    let request = llm::ClassificationRequest {
        input,
        shell_type,
        known_commands: Vec::new(), // Kept lightweight; the LLM prompt has its own examples
    };
    let response = llm::classify_intent(&settings, &request).await?;
    // Validate: only accept exact "cli" or "natural_language"
    match response.intent.as_str() {
        "cli" | "natural_language" => Ok(response.intent),
        _ => Ok("cli".to_string()), // Default to CLI if unexpected
    }
}

#[derive(Serialize, Clone, Debug, PartialEq)]
pub struct GitInfo {
    pub branch: String,
    pub is_dirty: bool,
    pub ahead: u32,
    pub behind: u32,
}

#[tauri::command]
pub async fn get_git_info(cwd: String) -> Result<Option<GitInfo>, String> {
    tokio::task::spawn_blocking(move || compute_git_info(&cwd))
        .await
        .map_err(|e| e.to_string())?
}

/// Core logic for `get_git_info` — extracted for testability without Tauri runtime.
pub fn compute_git_info(cwd: &str) -> Result<Option<GitInfo>, String> {
    // Validate cwd is a real directory
    let cwd_path = std::path::Path::new(cwd);
    if !cwd_path.is_dir() {
        return Err(format!("Invalid directory: {}", cwd));
    }

    // Check if we're in a git repo by running `git rev-parse --is-inside-work-tree`
    let is_repo = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("--is-inside-work-tree")
        .current_dir(cwd_path)
        .output();

    match is_repo {
        Ok(output) => {
            if !output.status.success() {
                // Not a git repo
                return Ok(None);
            }
        }
        Err(e) => {
            // git not installed or other error
            return Err(format!("Failed to run git: {}", e));
        }
    }

    // Get branch name
    let branch_output = std::process::Command::new("git")
        .arg("rev-parse")
        .arg("--abbrev-ref")
        .arg("HEAD")
        .current_dir(cwd_path)
        .output()
        .map_err(|e| format!("Failed to get branch: {}", e))?;

    let branch = String::from_utf8_lossy(&branch_output.stdout)
        .trim()
        .to_string();

    // Get dirty status
    let status_output = std::process::Command::new("git")
        .arg("status")
        .arg("--porcelain")
        .current_dir(cwd_path)
        .output()
        .map_err(|e| format!("Failed to get status: {}", e))?;

    let is_dirty = !status_output.stdout.is_empty();

    // Get ahead/behind count — may fail if no upstream is set
    let mut ahead: u32 = 0;
    let mut behind: u32 = 0;

    let revlist_output = std::process::Command::new("git")
        .arg("rev-list")
        .arg("--left-right")
        .arg("--count")
        .arg("HEAD...@{upstream}")
        .current_dir(cwd_path)
        .output();

    if let Ok(output) = revlist_output {
        if output.status.success() {
            let text = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let parts: Vec<&str> = text.split_whitespace().collect();
            if parts.len() == 2 {
                ahead = parts[0].parse().unwrap_or(0);
                behind = parts[1].parse().unwrap_or(0);
            }
        }
        // If it fails (no upstream), we default to 0/0 — that's fine
    }

    Ok(Some(GitInfo {
        branch,
        is_dirty,
        ahead,
        behind,
    }))
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

/// Returns a cached copy of known commands, refreshing if older than 30 seconds.
fn get_cached_commands() -> Vec<String> {
    const TTL_SECS: u64 = 30;

    let mut cache = COMMAND_CACHE.lock().unwrap_or_else(|e| e.into_inner());

    if let Some((cached_at, ref commands)) = *cache {
        if cached_at.elapsed().as_secs() < TTL_SECS {
            return commands.clone();
        }
    }

    let commands = collect_known_commands();
    *cache = Some((Instant::now(), commands.clone()));
    commands
}

fn compute_command_completions(partial: &str) -> Result<Vec<String>, String> {
    const MAX_RESULTS: usize = 50;

    let commands = get_cached_commands();
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

#[tauri::command]
pub async fn create_new_window(app: tauri::AppHandle) -> Result<(), String> {
    let window_id = format!("velocity-{}", uuid::Uuid::new_v4());
    tauri::WebviewWindowBuilder::new(
        &app,
        &window_id,
        tauri::WebviewUrl::App("index.html".into()),
    )
    .title("Velocity")
    .inner_size(1200.0, 800.0)
    .build()
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub async fn set_window_effect(
    app: tauri::AppHandle,
    effect: String,
    opacity: f64,
) -> Result<(), String> {
    settings::validate_window_effect(&effect, opacity)?;

    let window = app
        .get_webview_window("main")
        .ok_or("No main window")?;

    // Clear any previously applied effects first
    let _ = window_vibrancy::clear_acrylic(&window);
    let _ = window_vibrancy::clear_mica(&window);
    let _ = window_vibrancy::clear_blur(&window);

    match effect.as_str() {
        "acrylic" => {
            let alpha = (opacity * 255.0) as u8;
            window_vibrancy::apply_acrylic(&window, Some((18, 18, 30, alpha)))
                .map_err(|e| format!("Failed to apply acrylic effect: {}", e))?;
        }
        "mica" => {
            window_vibrancy::apply_mica(&window, Some(true))
                .map_err(|e| format!("Failed to apply mica effect: {}", e))?;
        }
        "transparent" => {
            // For plain transparency, use blur with transparent color
            let alpha = (opacity * 255.0) as u8;
            window_vibrancy::apply_blur(&window, Some((18, 18, 30, alpha)))
                .map_err(|e| format!("Failed to apply transparent effect: {}", e))?;
        }
        _ => {
            // "none" — effects already cleared above
        }
    }
    Ok(())
}

#[derive(Serialize, Clone, Debug)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_hidden: bool,
}

/// Core logic for `list_directory` — extracted for testability without Tauri runtime.
pub fn compute_list_directory(path: &str) -> Result<Vec<FileEntry>, String> {
    const MAX_ENTRIES: usize = 500;

    let dir_path = std::path::Path::new(path);
    if !dir_path.is_dir() {
        return Err(format!("Invalid directory: {}", path));
    }

    let entries = std::fs::read_dir(dir_path)
        .map_err(|e| format!("Failed to read directory: {}", e))?;

    let mut dirs: Vec<FileEntry> = Vec::new();
    let mut files: Vec<FileEntry> = Vec::new();

    for entry in entries.flatten() {
        let name = match entry.file_name().to_str() {
            Some(n) => n.to_string(),
            None => continue,
        };

        let entry_path = entry.path().to_string_lossy().to_string();
        let is_directory = entry.file_type().map(|ft| ft.is_dir()).unwrap_or(false);

        // Detect hidden: starts with '.' or has Windows hidden attribute
        let is_hidden = name.starts_with('.') || {
            #[cfg(target_os = "windows")]
            {
                use std::os::windows::fs::MetadataExt;
                entry.metadata()
                    .map(|m| m.file_attributes() & 0x2 != 0) // FILE_ATTRIBUTE_HIDDEN
                    .unwrap_or(false)
            }
            #[cfg(not(target_os = "windows"))]
            {
                false
            }
        };

        let file_entry = FileEntry {
            name,
            path: entry_path,
            is_directory,
            is_hidden,
        };

        if is_directory {
            dirs.push(file_entry);
        } else {
            files.push(file_entry);
        }
    }

    // Sort alphabetically (case-insensitive)
    dirs.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));
    files.sort_by(|a, b| a.name.to_lowercase().cmp(&b.name.to_lowercase()));

    // Directories first, then files
    let mut results = dirs;
    results.extend(files);

    // Limit to MAX_ENTRIES
    results.truncate(MAX_ENTRIES);

    Ok(results)
}

#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String> {
    let p = path.clone();
    tokio::task::spawn_blocking(move || compute_list_directory(&p))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn analyze_command_danger(command: String, shell_type: String) -> danger::DangerAnalysis {
    danger::analyze_command_danger(&command, &shell_type)
}

#[tauri::command]
pub async fn save_session(state: String) -> Result<(), String> {
    session::save_session(&state)
}

#[tauri::command]
pub async fn load_session() -> Result<Option<String>, String> {
    session::load_session()
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
    fn test_git_info_in_git_repo() {
        // Run in the project's own repo (parent of src-tauri)
        let project_dir = std::env::current_dir().unwrap();
        // If running from src-tauri, go up one level
        let repo_dir = if project_dir.join(".git").is_dir() {
            project_dir
        } else {
            project_dir.parent().unwrap().to_path_buf()
        };

        let result = compute_git_info(&repo_dir.to_string_lossy());
        assert!(result.is_ok(), "Should succeed in a git repo");
        let git_info = result.unwrap();
        assert!(git_info.is_some(), "Should return Some in a git repo");
        let info = git_info.unwrap();
        assert!(!info.branch.is_empty(), "Branch name should not be empty");
    }

    #[test]
    fn test_git_info_outside_repo() {
        // Use a temp dir that's not a git repo
        let dir = std::env::temp_dir().join("velocity_test_no_git");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        let result = compute_git_info(&dir.to_string_lossy());
        assert!(result.is_ok(), "Should not error for non-repo dir");
        assert!(result.unwrap().is_none(), "Should return None for non-repo dir");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_git_info_invalid_cwd() {
        let result = compute_git_info("C:\\this_path_does_not_exist_velocity_999");
        assert!(result.is_err(), "Should return error for invalid path");
    }

    #[test]
    fn test_create_window_command_exists() {
        // Verify create_new_window is defined and has the correct return type.
        // We cannot construct a real AppHandle in unit tests, but we can verify
        // the function exists at compile time by taking its address.
        // The async fn returns impl Future<Output = Result<(), String>>.
        let _exists = create_new_window as fn(tauri::AppHandle) -> _;
        // If this compiles, the command exists with the expected signature.
    }

    #[test]
    fn test_list_directory_returns_entries() {
        let dir = std::env::temp_dir().join("velocity_test_list_dir_entries");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("alpha.txt"), "").unwrap();
        fs::write(dir.join("beta.txt"), "").unwrap();

        let result = compute_list_directory(&dir.to_string_lossy()).unwrap();
        assert_eq!(result.len(), 2);
        let names: Vec<&str> = result.iter().map(|e| e.name.as_str()).collect();
        assert!(names.contains(&"alpha.txt"));
        assert!(names.contains(&"beta.txt"));

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_list_directory_sorts_dirs_first() {
        let dir = std::env::temp_dir().join("velocity_test_list_dir_sort");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("aaa_file.txt"), "").unwrap();
        fs::create_dir_all(dir.join("zzz_folder")).unwrap();

        let result = compute_list_directory(&dir.to_string_lossy()).unwrap();
        assert_eq!(result.len(), 2);
        // Directory should come first even though it's alphabetically after the file
        assert!(result[0].is_directory, "First entry should be directory");
        assert_eq!(result[0].name, "zzz_folder");
        assert!(!result[1].is_directory, "Second entry should be file");
        assert_eq!(result[1].name, "aaa_file.txt");

        let _ = fs::remove_dir_all(&dir);
    }

    #[test]
    fn test_list_directory_invalid_path() {
        let result = compute_list_directory("C:\\this_path_does_not_exist_velocity_999");
        assert!(result.is_err(), "Should return error for invalid path");
    }

    #[test]
    fn test_list_directory_limited_entries() {
        let dir = std::env::temp_dir().join("velocity_test_list_dir_limit");
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();

        for i in 0..600 {
            fs::write(dir.join(format!("file_{:04}.txt", i)), "").unwrap();
        }

        let result = compute_list_directory(&dir.to_string_lossy()).unwrap();
        assert!(result.len() <= 500, "Expected at most 500 results, got {}", result.len());

        let _ = fs::remove_dir_all(&dir);
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
