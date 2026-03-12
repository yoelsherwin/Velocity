import { render, screen } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

vi.mock('../lib/pty', () => ({
  createSession: vi.fn().mockResolvedValue('test-session-id'),
  writeToSession: vi.fn().mockResolvedValue(undefined),
  closeSession: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn().mockResolvedValue(vi.fn()),
}));

import AnsiOutput from '../components/AnsiOutput';

describe('AnsiOutput Component', () => {
  it('test_AnsiOutput_renders_plain_text', () => {
    render(<AnsiOutput text="hello world" />);
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('test_AnsiOutput_renders_colored_span', () => {
    const { container } = render(<AnsiOutput text={'\x1b[31mred text\x1b[0m'} />);
    // Should find a span element containing "red text"
    const spans = container.querySelectorAll('span');
    const redSpan = Array.from(spans).find(
      (s) => s.textContent === 'red text',
    );
    expect(redSpan).toBeDefined();
    // Should have a color style set
    expect(redSpan!.style.color).toBeTruthy();
  });
});
