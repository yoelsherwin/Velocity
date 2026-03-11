use portable_pty::{CommandBuilder, MasterPty, PtySize, Child, native_pty_system};
use std::collections::HashMap;
use std::io::{Read, Write};
use tauri::AppHandle;
use tauri::Emitter;
use uuid::Uuid;

pub fn validate_shell_type(shell_type: &str) -> Result<(), String> {
    match shell_type {
        "powershell" | "cmd" | "wsl" => Ok(()),
        _ => Err(format!("Invalid shell type: {}", shell_type)),
    }
}

pub struct ShellSession {
    pub id: String,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    pub shell_type: String,
}

pub struct SessionManager {
    sessions: HashMap<String, ShellSession>,
}

impl SessionManager {
    pub fn new() -> Self {
        SessionManager {
            sessions: HashMap::new(),
        }
    }

    pub fn get_session_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    pub fn create_session(
        &mut self,
        shell_type: &str,
        rows: u16,
        cols: u16,
        app_handle: AppHandle,
    ) -> Result<String, String> {
        validate_shell_type(shell_type)?;

        let pty_system = native_pty_system();

        let pair = pty_system
            .openpty(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to open PTY: {}", e))?;

        let cmd = match shell_type {
            "powershell" => {
                let mut c = CommandBuilder::new("powershell.exe");
                c.arg("-NoLogo");
                c.arg("-NoProfile");
                c
            }
            "cmd" => CommandBuilder::new("cmd.exe"),
            "wsl" => CommandBuilder::new("wsl.exe"),
            _ => return Err(format!("Invalid shell type: {}", shell_type)),
        };

        let child = pair
            .slave
            .spawn_command(cmd)
            .map_err(|e| format!("Failed to spawn shell: {}", e))?;

        let mut reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let session_id = Uuid::new_v4().to_string();
        let sid = session_id.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            loop {
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        let output = String::from_utf8_lossy(&buf[..n]).to_string();
                        let _ = app_handle.emit(
                            &format!("pty:output:{}", sid),
                            output,
                        );
                    }
                    Err(e) => {
                        let _ = app_handle.emit(
                            &format!("pty:error:{}", sid),
                            e.to_string(),
                        );
                        break;
                    }
                }
            }
            let _ = app_handle.emit(&format!("pty:closed:{}", sid), ());
        });

        let session = ShellSession {
            id: session_id.clone(),
            master: pair.master,
            writer,
            child,
            shell_type: shell_type.to_string(),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    pub fn write_to_session(&mut self, session_id: &str, data: &str) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        session
            .writer
            .write_all(data.as_bytes())
            .map_err(|e| format!("Failed to write to session: {}", e))?;

        session
            .writer
            .flush()
            .map_err(|e| format!("Failed to flush session writer: {}", e))?;

        Ok(())
    }

    pub fn resize_session(&mut self, session_id: &str, rows: u16, cols: u16) -> Result<(), String> {
        let session = self
            .sessions
            .get(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        session
            .master
            .resize(PtySize {
                rows,
                cols,
                pixel_width: 0,
                pixel_height: 0,
            })
            .map_err(|e| format!("Failed to resize session: {}", e))?;

        Ok(())
    }

    pub fn close_session(&mut self, session_id: &str) -> Result<(), String> {
        let mut session = self
            .sessions
            .remove(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        // Kill the child process — ignore errors (may already be dead)
        let _ = session.child.kill();

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_session_manager_starts_empty() {
        let manager = SessionManager::new();
        assert!(manager.get_session_ids().is_empty());
    }

    #[test]
    fn test_validate_shell_type_accepts_valid() {
        assert!(validate_shell_type("powershell").is_ok());
        assert!(validate_shell_type("cmd").is_ok());
        assert!(validate_shell_type("wsl").is_ok());
    }

    #[test]
    fn test_validate_shell_type_rejects_invalid() {
        assert!(validate_shell_type("bash").is_err());
        assert!(validate_shell_type("").is_err());
        assert!(validate_shell_type("rm -rf /").is_err());
    }

    #[test]
    fn test_close_nonexistent_session_returns_error() {
        let mut manager = SessionManager::new();
        let result = manager.close_session("nonexistent-id");
        assert!(result.is_err());
        let err = result.unwrap_err().to_lowercase();
        assert!(
            err.contains("not found"),
            "Error should contain 'not found', got: {}",
            err
        );
    }

    #[test]
    fn test_write_to_nonexistent_session_returns_error() {
        let mut manager = SessionManager::new();
        let result = manager.write_to_session("nonexistent-id", "hello");
        assert!(result.is_err());
        let err = result.unwrap_err().to_lowercase();
        assert!(
            err.contains("not found"),
            "Error should contain 'not found', got: {}",
            err
        );
    }

    #[test]
    fn test_resize_nonexistent_session_returns_error() {
        let mut manager = SessionManager::new();
        let result = manager.resize_session("nonexistent-id", 24, 80);
        assert!(result.is_err());
        let err = result.unwrap_err().to_lowercase();
        assert!(
            err.contains("not found"),
            "Error should contain 'not found', got: {}",
            err
        );
    }

    #[test]
    #[ignore]
    fn test_spawn_powershell_session() {
        // Integration test — requires Tauri AppHandle for event emission
        // This test must be run manually with `cargo test -- --ignored`
        // in an environment where PowerShell is available
        todo!("Integration test: requires Tauri AppHandle for event emission")
    }
}
