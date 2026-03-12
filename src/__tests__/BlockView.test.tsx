import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

describe('BlockView Component', () => {
  const baseBlock: Block = {
    id: 'block-1',
    command: 'dir',
    output: 'file1.txt\nfile2.txt',
    timestamp: new Date('2024-01-15T12:34:56').getTime(),
    status: 'completed',
    shellType: 'powershell',
  };

  const mockOnRerun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('test_BlockView_renders_command', () => {
    render(<BlockView block={baseBlock} isActive={false} onRerun={mockOnRerun} />);
    expect(screen.getByText('dir')).toBeInTheDocument();
  });

  it('test_BlockView_renders_output', () => {
    render(<BlockView block={baseBlock} isActive={false} onRerun={mockOnRerun} />);
    // AnsiOutput renders spans from the output text
    expect(screen.getByTestId('block-output')).toHaveTextContent('file1.txt');
    expect(screen.getByTestId('block-output')).toHaveTextContent('file2.txt');
  });

  it('test_BlockView_renders_timestamp', () => {
    render(<BlockView block={baseBlock} isActive={false} onRerun={mockOnRerun} />);
    // The timestamp should be formatted as a time string
    const timeStr = new Date(baseBlock.timestamp).toLocaleTimeString();
    expect(screen.getByText(timeStr)).toBeInTheDocument();
  });

  it('test_BlockView_hides_header_for_welcome_block', () => {
    const welcomeBlock: Block = {
      ...baseBlock,
      id: 'welcome-block',
      command: '',
    };
    const { container } = render(
      <BlockView block={welcomeBlock} isActive={false} onRerun={mockOnRerun} />,
    );
    // No block-header should be rendered for welcome block
    expect(container.querySelector('.block-header')).not.toBeInTheDocument();
  });

  it('test_BlockView_shows_running_indicator', () => {
    const runningBlock: Block = {
      ...baseBlock,
      status: 'running',
    };
    const { container } = render(
      <BlockView block={runningBlock} isActive={true} onRerun={mockOnRerun} />,
    );
    expect(container.querySelector('.block-running-indicator')).toBeInTheDocument();
  });

  it('test_BlockView_copy_command_button', async () => {
    render(<BlockView block={baseBlock} isActive={false} onRerun={mockOnRerun} />);
    const copyBtn = screen.getByText('Copy Command');
    fireEvent.click(copyBtn);
    expect(mockWriteText).toHaveBeenCalledWith('dir');
  });

  it('test_BlockView_rerun_calls_handler', () => {
    render(<BlockView block={baseBlock} isActive={false} onRerun={mockOnRerun} />);
    const rerunBtn = screen.getByText('Rerun');
    fireEvent.click(rerunBtn);
    expect(mockOnRerun).toHaveBeenCalledWith('dir');
  });
});
