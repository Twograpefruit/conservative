import Redis from 'ioredis';
import type { ConnectionProfile, RedisScanResult, RedisValue } from '@ocg/protocol';
import { assertRedisCommand, RedisGuardError } from '@ocg/redis';
import { HttpError, badRequest } from './http.js';

export type RedisProfile = ConnectionProfile & { host: string; port: number };

function options(profile: RedisProfile, password: string | null, db = Number(profile.database ?? 0)): Record<string, unknown> {
  return {
    host: profile.host,
    port: profile.port,
    username: profile.user || undefined,
    password: password || undefined,
    db: Number.isFinite(db) ? db : 0,
    lazyConnect: true,
    connectTimeout: profile.timeoutMs,
    maxRetriesPerRequest: 1,
    retryStrategy: () => null,
    enableOfflineQueue: false,
  };
}

function truncateString(value: string, max = 100_000): { value: string; truncated: boolean } {
  if (value.length <= max) return { value, truncated: false };
  return { value: value.slice(0, max), truncated: true };
}

export class RedisService {
  private clients = new Map<string, Redis>();

  private async connect(profile: RedisProfile, password: string | null, db?: number): Promise<Redis> {
    const client = new Redis(options(profile, password, db) as never);
    client.on('error', () => undefined);
    try {
      await client.connect();
      await client.ping();
      return client;
    } catch (err) {
      client.disconnect();
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(502, `Redis 连接失败：${message}`, 'redis_connect');
    }
  }

  private async withClient<T>(profile: RedisProfile, password: string | null, fn: (client: Redis) => Promise<T>): Promise<T> {
    const client = await this.connect(profile, password);
    try {
      return await fn(client);
    } catch (err) {
      if (err instanceof HttpError) throw err;
      if (err instanceof RedisGuardError) throw new HttpError(403, err.message, err.code);
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(502, `Redis 操作失败：${message}`, 'redis_error');
    } finally {
      client.disconnect();
    }
  }

  async test(profile: RedisProfile, password: string | null): Promise<{ ok: true; info: string }> {
    return this.withClient(profile, password, async (client) => {
      const info = await client.info('server');
      return { ok: true, info: String(info).split('\r\n').slice(0, 3).join(' | ') };
    });
  }

  async scan(
    profile: RedisProfile,
    password: string | null,
    input: { cursor?: string; pattern?: string; count?: number },
  ): Promise<RedisScanResult> {
    return this.withClient(profile, password, async (client) => {
      const cursor = input.cursor || '0';
      const count = Math.max(1, Math.min(500, input.count ?? 100));
      const pattern = input.pattern?.trim() || '*';
      const [next, keys] = await client.scan(cursor, 'MATCH', pattern, 'COUNT', count);
      let infos: Array<{ key: string; type: string }> = [];
      if (keys.length) {
        const pipeline = client.pipeline();
        for (const key of keys) pipeline.type(key);
        const types = await pipeline.exec();
        infos = keys.map((key, i) => ({ key, type: String(types?.[i]?.[1] ?? 'unknown') }));
      }
      return { cursor: String(next), keys: infos, scanned: keys.length };
    });
  }

  async value(profile: RedisProfile, password: string | null, key: string): Promise<RedisValue> {
    if (!key) badRequest('key is required');
    return this.withClient(profile, password, async (client) => {
      const type = String(await client.type(key));
      const ttl = Number(await client.ttl(key));
      let truncated = false;
      let value: unknown = null;
      switch (type) {
        case 'string': {
          const raw = (await client.get(key)) ?? '';
          const t = truncateString(raw);
          value = t.value;
          truncated = t.truncated;
          break;
        }
        case 'hash': {
          const [next, pairs] = await client.hscan(key, '0', 'COUNT', 200);
          value = { cursor: next, entries: pairs };
          truncated = next !== '0';
          break;
        }
        case 'list': {
          const items = await client.lrange(key, 0, 199);
          value = items;
          truncated = items.length >= 200;
          break;
        }
        case 'set': {
          const [next, members] = await client.sscan(key, '0', 'COUNT', 200);
          value = { cursor: next, members };
          truncated = next !== '0';
          break;
        }
        case 'zset': {
          const items = await client.zrange(key, '0', '199', 'WITHSCORES');
          value = items;
          truncated = items.length >= 400;
          break;
        }
        case 'stream': {
          const items = await client.xrange(key, '-', '+', 'COUNT', '50');
          value = items;
          truncated = items.length >= 50;
          break;
        }
        default:
          value = null;
      }
      return { key, type, value, truncated, ttl };
    });
  }

  async command(profile: RedisProfile, password: string | null, args: string[]): Promise<{ command: string; result: unknown }> {
    const command = assertRedisCommand(args);
    return this.withClient(profile, password, async (client) => {
      const result = await client.call(command, ...args.slice(1));
      const text = JSON.stringify(result);
      return { command, result: text.length > 200_000 ? `${text.slice(0, 200_000)}…` : result };
    });
  }

  async subscribe(
    profile: RedisProfile,
    password: string | null,
    channel: string,
    onMessage: (channel: string, message: string) => void,
  ): Promise<() => void> {
    const client = await this.connect(profile, password);
    await client.subscribe(channel);
    const handler = (ch: string, msg: string) => onMessage(ch, msg);
    client.on('message', handler);
    return () => {
      client.off('message', handler);
      client.disconnect();
    };
  }
}
