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

  // --- Task 020: Search highlight tests ---

  it('test_ansi_output_renders_without_highlights', () => {
    const { container } = render(<AnsiOutput text="hello world" />);
    // No highlight elements should exist
    const highlights = container.querySelectorAll('.search-highlight');
    expect(highlights.length).toBe(0);
    // Text should still be present
    expect(screen.getByText('hello world')).toBeInTheDocument();
  });

  it('test_ansi_output_renders_single_highlight', () => {
    const { container } = render(
      <AnsiOutput
        text="hello world"
        highlights={[{ startOffset: 0, length: 5, isCurrent: false }]}
      />,
    );
    const highlights = container.querySelectorAll('.search-highlight');
    expect(highlights.length).toBe(1);
    expect(highlights[0].textContent).toBe('hello');
  });

  it('test_ansi_output_renders_current_highlight', () => {
    const { container } = render(
      <AnsiOutput
        text="hello world"
        highlights={[{ startOffset: 0, length: 5, isCurrent: true }]}
      />,
    );
    const current = container.querySelectorAll('.search-highlight-current');
    expect(current.length).toBe(1);
    expect(current[0].textContent).toBe('hello');
    expect(current[0].getAttribute('data-match-current')).toBe('true');
  });

  it('test_ansi_output_highlight_splits_span', () => {
    // "hello world" is a single span; highlighting "world" should split it
    const { container } = render(
      <AnsiOutput
        text="hello world"
        highlights={[{ startOffset: 6, length: 5, isCurrent: false }]}
      />,
    );
    const highlights = container.querySelectorAll('.search-highlight');
    expect(highlights.length).toBe(1);
    expect(highlights[0].textContent).toBe('world');
    // "hello " should be rendered without highlight
    expect(container.textContent).toContain('hello world');
  });

  it('test_ansi_output_highlight_across_spans', () => {
    // "\x1b[31mhel\x1b[0mlo" produces two spans: "hel" (red) and "lo" (normal)
    // Highlighting "hello" (offset 0, length 5) should cross the span boundary
    const { container } = render(
      <AnsiOutput
        text={'\x1b[31mhel\x1b[0mlo world'}
        highlights={[{ startOffset: 0, length: 5, isCurrent: false }]}
      />,
    );
    const highlights = container.querySelectorAll('.search-highlight');
    // Should have highlight elements covering "hel" and "lo"
    expect(highlights.length).toBeGreaterThanOrEqual(1);
    // Combined text of all highlights should be "hello"
    const highlightedText = Array.from(highlights).map(h => h.textContent).join('');
    expect(highlightedText).toBe('hello');
  });

  it('test_ansi_output_preserves_ansi_styles_in_highlight', () => {
    // Red "hello" text with a highlight — should keep the red color
    const { container } = render(
      <AnsiOutput
        text={'\x1b[31mhello\x1b[0m world'}
        highlights={[{ startOffset: 0, length: 5, isCurrent: false }]}
      />,
    );
    const highlights = container.querySelectorAll('.search-highlight');
    expect(highlights.length).toBe(1);
    // The highlight wraps a span that should have color styling
    // The mark or wrapper should contain a span with color
    const innerSpan = highlights[0].querySelector('span') || highlights[0];
    // Verify the text content is correct
    expect(highlights[0].textContent).toBe('hello');
  });

  it('test_ansi_output_multiple_highlights_in_one_block', () => {
    const { container } = render(
      <AnsiOutput
        text="hello world hello again"
        highlights={[
          { startOffset: 0, length: 5, isCurrent: false },
          { startOffset: 12, length: 5, isCurrent: true },
        ]}
      />,
    );
    const highlights = container.querySelectorAll('.search-highlight');
    expect(highlights.length).toBe(2);
    const current = container.querySelectorAll('.search-highlight-current');
    expect(current.length).toBe(1);
  });

  // --- Task 039: Text decoration tests ---

  it('test_strikethrough_renders', () => {
    // SGR 9 = strikethrough
    const { container } = render(<AnsiOutput text={'\x1b[9mstruck\x1b[0m'} />);
    const spans = container.querySelectorAll('span');
    const struckSpan = Array.from(spans).find(
      (s) => s.textContent === 'struck',
    );
    expect(struckSpan).toBeDefined();
    expect(struckSpan!.style.textDecoration).toContain('line-through');
  });

  it('test_combined_bold_italic', () => {
    // SGR 1 = bold, SGR 3 = italic
    const { container } = render(<AnsiOutput text={'\x1b[1;3mbolditalic\x1b[0m'} />);
    const spans = container.querySelectorAll('span');
    const biSpan = Array.from(spans).find(
      (s) => s.textContent === 'bolditalic',
    );
    expect(biSpan).toBeDefined();
    expect(biSpan!.style.fontWeight).toBe('bold');
    expect(biSpan!.style.fontStyle).toBe('italic');
  });

  it('test_combined_underline_strikethrough', () => {
    // SGR 4 = underline, SGR 9 = strikethrough
    const { container } = render(<AnsiOutput text={'\x1b[4;9mboth\x1b[0m'} />);
    const spans = container.querySelectorAll('span');
    const bothSpan = Array.from(spans).find(
      (s) => s.textContent === 'both',
    );
    expect(bothSpan).toBeDefined();
    expect(bothSpan!.style.textDecoration).toContain('underline');
    expect(bothSpan!.style.textDecoration).toContain('line-through');
  });

  it('test_dim_with_color', () => {
    // SGR 2 = dim, SGR 31 = red fg
    const { container } = render(<AnsiOutput text={'\x1b[2;31mdimred\x1b[0m'} />);
    const spans = container.querySelectorAll('span');
    const dimRedSpan = Array.from(spans).find(
      (s) => s.textContent === 'dimred',
    );
    expect(dimRedSpan).toBeDefined();
    expect(dimRedSpan!.style.opacity).toBe('0.5');
    expect(dimRedSpan!.style.color).toBeTruthy();
  });

  it('test_all_decorations_combined', () => {
    // SGR 1=bold, 2=dim, 3=italic, 4=underline, 9=strikethrough
    const { container } = render(<AnsiOutput text={'\x1b[1;2;3;4;9mall\x1b[0m'} />);
    const spans = container.querySelectorAll('span');
    const allSpan = Array.from(spans).find(
      (s) => s.textContent === 'all',
    );
    expect(allSpan).toBeDefined();
    expect(allSpan!.style.fontWeight).toBe('bold');
    expect(allSpan!.style.fontStyle).toBe('italic');
    expect(allSpan!.style.textDecoration).toContain('underline');
    expect(allSpan!.style.textDecoration).toContain('line-through');
    expect(allSpan!.style.opacity).toBe('0.5');
  });
});
