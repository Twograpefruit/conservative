import { Worker } from 'node:worker_threads';
import { createRequire } from 'node:module';
import type { ConnectionProfile, DbColumnInfo, DbIndexInfo, DbMetadata, DbQueryResult, DbTableInfo } from '@ocg/protocol';
import { assertStatement, type SqlKind } from '@ocg/db';
import { HttpError, badRequest } from './http.js';

const nodeRequire = createRequire(import.meta.url);
const { DatabaseSync } = nodeRequire('node:sqlite') as typeof import('node:sqlite');

export type SqliteProfile = ConnectionProfile & { file: string };

const WORKER_SOURCE = `
const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
function clean(v) {
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) return { __binary: v.subarray(0, 4096).toString('base64'), truncated: v.length > 4096 };
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const out = {};
    for (const [k, x] of Object.entries(v)) out[k] = clean(x);
    return out;
  }
  if (Array.isArray(v)) return v.map(clean);
  return v;
}
try {
  const db = new DatabaseSync(workerData.file, { readOnly: workerData.readOnly });
  db.exec('PRAGMA busy_timeout = ' + Number(workerData.timeoutMs || 5000));
  const stmt = db.prepare(workerData.sql);
  const params = Array.isArray(workerData.params) ? workerData.params : [];
  if (workerData.readOnly) {
    const columns = stmt.columns().map((c) => c.name);
    const rows = [];
    let truncated = false;
    for (const row of stmt.iterate(...params)) {
      if (rows.length >= workerData.rowLimit) { truncated = true; break; }
      rows.push(columns.map((c) => clean(row[c])));
    }
    db.close();
    parentPort.postMessage({ ok: true, columns, rows, truncated });
  } else {
    const result = stmt.run(...params);
    db.close();
    parentPort.postMessage({ ok: true, columns: [], rows: [], changes: Number(result.changes || 0), truncated: false });
  }
} catch (err) {
  parentPort.postMessage({ ok: false, error: String(err && err.message ? err.message : err) });
}
`;

function runWorker(
  profile: SqliteProfile,
  sql: string,
  params: unknown[],
  kind: SqlKind,
): Promise<{ columns: string[]; rows: unknown[][]; truncated: boolean; changes?: number }> {
  return new Promise((resolve, reject) => {
    const worker = new Worker(WORKER_SOURCE, {
      eval: true,
      workerData: {
        file: profile.file,
        readOnly: profile.readOnly || kind === 'read',
        timeoutMs: profile.timeoutMs,
        rowLimit: profile.rowLimit,
        sql,
        params,
      },
    });
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      void worker.terminate();
      reject(new HttpError(408, `查询超时（${profile.timeoutMs}ms），已取消`, 'query_timeout'));
    }, profile.timeoutMs + 250);
    worker.once('message', (msg: { ok: boolean; error?: string; columns?: string[]; rows?: unknown[][]; truncated?: boolean; changes?: number }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      void worker.terminate();
      if (!msg.ok) {
        reject(new HttpError(400, msg.error ?? 'SQLite query failed', 'query_failed'));
        return;
      }
      resolve({
        columns: msg.columns ?? [],
        rows: msg.rows ?? [],
        truncated: Boolean(msg.truncated),
        changes: msg.changes,
      });
    });
    worker.once('error', (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new HttpError(500, err.message, 'query_failed'));
    });
  });
}

function quoteIdent(name: string): string {
  return `"${name.replace(/"/g, '""')}"`;
}

export class SqliteService {
  private ensure(profile: SqliteProfile): void {
    if (profile.kind !== 'sqlite') throw badRequest('profile is not sqlite', 'invalid_kind');
    if (!profile.file) throw badRequest('sqlite file is missing', 'missing_file');
  }

  async test(profile: SqliteProfile): Promise<{ ok: true; version: string }> {
    this.ensure(profile);
    const db = new DatabaseSync(profile.file, { readOnly: true });
    try {
      const row = db.prepare('select sqlite_version() as v').get() as { v?: string };
      return { ok: true, version: String(row?.v ?? 'unknown') };
    } finally {
      db.close();
    }
  }

  async query(profile: SqliteProfile, sql: string, params: unknown[] = []): Promise<DbQueryResult> {
    this.ensure(profile);
    const kind = assertStatement(sql, profile.readOnly);
    const start = Date.now();
    const res = await runWorker(profile, sql, params, kind);
    return {
      columns: res.columns,
      rows: res.rows,
      rowCount: res.rows.length,
      truncated: res.truncated,
      durationMs: Date.now() - start,
      kind,
      changes: res.changes,
    };
  }

  async metadata(profile: SqliteProfile): Promise<DbMetadata> {
    this.ensure(profile);
    const db = new DatabaseSync(profile.file, { readOnly: true });
    try {
      const tables = (db.prepare(
        "select name,type from sqlite_master where type in ('table','view') and name not like 'sqlite_%' order by name",
      ).all() as Array<{ name: string; type: string }>).map((t) => ({ name: t.name, type: t.type === 'view' ? 'view' : 'table' })) as DbTableInfo[];
      const columns: Record<string, DbColumnInfo[]> = {};
      const indexes: Record<string, DbIndexInfo[]> = {};
      for (const table of tables.slice(0, 200)) {
        const cols = db.prepare(`PRAGMA table_info(${quoteIdent(table.name)})`).all() as Array<{
          name: string;
          type: string;
          notnull: number;
          pk: number;
          dflt_value: unknown;
        }>;
        columns[table.name] = cols.map((c) => ({
          name: c.name,
          type: c.type || 'any',
          notNull: Boolean(c.notnull),
          primaryKey: Boolean(c.pk),
          defaultValue: c.dflt_value,
        }));
        const idx = db.prepare(`PRAGMA index_list(${quoteIdent(table.name)})`).all() as Array<{ name: string; unique: number }>;
        indexes[table.name] = idx.map((i) => {
          const info = db.prepare(`PRAGMA index_info(${quoteIdent(i.name)})`).all() as Array<{ name: string }>;
          return { name: i.name, unique: Boolean(i.unique), columns: info.map((x) => x.name) };
        });
      }
      return { tables, columns, indexes };
    } finally {
      db.close();
    }
  }

  async exportRows(
    profile: SqliteProfile,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    const result = await this.query(profile, sql, params);
    if (result.kind !== 'read') throw new HttpError(400, '只能导出查询结果', 'not_read_only');
    return { columns: result.columns, rows: result.rows };
  }
}
