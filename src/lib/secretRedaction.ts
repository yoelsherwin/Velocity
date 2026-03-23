/**
 * Secret redaction utility for terminal output.
 *
 * Detects common secret patterns (API keys, tokens, passwords, connection strings)
 * and returns segments with redaction markers. The original text is never modified —
 * redaction is display-layer only.
 */

export const MASK_CHAR = '\u2022'; // bullet •
export const MASK_TEXT = MASK_CHAR.repeat(8); // ••••••••
export const REVEAL_DURATION_MS = 3000;

/** A segment of text that may be redacted. */
export interface RedactedSegment {
  /** The display text (masked or original) */
  text: string;
  /** Original secret value, present only for masked segments */
  originalValue?: string;
  /** Unique key for this secret occurrence (for click-to-reveal tracking) */
  secretId?: string;
  /** Whether this segment is a redacted secret */
  isSecret: boolean;
}

/**
 * UUID pattern — used to exclude from generic hex detection.
 * Standard UUID: 8-4-4-4-12 hex chars with dashes.
 */
const UUID_PATTERN = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/**
 * Git hash pattern — 40 hex chars that look like a git commit SHA.
 * Must be preceded by whitespace, line start, or common git-context chars,
 * and followed by whitespace, line end, or common delimiters.
 */
const GIT_HASH_PATTERN = /(?:^|[\s(])[0-9a-f]{40}(?=[\s)\].,;:]|$)/gm;

/**
 * Patterns that detect secrets. Each pattern has:
 * - regex: the detection regex
 * - group: which capture group contains the secret value to mask (0 = full match)
 * - name: identifier for the pattern type
 */
interface SecretPattern {
  regex: RegExp;
  /** Which capture group is the secret value (0 = full match) */
  secretGroup: number;
  name: string;
}

const SECRET_PATTERNS: SecretPattern[] = [
  // OpenAI API keys: sk-... (at least 20 alphanumeric chars after prefix)
  {
    regex: /sk-[a-zA-Z0-9]{20,}/g,
    secretGroup: 0,
    name: 'openai-key',
  },
  // AWS Access Key IDs: AKIA followed by 16 uppercase alphanumeric
  {
    regex: /AKIA[A-Z0-9]{16}/g,
    secretGroup: 0,
    name: 'aws-key',
  },
  // GitHub Personal Access Tokens: ghp_ followed by 36 alphanumeric
  {
    regex: /ghp_[a-zA-Z0-9]{36}/g,
    secretGroup: 0,
    name: 'github-pat',
  },
  // GitHub fine-grained PATs
  {
    regex: /github_pat_[a-zA-Z0-9_]{20,}/g,
    secretGroup: 0,
    name: 'github-fine-pat',
  },
  // Slack tokens: xoxb-, xoxp-, xoxa-, xoxr-
  {
    regex: /xox[bpar]-[a-zA-Z0-9-]+/g,
    secretGroup: 0,
    name: 'slack-token',
  },
  // Connection string passwords: ://user:password@host
  // Capture group 1 = password
  {
    regex: /:\/\/[^:/?#\s]+:([^@\s]{2,})@/g,
    secretGroup: 1,
    name: 'connection-string-password',
  },
  // Environment variable secrets: COMMON_SECRET_NAME=value
  // Captures the value after the = sign
  {
    regex: /(?:API_KEY|SECRET|TOKEN|PASSWORD|PRIVATE_KEY|ACCESS_KEY|SECRET_KEY|AUTH)=([^\s]{2,})/g,
    secretGroup: 1,
    name: 'env-secret',
  },
];

/** Positions to exclude from redaction (UUIDs, git hashes, file paths). */
interface ExcludedRange {
  start: number;
  end: number;
}

function findExcludedRanges(text: string): ExcludedRange[] {
  const excluded: ExcludedRange[] = [];

  // Exclude UUIDs
  UUID_PATTERN.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = UUID_PATTERN.exec(text)) !== null) {
    excluded.push({ start: match.index, end: match.index + match[0].length });
  }

  // Exclude git hashes (40-char hex preceded/followed by boundaries)
  GIT_HASH_PATTERN.lastIndex = 0;
  while ((match = GIT_HASH_PATTERN.exec(text)) !== null) {
    // The match may include a leading space/paren, so find the hex part
    const fullMatch = match[0];
    const hexStart = match.index + fullMatch.search(/[0-9a-f]{40}/i);
    excluded.push({ start: hexStart, end: hexStart + 40 });
  }

  return excluded;
}

function isInExcludedRange(pos: number, length: number, excluded: ExcludedRange[]): boolean {
  const end = pos + length;
  for (const range of excluded) {
    // Check if the detected secret overlaps significantly with an excluded range
    if (pos >= range.start && end <= range.end) return true;
    // Secret is mostly within excluded range
    const overlapStart = Math.max(pos, range.start);
    const overlapEnd = Math.min(end, range.end);
    if (overlapEnd > overlapStart) {
      const overlap = overlapEnd - overlapStart;
      if (overlap >= length * 0.5) return true;
    }
  }
  return false;
}

interface DetectedSecret {
  /** Start position of the text to mask in the input string */
  start: number;
  /** End position (exclusive) of the text to mask */
  end: number;
  /** The original secret value */
  value: string;
  /** Pattern name */
  name: string;
}

/**
 * Detect secrets in plain text. Returns sorted, non-overlapping secret ranges.
 */
export function detectSecrets(text: string): DetectedSecret[] {
  const excluded = findExcludedRanges(text);
  const secrets: DetectedSecret[] = [];

  for (const pattern of SECRET_PATTERNS) {
    pattern.regex.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = pattern.regex.exec(text)) !== null) {
      let secretValue: string;
      let secretStart: number;

      if (pattern.secretGroup > 0 && match[pattern.secretGroup] !== undefined) {
        secretValue = match[pattern.secretGroup];
        // Calculate the start position of the capture group within the full match
        const groupOffset = match[0].indexOf(secretValue);
        secretStart = match.index + groupOffset;
      } else {
        secretValue = match[0];
        secretStart = match.index;
      }

      if (!isInExcludedRange(secretStart, secretValue.length, excluded)) {
        secrets.push({
          start: secretStart,
          end: secretStart + secretValue.length,
          value: secretValue,
          name: pattern.name,
        });
      }
    }
  }

  // Sort by start position and remove overlaps
  secrets.sort((a, b) => a.start - b.start);

  // Remove overlapping detections (keep earlier / longer)
  const deduped: DetectedSecret[] = [];
  for (const secret of secrets) {
    if (deduped.length === 0 || secret.start >= deduped[deduped.length - 1].end) {
      deduped.push(secret);
    }
  }

  return deduped;
}

/**
 * Build redacted segments from text and detected secrets.
 * Each secret gets a unique secretId based on its position.
 */
export function buildRedactedSegments(text: string, secrets: DetectedSecret[]): RedactedSegment[] {
  if (secrets.length === 0) {
    return [{ text, isSecret: false }];
  }

  const segments: RedactedSegment[] = [];
  let pos = 0;

  for (let i = 0; i < secrets.length; i++) {
    const secret = secrets[i];

    // Non-secret text before this secret
    if (secret.start > pos) {
      segments.push({
        text: text.slice(pos, secret.start),
        isSecret: false,
      });
    }

    // The secret itself
    segments.push({
      text: MASK_TEXT,
      originalValue: secret.value,
      secretId: `secret-${secret.start}-${secret.end}`,
      isSecret: true,
    });

    pos = secret.end;
  }

  // Remaining text after last secret
  if (pos < text.length) {
    segments.push({
      text: text.slice(pos),
      isSecret: false,
    });
  }

  return segments;
}

/**
 * Apply masking to a full text string, returning the masked version.
 * Used for clipboard copy operations.
 */
export function maskSecrets(text: string): string {
  const secrets = detectSecrets(text);
  if (secrets.length === 0) return text;

  let result = '';
  let pos = 0;

  for (const secret of secrets) {
    result += text.slice(pos, secret.start);
    result += MASK_TEXT;
    pos = secret.end;
  }

  result += text.slice(pos);
  return result;
}
