use crate::pty::SessionManager;
use std::sync::{Arc, Mutex};
use tauri::State;

pub struct AppState {
    pub session_manager: Arc<Mutex<SessionManager>>,
}

#[tauri::command]
pub async fn create_session(
    state: State<'_, AppState>,
    app_handle: tauri::AppHandle,
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

        mgr.create_session(shell, r, c, app_handle)
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
