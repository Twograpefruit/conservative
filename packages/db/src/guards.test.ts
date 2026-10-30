import { describe, expect, it } from 'vitest';
import { assertSingleStatement, assertStatement, classifySql, SqlGuardError } from '../src/index.js';

describe('sql guards', () => {
  it('classifies read and write statements', () => {
    expect(classifySql('select * from t')).toBe('read');
    expect(classifySql('with x as (select 1) select * from x')).toBe('read');
    expect(classifySql('explain select 1')).toBe('read');
    expect(classifySql('update t set a=1')).toBe('write');
    expect(classifySql('with x as (select 1) delete from t')).toBe('write');
  });

  it('ignores keywords inside strings and comments', () => {
    expect(classifySql("select 'delete from t' as x")).toBe('read');
    expect(classifySql('select 1 -- update t')).toBe('read');
    expect(classifySql('select /* drop table t */ 1')).toBe('read');
  });

  it('rejects multiple statements but allows a trailing semicolon', () => {
    expect(() => assertSingleStatement('select 1;')).not.toThrow();
    expect(() => assertSingleStatement('select 1; select 2;')).toThrow(SqlGuardError);
    expect(() => assertSingleStatement("select ';' as x")).not.toThrow();
  });

  it('allows only read-only pragmas', () => {
    expect(classifySql('pragma table_info(users)')).toBe('read');
    expect(() => classifySql('pragma journal_mode=wal')).toThrow(SqlGuardError);
  });

  it('enforces read-only profiles', () => {
    expect(assertStatement('select 1', true)).toBe('read');
    expect(() => assertStatement('delete from t', true)).toThrow(/只读/);
    expect(assertStatement('delete from t', false)).toBe('write');
  });
});
