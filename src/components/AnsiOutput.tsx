import React, { useMemo } from 'react';
import { useIncrementalAnsi } from '../hooks/useIncrementalAnsi';
import { AnsiSpan } from '../lib/ansi';
import { RedactedSegment, MASK_TEXT } from '../lib/secretRedaction';

export interface HighlightRange {
  startOffset: number;
  length: number;
  isCurrent: boolean;
}

interface AnsiOutputProps {
  text: string;
  highlights?: HighlightRange[];
  /** Redacted segments from useSecretRedaction. When provided, secrets are masked in rendering. */
  redactedSegments?: RedactedSegment[];
  /** Set of secret IDs that are currently revealed (click-to-reveal). */
  revealedSecretIds?: Set<string>;
  /** Callback when a masked secret is clicked to reveal it. */
  onRevealSecret?: (secretId: string) => void;
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

/**
 * Build a map from the redacted segments: for each secret, record
 * its start offset, end offset, secretId, and originalValue.
 */
interface SecretRange {
  start: number;
  end: number;
  secretId: string;
  originalValue: string;
}

function buildSecretRanges(redactedSegments: RedactedSegment[]): SecretRange[] {
  const ranges: SecretRange[] = [];
  let offset = 0;
  for (const seg of redactedSegments) {
    if (seg.isSecret && seg.secretId && seg.originalValue) {
      ranges.push({
        start: offset,
        end: offset + seg.originalValue.length,
        secretId: seg.secretId,
        originalValue: seg.originalValue,
      });
      offset += seg.originalValue.length;
    } else {
      offset += seg.text.length;
    }
  }
  return ranges;
}

interface RedactedRenderSegment extends RenderSegment {
  /** If this segment is a masked secret */
  secretId?: string;
  /** The original secret value */
  originalValue?: string;
}

/**
 * Apply secret redaction to render segments. Replaces secret character
 * ranges with masked text spans.
 */
function applyRedaction(
  renderSegments: RenderSegment[],
  secretRanges: SecretRange[],
): RedactedRenderSegment[] {
  if (secretRanges.length === 0) return renderSegments;

  const result: RedactedRenderSegment[] = [];
  let charOffset = 0;
  let sIdx = 0;

  for (const seg of renderSegments) {
    const segStart = charOffset;
    const segEnd = charOffset + seg.content.length;
    let pos = 0;

    while (sIdx < secretRanges.length && pos < seg.content.length) {
      const s = secretRanges[sIdx];

      if (s.end <= segStart + pos) {
        sIdx++;
        continue;
      }

      if (s.start >= segEnd) {
        break;
      }

      // Overlap: emit non-secret part before
      const overlapStart = Math.max(s.start, segStart + pos) - segStart;
      if (overlapStart > pos) {
        result.push({
          content: seg.content.slice(pos, overlapStart),
          style: seg.style,
          highlightClass: seg.highlightClass,
          isCurrent: seg.isCurrent,
        });
      }

      // Emit the masked secret (only on first span that touches this secret)
      if (s.start >= segStart + pos || pos === 0) {
        const overlapEnd = Math.min(s.end, segEnd) - segStart;
        // Only emit the mask once per secret (when we first encounter it)
        if (segStart + overlapStart <= s.start + 1) {
          result.push({
            content: MASK_TEXT,
            style: seg.style,
            secretId: s.secretId,
            originalValue: s.originalValue,
          });
        }
        pos = overlapEnd;
      }

      if (s.end <= segEnd) {
        sIdx++;
      } else {
        break;
      }
    }

    if (pos < seg.content.length) {
      result.push({
        content: seg.content.slice(pos),
        style: seg.style,
        highlightClass: seg.highlightClass,
        isCurrent: seg.isCurrent,
      });
    }

    charOffset = segEnd;
  }

  return result;
}

function AnsiOutput({ text, highlights, redactedSegments, revealedSecretIds, onRevealSecret }: AnsiOutputProps) {
  const spans = useIncrementalAnsi(text);

  const secretRanges = useMemo(() => {
    if (!redactedSegments || redactedSegments.length === 0) return [];
    return buildSecretRanges(redactedSegments);
  }, [redactedSegments]);

  const hasSecrets = secretRanges.length > 0;

  const segments = useMemo(() => {
    if ((!highlights || highlights.length === 0) && !hasSecrets) {
      return null; // Use fast path (render spans directly)
    }
    // Build base render segments (with highlights if applicable)
    const baseSegments = (!highlights || highlights.length === 0)
      ? spans.map((span) => ({
          content: span.content,
          style: spanStyle(span),
        }))
      : buildSegments(spans, highlights);

    // Apply redaction
    if (hasSecrets) {
      return applyRedaction(baseSegments, secretRanges);
    }
    return baseSegments as RedactedRenderSegment[];
  }, [spans, highlights, hasSecrets, secretRanges]);

  // Fast path: no highlights and no secrets — render spans directly
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

  // Render segments with highlights and/or redaction
  return (
    <>
      {segments.map((seg, i) => {
        const rSeg = seg as RedactedRenderSegment;

        // Secret segment — render as masked or revealed
        if (rSeg.secretId) {
          const isRevealed = revealedSecretIds?.has(rSeg.secretId) ?? false;
          const displayText = isRevealed ? rSeg.originalValue ?? rSeg.content : rSeg.content;

          return (
            <span
              key={i}
              className={`secret-mask ${isRevealed ? 'secret-revealed' : ''}`}
              data-testid="secret-mask"
              data-secret-id={rSeg.secretId}
              style={rSeg.style}
              onClick={() => onRevealSecret?.(rSeg.secretId!)}
              role="button"
              tabIndex={0}
              title={isRevealed ? undefined : 'Click to reveal secret (3s)'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  onRevealSecret?.(rSeg.secretId!);
                }
              }}
            >
              {displayText}
            </span>
          );
        }

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
  if (prev.redactedSegments !== next.redactedSegments) return false;
  if (prev.revealedSecretIds !== next.revealedSecretIds) return false;
  if (prev.onRevealSecret !== next.onRevealSecret) return false;
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
