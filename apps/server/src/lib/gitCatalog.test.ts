import { describe, expect, it } from 'vitest';
import { hintsFor, redactSecrets, validateExtraArgs } from './gitCatalog.js';

describe('git catalog helpers', () => {
  it('redacts tokens and password-like values', () => {
    const res = redactSecrets('token=ghp_abcdefghijklmnopqrstuvwxyz123456 password=secret123');
    expect(res.redacted).toBe(true);
    expect(res.text).not.toContain('ghp_');
    expect(res.text).not.toContain('secret123');
  });

  it('maps common git failures to actionable hints', () => {
    expect(hintsFor('! [rejected] main -> main (non-fast-forward)')[0].message).toMatch(/远程/);
    expect(hintsFor('fatal: no upstream branch')[0].message).toMatch(/upstream/);
    expect(hintsFor('fatal: Unable to create .git/index.lock')[0].message).toMatch(/索引/);
  });

  it('rejects unsafe extra args', () => {
    expect(validateExtraArgs(['--stat'])).toEqual(['--stat']);
    expect(() => validateExtraArgs(['--force'])).toThrow();
    expect(() => validateExtraArgs(['$(rm -rf /)'])).toThrow();
    expect(() => validateExtraArgs('nope')).toThrow();
  });
});
