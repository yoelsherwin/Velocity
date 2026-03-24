import { render, screen, fireEvent, waitFor, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock the file-tree module
const mockListDirectory = vi.fn();
vi.mock('../lib/file-tree', () => ({
  listDirectory: (...args: unknown[]) => mockListDirectory(...args),
}));

// Mock pty to avoid errors from Terminal component
vi.mock('../lib/pty', () => ({
  createSession: vi.fn().mockResolvedValue('test-session-id'),
  writeToSession: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
  startReading: vi.fn().mockResolvedValue(undefined),
}));

// Mock Tauri event listener
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

// Mock Tauri invoke for get_cwd
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockImplementation((cmd: string) => {
    if (cmd === 'get_cwd') return Promise.resolve('C:\\test\\project');
    if (cmd === 'get_git_info') return Promise.resolve(null);
    if (cmd === 'get_settings') return Promise.resolve({ llm_provider: 'anthropic', api_key: '', model: '' });
    return Promise.resolve(null);
  }),
}));

import FileTree from '../components/layout/FileTree';
import TabManager from '../components/layout/TabManager';

describe('FileTree Component', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_file_tree_renders_entries', async () => {
    mockListDirectory.mockResolvedValue([
      { name: 'src', path: 'C:\\test\\project\\src', is_directory: true, is_hidden: false },
      { name: 'README.md', path: 'C:\\test\\project\\README.md', is_directory: false, is_hidden: false },
    ]);

    render(
      <FileTree
        rootPath="C:\\test\\project"
        onFileClick={vi.fn()}
        width={200}
        onResize={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-tree-item-src')).toBeInTheDocument();
      expect(screen.getByTestId('file-tree-item-README.md')).toBeInTheDocument();
    });
  });

  it('test_folder_click_expands', async () => {
    mockListDirectory
      .mockResolvedValueOnce([
        { name: 'src', path: 'C:\\test\\project\\src', is_directory: true, is_hidden: false },
      ])
      .mockResolvedValueOnce([
        { name: 'App.tsx', path: 'C:\\test\\project\\src\\App.tsx', is_directory: false, is_hidden: false },
      ]);

    render(
      <FileTree
        rootPath="C:\\test\\project"
        onFileClick={vi.fn()}
        width={200}
        onResize={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-tree-item-src')).toBeInTheDocument();
    });

    // Click the folder to expand it
    await act(async () => {
      fireEvent.click(screen.getByTestId('file-tree-item-src'));
    });

    await waitFor(() => {
      expect(mockListDirectory).toHaveBeenCalledWith('C:\\test\\project\\src');
      expect(screen.getByTestId('file-tree-item-App.tsx')).toBeInTheDocument();
    });
  });

  it('test_file_click_copies_path', async () => {
    const mockOnFileClick = vi.fn();
    mockListDirectory.mockResolvedValue([
      { name: 'hello.txt', path: 'C:\\test\\project\\hello.txt', is_directory: false, is_hidden: false },
    ]);

    render(
      <FileTree
        rootPath="C:\\test\\project"
        onFileClick={mockOnFileClick}
        width={200}
        onResize={vi.fn()}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('file-tree-item-hello.txt')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByTestId('file-tree-item-hello.txt'));

    expect(mockOnFileClick).toHaveBeenCalledWith('C:\\test\\project\\hello.txt');
  });

  it('test_sidebar_toggle', async () => {
    mockListDirectory.mockResolvedValue([]);

    render(<TabManager />);

    // Sidebar should not be visible initially
    expect(screen.queryByTestId('file-tree-sidebar')).not.toBeInTheDocument();

    // Press Ctrl+Shift+E to toggle sidebar
    await act(async () => {
      fireEvent.keyDown(document, { key: 'E', ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.getByTestId('file-tree-sidebar')).toBeInTheDocument();
    });

    // Press again to hide
    await act(async () => {
      fireEvent.keyDown(document, { key: 'E', ctrlKey: true, shiftKey: true });
    });

    await waitFor(() => {
      expect(screen.queryByTestId('file-tree-sidebar')).not.toBeInTheDocument();
    });
  });

  it('test_sidebar_hidden_by_default', () => {
    render(<TabManager />);
    expect(screen.queryByTestId('file-tree-sidebar')).not.toBeInTheDocument();
  });

  it('test_sidebar_resizable', async () => {
    mockListDirectory.mockResolvedValue([]);

    const mockOnResize = vi.fn();
    render(
      <FileTree
        rootPath="C:\\test\\project"
        onFileClick={vi.fn()}
        width={200}
        onResize={mockOnResize}
      />
    );

    const handle = screen.getByTestId('file-tree-resize-handle');
    expect(handle).toBeInTheDocument();

    // Simulate drag
    fireEvent.mouseDown(handle, { clientX: 200 });

    // The mouseMove listener is on document, so dispatch to document
    fireEvent.mouseMove(document, { clientX: 250 });
    fireEvent.mouseUp(document);

    expect(mockOnResize).toHaveBeenCalled();
  });
});
