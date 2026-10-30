/** Redis command whitelist. KEYS and destructive commands are never allowed. */

export class RedisGuardError extends Error {
  constructor(
    message: string,
    public readonly code: 'empty' | 'forbidden' | 'not_whitelisted',
  ) {
    super(message);
  }
}

export const REDIS_READ_COMMANDS = new Set([
  'GET',
  'MGET',
  'STRLEN',
  'TYPE',
  'TTL',
  'PTTL',
  'EXISTS',
  'HGET',
  'HMGET',
  'HGETALL',
  'HKEYS',
  'HVALS',
  'HLEN',
  'HEXISTS',
  'LRANGE',
  'LLEN',
  'LINDEX',
  'SMEMBERS',
  'SCARD',
  'SISMEMBER',
  'ZRANGE',
  'ZREVRANGE',
  'ZRANGEBYSCORE',
  'ZSCORE',
  'ZCARD',
  'XRANGE',
  'XREVRANGE',
  'XLEN',
  'SCAN',
  'SSCAN',
  'HSCAN',
  'ZSCAN',
  'INFO',
  'PING',
  'DBSIZE',
  'RANDOMKEY',
  'MEMORY',
  'OBJECT',
]);

export const REDIS_FORBIDDEN_COMMANDS = new Set([
  'KEYS',
  'FLUSHALL',
  'FLUSHDB',
  'SHUTDOWN',
  'CONFIG',
  'DEBUG',
  'SCRIPT',
  'EVAL',
  'EVALSHA',
  'FUNCTION',
  'MODULE',
  'MIGRATE',
  'MONITOR',
  'SLAVEOF',
  'REPLICAOF',
  'CLUSTER',
  'ACL',
  'CLIENT',
]);

export function assertRedisCommand(args: string[]): string {
  if (!Array.isArray(args) || args.length === 0) throw new RedisGuardError('Redis 命令不能为空', 'empty');
  if (args.some((a) => typeof a !== 'string')) throw new RedisGuardError('Redis 参数必须是字符串', 'empty');
  if (args.length > 32) throw new RedisGuardError('Redis 命令参数过多', 'forbidden');
  const command = args[0].toUpperCase();
  if (REDIS_FORBIDDEN_COMMANDS.has(command)) {
    throw new RedisGuardError(`Redis 命令 ${command} 默认禁用`, 'forbidden');
  }
  if (!REDIS_READ_COMMANDS.has(command)) {
    throw new RedisGuardError(`Redis 命令 ${command} 不在只读白名单内`, 'not_whitelisted');
  }
  // Never allow KEYS through an alias/multi-command value.
  if (args.slice(1).some((a) => /^(keys|flushall|flushdb|config|shutdown|debug)$/i.test(a))) {
    throw new RedisGuardError('参数中包含禁用命令', 'forbidden');
  }
  return command;
}

export function splitRedisCommand(input: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(input)) !== null) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}
