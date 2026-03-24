# Task 048: Global Hotkey — Quake-Style Summon (P1-U6)

## Context
Users need a system-wide hotkey to summon/dismiss the Velocity window from anywhere, like Quake console terminals (iTerm2 hotkey window, Guake).

## Requirements
### Backend (Rust) + Frontend.

1. **Default hotkey**: Ctrl+` (backtick). Configurable in future.
2. **Tauri global shortcut**: Use `tauri::plugin::global_shortcut` to register a system-wide shortcut.
3. **Toggle behavior**: If window is hidden/minimized → show and focus. If window is visible and focused → hide/minimize.
4. **Implementation in Rust**: Register the shortcut in the Tauri setup hook. On trigger, toggle the main window visibility.

```rust
// In app setup:
use tauri::plugin::global_shortcut::GlobalShortcutPlugin;

app.plugin(
    GlobalShortcutPlugin::with_handler(|app, shortcut, event| {
        if shortcut.matches("ctrl+`") && event == ShortcutEvent::Pressed {
            let window = app.get_webview_window("main").unwrap();
            if window.is_visible().unwrap_or(false) {
                window.hide().unwrap();
            } else {
                window.show().unwrap();
                window.set_focus().unwrap();
            }
        }
    })
);
```

5. **Tauri capabilities**: Add `global-shortcut:default` to capabilities.
6. **Command palette**: Add `window.toggle` command.

## Tests
### Rust
- [ ] `test_global_shortcut_plugin_registered`: Verify plugin is added in setup.

### Frontend
- [ ] `test_window_toggle_in_palette`: Command palette has "Toggle Window" entry.

## Files to Read First
- `src-tauri/src/lib.rs` — App setup, plugin registration
- `src-tauri/tauri.conf.json` — Capabilities
- `src/lib/commands.ts` — Command palette

## Acceptance Criteria
- [ ] Ctrl+` toggles window visibility system-wide
- [ ] Window focused when summoned
- [ ] Command in palette
- [ ] All tests pass
- [ ] Commit: `feat: add global hotkey for Quake-style window toggle`
