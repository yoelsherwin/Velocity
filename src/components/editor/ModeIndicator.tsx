interface ModeIndicatorProps {
    intent: 'cli' | 'natural_language';
    confidence: 'high' | 'low';
    onToggle: () => void;
    disabled?: boolean;
    autoDetected?: boolean;
}

function ModeIndicator({ intent, confidence, onToggle, disabled, autoDetected }: ModeIndicatorProps) {
    const isAI = intent === 'natural_language';
    const isUncertain = confidence === 'low';

    let label: string;
    if (isAI) {
        label = isUncertain ? 'AI?' : 'AI';
    } else {
        label = isUncertain ? 'CLI?' : 'CLI';
    }

    const classes = [
        'mode-indicator',
        isAI ? 'mode-indicator-ai' : 'mode-indicator-cli',
        isUncertain ? 'mode-indicator-uncertain' : '',
        autoDetected ? 'mode-indicator-flash' : '',
    ]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            className={classes}
            data-testid="mode-indicator"
            onClick={disabled ? undefined : onToggle}
            type="button"
            aria-label={`Mode: ${label}. Click to toggle.`}
        >
            {label}
        </button>
    );
}

export default ModeIndicator;
