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
    tokio::task::spawn_blocking(|| {
        let mut commands = Vec::new();

        // 1. Scan PATH directories for executables
        if let Ok(path_var) = std::env::var("PATH") {
            for dir in path_var.split(';') {
                if let Ok(entries) = std::fs::read_dir(dir) {
                    for entry in entries.flatten() {
                        if let Some(name) = entry.file_name().to_str() {
                            // Strip .exe, .cmd, .bat, .ps1 extensions
                            let base = name.split('.').next().unwrap_or(name).to_lowercase();
                            if !base.is_empty() {
                                commands.push(base);
                            }
                        }
                    }
                }
            }
        }

        // 2. Add common shell builtins
        let builtins = vec![
            "cd", "dir", "echo", "set", "cls", "exit", "type", "copy", "move", "del",
            "mkdir", "rmdir", "ren", "pushd", "popd", "call", "start", "where", "assoc",
            "ftype", "path", "prompt", "title", "color", "ver", "vol", "pause",
        ];
        commands.extend(builtins.iter().map(|s| s.to_string()));

        // 3. Deduplicate
        commands.sort();
        commands.dedup();

        Ok(commands)
    })
    .await
    .map_err(|e| e.to_string())?
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

#[cfg(test)]
mod tests {
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
