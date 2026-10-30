import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { ConnectionKind } from '@ocg/protocol';
import { HttpError, requireString } from '../lib/http.js';
import type { SqliteProfile } from '../lib/sqlite.js';
import type { RedisProfile } from '../lib/redis.js';
import type { MysqlProfile } from '../lib/mysql.js';

function profileOf(ctx: AppContext, id: unknown) {
  if (typeof id !== 'string' || !id) throw new HttpError(400, 'profileId is required', 'invalid_field');
  return ctx.connections.get(id);
}

function requireKind(kind: ConnectionKind, expected: ConnectionKind): void {
  if (kind !== expected) throw new HttpError(400, `连接类型为 ${kind}，不是 ${expected}`, 'invalid_kind');
}

export async function registerDataRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/connections', async () => ctx.connections.listPublic());

  app.post('/api/connections', async (req) => {
    const body = req.body as Record<string, unknown>;
    return ctx.connections.create({
      label: typeof body.label === 'string' ? body.label : undefined,
      kind: typeof body.kind === 'string' ? (body.kind as ConnectionKind) : undefined,
      readOnly: typeof body.readOnly === 'boolean' ? body.readOnly : undefined,
      timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
      rowLimit: typeof body.rowLimit === 'number' ? body.rowLimit : undefined,
      file: typeof body.file === 'string' ? body.file : undefined,
      host: typeof body.host === 'string' ? body.host : undefined,
      port: typeof body.port === 'number' ? body.port : undefined,
      database: typeof body.database === 'string' ? body.database : undefined,
      user: typeof body.user === 'string' ? body.user : undefined,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
    });
  });

  app.put('/api/connections/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    return ctx.connections.update(id, {
      label: typeof body.label === 'string' ? body.label : undefined,
      readOnly: typeof body.readOnly === 'boolean' ? body.readOnly : undefined,
      timeoutMs: typeof body.timeoutMs === 'number' ? body.timeoutMs : undefined,
      rowLimit: typeof body.rowLimit === 'number' ? body.rowLimit : undefined,
      file: typeof body.file === 'string' ? body.file : undefined,
      host: typeof body.host === 'string' ? body.host : undefined,
      port: typeof body.port === 'number' ? body.port : undefined,
      database: typeof body.database === 'string' ? body.database : undefined,
      user: typeof body.user === 'string' ? body.user : undefined,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
      clearPassword: body.clearPassword === true,
    });
  });

  app.delete('/api/connections/:id', async (req) => {
    const { id } = req.params as { id: string };
    ctx.connections.remove(id);
    return { ok: true };
  });

  app.post('/api/connections/test', async (req) => {
    const body = req.body as { id?: string };
    const profile = profileOf(ctx, body.id);
    if (profile.kind === 'sqlite') {
      return ctx.sqlite.test(profile as SqliteProfile);
    }
    if (profile.kind === 'redis') {
      const secret = await ctx.connections.getSecret(profile);
      return ctx.redis.test(profile as RedisProfile, secret);
    }
    if (profile.kind === 'mysql') {
      const secret = await ctx.connections.getSecret(profile);
      return ctx.mysql.test(profile as MysqlProfile, secret);
    }
    throw new HttpError(501, `${profile.kind} 驱动尚未启用（SQLite/Redis/MySQL）`, 'driver_not_available');
  });

  app.post('/api/db/query', async (req) => {
    const body = req.body as { profileId?: string; sql?: string; params?: unknown[] };
    const profile = profileOf(ctx, body.profileId);
    const sql = requireString(body.sql, 'sql');
    if (profile.kind === 'sqlite') {
      return ctx.sqlite.query(profile as SqliteProfile, sql, Array.isArray(body.params) ? body.params : []);
    }
    if (profile.kind === 'mysql') {
      const secret = await ctx.connections.getSecret(profile);
      return ctx.mysql.query(profile as MysqlProfile, secret, sql, Array.isArray(body.params) ? body.params : []);
    }
    throw new HttpError(501, `${profile.kind} 驱动尚未启用；当前支持 SQLite/MySQL`, 'driver_not_available');
  });

  app.get('/api/db/metadata', async (req) => {
    const query = req.query as { profileId?: string };
    const profile = profileOf(ctx, query.profileId);
    if (profile.kind === 'sqlite') return ctx.sqlite.metadata(profile as SqliteProfile);
    if (profile.kind === 'mysql') {
      const secret = await ctx.connections.getSecret(profile);
      return ctx.mysql.metadata(profile as MysqlProfile, secret);
    }
    throw new HttpError(501, 'metadata 目前支持 SQLite/MySQL', 'driver_not_available');
  });

  app.post('/api/db/export', async (req, reply) => {
    const body = req.body as { profileId?: string; sql?: string; params?: unknown[]; format?: 'csv' | 'json' };
    const profile = profileOf(ctx, body.profileId);
    const sql = requireString(body.sql, 'sql');
    let columns: string[];
    let rows: unknown[][];
    if (profile.kind === 'sqlite') {
      ({ columns, rows } = await ctx.sqlite.exportRows(
        profile as SqliteProfile,
        sql,
        Array.isArray(body.params) ? body.params : [],
      ));
    } else if (profile.kind === 'mysql') {
      const secret = await ctx.connections.getSecret(profile);
      ({ columns, rows } = await ctx.mysql.exportRows(
        profile as MysqlProfile,
        secret,
        sql,
        Array.isArray(body.params) ? body.params : [],
      ));
    } else {
      throw new HttpError(501, 'export 目前支持 SQLite/MySQL', 'driver_not_available');
    }
    const format = body.format === 'json' ? 'json' : 'csv';
    const base = `${profile.label.replace(/[^\w.-]+/g, '_')}-export.${format}`;
    reply.header('content-disposition', `attachment; filename="${base}"`);
    if (format === 'json') {
      reply.header('content-type', 'application/json; charset=utf-8');
      return { columns, rows };
    }
    reply.header('content-type', 'text/csv; charset=utf-8');
    const esc = (v: unknown) => {
      const s = v == null ? '' : typeof v === 'string' ? v : JSON.stringify(v);
      return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const lines = [columns.map(esc).join(',')];
    for (const row of rows) lines.push(row.map(esc).join(','));
    return lines.join('\r\n') + '\r\n';
  });

  app.post('/api/redis/scan', async (req) => {
    const body = req.body as { profileId?: string; cursor?: string; pattern?: string; count?: number };
    const profile = profileOf(ctx, body.profileId);
    requireKind(profile.kind, 'redis');
    const secret = await ctx.connections.getSecret(profile);
    return ctx.redis.scan(profile as RedisProfile, secret, {
      cursor: body.cursor,
      pattern: body.pattern,
      count: body.count,
    });
  });

  app.get('/api/redis/value', async (req) => {
    const query = req.query as { profileId?: string; key?: string };
    const profile = profileOf(ctx, query.profileId);
    requireKind(profile.kind, 'redis');
    const secret = await ctx.connections.getSecret(profile);
    return ctx.redis.value(profile as RedisProfile, secret, requireString(query.key, 'key'));
  });

  app.post('/api/redis/command', async (req) => {
    const body = req.body as { profileId?: string; args?: string[] };
    const profile = profileOf(ctx, body.profileId);
    requireKind(profile.kind, 'redis');
    if (!Array.isArray(body.args) || body.args.some((a) => typeof a !== 'string')) {
      throw new HttpError(400, 'args must be a string array', 'invalid_field');
    }
    const secret = await ctx.connections.getSecret(profile);
    return ctx.redis.command(profile as RedisProfile, secret, body.args);
  });

  app.get('/api/redis/subscribe', async (req, reply) => {
    const query = req.query as { profileId?: string; channel?: string };
    const profile = profileOf(ctx, query.profileId);
    requireKind(profile.kind, 'redis');
    const channel = requireString(query.channel, 'channel');
    const secret = await ctx.connections.getSecret(profile);
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    reply.raw.write(`: subscribed ${channel}\n\n`);
    let close: (() => void) | null = null;
    try {
      close = await ctx.redis.subscribe(profile as RedisProfile, secret, channel, (ch, message) => {
        reply.raw.write(`event: message\ndata: ${JSON.stringify({ channel: ch, message })}\n\n`);
      });
    } catch (err) {
      reply.raw.write(`event: error\ndata: ${JSON.stringify({ message: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    const ping = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n');
      } catch {
        /* closed */
      }
    }, 15_000);
    req.raw.on('close', () => {
      clearInterval(ping);
      close?.();
    });
  });
}
