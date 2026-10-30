import mysql from 'mysql2/promise';
import type {
  ConnectionProfile,
  DbColumnInfo,
  DbIndexInfo,
  DbMetadata,
  DbQueryResult,
  DbTableInfo,
} from '@ocg/protocol';
import { assertStatement } from '@ocg/db';
import { HttpError, badRequest } from './http.js';

export type MysqlProfile = ConnectionProfile & { host: string; port: number; user: string };

const SYSTEM_SCHEMAS = ['mysql', 'information_schema', 'performance_schema', 'sys'];

function clean(v: unknown): unknown {
  if (typeof v === 'bigint') return v.toString();
  if (Buffer.isBuffer(v)) {
    return { __binary: v.subarray(0, 4096).toString('base64'), truncated: v.length > 4096 };
  }
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(clean);
  if (v && typeof v === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) out[k] = clean(x);
    return out;
  }
  return v;
}

function q(identifier: string): string {
  return `\`${identifier.replace(/`/g, '``')}\``;
}

function tableLabel(schema: string, name: string, multi: boolean): string {
  return multi ? `${schema}.${name}` : name;
}

export class MysqlService {
  private ensure(profile: MysqlProfile): void {
    if (profile.kind !== 'mysql') throw badRequest('profile is not mysql', 'invalid_kind');
    if (!profile.host) throw badRequest('mysql host is missing', 'missing_host');
    if (!profile.user) throw badRequest('mysql user is missing', 'missing_user');
  }

  private async connect(profile: MysqlProfile, secret: string | null) {
    this.ensure(profile);
    return mysql.createConnection({
      host: profile.host,
      port: profile.port || 3306,
      user: profile.user,
      password: secret ?? '',
      ...(profile.database ? { database: profile.database } : {}),
      connectTimeout: Math.min(profile.timeoutMs || 5000, 10_000),
      multipleStatements: false,
      dateStrings: true,
      supportBigNumbers: true,
      bigNumberStrings: true,
      charset: 'utf8mb4',
    });
  }

  async test(profile: MysqlProfile, secret: string | null): Promise<{ ok: true; version: string; info: string }> {
    const conn = await this.connect(profile, secret);
    try {
      const [rows] = await conn.query('select version() as v');
      const version = String((rows as Array<{ v?: string }>)[0]?.v ?? 'unknown');
      const [dbs] = await conn.query('select database() as db');
      const db = (dbs as Array<{ db?: string | null }>)[0]?.db;
      return { ok: true, version, info: `MySQL ${version}${db ? ` · ${db}` : ''}` };
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  async query(
    profile: MysqlProfile,
    secret: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<DbQueryResult> {
    this.ensure(profile);
    const kind = assertStatement(sql, profile.readOnly);
    const conn = await this.connect(profile, secret);
    const start = Date.now();
    let timer: NodeJS.Timeout | null = null;
    try {
      const result = await Promise.race([
        conn.query({ sql, values: params, rowsAsArray: kind === 'read' }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            void conn.destroy();
            reject(new HttpError(408, `查询超时（${profile.timeoutMs}ms），已取消`, 'query_timeout'));
          }, profile.timeoutMs + 250);
        }),
      ]);
      const [rows, fields] = result as [unknown, unknown];
      if (kind === 'read') {
        const all = Array.isArray(rows) ? rows : [];
        const rowLimit = profile.rowLimit || 500;
        const truncated = all.length > rowLimit;
        const sliced = all.slice(0, rowLimit) as unknown[][];
        const columns = Array.isArray(fields)
          ? (fields as Array<{ name: string }>).map((f) => f.name)
          : [];
        return {
          columns,
          rows: sliced.map((row) => (Array.isArray(row) ? row.map(clean) : [clean(row)])),
          rowCount: Math.min(all.length, rowLimit),
          truncated,
          durationMs: Date.now() - start,
          kind,
        };
      }
      const header = rows as { affectedRows?: number };
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        truncated: false,
        durationMs: Date.now() - start,
        kind,
        changes: Number(header?.affectedRows ?? 0),
      };
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(400, err instanceof Error ? err.message : 'MySQL query failed', 'query_failed');
    } finally {
      if (timer) clearTimeout(timer);
      await conn.end().catch(() => undefined);
    }
  }

  async metadata(profile: MysqlProfile, secret: string | null): Promise<DbMetadata> {
    const conn = await this.connect(profile, secret);
    try {
      const schemas = profile.database ? [profile.database] : [];
      if (!schemas.length) {
        const [rows] = await conn.query(
          `select schema_name as name from information_schema.schemata where schema_name not in (${SYSTEM_SCHEMAS.map(() => '?').join(',')}) order by schema_name`,
          SYSTEM_SCHEMAS,
        );
        for (const row of rows as Array<{ name: string }>) schemas.push(row.name);
      }
      if (!schemas.length) return { tables: [], columns: {}, indexes: {} };
      const placeholders = schemas.map(() => '?').join(',');
      const [tableRows] = await conn.query(
        `select table_schema as schema_name, table_name as name, table_type as type
           from information_schema.tables
          where table_schema in (${placeholders})
            and table_type in ('BASE TABLE','VIEW')
          order by table_schema, table_name
          limit 500`,
        schemas,
      );
      const multi = schemas.length > 1;
      const tables: DbTableInfo[] = (tableRows as Array<{ schema_name: string; name: string; type: string }>).map((t) => ({
        name: tableLabel(t.schema_name, t.name, multi),
        type: t.type === 'VIEW' ? 'view' : 'table',
      }));

      const [columnRows] = await conn.query(
        `select table_schema as schema_name, table_name as table_name, column_name as name,
                column_type as type, is_nullable, column_key, column_default
           from information_schema.columns
          where table_schema in (${placeholders})
          order by table_schema, table_name, ordinal_position`,
        schemas,
      );
      const columns: Record<string, DbColumnInfo[]> = {};
      for (const c of columnRows as Array<{
        schema_name: string;
        table_name: string;
        name: string;
        type: string;
        is_nullable: string;
        column_key: string;
        column_default: unknown;
      }>) {
        const key = tableLabel(c.schema_name, c.table_name, multi);
        (columns[key] ??= []).push({
          name: c.name,
          type: c.type || 'unknown',
          notNull: c.is_nullable === 'NO',
          primaryKey: c.column_key === 'PRI',
          defaultValue: c.column_default,
        });
      }

      const [indexRows] = await conn.query(
        `select table_schema as schema_name, table_name as table_name, index_name as name,
                non_unique, column_name
           from information_schema.statistics
          where table_schema in (${placeholders})
          order by table_schema, table_name, index_name, seq_in_index`,
        schemas,
      );
      const indexes: Record<string, DbIndexInfo[]> = {};
      const seen = new Set<string>();
      for (const i of indexRows as Array<{
        schema_name: string;
        table_name: string;
        name: string;
        non_unique: number;
        column_name: string;
      }>) {
        const key = tableLabel(i.schema_name, i.table_name, multi);
        const id = `${key}\u0000${i.name}`;
        if (!seen.has(id)) {
          seen.add(id);
          (indexes[key] ??= []).push({ name: i.name, unique: i.non_unique === 0, columns: [i.column_name] });
        } else {
          indexes[key][indexes[key].length - 1].columns.push(i.column_name);
        }
      }

      return { tables, columns, indexes };
    } finally {
      await conn.end().catch(() => undefined);
    }
  }

  async exportRows(
    profile: MysqlProfile,
    secret: string | null,
    sql: string,
    params: unknown[] = [],
  ): Promise<{ columns: string[]; rows: unknown[][] }> {
    const result = await this.query(profile, secret, sql, params);
    if (result.kind !== 'read') throw new HttpError(400, '只能导出查询结果', 'not_read_only');
    return { columns: result.columns, rows: result.rows };
  }

  static quoteTable(name: string): string {
    return name.split('.').map(q).join('.');
  }
}
