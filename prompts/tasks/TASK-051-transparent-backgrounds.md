# Task 051: Transparent/Blurred Backgrounds (P2-19)

## Context
Modern terminals (Windows Terminal, Hyper) support transparent and acrylic/mica backgrounds. This is a popular aesthetic feature.

## Requirements
### Backend (Rust) + Frontend.

1. **Window vibrancy**: Use the `window-vibrancy` crate (already a Tauri dependency) or Tauri's built-in window effects.
2. **Transparency levels**:
   - `none` (default, opaque — current behavior)
   - `transparent` (semi-transparent background, content behind visible)
   - `acrylic` (Windows acrylic blur effect)
   - `mica` (Windows 11 Mica effect)
3. **Settings**: Add `background_effect` to AppSettings. Values: `"none"`, `"transparent"`, `"acrylic"`, `"mica"`.
4. **CSS**: When transparent, the terminal background needs `background-color: rgba(...)` instead of opaque hex. Adjust `--bg-base` to use rgba with configurable opacity.
5. **Opacity setting**: Add `background_opacity` (0.5-1.0, default 1.0) for transparent mode.
6. **Tauri window config**: Set `transparent: true` in window config when effect is not `none`.
7. **Apply on startup**: Read settings and apply window effect in Rust setup or via a Tauri command.

```rust
#[tauri::command]
async fn set_window_effect(app: tauri::AppHandle, effect: String, opacity: f64) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("No main window")?;
    match effect.as_str() {
        "acrylic" => { /* apply acrylic via window-vibrancy */ }
        "mica" => { /* apply mica */ }
        "transparent" => { /* just make window transparent */ }
        _ => { /* remove effects */ }
    }
    Ok(())
}
```

## Tests
### Rust
- [ ] `test_window_effect_validation`: Only valid effect names accepted.
- [ ] `test_opacity_bounds`: Opacity clamped to 0.5-1.0.

### Frontend
- [ ] `test_background_effect_setting_renders`: Settings modal has background effect dropdown.
- [ ] `test_opacity_slider_renders`: Opacity slider appears when effect is not "none".
- [ ] `test_background_setting_persists`: Setting saves/loads.
- [ ] `test_css_vars_updated_for_transparent`: When transparent, --bg-base uses rgba.

## Files to Read First
- `src-tauri/src/lib.rs` — App setup
- `src-tauri/tauri.conf.json` — Window config
- `src-tauri/Cargo.toml` — Dependencies (check for window-vibrancy)
- `src/components/SettingsModal.tsx` — Settings UI
- `src/App.css` — Background color usage

## Acceptance Criteria
- [ ] Transparent, acrylic, and mica backgrounds work
- [ ] Configurable opacity
- [ ] Settings persist
- [ ] Default is opaque (no change for existing users)
- [ ] All tests pass
- [ ] Commit: `feat: add transparent and blurred background effects`
