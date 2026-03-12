import React, { useMemo } from 'react';
import { parseAnsi } from '../lib/ansi';

interface AnsiOutputProps {
  text: string;
}

function AnsiOutput({ text }: AnsiOutputProps) {
  const spans = useMemo(() => parseAnsi(text), [text]);
  return (
    <>
      {spans.map((span, i) => (
        <span
          key={i}
          style={{
            color: span.fg,
            backgroundColor: span.bg,
            fontWeight: span.bold ? 'bold' : undefined,
            fontStyle: span.italic ? 'italic' : undefined,
            textDecoration: span.underline ? 'underline' : undefined,
            opacity: span.dim ? 0.5 : undefined,
          }}
        >
          {span.content}
        </span>
      ))}
    </>
  );
}

export default React.memo(AnsiOutput);
