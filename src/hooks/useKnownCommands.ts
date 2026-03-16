import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';

/**
 * Fetches the list of known commands from the Rust backend (PATH scan + builtins).
 * Called once on mount, result cached in state.
 *
 * Returns an empty set on failure — the classifier still works via structural signals.
 */
export function useKnownCommands(): Set<string> {
    const [commands, setCommands] = useState<Set<string>>(new Set());

    useEffect(() => {
        invoke<string[]>('get_known_commands')
            .then(cmds => setCommands(new Set(cmds)))
            .catch(() => setCommands(new Set())); // Fallback: empty set
    }, []);

    return commands;
}
