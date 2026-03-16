# Task 018: Intelligent Intent Classifier + Mode Indicator

## Context

Agent Mode uses `#` prefix only. This task adds automatic CLI-vs-NL detection with a visual indicator, following the hybrid approach from `prompts/reports/investigations/INVESTIGATION-intent-classification.md`.

Covers roadmap items: **P0-7** (mode indicator), **P0-8a** (heuristic engine), **P0-8b** (known-command enumeration).

### Current State
- **`src/lib/intent-classifier.ts`**: Returns `'natural_language'` only for `#` prefix, `'cli'` for everything else.
- **`src/components/Terminal.tsx`**: `handleSubmit` checks `hasHashPrefix` to route to agent mode.
- **`src/components/editor/InputEditor.tsx`**: No mode indicator.

### Design (from investigation report)

```
User types → Heuristic engine (<1ms) → Confidence score
    ├── High confidence CLI → Show "CLI" badge (neutral)
    ├── High confidence NL  → Show "AI" badge (accent blue)
    └── Low confidence      → Show "AI?" badge (dimmed, uncertain)

User can click badge to toggle. Override persists until input cleared.
```

## Requirements

### Backend (Rust)

#### 1. Known-command enumeration

Create `src-tauri/src/commands/intent.rs` (or add to existing commands):

```rust
#[tauri::command]
pub async fn get_known_commands() -> Result<Vec<String>, String> {
    let mut commands = Vec::new();

    // 1. Scan PATH directories for executables
    if let Ok(path_var) = std::env::var("PATH") {
        for dir in path_var.split(';') {
            if let Ok(entries) = std::fs::read_dir(dir) {
                for entry in entries.flatten() {
                    if let Some(name) = entry.file_name().to_str() {
                        // Strip .exe, .cmd, .bat, .ps1 extensions
                        let base = name.split('.').next().unwrap_or(name).to_lowercase();
                        if !base.is_empty() {
                            commands.push(base);
                        }
                    }
                }
            }
        }
    }

    // 2. Add common shell builtins
    let builtins = vec![
        "cd", "dir", "echo", "set", "cls", "exit", "type", "copy", "move", "del",
        "mkdir", "rmdir", "ren", "pushd", "popd", "call", "start", "where", "assoc",
        "ftype", "path", "prompt", "title", "color", "ver", "vol", "pause",
    ];
    commands.extend(builtins.iter().map(|s| s.to_string()));

    // 3. Add common PowerShell verbs (for Verb-Noun cmdlet detection)
    // We don't enumerate all cmdlets — instead the frontend detects the Verb-Noun pattern

    // Deduplicate
    commands.sort();
    commands.dedup();

    Ok(commands)
}
```

Register in `lib.rs`.

#### 2. Note on performance
This command scans the filesystem. Cache the result on the frontend — call once on app start, not on every keystroke.

### Frontend (React/TypeScript)

#### 1. Expand intent classifier

Rewrite `src/lib/intent-classifier.ts`:

```typescript
export interface ClassificationResult {
    intent: 'cli' | 'natural_language';
    confidence: 'high' | 'low';
}

export function classifyIntent(input: string, knownCommands: Set<string>): ClassificationResult {
    const trimmed = input.trim();

    // Explicit # trigger — always NL, high confidence
    if (trimmed.startsWith('#')) return { intent: 'natural_language', confidence: 'high' };

    // Empty — CLI
    if (!trimmed) return { intent: 'cli', confidence: 'high' };

    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    const words = trimmed.split(/\s+/);

    // === CLI signals (high confidence) ===

    // Flags: -x, --flag
    if (/\s-{1,2}\w/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Pipes and redirects
    if (/[|<>]/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Starts with path: ./ ../ ~/ C:\ /
    if (/^[.~\/\\]|^[a-zA-Z]:[\/\\]/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Assignment: VAR=value
    if (/^\w+=/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // PowerShell Verb-Noun pattern: Get-ChildItem, Set-Location, etc.
    if (/^[A-Z][a-z]+-[A-Z][a-z]+/.test(trimmed.split(/\s/)[0])) return { intent: 'cli', confidence: 'high' };

    // First token is a known command from PATH
    if (knownCommands.has(firstToken)) return { intent: 'cli', confidence: 'high' };

    // === NL signals ===

    // Question words
    const questionStarters = ['what', 'how', 'where', 'when', 'why', 'can', 'could', 'would', 'is', 'are', 'do', 'does'];
    if (questionStarters.includes(firstToken)) return { intent: 'natural_language', confidence: 'high' };

    // Polite/request patterns
    if (['please', 'help'].includes(firstToken)) return { intent: 'natural_language', confidence: 'high' };

    // Contains articles/prepositions (strong NL signal) + 4+ words
    const hasArticles = /\b(the|a|an|all|my|this|that|every|some|any)\b/i.test(trimmed);
    if (words.length >= 4 && hasArticles) return { intent: 'natural_language', confidence: 'high' };

    // Action verbs that aren't known commands + multi-word
    const nlVerbs = ['show', 'list', 'create', 'delete', 'remove', 'search', 'look', 'check',
                     'tell', 'give', 'open', 'close', 'rename', 'download', 'deploy', 'configure',
                     'setup', 'reset', 'fix', 'debug', 'explain', 'describe', 'count'];
    if (words.length >= 3 && nlVerbs.includes(firstToken) && !knownCommands.has(firstToken)) {
        return { intent: 'natural_language', confidence: 'high' };
    }

    // === Ambiguous zone ===

    // Multi-word without any CLI artifacts — lean NL but low confidence
    if (words.length >= 3 && !knownCommands.has(firstToken)) {
        return { intent: 'natural_language', confidence: 'low' };
    }

    // Short unknown input — lean CLI but low confidence
    if (!knownCommands.has(firstToken) && words.length <= 2) {
        return { intent: 'cli', confidence: 'low' };
    }

    // Default: CLI, high confidence
    return { intent: 'cli', confidence: 'high' };
}
```

#### 2. Known commands hook

Create `src/hooks/useKnownCommands.ts`:

```typescript
export function useKnownCommands(): Set<string> {
    const [commands, setCommands] = useState<Set<string>>(new Set());

    useEffect(() => {
        invoke<string[]>('get_known_commands')
            .then(cmds => setCommands(new Set(cmds)))
            .catch(() => setCommands(new Set())); // Fallback: empty set (classifier still works via other signals)
    }, []);

    return commands;
}
```

Called once in `TabManager` or `Terminal`, passed down.

#### 3. ModeIndicator component

Create `src/components/editor/ModeIndicator.tsx`:

Props:
```typescript
interface ModeIndicatorProps {
    intent: 'cli' | 'natural_language';
    confidence: 'high' | 'low';
    onToggle: () => void;
    disabled?: boolean;
}
```

Renders:
- **CLI high**: `CLI` badge, neutral color (`#a6adc8`)
- **AI high**: `AI` badge, accent color (`#89b4fa`)
- **AI low** (uncertain): `AI?` badge, dimmed accent (`#585b70`)
- **CLI low**: `CLI?` badge, dimmed neutral
- Clickable to toggle
- `data-testid="mode-indicator"`

#### 4. Update InputEditor

Add `mode` (ClassificationResult) and `onToggleMode` props. Render `ModeIndicator` left of the prompt.

#### 5. Update Terminal.tsx

State:
```typescript
const [inputMode, setInputMode] = useState<ClassificationResult>({ intent: 'cli', confidence: 'high' });
const [modeOverride, setModeOverride] = useState(false);
```

On input change (not on every keystroke — use the value after onChange):
```typescript
if (!modeOverride) {
    setInputMode(classifyIntent(newValue, knownCommands));
}
```

On toggle:
```typescript
setInputMode(prev => ({
    intent: prev.intent === 'cli' ? 'natural_language' : 'cli',
    confidence: 'high',
}));
setModeOverride(true);
```

On submit:
```typescript
if (inputMode.intent === 'natural_language') {
    // Agent mode (same flow as before — strip #, translate, populate editor)
} else {
    // CLI mode (execute normally)
}
// After submit:
setModeOverride(false);
setInputMode({ intent: 'cli', confidence: 'high' });
```

Remove the hardcoded `hasHashPrefix` check — use `inputMode.intent` instead.

#### 6. Styles

```css
.mode-indicator {
    display: flex;
    align-items: center;
    gap: 2px;
    padding: 2px 8px;
    border-radius: 4px;
    border: 1px solid #313244;
    background: transparent;
    font-size: 11px;
    cursor: pointer;
    user-select: none;
    white-space: nowrap;
    transition: all 0.15s;
    margin-right: 6px;
}
.mode-indicator:hover { background: #313244; }
.mode-indicator-cli { color: #a6adc8; border-color: #313244; }
.mode-indicator-ai { color: #89b4fa; border-color: #89b4fa; }
.mode-indicator-uncertain { opacity: 0.6; }
```

### IPC Contract

New command:
```
get_known_commands() -> Result<Vec<String>, String>
```
Returns deduplicated list of command names from PATH + builtins. Called once on app start.

## Tests (Write These FIRST)

### Rust Unit Tests
- [ ] **`test_get_known_commands_returns_nonempty`**: Call `get_known_commands`. Assert the result is non-empty and contains common commands like "cmd" or "powershell".

### Intent Classifier Tests (`src/__tests__/intent-classifier.test.ts`)

Update all existing tests to pass `knownCommands` parameter. Add new tests:

- [ ] **`test_hash_prefix_is_nl_high`**: `# find files` → `{ intent: 'natural_language', confidence: 'high' }`
- [ ] **`test_flags_are_cli_high`**: `ls -la` → `{ intent: 'cli', confidence: 'high' }`
- [ ] **`test_pipe_is_cli_high`**: `ps | grep node` → CLI high
- [ ] **`test_known_command_is_cli_high`**: `git status` (with `git` in knownCommands) → CLI high
- [ ] **`test_powershell_cmdlet_is_cli_high`**: `Get-ChildItem -Recurse` → CLI high
- [ ] **`test_question_is_nl_high`**: `how do I find large files` → NL high
- [ ] **`test_sentence_with_articles_is_nl_high`**: `show me all the log files` → NL high
- [ ] **`test_action_verb_multiword_is_nl_high`**: `delete all temporary files` → NL high (if `delete` not in knownCommands)
- [ ] **`test_short_unknown_is_cli_low`**: `foobar` (not in knownCommands) → CLI low
- [ ] **`test_multiword_unknown_is_nl_low`**: `foo bar baz` (no CLI signals) → NL low
- [ ] **`test_find_with_flags_is_cli`**: `find . -name '*.ts'` → CLI high (flags present)
- [ ] **`test_find_natural_is_nl`**: `find all typescript files` → NL high (if `find` not in knownCommands set used)
- [ ] **`test_path_is_cli_high`**: `./script.sh` → CLI high
- [ ] **`test_empty_is_cli_high`**: `""` → CLI high

### ModeIndicator Tests (`src/__tests__/ModeIndicator.test.tsx`)
- [ ] **`test_renders_cli_badge`**: Render with `intent='cli', confidence='high'`. Assert "CLI" visible.
- [ ] **`test_renders_ai_badge`**: Render with `intent='natural_language', confidence='high'`. Assert "AI" visible with accent class.
- [ ] **`test_renders_uncertain`**: Render with `confidence='low'`. Assert uncertain class applied.
- [ ] **`test_click_calls_onToggle`**: Click indicator. Assert `onToggle` called.

### Terminal Tests
- [ ] **`test_auto_detects_nl`**: Type "show me all log files". Assert mode indicator shows AI.
- [ ] **`test_auto_detects_cli`**: Type "git status" (with git in knownCommands mock). Assert CLI.
- [ ] **`test_toggle_overrides`**: Auto-detect AI, click toggle to CLI. Type more — stays CLI.
- [ ] **`test_submit_resets_override`**: Toggle to AI, submit. Assert mode resets to CLI.
- [ ] **`test_nl_mode_triggers_translate`**: Mode is NL, type text, Enter. Assert `translateCommand` called.

### E2E Tests (Playwright)
- [ ] **`test_mode_indicator_visible`**: Assert mode indicator in the DOM.
- [ ] **`test_mode_indicator_toggles_on_click`**: Click indicator. Assert it changes.

## Acceptance Criteria
- [ ] All tests written and passing
- [ ] `get_known_commands` Rust command scans PATH + builtins
- [ ] Intent classifier uses structural analysis + known commands + NL detection
- [ ] Returns `{ intent, confidence }` — not just intent
- [ ] ModeIndicator badge shows CLI/AI/uncertain states
- [ ] Click to toggle, override persists until submit
- [ ] `#` prefix still forces AI (backward compatible)
- [ ] Auto-detection on input change (not debounced — classifier is <1ms)
- [ ] After submit, mode resets to auto-detect
- [ ] `npm run test` + `cargo test` pass
- [ ] Clean commit: `feat: add intelligent intent classifier with mode indicator`

## Security Notes
- Known commands from PATH are local system info — not sensitive, not sent anywhere.
- The classifier is display-only until the user presses Enter. No auto-execution.
- Defaults to CLI when uncertain (safer).

## Files to Read First
- `prompts/reports/investigations/INVESTIGATION-intent-classification.md` — Full approach analysis
- `src/lib/intent-classifier.ts` — Current classifier (rewrite)
- `src/components/Terminal.tsx` — Mode state, submit flow
- `src/components/editor/InputEditor.tsx` — Add indicator
- `src-tauri/src/commands/mod.rs` — Add get_known_commands
