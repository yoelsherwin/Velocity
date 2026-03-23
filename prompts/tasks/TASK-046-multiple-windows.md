# Task 046: Multiple Windows (P1-W2)

## Context
Velocity currently supports a single window. Power users need multiple windows — e.g., one window for frontend work, another for backend, a third monitoring logs. Each window should be independent with its own tabs/panes.

## Requirements
### Backend (Rust) + Frontend.

1. **New window**: Add a "New Window" action (Ctrl+Shift+N) that opens a new Tauri window.
2. **Independent state**: Each window has its own TabManager with independent tabs, panes, and shell sessions. No shared state between windows.
3. **Tauri multi-window**: Use `WebviewWindowBuilder::new()` in Rust to create additional windows. Each window loads the same React app but with independent state.
4. **Window management**: Track open windows. Closing the last window quits the app.
5. **Session persistence**: Each window's state saved in the session file. On restore, recreate all windows.
6. **Command palette**: Register `window.new` command.

## Rust Implementation
```rust
#[tauri::command]
async fn create_new_window(app: tauri::AppHandle) -> Result<(), String> {
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
```

## Tests

### Rust
- [ ] `test_create_window_command_exists`: Command is registered.

### Frontend
- [ ] `test_ctrl_shift_n_creates_window`: Shortcut calls create_new_window.
- [ ] `test_window_new_in_palette`: Command palette has "New Window" entry.
- [ ] `test_new_window_independent_state`: Each window has its own tab count starting at 1.

## Files to Read First
- `src-tauri/src/lib.rs` — app setup, window creation
- `src-tauri/tauri.conf.json` — window configuration
- `src/components/layout/TabManager.tsx` — app state management
- `src/lib/commands.ts` — command palette

## Acceptance Criteria
- [ ] Ctrl+Shift+N opens a new window
- [ ] Each window has independent tabs/panes
- [ ] Closing last window quits the app
- [ ] Command registered in palette
- [ ] All tests pass
- [ ] Commit: `feat: add multiple window support`
