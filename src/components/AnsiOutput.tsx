import React, { useMemo } from 'react';
import { useIncrementalAnsi } from '../hooks/useIncrementalAnsi';
import { AnsiSpan } from '../lib/ansi';

export interface HighlightRange {
  startOffset: number;
  length: number;
  isCurrent: boolean;
}

interface AnsiOutputProps {
  text: string;
  highlights?: HighlightRange[];
}

/** Style object for a single ANSI span */
function spanStyle(span: AnsiSpan): React.CSSProperties {
  return {
    color: span.fg,
    backgroundColor: span.bg,
    fontWeight: span.bold ? 'bold' : undefined,
    fontStyle: span.italic ? 'italic' : undefined,
    textDecoration: span.underline ? 'underline' : undefined,
    opacity: span.dim ? 0.5 : undefined,
  };
}

interface RenderSegment {
  content: string;
  style: React.CSSProperties;
  highlightClass?: string;
  isCurrent?: boolean;
}

/**
 * Split ANSI spans at highlight boundaries and return a flat list of
 * render segments, each annotated with optional highlight class.
 */
function buildSegments(
  spans: AnsiSpan[],
  highlights: HighlightRange[],
): RenderSegment[] {
  if (highlights.length === 0) {
    return spans.map((span) => ({
      content: span.content,
      style: spanStyle(span),
    }));
  }

  // Sort highlights by startOffset
  const sorted = [...highlights].sort((a, b) => a.startOffset - b.startOffset);

  const segments: RenderSegment[] = [];
  let charOffset = 0; // cumulative char offset in stripped text
  let hIdx = 0; // index into sorted highlights

  for (const span of spans) {
    const style = spanStyle(span);
    const spanStart = charOffset;
    const spanEnd = charOffset + span.content.length;
    let pos = 0; // position within this span's content

    // Process all highlights that overlap with this span
    while (hIdx < sorted.length && pos < span.content.length) {
      const h = sorted[hIdx];
      const hStart = h.startOffset;
      const hEnd = h.startOffset + h.length;

      // If the highlight is entirely before this span position, skip it
      if (hEnd <= spanStart + pos) {
        hIdx++;
        continue;
      }

      // If the highlight starts after this span ends, stop for this span
      if (hStart >= spanEnd) {
        break;
      }

      // There is overlap. First, emit any content before the highlight
      const overlapStart = Math.max(hStart, spanStart + pos) - spanStart;
      if (overlapStart > pos) {
        segments.push({
          content: span.content.slice(pos, overlapStart),
          style,
        });
      }

      // Emit the highlighted portion
      const overlapEnd = Math.min(hEnd, spanEnd) - spanStart;
      const highlightClass = h.isCurrent
        ? 'search-highlight search-highlight-current'
        : 'search-highlight';

      segments.push({
        content: span.content.slice(overlapStart, overlapEnd),
        style,
        highlightClass,
        isCurrent: h.isCurrent,
      });

      pos = overlapEnd;

      // If the highlight extends beyond this span, don't advance hIdx
      if (hEnd > spanEnd) {
        break;
      }

      // Highlight is fully consumed within this span
      hIdx++;
    }

    // Emit remaining content after all highlights for this span
    if (pos < span.content.length) {
      segments.push({
        content: span.content.slice(pos),
        style,
      });
    }

    charOffset = spanEnd;
  }

  return segments;
}

function AnsiOutput({ text, highlights }: AnsiOutputProps) {
  const spans = useIncrementalAnsi(text);

  const segments = useMemo(() => {
    if (!highlights || highlights.length === 0) {
      return null; // Use fast path (render spans directly)
    }
    return buildSegments(spans, highlights);
  }, [spans, highlights]);

  // Fast path: no highlights — render spans directly (same as before)
  if (!segments) {
    return (
      <>
        {spans.map((span, i) => (
          <span key={i} style={spanStyle(span)}>
            {span.content}
          </span>
        ))}
      </>
    );
  }

  // Highlight path: render segments with highlight wrappers
  return (
    <>
      {segments.map((seg, i) => {
        if (seg.highlightClass) {
          return (
            <mark
              key={i}
              className={seg.highlightClass}
              data-match-current={seg.isCurrent ? 'true' : undefined}
            >
              <span style={seg.style}>{seg.content}</span>
            </mark>
          );
        }
        return (
          <span key={i} style={seg.style}>
            {seg.content}
          </span>
        );
      })}
    </>
  );
}

export default React.memo(AnsiOutput, (prev, next) => {
  if (prev.text !== next.text) return false;
  if (prev.highlights === next.highlights) return true;
  // If one is undefined/empty and the other is too, consider them equal
  const prevEmpty = !prev.highlights || prev.highlights.length === 0;
  const nextEmpty = !next.highlights || next.highlights.length === 0;
  if (prevEmpty && nextEmpty) return true;
  if (prevEmpty !== nextEmpty) return false;
  // Shallow comparison of highlight elements
  const prevH = prev.highlights!;
  const nextH = next.highlights!;
  if (prevH.length !== nextH.length) return false;
  for (let i = 0; i < prevH.length; i++) {
    if (prevH[i].startOffset !== nextH[i].startOffset
      || prevH[i].length !== nextH[i].length
      || prevH[i].isCurrent !== nextH[i].isCurrent) return false;
  }
  return true;
});
