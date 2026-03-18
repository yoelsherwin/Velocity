/// PTY Integration Tests
///
/// These tests exercise the REAL PTY pipeline: spawn a real PowerShell process,
/// read output through the ANSI filter via channels, and verify behavior.
///
/// No mocks. No AppHandle. Real shell processes + channels.
///
/// Run with: `cd src-tauri && cargo test --test pty_integration`

use std::sync::mpsc;
use std::time::{Duration, Instant};
use velocity_lib::pty::{PtyEvent, SessionManager};

/// Helper: collect events from a channel receiver until timeout.
/// Returns all events received before the deadline.
fn collect_events(
    rx: &mpsc::Receiver<PtyEvent>,
    timeout: Duration,
) -> Vec<PtyEvent> {
    let deadline = Instant::now() + timeout;
    let mut events = Vec::new();
    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        if remaining.is_zero() {
            break;
        }
        match rx.recv_timeout(remaining) {
            Ok(event) => events.push(event),
            Err(mpsc::RecvTimeoutError::Timeout) => break,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }
    events
}

/// Helper: collect output text from events.
/// For Append events, concatenates the payloads.
/// For Replace events, uses the last Replace payload as the base.
/// This simulates the frontend's behavior: appends grow, replaces overwrite.
fn collect_output_text(events: &[PtyEvent]) -> String {
    let mut result = String::new();
    for event in events {
        match event {
            PtyEvent::Output(s) => result.push_str(s),
            PtyEvent::OutputReplace(s) => result = s.clone(),
            _ => {}
        }
    }
    result
}

/// Helper: check if events contain a Closed event.
fn has_closed_event(events: &[PtyEvent]) -> bool {
    events.iter().any(|e| matches!(e, PtyEvent::Closed))
}

// ─── Test 1: Real PowerShell produces output ───────────────────────────

#[test]
fn test_real_powershell_produces_output() {
    let mut manager = SessionManager::new();

    // create_session_with_channel creates the session AND starts the reader
    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // PowerShell should produce prompt output within 5 seconds
    let events = collect_events(&rx, Duration::from_secs(5));

    let output_count = events
        .iter()
        .filter(|e| matches!(e, PtyEvent::Output(_) | PtyEvent::OutputReplace(_)))
        .count();

    assert!(
        output_count > 0,
        "Expected at least one Output/OutputReplace event from PowerShell, got 0. Total events: {}",
        events.len()
    );

    let combined = collect_output_text(&events);
    assert!(
        !combined.is_empty(),
        "Expected non-empty combined output from PowerShell"
    );

    manager.close_session(&session_id).expect("Failed to close session");
}

// ─── Test 2: Real echo command ─────────────────────────────────────────

#[test]
fn test_real_echo_command() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait a moment for PowerShell to be ready, then send echo command
    std::thread::sleep(Duration::from_millis(500));

    manager
        .write_to_session(&session_id, "echo hello\r")
        .expect("Failed to write to session");

    // Collect output for 3 seconds
    let events = collect_events(&rx, Duration::from_secs(3));
    let combined = collect_output_text(&events);

    assert!(
        combined.contains("hello"),
        "Expected output to contain 'hello', got: {}",
        combined
    );

    manager.close_session(&session_id).expect("Failed to close session");
}

// ─── Test 3: ANSI filter on live output ────────────────────────────────

#[test]
fn test_real_ansi_filter_on_live_output() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_millis(500));

    // Write-Host with color produces SGR sequences that our filter should preserve
    manager
        .write_to_session(&session_id, "Write-Host -ForegroundColor Red 'colored'\r")
        .expect("Failed to write to session");

    // Collect output for 3 seconds
    let events = collect_events(&rx, Duration::from_secs(3));
    let combined = collect_output_text(&events);

    assert!(
        combined.contains("colored"),
        "Expected output to contain 'colored', got: {}",
        combined
    );

    // SGR sequence should be preserved by the ANSI filter (ESC[ ... m)
    assert!(
        combined.contains("\x1b["),
        "Expected output to contain SGR escape sequence (\\x1b[), got: {}",
        combined
    );

    manager.close_session(&session_id).expect("Failed to close session");
}

// ─── Test 4: Session close produces Closed event ───────────────────────

#[test]
fn test_session_close_produces_closed_event() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_millis(500));

    // Send exit command
    manager
        .write_to_session(&session_id, "exit\r")
        .expect("Failed to write exit command");

    // The watchdog thread polls child.try_wait() every 500ms and drops the
    // master PTY handle when the child exits, unblocking the reader thread.
    // Allow up to 10 seconds for PowerShell to exit + watchdog to detect it.
    let events = collect_events(&rx, Duration::from_secs(10));

    assert!(
        has_closed_event(&events),
        "Expected PtyEvent::Closed after 'exit' command (via watchdog). Events received: {}",
        events.len()
    );

    // Clean up (session may already be gone from exit, ignore errors)
    let _ = manager.close_session(&session_id);
}

// ─── Test 9: Process exit detected via watchdog ─────────────────────────

#[test]
fn test_process_exit_detected_via_watchdog() {
    // This test verifies the core fix: the watchdog thread detects that the
    // child process has exited and drops the master PTY handle, which unblocks
    // the reader thread so it sends PtyEvent::Closed.
    //
    // Critically, this test does NOT call close_session() -- the Closed event
    // must arrive purely from the watchdog detecting the child exit.
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for PowerShell to be ready
    std::thread::sleep(Duration::from_millis(1000));

    // Drain initial prompt output
    let _ = collect_events(&rx, Duration::from_millis(500));

    // Send exit command -- this causes PowerShell to terminate
    manager
        .write_to_session(&session_id, "exit\r")
        .expect("Failed to write exit command");

    // Wait for the watchdog to detect the exit and unblock the reader.
    // Budget: PowerShell exit (~1-2s) + watchdog poll interval (500ms) + margin.
    let events = collect_events(&rx, Duration::from_secs(10));

    assert!(
        has_closed_event(&events),
        "Expected PtyEvent::Closed from watchdog after 'exit' command \
         (WITHOUT calling close_session). Events received: {}",
        events.len()
    );

    // Clean up (session is still in the manager's map, remove it)
    let _ = manager.close_session(&session_id);
}

// ─── Test 5: Session kill produces Closed event ────────────────────────

#[test]
fn test_session_kill_produces_closed_event() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_millis(500));

    // Kill the session (close_session kills the child process)
    manager
        .close_session(&session_id)
        .expect("Failed to close session");

    // Collect events until Closed arrives (up to 5 seconds)
    let events = collect_events(&rx, Duration::from_secs(5));

    assert!(
        has_closed_event(&events),
        "Expected PtyEvent::Closed after close_session(). Events received: {}",
        events.len()
    );
}

// ─── Test 6: Concurrent sessions are independent ───────────────────────

#[test]
fn test_concurrent_sessions_independent() {
    let mut manager = SessionManager::new();

    // Create two sessions (each creates session + starts reading)
    let (sid1, rx1) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session 1");

    let (sid2, rx2) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session 2");

    // Wait for both shells to be ready
    std::thread::sleep(Duration::from_millis(1000));

    // Drain initial prompt output from both
    let _ = collect_events(&rx1, Duration::from_millis(500));
    let _ = collect_events(&rx2, Duration::from_millis(500));

    // Write unique markers to each session
    manager
        .write_to_session(&sid1, "echo session1marker\r")
        .expect("Failed to write to session 1");
    manager
        .write_to_session(&sid2, "echo session2marker\r")
        .expect("Failed to write to session 2");

    // Collect output from each
    let events1 = collect_events(&rx1, Duration::from_secs(3));
    let events2 = collect_events(&rx2, Duration::from_secs(3));

    let output1 = collect_output_text(&events1);
    let output2 = collect_output_text(&events2);

    // Session 1 should contain its marker but not session 2's
    assert!(
        output1.contains("session1marker"),
        "Session 1 output should contain 'session1marker', got: {}",
        output1
    );
    assert!(
        !output1.contains("session2marker"),
        "Session 1 output should NOT contain 'session2marker', got: {}",
        output1
    );

    // Session 2 should contain its marker but not session 1's
    assert!(
        output2.contains("session2marker"),
        "Session 2 output should contain 'session2marker', got: {}",
        output2
    );
    assert!(
        !output2.contains("session1marker"),
        "Session 2 output should NOT contain 'session1marker', got: {}",
        output2
    );

    let _ = manager.close_session(&sid1);
    let _ = manager.close_session(&sid2);
}

// ─── Test 7: Cursor response unblocks output ───────────────────────────

#[test]
fn test_cursor_response_unblocks_output() {
    // The create_session method writes \x1b[1;1R to unblock ConPTY's DSR query.
    // If this didn't work, the reader thread would block after 4 bytes and
    // we'd get at most 1 Output event with minimal data.
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Collect output for 5 seconds -- if ConPTY is unblocked, we should get
    // multiple Output events (prompt, MOTD, etc.)
    let events = collect_events(&rx, Duration::from_secs(5));

    let output_events: Vec<_> = events
        .iter()
        .filter(|e| matches!(e, PtyEvent::Output(_) | PtyEvent::OutputReplace(_)))
        .collect();

    assert!(
        output_events.len() > 1,
        "Expected more than 1 Output/OutputReplace event (proving ConPTY is unblocked). Got {}. \
         If only 1 event with ~4 bytes, the cursor response likely failed.",
        output_events.len()
    );

    manager.close_session(&session_id).expect("Failed to close session");
}

// ─── Test 8: Large output no truncation ────────────────────────────────

#[test]
fn test_large_output_no_truncation() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_millis(500));

    // Generate 100 lines of output
    manager
        .write_to_session(
            &session_id,
            "1..100 | ForEach-Object { echo \"line $_\" }\r",
        )
        .expect("Failed to write to session");

    // Collect output for 5 seconds (large output may take a moment)
    let events = collect_events(&rx, Duration::from_secs(5));
    let combined = collect_output_text(&events);

    assert!(
        combined.contains("line 1"),
        "Expected output to contain 'line 1', got: {} bytes of output",
        combined.len()
    );
    assert!(
        combined.contains("line 100"),
        "Expected output to contain 'line 100', got: {} bytes of output",
        combined.len()
    );

    manager.close_session(&session_id).expect("Failed to close session");
}

// ─── Unit Test: PtyEvent variants ──────────────────────────────────────

#[test]
fn test_pty_event_variants() {
    // Verify PtyEvent enum can be constructed and Debug-printed
    let output = PtyEvent::Output("hello".to_string());
    let output_replace = PtyEvent::OutputReplace("replaced".to_string());
    let error = PtyEvent::Error("something went wrong".to_string());
    let closed = PtyEvent::Closed;

    // Debug must work (derive(Debug) check)
    assert!(format!("{:?}", output).contains("Output"));
    assert!(format!("{:?}", output_replace).contains("OutputReplace"));
    assert!(format!("{:?}", error).contains("Error"));
    assert!(format!("{:?}", closed).contains("Closed"));

    // Clone must work (derive(Clone) check)
    let output_clone = output.clone();
    assert!(format!("{:?}", output_clone).contains("Output"));
}

// ─── Test: Real shell carriage return (vt100 emulator integration) ──────

#[test]
fn test_real_shell_carriage_return() {
    let mut manager = SessionManager::new();

    let (session_id, rx) = manager
        .create_session_with_channel("powershell", 24, 80)
        .expect("Failed to create session");

    // Wait for shell to be ready
    std::thread::sleep(Duration::from_secs(1));

    // Drain initial prompt output
    let _ = collect_events(&rx, Duration::from_millis(500));

    // Use Write-Host -NoNewline with \r to simulate a progress bar overwrite
    // This writes "AAA" then carriage returns and overwrites with "BBB"
    manager
        .write_to_session(
            &session_id,
            "Write-Host -NoNewline \"AAA\"; Write-Host -NoNewline \"`rBBB\"; Write-Host ''\r",
        )
        .expect("Failed to write to session");

    // Collect output for 3 seconds
    let events = collect_events(&rx, Duration::from_secs(3));
    let combined = collect_output_text(&events);

    // The final output should contain "BBB" (the overwritten value)
    assert!(
        combined.contains("BBB"),
        "Expected output to contain 'BBB' (overwritten text), got: {}",
        combined
    );

    manager.close_session(&session_id).expect("Failed to close session");
}
