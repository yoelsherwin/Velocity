export type InputIntent = 'cli' | 'natural_language';

export interface ClassificationResult {
    intent: InputIntent;
    confidence: 'high' | 'low';
}

/**
 * Classifies user input as either a CLI command or natural language.
 *
 * Uses structural analysis (flags, pipes, paths, PowerShell Verb-Noun),
 * known-command lookup, and NL pattern detection to determine intent.
 * Returns both the intent and a confidence level.
 *
 * Designed to run on every input change (<1ms).
 */
export function classifyIntent(input: string, knownCommands: Set<string>): ClassificationResult {
    const trimmed = input.trim();

    // Explicit # trigger — always NL, high confidence
    if (trimmed.startsWith('#')) return { intent: 'natural_language', confidence: 'high' };

    // Empty — CLI
    if (!trimmed) return { intent: 'cli', confidence: 'high' };

    const firstToken = trimmed.split(/\s+/)[0].toLowerCase();
    const words = trimmed.split(/\s+/);

    // === CLI signals (high confidence) ===

    // Flags: -x, --flag
    if (/\s-{1,2}\w/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Pipes and redirects
    if (/[|<>]/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Starts with path: ./ ../ ~/ C:\ /
    if (/^[.~\/\\]|^[a-zA-Z]:[\/\\]/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // Assignment: VAR=value
    if (/^\w+=/.test(trimmed)) return { intent: 'cli', confidence: 'high' };

    // PowerShell Verb-Noun pattern: Get-ChildItem, Set-Location, etc.
    if (/^[A-Z][a-z]+-[A-Z][a-z]+/.test(trimmed.split(/\s/)[0])) return { intent: 'cli', confidence: 'high' };

    // First token is a known command from PATH
    if (knownCommands.has(firstToken)) return { intent: 'cli', confidence: 'high' };

    // === NL signals ===

    // Question words
    const questionStarters = ['what', 'how', 'where', 'when', 'why', 'can', 'could', 'would', 'is', 'are', 'do', 'does'];
    if (questionStarters.includes(firstToken)) return { intent: 'natural_language', confidence: 'high' };

    // Polite/request patterns
    if (['please', 'help'].includes(firstToken)) return { intent: 'natural_language', confidence: 'high' };

    // Contains articles/prepositions (strong NL signal) + 4+ words
    const hasArticles = /\b(the|a|an|all|my|this|that|every|some|any)\b/i.test(trimmed);
    if (words.length >= 4 && hasArticles) return { intent: 'natural_language', confidence: 'high' };

    // Action verbs that aren't known commands + multi-word
    const nlVerbs = ['show', 'list', 'create', 'delete', 'remove', 'search', 'look', 'check',
                     'tell', 'give', 'open', 'close', 'rename', 'download', 'deploy', 'configure',
                     'setup', 'reset', 'fix', 'debug', 'explain', 'describe', 'count'];
    if (words.length >= 3 && nlVerbs.includes(firstToken) && !knownCommands.has(firstToken)) {
        return { intent: 'natural_language', confidence: 'high' };
    }

    // === Ambiguous zone ===

    // Multi-word without any CLI artifacts — lean NL but low confidence
    if (words.length >= 3 && !knownCommands.has(firstToken)) {
        return { intent: 'natural_language', confidence: 'low' };
    }

    // Short unknown input — lean CLI but low confidence
    if (!knownCommands.has(firstToken) && words.length <= 2) {
        return { intent: 'cli', confidence: 'low' };
    }

    // Default: CLI, high confidence
    return { intent: 'cli', confidence: 'high' };
}

/**
 * Strips the leading `#` prefix (and optional space) from input.
 */
export function stripHashPrefix(input: string): string {
  return input.replace(/^#\s*/, '');
}
