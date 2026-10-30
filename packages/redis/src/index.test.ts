import { describe, expect, it } from 'vitest';
import { assertRedisCommand, RedisGuardError } from '../src/index.js';

describe('redis command guard', () => {
  it('allows read commands', () => {
    expect(assertRedisCommand(['GET', 'a'])).toBe('GET');
    expect(assertRedisCommand(['scan', '0', 'MATCH', '*'])).toBe('SCAN');
    expect(assertRedisCommand(['HGETALL', 'h'])).toBe('HGETALL');
  });

  it('forbids KEYS and dangerous commands', () => {
    for (const cmd of ['KEYS', 'FLUSHALL', 'FLUSHDB', 'CONFIG', 'SHUTDOWN', 'DEBUG', 'EVAL']) {
      expect(() => assertRedisCommand([cmd])).toThrow(RedisGuardError);
    }
  });

  it('rejects unknown writes', () => {
    expect(() => assertRedisCommand(['SET', 'a', '1'])).toThrow(/白名单/);
  });
});
