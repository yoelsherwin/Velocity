import { render } from '@testing-library/react';
import { describe, it, expect, vi, beforeAll } from 'vitest';
import type { Block } from '../lib/types';
import BlockView from '../components/blocks/BlockView';
import fs from 'fs';
import path from 'path';

// Mock clipboard API
const mockWriteText = vi.fn().mockResolvedValue(undefined);
Object.assign(navigator, {
  clipboard: {
    writeText: mockWriteText,
  },
});

// Inject App.css into jsdom so getComputedStyle works
beforeAll(() => {
  const cssPath = path.resolve(__dirname, '..', 'App.css');
  const css = fs.readFileSync(cssPath, 'utf-8');
  const style = document.createElement('style');
  style.textContent = css;
  document.head.appendChild(style);
});

describe('Sticky Command Header', () => {
  const baseBlock: Block = {
    id: 'block-1',
    command: 'dir',
    output: 'file1.txt\nfile2.txt\nfile3.txt',
    timestamp: new Date('2024-01-15T12:34:56').getTime(),
    status: 'completed',
    shellType: 'powershell',
    exitCode: 0,
  };

  const mockOnRerun = vi.fn();
  const mockOnToggleCollapse = vi.fn();

  it('test_block_header_has_sticky_position', () => {
    const { container } = render(
      <BlockView
        block={baseBlock}
        isActive={false}
        onRerun={mockOnRerun}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />,
    );
    const header = container.querySelector('.block-header') as HTMLElement;
    expect(header).toBeInTheDocument();
    const style = window.getComputedStyle(header);
    expect(style.position).toBe('sticky');
  });

  it('test_block_header_has_opaque_background', () => {
    const { container } = render(
      <BlockView
        block={baseBlock}
        isActive={false}
        onRerun={mockOnRerun}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />,
    );
    const header = container.querySelector('.block-header') as HTMLElement;
    expect(header).toBeInTheDocument();
    const style = window.getComputedStyle(header);
    // Background color should be set (not empty or transparent)
    expect(style.backgroundColor).toBeTruthy();
    expect(style.backgroundColor).not.toBe('');
    expect(style.backgroundColor).not.toBe('transparent');
  });

  it('test_block_header_has_z_index', () => {
    const { container } = render(
      <BlockView
        block={baseBlock}
        isActive={false}
        onRerun={mockOnRerun}
        isCollapsed={false}
        onToggleCollapse={mockOnToggleCollapse}
      />,
    );
    const header = container.querySelector('.block-header') as HTMLElement;
    expect(header).toBeInTheDocument();
    const style = window.getComputedStyle(header);
    const zIndex = parseInt(style.zIndex, 10);
    expect(zIndex).toBeGreaterThanOrEqual(10);
  });
});
