import { describe, expect, it } from 'vitest';
import { parseRedisUrl } from './localConfig.js';
import { MysqlService } from './mysql.js';

describe('local defaults', () => {
  it('parses redis urls into host/port/db', () => {
    expect(parseRedisUrl('redis://localhost:6379/0')).toEqual({
      host: 'localhost',
      port: 6379,
      database: '0',
    });
    expect(parseRedisUrl('redis://:secret@127.0.0.1:6380/2')).toEqual({
      host: '127.0.0.1',
      port: 6380,
      database: '2',
      password: 'secret',
    });
  });

  it('rejects non-redis protocols', () => {
    expect(() => parseRedisUrl('http://localhost:6379')).toThrow();
  });

  it('quotes MySQL identifiers including schema-qualified names', () => {
    expect(MysqlService.quoteTable('actor')).toBe('`actor`');
    expect(MysqlService.quoteTable('sakila.actor')).toBe('`sakila`.`actor`');
    expect(MysqlService.quoteTable('we`ird')).toBe('`we``ird`');
  });
});
