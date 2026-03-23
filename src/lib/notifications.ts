/**
 * Desktop notification support for long-running command completion.
 *
 * Uses the Web Notification API (supported by Tauri's WebView2).
 */

/** Minimum command duration (ms) before a notification is shown. */
export const NOTIFICATION_THRESHOLD_MS = 10_000;

/** Maximum command text length shown in the notification body. */
export const MAX_BODY_LENGTH = 80;

/**
 * Truncate a command string to `maxLen` characters, appending "..." if truncated.
 */
export function truncateCommand(command: string, maxLen: number = MAX_BODY_LENGTH): string {
  if (command.length <= maxLen) return command;
  return command.slice(0, maxLen) + '...';
}

/**
 * Build a notification title based on the exit code.
 */
export function getNotificationTitle(exitCode: number | null | undefined): string {
  if (exitCode === 0 || exitCode === undefined || exitCode === null) {
    return 'Command completed';
  }
  return 'Command failed';
}

/**
 * Build the notification body from the command text and optional exit code.
 */
export function getNotificationBody(command: string, exitCode: number | null | undefined): string {
  const truncated = truncateCommand(command);
  if (exitCode !== null && exitCode !== undefined && exitCode !== 0) {
    return `${truncated}\nExit code: ${exitCode}`;
  }
  return truncated;
}

/**
 * Request notification permission if not already granted.
 * Returns true if permission is granted, false otherwise.
 */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (typeof Notification === 'undefined') return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;

  const result = await Notification.requestPermission();
  return result === 'granted';
}

/**
 * Determine whether a desktop notification should be shown for a completed command.
 */
export function shouldNotify(
  commandTimestamp: number,
  completionTime: number,
  windowFocused: boolean,
): boolean {
  if (windowFocused) return false;
  return completionTime - commandTimestamp >= NOTIFICATION_THRESHOLD_MS;
}

/**
 * Show a desktop notification for a completed command.
 * Clicking the notification focuses the app window.
 */
export async function showCommandNotification(
  command: string,
  exitCode: number | null | undefined,
  commandTimestamp: number,
  completionTime: number = Date.now(),
  windowFocused: boolean = document.hasFocus(),
): Promise<void> {
  if (!shouldNotify(commandTimestamp, completionTime, windowFocused)) return;

  const permitted = await ensureNotificationPermission();
  if (!permitted) return;

  const title = getNotificationTitle(exitCode);
  const body = getNotificationBody(command, exitCode);

  const notification = new Notification(title, { body });
  notification.onclick = () => {
    window.focus();
  };
}

/**
 * Send a test notification (for the command palette).
 */
export async function sendTestNotification(): Promise<void> {
  const permitted = await ensureNotificationPermission();
  if (!permitted) return;

  const notification = new Notification('Velocity Test Notification', {
    body: 'Notifications are working!',
  });
  notification.onclick = () => {
    window.focus();
  };
}
