import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { ConnectionStore } from './connections.js';

export interface LocalRedisConfig {
  url?: string;
}

export interface LocalMysqlConfig {
  host?: string;
  port?: number;
  user?: string;
  password?: string;
  database?: string;
}

export interface LocalConfig {
  redis?: LocalRedisConfig;
  mysql?: LocalMysqlConfig;
}

const DEFAULTS: LocalConfig = {
  redis: { url: 'redis://localhost:6379/0' },
  mysql: { host: '127.0.0.1', port: 3306, user: 'root', password: 'root' },
};

function candidates(): string[] {
  const here = path.dirname(fileURLToPath(import.meta.url));
  return [
    process.env.OCG_LOCAL_CONFIG ?? '',
    path.resolve(process.cwd(), 'config', 'local.json'),
    path.resolve(here, '../../..', 'config', 'local.json'),
    path.resolve(here, '../../../..', 'config', 'local.json'),
  ].filter(Boolean);
}

export function loadLocalConfig(): LocalConfig {
  for (const file of candidates()) {
    try {
      if (!fs.existsSync(file)) continue;
      const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as LocalConfig;
      const merged: LocalConfig = {
        redis: { ...DEFAULTS.redis, ...(raw.redis ?? {}) },
        mysql: { ...DEFAULTS.mysql, ...(raw.mysql ?? {}) },
      };
      console.log(`[bff] local defaults loaded from ${file}`);
      return merged;
    } catch (err) {
      console.warn(`[bff] failed to read local config ${file}:`, err instanceof Error ? err.message : err);
    }
  }
  return DEFAULTS;
}

export function parseRedisUrl(url: string): {
  host: string;
  port: number;
  database: string;
  password?: string;
} {
  const parsed = new URL(url);
  if (parsed.protocol !== 'redis:' && parsed.protocol !== 'rediss:') {
    throw new Error(`unsupported redis url protocol: ${parsed.protocol}`);
  }
  return {
    host: parsed.hostname || '127.0.0.1',
    port: parsed.port ? Number(parsed.port) : 6379,
    database: parsed.pathname.replace(/^\//, '') || '0',
    ...(parsed.password ? { password: decodeURIComponent(parsed.password) } : {}),
  };
}

/**
 * Create the local Redis/MySQL profiles from config/local.json when they do not
 * exist yet. Credentials go straight into the DPAPI credential store; the
 * profiles file only keeps an opaque authRef.
 */
export async function seedLocalConnections(
  connections: ConnectionStore,
  cfg: LocalConfig,
): Promise<void> {
  const list = () => connections.listPublic();

  if (cfg.redis?.url) {
    try {
      const redis = parseRedisUrl(cfg.redis.url);
      const existing = list().find((p) => p.kind === 'redis' && p.label === 'Local Redis');
      if (!existing) {
        await connections.create({
          label: 'Local Redis',
          kind: 'redis',
          host: redis.host,
          port: redis.port,
          database: redis.database,
          readOnly: true,
          secret: redis.password,
          timeoutMs: 5000,
          rowLimit: 500,
        });
        console.log(`[bff] seeded Redis profile ${redis.host}:${redis.port}/${redis.database}`);
      } else {
        await connections.update(existing.id, {
          host: redis.host,
          port: redis.port,
          database: redis.database,
          ...(redis.password ? { secret: redis.password } : {}),
        });
      }
    } catch (err) {
      console.warn('[bff] invalid redis url:', err instanceof Error ? err.message : err);
    }
  }

  if (cfg.mysql) {
    const m = cfg.mysql;
    const existing = list().find((p) => p.kind === 'mysql' && p.label === 'Local MySQL');
    if (!existing) {
      await connections.create({
        label: 'Local MySQL',
        kind: 'mysql',
        host: m.host || '127.0.0.1',
        port: m.port || 3306,
        user: m.user || 'root',
        database: m.database || undefined,
        readOnly: true,
        secret: m.password || undefined,
        timeoutMs: 8000,
        rowLimit: 500,
      });
      console.log(`[bff] seeded MySQL profile ${m.host || '127.0.0.1'}:${m.port || 3306}`);
    } else {
      await connections.update(existing.id, {
        host: m.host || '127.0.0.1',
        port: m.port || 3306,
        user: m.user || 'root',
        database: m.database || '',
        ...(m.password ? { secret: m.password } : {}),
      });
    }
  }
}
