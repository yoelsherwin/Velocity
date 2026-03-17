# Investigation: Color Rendering Pipeline

**Date**: 2026-03-17
**Status**: Complete

## Summary

The Velocity color rendering pipeline (Rust ANSI filter -> anser parser -> React renderer) **fully supports 8/16, 256-color, and 24-bit truecolor** with no critical gaps. One minor robustness issue exists in the `stripAnsi` regex, and test coverage for extended colors is absent.

---

## Pipeline Analysis

### Stage 1: Rust ANSI Filter (`src-tauri/src/ansi/mod.rs`)

**Verdict: PASS -- all SGR sequences pass through correctly.**

The filter uses `vte 0.15` to parse raw PTY bytes. The `csi_dispatch` handler preserves any CSI sequence with action `'m'` (SGR) and strips everything else. The reconstruction logic iterates over `Params` and joins all values with `;`:

```rust
fn csi_dispatch(&mut self, params: &Params, _intermediates: &[u8], _ignore: bool, action: char) {
    if action == 'm' {
        let mut reconstructed = String::from("\x1b[");
        let mut first = true;
        for param in params.iter() {
            for &subparam in param {
                if !first { reconstructed.push(';'); }
                reconstructed.push_str(&subparam.to_string());
                first = false;
            }
        }
        reconstructed.push('m');
        // ... length check, then emit
    }
}
```

In vte 0.15, `Params::iter()` yields `&[u16]` slices where:
- Semicolon-separated values are separate params (each a single-element slice)
- Colon-separated subparams are grouped in the same slice

For `\x1b[38;5;196m` (256-color): vte produces params `[38]`, `[5]`, `[196]` (all semicolons). The nested loop joins them as `38;5;196` -- correct.

For `\x1b[38;2;255;100;0m` (24-bit truecolor): vte produces params `[38]`, `[2]`, `[255]`, `[100]`, `[0]`. Reconstructed as `38;2;255;100;0` -- correct.

For colon-variant `\x1b[38:2:255:100:0m`: vte groups as a single param `[38, 2, 255, 100, 0]`. The inner loop joins with `;`, producing `38;2;255;100;0` -- this normalizes colons to semicolons, which is actually desirable because anser only understands the semicolon form.

The `MAX_SEQUENCE_LENGTH` of 256 bytes is sufficient (a 24-bit color SGR is ~20 bytes).

### Stage 2: TypeScript Parser (`src/lib/ansi.ts`)

**Verdict: PASS -- anser handles 256-color and 24-bit color correctly.**

The code calls `Anser.ansiToJson(text, { use_classes: false, remove_empty: true })`, and reads the `fg`/`bg` fields from the result. With `use_classes: false`, anser returns RGB triplet strings like `"255, 100, 0"`.

Confirmed in anser source (`node_modules/anser/lib/index.js`):

- **256-color** (`38;5;N`): Lines 431-453 -- reads mode `"5"`, looks up `palette_index` in `PALETTE_COLORS[]` (a 256-entry table built in `setupPalette()`). Returns the RGB string. Works correctly.

- **24-bit truecolor** (`38;2;R;G;B`): Lines 454-476 -- reads mode `"2"`, parses R/G/B values, validates 0-255 range, and returns `"R, G, B"` string. Works correctly.

- **Background variants** (`48;5;N` and `48;2;R;G;B`): Same code path, writes to `bg` instead of `fg`. Works correctly.

The `isValidRgb()` check in `ansi.ts` (regex: `/^\d{1,3},\s?\d{1,3},\s?\d{1,3}$/`) correctly validates the triplet format that anser produces (e.g., `"255, 100, 0"`).

### Stage 3: React Renderer (`src/components/AnsiOutput.tsx`)

**Verdict: PASS -- colors are rendered as inline `rgb()` styles.**

The component maps each parsed span to:
```tsx
<span style={{
    color: span.fg,           // e.g. "rgb(255, 100, 0)"
    backgroundColor: span.bg, // e.g. "rgb(0, 0, 187)"
    ...
}} />
```

Since `parseAnsi` wraps validated triplets in `rgb(...)`, these become valid CSS color values. This works for all color depths (8/16 colors are also converted to RGB by anser).

---

## Issues Found

### Issue 1: No test coverage for extended colors (LOW severity)

Neither the Rust tests nor the TypeScript tests include 256-color or 24-bit truecolor test cases. All existing tests use basic 8-color SGR codes (`\x1b[31m`). Missing tests:

- Rust: No test for `\x1b[38;5;196m` or `\x1b[38;2;255;100;0m` passthrough
- TypeScript: No test for `parseAnsi` with 256/truecolor input
- Component: No test for rendered `rgb()` style values with extended colors

### Issue 2: `stripAnsi` regex is slightly too narrow (LOW severity)

The regex `/\x1b\[[0-9;]*m/g` in `stripAnsi()` does not match colon-separated SGR forms like `\x1b[38:2:255:100:0m`. While the Rust filter normalizes colons to semicolons (so this is unlikely to occur in practice), the regex should technically be `/\x1b\[[0-9;:]*m/g` for completeness.

### Issue 3: No dim/strikethrough/blink rendering (COSMETIC, not color-related)

The `AnsiOutput` component handles bold, italic, underline, and dim. It does not render `strikethrough` (SGR 9) or `blink` (SGR 5), which anser does parse. Not a color issue but noted for completeness.

---

## Conclusion

The color rendering pipeline is **sound end-to-end** for all color depths:

| Color Mode | Rust Filter | anser Parser | React Renderer |
|---|---|---|---|
| 8-color (30-37) | PASS | PASS | PASS |
| 16-color (90-97) | PASS | PASS | PASS |
| 256-color (38;5;N) | PASS | PASS | PASS |
| 24-bit (38;2;R;G;B) | PASS | PASS | PASS |

**Recommended follow-up**: Add targeted tests for 256-color and 24-bit truecolor at each pipeline stage to prevent regressions.
