import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { stripAnsi } from '../lib/ansi';
import {
  detectSecrets,
  buildRedactedSegments,
  RedactedSegment,
  REVEAL_DURATION_MS,
} from '../lib/secretRedaction';

export interface SecretRedactionResult {
  /** Redacted segments for rendering */
  segments: RedactedSegment[];
  /** Set of currently revealed secret IDs */
  revealedIds: Set<string>;
  /** Toggle reveal for a secret by its secretId */
  revealSecret: (secretId: string) => void;
  /** Whether any secrets were detected */
  hasSecrets: boolean;
}

/**
 * Hook to detect and redact secrets in terminal output text.
 * Memoizes regex detection so it only runs when text changes.
 * Provides click-to-reveal with auto-hide after REVEAL_DURATION_MS.
 */
export function useSecretRedaction(text: string): SecretRedactionResult {
  const [revealedIds, setRevealedIds] = useState<Set<string>>(new Set());
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Memoize secret detection — only re-run when text changes
  const strippedText = useMemo(() => stripAnsi(text), [text]);
  const secrets = useMemo(() => detectSecrets(strippedText), [strippedText]);
  const segments = useMemo(
    () => buildRedactedSegments(strippedText, secrets),
    [strippedText, secrets],
  );

  const revealSecret = useCallback((secretId: string) => {
    setRevealedIds((prev) => {
      const next = new Set(prev);
      next.add(secretId);
      return next;
    });

    // Clear existing timer for this secret if any
    const existing = timersRef.current.get(secretId);
    if (existing) clearTimeout(existing);

    // Auto-hide after timeout
    const timer = setTimeout(() => {
      setRevealedIds((prev) => {
        const next = new Set(prev);
        next.delete(secretId);
        return next;
      });
      timersRef.current.delete(secretId);
    }, REVEAL_DURATION_MS);

    timersRef.current.set(secretId, timer);
  }, []);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      timersRef.current.forEach((timer) => clearTimeout(timer));
      timersRef.current.clear();
    };
  }, []);

  return {
    segments,
    revealedIds,
    revealSecret,
    hasSecrets: secrets.length > 0,
  };
}
