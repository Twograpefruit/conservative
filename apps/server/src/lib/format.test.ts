import { describe, expect, it } from 'vitest';
import { formatSql } from './format.js';

describe('sql formatter', () => {
  it('formats sqlite/postgresql with uppercase keywords', () => {
    const out = formatSql('select id,name from users where id=1;', { dialect: 'sqlite' });
    expect(out).toContain('SELECT');
    expect(out).toContain('FROM');
    expect(out).toContain('WHERE');
    expect(out).toContain('id = 1');
  });

  it('supports postgresql dialect', () => {
    const out = formatSql('select 1', { dialect: 'postgresql' });
    expect(out.trim()).toBe('SELECT\n  1');
  });

  it('rejects unsupported dialects', () => {
    expect(() => formatSql('select 1', { dialect: 'nope' as never })).toThrow(/unsupported/i);
  });
});
