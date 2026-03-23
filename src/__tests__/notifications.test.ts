import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  truncateCommand,
  getNotificationTitle,
  getNotificationBody,
  shouldNotify,
  showCommandNotification,
  NOTIFICATION_THRESHOLD_MS,
  MAX_BODY_LENGTH,
} from '../lib/notifications';

// Mock the Notification API
class MockNotification {
  static permission: NotificationPermission = 'granted';
  static requestPermission = vi.fn(async () => MockNotification.permission);

  title: string;
  body: string;
  onclick: (() => void) | null = null;

  constructor(title: string, options?: { body?: string }) {
    this.title = title;
    this.body = options?.body ?? '';
    MockNotification._lastInstance = this;
  }

  static _lastInstance: MockNotification | null = null;
}

beforeEach(() => {
  MockNotification.permission = 'granted';
  MockNotification._lastInstance = null;
  MockNotification.requestPermission = vi.fn(async () => MockNotification.permission);
  vi.stubGlobal('Notification', MockNotification);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('shouldNotify', () => {
  it('test_notification_shown_for_long_command', () => {
    const timestamp = 1000;
    const completionTime = timestamp + NOTIFICATION_THRESHOLD_MS;
    expect(shouldNotify(timestamp, completionTime, false)).toBe(true);
  });

  it('test_no_notification_for_short_command', () => {
    const timestamp = 1000;
    const completionTime = timestamp + 5000; // 5 seconds — below threshold
    expect(shouldNotify(timestamp, completionTime, false)).toBe(false);
  });

  it('test_no_notification_when_focused', () => {
    const timestamp = 1000;
    const completionTime = timestamp + NOTIFICATION_THRESHOLD_MS + 5000;
    expect(shouldNotify(timestamp, completionTime, true)).toBe(false);
  });

  it('test_notification_at_exact_threshold', () => {
    const timestamp = 1000;
    const completionTime = timestamp + NOTIFICATION_THRESHOLD_MS;
    expect(shouldNotify(timestamp, completionTime, false)).toBe(true);
  });
});

describe('getNotificationTitle', () => {
  it('test_notification_title_success', () => {
    expect(getNotificationTitle(0)).toBe('Command completed');
  });

  it('test_notification_title_failure', () => {
    expect(getNotificationTitle(1)).toBe('Command failed');
    expect(getNotificationTitle(127)).toBe('Command failed');
    expect(getNotificationTitle(-1)).toBe('Command failed');
  });

  it('test_notification_title_null_exit_code', () => {
    expect(getNotificationTitle(null)).toBe('Command completed');
    expect(getNotificationTitle(undefined)).toBe('Command completed');
  });
});

describe('getNotificationBody', () => {
  it('test_notification_body_short_command', () => {
    expect(getNotificationBody('npm install', 0)).toBe('npm install');
  });

  it('test_notification_body_truncated', () => {
    const longCommand = 'a'.repeat(100);
    const body = getNotificationBody(longCommand, 0);
    expect(body).toBe('a'.repeat(MAX_BODY_LENGTH) + '...');
    expect(body.length).toBe(MAX_BODY_LENGTH + 3);
  });

  it('test_notification_body_includes_exit_code_on_failure', () => {
    const body = getNotificationBody('cargo build', 1);
    expect(body).toContain('cargo build');
    expect(body).toContain('Exit code: 1');
  });

  it('test_notification_body_no_exit_code_on_success', () => {
    const body = getNotificationBody('npm install', 0);
    expect(body).not.toContain('Exit code');
  });
});

describe('truncateCommand', () => {
  it('test_no_truncation_for_short_command', () => {
    expect(truncateCommand('ls -la')).toBe('ls -la');
  });

  it('test_truncation_at_max_length', () => {
    const exact = 'x'.repeat(MAX_BODY_LENGTH);
    expect(truncateCommand(exact)).toBe(exact);
  });

  it('test_truncation_over_max_length', () => {
    const over = 'x'.repeat(MAX_BODY_LENGTH + 1);
    expect(truncateCommand(over)).toBe('x'.repeat(MAX_BODY_LENGTH) + '...');
  });
});

describe('showCommandNotification', () => {
  it('test_shows_notification_for_long_unfocused_command', async () => {
    const timestamp = Date.now() - 15000;
    await showCommandNotification('npm install', 0, timestamp, Date.now(), false);

    expect(MockNotification._lastInstance).not.toBeNull();
    expect(MockNotification._lastInstance!.title).toBe('Command completed');
    expect(MockNotification._lastInstance!.body).toBe('npm install');
  });

  it('test_no_notification_for_short_command_integration', async () => {
    const now = Date.now();
    await showCommandNotification('ls', 0, now - 3000, now, false);
    expect(MockNotification._lastInstance).toBeNull();
  });

  it('test_no_notification_when_window_focused', async () => {
    const timestamp = Date.now() - 15000;
    await showCommandNotification('npm install', 0, timestamp, Date.now(), true);
    expect(MockNotification._lastInstance).toBeNull();
  });

  it('test_notification_click_focuses_window', async () => {
    const focusSpy = vi.spyOn(window, 'focus').mockImplementation(() => {});
    const timestamp = Date.now() - 15000;
    await showCommandNotification('npm install', 0, timestamp, Date.now(), false);

    expect(MockNotification._lastInstance).not.toBeNull();
    MockNotification._lastInstance!.onclick!();
    expect(focusSpy).toHaveBeenCalled();
  });

  it('test_skips_when_permission_denied', async () => {
    MockNotification.permission = 'denied';
    const timestamp = Date.now() - 15000;
    await showCommandNotification('npm install', 0, timestamp, Date.now(), false);
    expect(MockNotification._lastInstance).toBeNull();
  });
});
