import { render, screen, fireEvent, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';
import { MASK_TEXT } from '../lib/secretRedaction';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

describe('Secret Redaction Integration', () => {
  const mockOnRerun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('test_renders_masked_secret_in_output', () => {
    const block: Block = {
      id: 'b1',
      command: 'echo $API_KEY',
      output: 'API_KEY=mysecretvalue123',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);
    const output = screen.getByTestId('block-output');
    // The secret value should be masked
    expect(output.textContent).toContain(MASK_TEXT);
    expect(output.textContent).not.toContain('mysecretvalue123');
    // The key name should still be visible
    expect(output.textContent).toContain('API_KEY=');
  });

  it('test_click_reveals_secret', () => {
    const block: Block = {
      id: 'b2',
      command: 'env',
      output: 'API_KEY=mysecretvalue123',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);

    const maskedEl = screen.getByTestId('secret-mask');
    expect(maskedEl.textContent).toBe(MASK_TEXT);

    // Click to reveal
    act(() => {
      fireEvent.click(maskedEl);
    });
    expect(maskedEl.textContent).toBe('mysecretvalue123');
    expect(maskedEl.classList.contains('secret-revealed')).toBe(true);
  });

  it('test_reveal_auto_hides', () => {
    const block: Block = {
      id: 'b3',
      command: 'env',
      output: 'API_KEY=mysecretvalue123',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);

    const maskedEl = screen.getByTestId('secret-mask');

    act(() => {
      fireEvent.click(maskedEl);
    });
    expect(maskedEl.textContent).toBe('mysecretvalue123');

    // After 3 seconds, should re-mask
    act(() => {
      vi.advanceTimersByTime(3100);
    });
    expect(maskedEl.textContent).toBe(MASK_TEXT);
  });

  it('test_copy_output_copies_masked', () => {
    const block: Block = {
      id: 'b4',
      command: 'env',
      output: 'API_KEY=mysecretvalue123',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);

    const copyBtn = screen.getByText('Copy Output');
    fireEvent.click(copyBtn);

    expect(mockWriteText).toHaveBeenCalledWith(`API_KEY=${MASK_TEXT}`);
  });

  it('test_copy_raw_copies_unmasked', () => {
    const block: Block = {
      id: 'b5',
      command: 'env',
      output: 'API_KEY=mysecretvalue123',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);

    const copyRawBtn = screen.getByText('Copy Raw');
    fireEvent.click(copyRawBtn);

    expect(mockWriteText).toHaveBeenCalledWith('API_KEY=mysecretvalue123');
  });

  it('test_no_masking_for_clean_output', () => {
    const block: Block = {
      id: 'b6',
      command: 'dir',
      output: 'file1.txt\nfile2.txt',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);
    const output = screen.getByTestId('block-output');
    expect(output.textContent).toContain('file1.txt');
    expect(output.textContent).not.toContain(MASK_TEXT);
  });

  it('test_git_hashes_not_masked', () => {
    const block: Block = {
      id: 'b7',
      command: 'git log',
      output: 'commit abc0123456789abcdef0123456789abcdef012345\nAuthor: test',
      timestamp: Date.now(),
      status: 'completed',
      shellType: 'powershell',
    };
    render(<BlockView block={block} isActive={false} onRerun={mockOnRerun} />);
    const output = screen.getByTestId('block-output');
    expect(output.textContent).toContain('abc0123456789abcdef0123456789abcdef012345');
    expect(output.textContent).not.toContain(MASK_TEXT);
  });
});
