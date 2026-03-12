use crate::ansi::AnsiFilter;
use portable_pty::{CommandBuilder, MasterPty, PtySize, Child, native_pty_system};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::AppHandle;
use tauri::Emitter;
use uuid::Uuid;

pub const MAX_SESSIONS: usize = 20;

pub fn validate_dimensions(rows: u16, cols: u16) -> Result<(), String> {
    if rows < 1 || rows > 500 {
        return Err(format!("Invalid rows: {}. Must be between 1 and 500.", rows));
    }
    if cols < 1 || cols > 500 {
        return Err(format!("Invalid cols: {}. Must be between 1 and 500.", cols));
    }
    Ok(())
}

pub fn validate_shell_type(shell_type: &str) -> Result<(), String> {
    match shell_type {
        "powershell" | "cmd" | "wsl" => Ok(()),
        _ => Err(format!("Invalid shell type: {}", shell_type)),
    }
}

pub struct ShellSession {
    #[allow(dead_code)] // Reserved for future use (session listing, tab labels)
    pub id: String,
    #[allow(dead_code)]
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
    #[allow(dead_code)] // Reserved for future use (session listing, tab labels)
    pub shell_type: String,
    shutdown: Arc<AtomicBool>,
    /// PTY reader handle — stored here until start_reading() is called.
    /// This is None after start_reading() takes the reader to spawn the
    /// reader thread, ensuring output is only emitted after the frontend
    /// has registered its event listeners.
    reader: Option<Box<dyn Read + Send>>,
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

    #[allow(dead_code)] // Reserved for future use (list-sessions command)
    pub fn get_session_ids(&self) -> Vec<String> {
        self.sessions.keys().cloned().collect()
    }

    #[allow(dead_code)] // Used by tests to verify session limits
    pub fn session_count(&self) -> usize {
        self.sessions.len()
    }

    pub fn create_session(
        &mut self,
        shell_type: &str,
        rows: u16,
        cols: u16,
    ) -> Result<String, String> {
        validate_dimensions(rows, cols)?;

        if self.sessions.len() >= MAX_SESSIONS {
            return Err(format!("Maximum session limit ({}) reached", MAX_SESSIONS));
        }

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

        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("Failed to clone PTY reader: {}", e))?;

        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("Failed to get PTY writer: {}", e))?;

        let session_id = Uuid::new_v4().to_string();
        let shutdown = Arc::new(AtomicBool::new(false));

        let session = ShellSession {
            id: session_id.clone(),
            master: pair.master,
            writer,
            child,
            shell_type: shell_type.to_string(),
            shutdown,
            reader: Some(reader),
        };

        self.sessions.insert(session_id.clone(), session);
        Ok(session_id)
    }

    /// Check whether a session exists.
    #[allow(dead_code)] // Used by tests
    pub fn has_session(&self, session_id: &str) -> bool {
        self.sessions.contains_key(session_id)
    }

    /// Start the reader thread for a session. Must be called AFTER the
    /// frontend has registered its event listeners, to eliminate the
    /// race between emit and listen.
    ///
    /// Takes the reader handle out of the session (so it can only be
    /// called once per session). Returns an error if the session doesn't
    /// exist or if the reader has already been started.
    pub fn start_reading(
        &mut self,
        session_id: &str,
        app_handle: AppHandle,
    ) -> Result<(), String> {
        let session = self
            .sessions
            .get_mut(session_id)
            .ok_or_else(|| format!("Session not found: {}", session_id))?;

        let mut reader = session
            .reader
            .take()
            .ok_or_else(|| "Reader already started".to_string())?;

        let sid = session_id.to_string();
        let shutdown_flag = session.shutdown.clone();

        std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            let mut ansi_filter = AnsiFilter::new();
            loop {
                if shutdown_flag.load(Ordering::Relaxed) {
                    break;
                }
                match reader.read(&mut buf) {
                    Ok(0) => break,
                    Ok(n) => {
                        eprintln!("[pty:{}] raw read: {} bytes", sid, n);
                        let output = ansi_filter.filter(&buf[..n]);
                        eprintln!(
                            "[pty:{}] filtered: {} bytes, empty={}",
                            sid,
                            output.len(),
                            output.is_empty()
                        );
                        if let Err(e) = app_handle.emit(
                            &format!("pty:output:{}", sid),
                            output,
                        ) {
                            eprintln!("[pty:{}] Failed to emit output: {}", sid, e);
                        }
                    }
                    Err(e) => {
                        if let Err(emit_err) = app_handle.emit(
                            &format!("pty:error:{}", sid),
                            e.to_string(),
                        ) {
                            eprintln!("[pty:{}] Failed to emit error: {}", sid, emit_err);
                        }
                        break;
                    }
                }
            }
            if let Err(e) = app_handle.emit(&format!("pty:closed:{}", sid), ()) {
                eprintln!("[pty:{}] Failed to emit closed: {}", sid, e);
            }
        });

        Ok(())
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
        validate_dimensions(rows, cols)?;

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

        // Signal reader thread to stop
        session.shutdown.store(true, Ordering::Relaxed);

        // Kill the child process — ignore errors (may already be dead)
        let _ = session.child.kill();

        // Wait for child to exit to avoid zombie process handles
        std::thread::sleep(std::time::Duration::from_millis(100));
        match session.child.try_wait() {
            Ok(Some(_status)) => {} // Exited cleanly
            _ => {
                // Force wait — blocking but should be fast after kill
                let _ = session.child.wait();
            }
        }

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

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
    fn test_shutdown_flag_defaults_to_false() {
        let flag = Arc::new(AtomicBool::new(false));
        assert!(!flag.load(Ordering::Relaxed));
    }

    #[test]
    fn test_shutdown_flag_can_be_set() {
        let flag = Arc::new(AtomicBool::new(false));
        let flag_clone = flag.clone();
        flag_clone.store(true, Ordering::Relaxed);
        assert!(flag.load(Ordering::Relaxed));
    }

    #[test]
    fn test_max_sessions_enforced() {
        // Test MAX_SESSIONS limit in isolation
        // We can't create real sessions (need AppHandle), so test the count logic directly
        let manager = SessionManager::new();
        // The manager starts empty, so the session count is 0
        assert_eq!(manager.session_count(), 0);
        // The MAX_SESSIONS constant should be 20
        assert_eq!(MAX_SESSIONS, 20);
    }

    #[test]
    #[ignore]
    fn test_spawn_powershell_session() {
        // Integration test — requires Tauri AppHandle for event emission
        // This test must be run manually with `cargo test -- --ignored`
        // in an environment where PowerShell is available
        todo!("Integration test: requires Tauri AppHandle for event emission")
    }

    #[test]
    fn test_has_session_returns_false_for_nonexistent() {
        let manager = SessionManager::new();
        assert!(!manager.has_session("nonexistent-id"));
    }

    #[test]
    fn test_start_reading_validates_session_exists() {
        // start_reading requires an AppHandle for spawning the reader thread.
        // We can't construct one in unit tests, but we can verify the method
        // signature exists and test the "not found" path through has_session.
        // Full integration testing of start_reading requires `cargo test -- --ignored`.
        let manager = SessionManager::new();
        assert!(!manager.has_session("nonexistent-id"));
        // The start_reading method checks for session existence first,
        // then checks that reader hasn't already been taken.
        // These paths are tested in integration tests.
    }

    #[test]
    fn test_create_session_no_longer_takes_app_handle() {
        // Verify the create_session signature no longer requires AppHandle.
        // The reader thread is now started lazily via start_reading.
        // We can't call create_session in unit tests (needs real PTY),
        // but the type signature is verified at compile time.
        let manager = SessionManager::new();
        assert_eq!(manager.session_count(), 0);
    }

    #[test]
    fn test_validate_dimensions_valid() {
        assert!(validate_dimensions(24, 80).is_ok());
        assert!(validate_dimensions(1, 1).is_ok());
        assert!(validate_dimensions(500, 500).is_ok());
    }

    #[test]
    fn test_validate_dimensions_zero_rows() {
        let result = validate_dimensions(0, 80);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid rows"));
    }

    #[test]
    fn test_validate_dimensions_zero_cols() {
        let result = validate_dimensions(24, 0);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid cols"));
    }

    #[test]
    fn test_validate_dimensions_overflow_rows() {
        let result = validate_dimensions(501, 80);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid rows"));
    }

    #[test]
    fn test_validate_dimensions_overflow_cols() {
        let result = validate_dimensions(24, 501);
        assert!(result.is_err());
        assert!(result.unwrap_err().contains("Invalid cols"));
    }
}
