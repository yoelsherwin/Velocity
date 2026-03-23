import React, { useState, useEffect, useCallback } from 'react';
import { suggestFix, type FixSuggestion } from '../../lib/llm';

interface ErrorSuggestionProps {
  command: string;
  exitCode: number;
  output: string;
  shellType: string;
  cwd: string;
  hasApiKey: boolean;
  onUseFix: (command: string) => void;
}

function ErrorSuggestion({
  command,
  exitCode,
  output,
  shellType,
  cwd,
  hasApiKey,
  onUseFix,
}: ErrorSuggestionProps) {
  const [suggestion, setSuggestion] = useState<FixSuggestion | null>(null);
  const [loading, setLoading] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Only trigger for non-zero exit codes when API key is configured
    if (exitCode === 0 || !hasApiKey || !command) return;

    let cancelled = false;
    setLoading(true);
    setSuggestion(null);
    setDismissed(false);

    // Truncate output to last 2000 chars before sending
    const truncatedOutput = output.length > 2000 ? output.slice(-2000) : output;

    suggestFix(command, exitCode, truncatedOutput, shellType, cwd)
      .then((result) => {
        if (cancelled) return;
        // Only show if we got a non-empty suggested command
        if (result.suggested_command) {
          setSuggestion(result);
        }
      })
      .catch(() => {
        // Silently hide on failure
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [command, exitCode, output, shellType, cwd, hasApiKey]);

  const handleUse = useCallback(() => {
    if (suggestion) {
      onUseFix(suggestion.suggested_command);
    }
  }, [suggestion, onUseFix]);

  const handleDismiss = useCallback(() => {
    setDismissed(true);
  }, []);

  if (dismissed || (!loading && !suggestion)) {
    return null;
  }

  if (loading) {
    return (
      <div className="error-suggestion error-suggestion-loading" data-testid="error-suggestion-loading">
        <span className="error-suggestion-spinner">&#x27F3;</span>
        Analyzing error...
      </div>
    );
  }

  return (
    <div className="error-suggestion" data-testid="error-suggestion">
      <span className="error-suggestion-label">Did you mean:</span>
      <code className="error-suggestion-command" data-testid="error-suggestion-command">
        {suggestion!.suggested_command}
      </code>
      {suggestion!.explanation && (
        <span className="error-suggestion-explanation">
          {suggestion!.explanation}
        </span>
      )}
      <button
        className="error-suggestion-btn error-suggestion-use"
        data-testid="error-suggestion-use"
        onClick={handleUse}
      >
        Use
      </button>
      <button
        className="error-suggestion-btn error-suggestion-dismiss"
        data-testid="error-suggestion-dismiss"
        onClick={handleDismiss}
      >
        Dismiss
      </button>
    </div>
  );
}

export default React.memo(ErrorSuggestion);
