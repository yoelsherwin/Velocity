import { useEffect, useCallback } from 'react';

/**
 * Registers a `beforeunload` handler when `hasRunningProcesses` is true,
 * warning the user before they close the window while commands are still running.
 */
export function useQuitWarning(hasRunningProcesses: boolean): void {
  const handler = useCallback((e: BeforeUnloadEvent) => {
    e.preventDefault();
    // Setting returnValue to empty string is required by some browsers
    // to trigger the native "are you sure?" dialog.
    e.returnValue = '';
  }, []);

  useEffect(() => {
    if (hasRunningProcesses) {
      window.addEventListener('beforeunload', handler);
      return () => window.removeEventListener('beforeunload', handler);
    }
  }, [hasRunningProcesses, handler]);
}
