# Investigation: App Still Shows Default Tauri Icon

**Date**: 2026-03-12
**Status**: Root cause identified

---

## Summary

The Velocity app shows the default Tauri icon in the title bar and taskbar because **the binary was last compiled BEFORE the custom icons were generated**. The icons themselves are correct and properly configured -- a clean rebuild will fix the issue.

---

## Findings

### 1. `tauri.conf.json` -- Bundle Icon Paths (CORRECT)

**File**: `src-tauri/tauri.conf.json`, lines 29-35

```json
"bundle": {
    "active": true,
    "targets": "all",
    "icon": [
        "icons/32x32.png",
        "icons/128x128.png",
        "icons/128x128@2x.png",
        "icons/icon.icns",
        "icons/icon.ico"
    ]
}
```

All referenced icon files exist and are non-zero. The paths are correct relative to `src-tauri/`.

### 2. Generated Icons -- Verified as Custom Velocity Logo (CORRECT)

All icons in `src-tauri/icons/` contain the custom Velocity logo (a stylized arrow/cursor on a dark rounded-square background), **NOT** the default Tauri logo.

| File | Size | Content |
|------|------|---------|
| `Velocity.png` (source) | 459,219 bytes | Custom Velocity logo (1024x1024) |
| `icon.png` | 175,999 bytes | Custom Velocity logo (scaled) |
| `icon.ico` | 72,258 bytes | Custom Velocity logo (multi-layer ICO) |
| `128x128@2x.png` | 57,865 bytes | Custom Velocity logo |
| `128x128.png` | 19,260 bytes | Custom Velocity logo |
| `32x32.png` | 1,982 bytes | Custom Velocity logo |

Visual confirmation: the 32x32.png and icon.png were read as images and show the Velocity arrow logo on a dark background, not the Tauri gear icon.

### 3. ICO Layer Ordering (CORRECT)

The `icon.ico` file has 6 layers in the correct order for Windows dev mode display:

```
Layer 0: 32x32   (first -- correct per Tauri docs)
Layer 1: 16x16
Layer 2: 24x24
Layer 3: 48x48
Layer 4: 64x64
Layer 5: 256x256
```

Tauri docs state: "For optimal display of the ICO image in development, the 32px layer should be the first layer." This requirement is satisfied.

### 4. Windows Resource File (CORRECT)

**File**: `src-tauri/target/debug/build/velocity-cbbdd7d5ea9ecb19/out/resource.rc`, line 26

```rc
32512 ICON "C:\\Velocity\\src-tauri\\icons\\icon.ico"
```

The resource file correctly references the `icon.ico` path. On Windows, Tauri embeds the icon into the `.exe` via the Windows Resource Compiler at build time.

### 5. ROOT CAUSE: Stale Build -- Binary Predates Icon Generation

This is the key finding. The timestamps reveal the problem:

| Artifact | Last Modified |
|----------|--------------|
| `Velocity.png` (source icon) | Mar 12, 19:20:55 |
| `npx tauri icon` output (all generated icons) | Mar 12, 23:51:18-19 |
| `resource.lib` (compiled icon embedded in binary) | Mar 12, 08:53:40 |
| `velocity.exe` (the running binary) | Mar 12, 23:12:20 |

**The `velocity.exe` was last compiled at 23:12, but the icons were regenerated at 23:51 -- almost 40 minutes AFTER the last build.**

Furthermore, the `resource.lib` (which contains the compiled icon resource that gets linked into the exe) dates from 08:53 AM, meaning the icon embedded in the current binary is from a build that happened ~15 hours before the custom icons were generated.

The build pipeline is: `icon.ico` -> Windows Resource Compiler -> `resource.lib` -> linked into `velocity.exe`. Since the exe was built before the new icons existed, it still contains the old (default Tauri) icon.

### 6. No Window-Level Icon Override Needed

In Tauri v2, the `app.windows` configuration does **not** have a separate `icon` property. The window icon on Windows comes from:

1. The ICO resource embedded in the `.exe` via `resource.rc` (for title bar + taskbar)
2. The `bundle.icon` config (for installers and shortcuts)

There is no separate "window icon" config to set. The `bundle.icon` array is the correct and only place to configure this. Tauri's build script (`tauri-build`) reads these paths and generates the `resource.rc` file that embeds `icon.ico` into the Windows executable.

### 7. Dev Mode vs Build Mode Behavior

On **Windows**, `tauri dev` DOES use the icon from `bundle.icon` -- the icon gets embedded into the debug exe via the Windows Resource Compiler during `cargo build`. This is different from Linux (where dev mode cannot display custom icons due to `.desktop` file requirements).

The issue is purely a stale build, not a dev-mode limitation.

---

## Diagnosis

**Root Cause**: The app binary (`velocity.exe`) was compiled before `npx tauri icon` regenerated the icon files. The exe still contains the old default Tauri icon embedded as a Windows resource.

**Why Cargo didn't rebuild**: Cargo's incremental compilation may not detect changes to non-Rust files referenced by the build script. The `tauri-build` crate generates `resource.rc` during the build script phase, but if Cargo considers the build script's outputs up-to-date (based on fingerprinting of `build.rs` and `Cargo.toml`), it will skip re-running the build script entirely, leaving the old `resource.lib` in place.

---

## Recommended Fix

1. **Clean and rebuild**:
   ```bash
   cd src-tauri && cargo clean
   npm run tauri dev
   ```
   This forces a full rebuild, which will re-run the build script, regenerate `resource.rc`, recompile it with the new `icon.ico`, and link the correct icon into the exe.

2. **Alternatively**, a targeted clean of just the build artifacts:
   ```bash
   # Delete the stale build script output to force re-run
   rm -rf src-tauri/target/debug/build/velocity-*
   npm run tauri dev
   ```

3. **No code changes are needed** -- the configuration and icon files are all correct.

---

## References

- [Tauri v2 App Icons Documentation](https://v2.tauri.app/develop/icons/)
- [Tauri v2 Configuration Reference](https://v2.tauri.app/reference/config/)
- [GitHub Discussion: Unable to change Tauri app icon](https://github.com/tauri-apps/tauri/discussions/9109)
- [GitHub Issue #1922: Window icons not working](https://github.com/tauri-apps/tauri/issues/1922)
