# Task 053: Built-in File Tree Sidebar (P3-8)

## Context
Developers frequently need to see the file structure of their project while working in the terminal. A collapsible file tree sidebar gives visual context without leaving the terminal.

## Requirements
### Backend (Rust) + Frontend.

#### 1. New Tauri command: `list_directory`
```rust
#[tauri::command]
pub async fn list_directory(path: String) -> Result<Vec<FileEntry>, String>

#[derive(Serialize)]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_directory: bool,
    pub is_hidden: bool,
}
```
- Lists immediate children of a directory (not recursive)
- Directories first, then files, both alphabetically
- Marks hidden files (starting with `.` or Windows hidden attribute)
- Validates path is a real directory
- Limited to 500 entries

#### 2. File Tree Sidebar Component (`src/components/layout/FileTree.tsx`)
- Collapsible sidebar on the left side of the terminal
- Toggle via Ctrl+B (or Ctrl+Shift+E like VS Code) — reuse different shortcut since Ctrl+B is bookmark
- Use Ctrl+Shift+E for file tree toggle
- Tree view: folders expandable (click to expand/collapse, lazy-loaded), files as leaves
- Icons: folder icon (📁/📂) and file icon (📄) or simple text indicators
- Click on file: copies the path to the input editor
- Click on folder: expands/collapses it
- Root: starts at the terminal's CWD
- Resizable width via drag handle (like pane dividers)

#### 3. Integration in TabManager/Terminal
- Sidebar state (open/closed, width) managed in TabManager
- The sidebar sits beside the terminal content area
- Register `sidebar.toggle` command in palette

#### 4. Styling
- Background: `var(--bg-surface)`
- Text: `var(--text-secondary)`
- Selected item: `var(--accent-blue)` background
- Width: default 200px, min 150px, max 400px
- Scrollable for long directory listings

## Tests
### Rust
- [ ] `test_list_directory_returns_entries`: Lists real directory contents.
- [ ] `test_list_directory_sorts_dirs_first`: Directories before files.
- [ ] `test_list_directory_invalid_path`: Returns error for invalid path.
- [ ] `test_list_directory_limited_entries`: Max 500 entries.

### Frontend
- [ ] `test_file_tree_renders_entries`: Shows files and folders.
- [ ] `test_folder_click_expands`: Clicking folder loads children.
- [ ] `test_file_click_copies_path`: Clicking file puts path in input.
- [ ] `test_sidebar_toggle`: Ctrl+Shift+E toggles sidebar.
- [ ] `test_sidebar_hidden_by_default`: Sidebar not visible on start.
- [ ] `test_sidebar_resizable`: Drag handle changes width.

## Files to Read First
- `src/components/layout/TabManager.tsx` — Layout management
- `src/components/layout/PaneContainer.tsx` — Pane layout pattern
- `src-tauri/src/commands/mod.rs` — Tauri command patterns
- `src/App.css` — Layout styling
- `src/lib/commands.ts` — Command palette

## Acceptance Criteria
- [ ] File tree sidebar with expandable directories
- [ ] Lazy-loaded directory contents
- [ ] Click file copies path to input
- [ ] Toggle via Ctrl+Shift+E and command palette
- [ ] Resizable width
- [ ] Uses theme colors
- [ ] All tests pass
- [ ] Commit: `feat: add built-in file tree sidebar`
