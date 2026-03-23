pub mod ansi;
mod commands;
pub mod llm;
pub mod pty;
pub mod settings;

use commands::AppState;
use pty::SessionManager;
use std::sync::{Arc, Mutex};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState {
            session_manager: Arc::new(Mutex::new(SessionManager::new())),
        })
        .invoke_handler(tauri::generate_handler![
            commands::create_session,
            commands::start_reading,
            commands::write_to_session,
            commands::resize_session,
            commands::close_session,
            commands::get_settings,
            commands::save_app_settings,
            commands::get_cwd,
            commands::translate_command,
            commands::get_known_commands,
            commands::get_completions,
            commands::classify_intent_llm,
            commands::get_git_info,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
