# Fix: Code Review Findings from TASK-001 R1

## Source
Code review report: `prompts/reports/code-reviews/CODE-REVIEW-TASK-001-bootstrap-R1.md`

## Fixes Required

### Fix 1: Enable Content Security Policy (CRITICAL)

**File**: `src-tauri/tauri.conf.json`
**Line**: 23
**Issue**: `"csp": null` disables Content Security Policy entirely. This is a security risk — the app will render untrusted PTY output, and without CSP, any output interpreted as HTML could execute arbitrary JavaScript in the webview.

**Fix**: Set a restrictive CSP. Use:
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'"
```

Notes:
- `'unsafe-inline'` for styles is needed because React commonly injects inline styles
- In dev mode, Vite's HMR may need additional CSP rules. Tauri v2 handles dev/build CSP separately — the `devUrl` origin is automatically trusted, so the above CSP should work for both dev and production. If `npm run tauri dev` breaks after this change, adjust by adding `'unsafe-eval'` to `script-src` **for dev only** (check Tauri v2 docs for dev-specific CSP config)
- Test that `npm run tauri dev` still works after the change

### Fix 2: Clean up `.gitignore` (CRITICAL)

**File**: `.gitignore`
**Issue**: Line 36 (`.claude\settings.local.json`) uses a backslash path separator and is redundant because `*.local` on line 34 already matches the file. The file also lacks a trailing newline.

**Fix**:
1. Remove line 36 entirely (`.claude\settings.local.json`)
2. Ensure the file ends with a newline after the last line
3. Since `.claude/settings.local.json` is already tracked in git, run `git rm --cached .claude/settings.local.json` to untrack it (the `*.local` gitignore rule will then prevent it from being re-added)

### Fix 3: Set up jest-dom and fix test assertions (IMPORTANT)

**Files**: `vitest.config.ts`, `src/__tests__/App.test.tsx`
**Issue**: Tests use `toBeDefined()` which is redundant with `getByText()` (which throws if element isn't found). The `@testing-library/jest-dom` package is installed but not configured.

**Fix**:
1. Create `src/__tests__/setup.ts`:
   ```typescript
   import '@testing-library/jest-dom/vitest';
   ```

2. Update `vitest.config.ts` to reference the setup file:
   ```typescript
   setupFiles: ['./src/__tests__/setup.ts'],
   ```

3. Update `src/__tests__/App.test.tsx` — change assertions from:
   ```typescript
   expect(screen.getByText("Velocity")).toBeDefined();
   ```
   to:
   ```typescript
   expect(screen.getByText("Velocity")).toBeInTheDocument();
   ```
   Do this for both test cases.

4. Run `npm run test` to verify tests still pass.

## Acceptance Criteria

- [ ] CSP is set to a restrictive policy in `tauri.conf.json` (not `null`)
- [ ] `npm run tauri dev` still works with the new CSP
- [ ] `.gitignore` line 36 removed, file ends with trailing newline
- [ ] `.claude/settings.local.json` untracked from git (`git rm --cached`)
- [ ] `src/__tests__/setup.ts` created with jest-dom import
- [ ] `vitest.config.ts` references the setup file
- [ ] Test assertions use `toBeInTheDocument()` instead of `toBeDefined()`
- [ ] `npm run test` passes
- [ ] Clean commit: `fix: address code review findings — enable CSP, fix gitignore, configure jest-dom`

## Files to Read First

- `src-tauri/tauri.conf.json` — Current CSP config (line 23)
- `.gitignore` — Current state, line 36
- `vitest.config.ts` — Current test config, setupFiles array
- `src/__tests__/App.test.tsx` — Current test assertions
