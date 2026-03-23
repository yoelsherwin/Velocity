import { describe, it, expect } from 'vitest';
import {
  detectSecrets,
  buildRedactedSegments,
  maskSecrets,
  MASK_TEXT,
} from '../lib/secretRedaction';

describe('detectSecrets', () => {
  it('test_detects_openai_key', () => {
    const text = 'Your key is sk-abc123def456ghi789jklmno';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('sk-abc123def456ghi789jklmno');
    expect(secrets[0].name).toBe('openai-key');
  });

  it('test_detects_aws_key', () => {
    const text = 'AWS key: AKIAIOSFODNN7EXAMPLE';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('AKIAIOSFODNN7EXAMPLE');
    expect(secrets[0].name).toBe('aws-key');
  });

  it('test_detects_github_pat', () => {
    const text = 'token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghij');
    expect(secrets[0].name).toBe('github-pat');
  });

  it('test_detects_slack_token', () => {
    const text = 'SLACK_TOKEN=xoxb-1234-5678-abcdef';
    const secrets = detectSecrets(text);
    // Should detect both the env-secret pattern and/or slack-token pattern
    expect(secrets.length).toBeGreaterThanOrEqual(1);
    // At least one match should cover the slack token
    const slackSecret = secrets.find((s) => s.name === 'slack-token');
    const envSecret = secrets.find((s) => s.name === 'env-secret');
    expect(slackSecret || envSecret).toBeTruthy();
  });

  it('test_detects_generic_env_secret', () => {
    const text = 'API_KEY=mysecretvalue123';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('mysecretvalue123');
    expect(secrets[0].name).toBe('env-secret');
  });

  it('test_detects_env_secret_PASSWORD', () => {
    const text = 'PASSWORD=hunter2';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('hunter2');
  });

  it('test_detects_env_secret_TOKEN', () => {
    const text = 'TOKEN=abc123xyz';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('abc123xyz');
  });

  it('test_detects_connection_string_password', () => {
    const text = 'mysql://user:p4ssw0rd@localhost:3306/db';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('p4ssw0rd');
    expect(secrets[0].name).toBe('connection-string-password');
  });

  it('test_detects_connection_string_postgres', () => {
    const text = 'postgres://admin:supersecret@db.example.com/mydb';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].value).toBe('supersecret');
  });

  it('test_preserves_git_hashes', () => {
    const text = 'commit abc0123456789abcdef0123456789abcdef012345';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(0);
  });

  it('test_preserves_git_hashes_at_start_of_line', () => {
    const text = 'abc0123456789abcdef0123456789abcdef012345 feat: something';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(0);
  });

  it('test_preserves_uuids', () => {
    const text = 'id: 550e8400-e29b-41d4-a716-446655440000';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(0);
  });

  it('test_preserves_uuids_uppercase', () => {
    const text = 'ID=550E8400-E29B-41D4-A716-446655440000';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(0);
  });

  it('test_detects_multiple_secrets', () => {
    const text = 'API_KEY=secret1 TOKEN=secret2';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(2);
  });

  it('test_no_false_positive_on_short_values', () => {
    // Single char value after = should not match (min 2 chars)
    const text = 'API_KEY=x';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(0);
  });

  it('test_github_fine_grained_pat', () => {
    const text = 'github_pat_12345678901234567890ab';
    const secrets = detectSecrets(text);
    expect(secrets).toHaveLength(1);
    expect(secrets[0].name).toBe('github-fine-pat');
  });
});

describe('buildRedactedSegments', () => {
  it('test_no_secrets_returns_single_segment', () => {
    const text = 'hello world';
    const segments = buildRedactedSegments(text, []);
    expect(segments).toHaveLength(1);
    expect(segments[0].text).toBe('hello world');
    expect(segments[0].isSecret).toBe(false);
  });

  it('test_masks_detected_secret', () => {
    const text = 'key: sk-abc123def456ghi789jklmno';
    const secrets = detectSecrets(text);
    const segments = buildRedactedSegments(text, secrets);

    // Should have: "key: " (non-secret) + masked (secret)
    expect(segments.length).toBe(2);
    expect(segments[0].text).toBe('key: ');
    expect(segments[0].isSecret).toBe(false);
    expect(segments[1].text).toBe(MASK_TEXT);
    expect(segments[1].isSecret).toBe(true);
    expect(segments[1].originalValue).toBe('sk-abc123def456ghi789jklmno');
    expect(segments[1].secretId).toBeDefined();
  });

  it('test_env_secret_masks_only_value', () => {
    const text = 'API_KEY=mysecretvalue123';
    const secrets = detectSecrets(text);
    const segments = buildRedactedSegments(text, secrets);

    // Should have: "API_KEY=" (non-secret) + masked (secret)
    expect(segments.length).toBe(2);
    expect(segments[0].text).toBe('API_KEY=');
    expect(segments[0].isSecret).toBe(false);
    expect(segments[1].text).toBe(MASK_TEXT);
    expect(segments[1].isSecret).toBe(true);
    expect(segments[1].originalValue).toBe('mysecretvalue123');
  });

  it('test_connection_string_masks_only_password', () => {
    const text = 'mysql://user:p4ssw0rd@host/db';
    const secrets = detectSecrets(text);
    const segments = buildRedactedSegments(text, secrets);

    // "mysql://user:" + masked + "@host/db"
    expect(segments.length).toBe(3);
    expect(segments[0].text).toBe('mysql://user:');
    expect(segments[1].text).toBe(MASK_TEXT);
    expect(segments[1].originalValue).toBe('p4ssw0rd');
    expect(segments[2].text).toBe('@host/db');
  });
});

describe('maskSecrets', () => {
  it('test_masks_text_for_clipboard', () => {
    const text = 'API_KEY=mysecretvalue123 other stuff';
    const masked = maskSecrets(text);
    expect(masked).toBe(`API_KEY=${MASK_TEXT} other stuff`);
    expect(masked).not.toContain('mysecretvalue123');
  });

  it('test_no_secrets_returns_original', () => {
    const text = 'just normal output';
    expect(maskSecrets(text)).toBe(text);
  });

  it('test_masks_multiple_secrets', () => {
    const text = 'API_KEY=secret1 TOKEN=secret2';
    const masked = maskSecrets(text);
    expect(masked).not.toContain('secret1');
    expect(masked).not.toContain('secret2');
    expect(masked).toContain(MASK_TEXT);
  });

  it('test_copy_output_copies_masked', () => {
    // Simulates the copy behavior: maskSecrets should mask all detected secrets
    const text = 'sk-abc123def456ghi789jklmno';
    const masked = maskSecrets(text);
    expect(masked).toBe(MASK_TEXT);
    expect(masked).not.toContain('sk-');
  });
});
