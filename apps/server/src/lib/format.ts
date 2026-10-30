import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths, type Workspace } from '@ocg/config';
import type { FileDiff } from '@ocg/diff';
import { parseUnifiedDiff } from '@ocg/diff';
import { createTwoFilesPatch } from 'diff';
import { format as sqlFormat, type SqlLanguage } from 'sql-formatter';
import { HttpError, badRequest } from './http.js';
import {
  applyEol,
  decodeText,
  encodeText,
  hashBuffer,
  isProbablyBinary,
  normalizeEol,
  readTextFile,
  relativePath,
  resolveInWorkspace,
  writeTextFileAtomic,
} from './fsutil.js';

export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb' | 'tsql' | 'plsql' | 'sql' | 'bigquery' | 'snowflake' | 'spark';

export interface FormatOptions {
  dialect?: SqlDialect;
  indent?: number;
  keywordCase?: 'upper' | 'lower' | 'preserve';
  linesBetweenQueries?: number;
  selection?: { from: number; to: number };
}

interface FormatPlan {
  id: string;
  ws: string;
  root: string;
  rel: string;
  abs: string;
  beforeHash: string;
  beforeRaw: Buffer;
  afterRaw: Buffer;
  createdAt: number;
}

const MAX_PLAN_AGE = 30 * 60 * 1000;

function dialectOf(value: string | undefined): SqlLanguage {
  const allowed: SqlLanguage[] = [
    'sqlite',
    'postgresql',
    'mysql',
    'mariadb',
    'tsql',
    'plsql',
    'sql',
    'bigquery',
    'snowflake',
    'spark',
  ];
  const d = (value ?? 'sqlite') as SqlLanguage;
  if (!allowed.includes(d)) badRequest(`unsupported SQL dialect: ${value}`, 'invalid_dialect');
  return d;
}

export function formatSql(text: string, options: FormatOptions = {}): string {
  try {
    return sqlFormat(text, {
      language: dialectOf(options.dialect),
      tabWidth: Math.max(1, Math.min(8, options.indent ?? 2)),
      keywordCase: options.keywordCase ?? 'upper',
      linesBetweenQueries: Math.max(0, Math.min(5, options.linesBetweenQueries ?? 1)),
    });
  } catch (err) {
    const full = err instanceof Error ? err.message : String(err);
    const first = full.split('\n')[0] ?? full;
    const m = /at line (\d+) column (\d+)/i.exec(first);
    const line = m ? Number(m[1]) : undefined;
    const column = m ? Number(m[2]) : undefined;
    const hint = '请检查括号/引号是否闭合，存储过程等方言扩展可尝试切换方言后重试。';
    throw new HttpError(422, first.replace(/^Parse error /i, 'SQL 解析失败：'), 'format_failed', {
      line,
      column,
      hint,
    });
  }
}

function makePatch(rel: string, before: string, after: string): FileDiff[] {
  const patch = createTwoFilesPatch(rel, rel, before, after, 'before', 'after', { context: 3 });
  return parseUnifiedDiff(patch);
}

export class FormatService {
  private plans = new Map<string, FormatPlan>();
  private undos = new Map<string, { id: string; dir: string; root: string; rel: string; hash: string }>();

  private gc(): void {
    const now = Date.now();
    for (const [id, plan] of this.plans) if (now - plan.createdAt > MAX_PLAN_AGE) this.plans.delete(id);
  }

  async preview(
    ws: Workspace,
    rel: string,
    options: FormatOptions,
  ): Promise<{ id: string; changed: boolean; files: FileDiff[]; before: string; after: string }> {
    this.gc();
    const abs = resolveInWorkspace(ws.path, rel);
    const info = await readTextFile(abs, { maxBytes: 2 * 1024 * 1024 });
    if (info.binary) throw new HttpError(415, '不能格式化二进制文件', 'binary_file');
    if (info.encoding !== 'utf-8') throw new HttpError(415, '只能格式化 UTF-8 文件', 'non_utf8');
    if (info.truncated) throw new HttpError(413, '文件超过 2MB，拒绝格式化', 'file_too_large');
    const beforeRaw = await fs.promises.readFile(abs);
    const eolTarget: 'lf' | 'crlf' = info.eol === 'crlf' ? 'crlf' : 'lf';
    const before = normalizeEol(info.content);
    let after: string;
    let afterRaw: Buffer;
    if (options.selection) {
      const { from, to } = options.selection;
      if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to <= from || to > info.content.length) {
        throw new HttpError(400, '选区范围无效', 'invalid_selection');
      }
      const selected = info.content.slice(from, to);
      const formatted = applyEol(normalizeEol(formatSql(normalizeEol(selected), options)), eolTarget);
      after = normalizeEol(info.content.slice(0, from) + formatted + info.content.slice(to));
      afterRaw = encodeText(info.content.slice(0, from) + formatted + info.content.slice(to), 'utf-8', info.bom);
    } else {
      after = normalizeEol(formatSql(before, options));
      afterRaw = encodeText(applyEol(after, eolTarget), 'utf-8', info.bom);
    }
    if (afterRaw.equals(beforeRaw) || after === before) {
      return { id: '', changed: false, files: [], before, after };
    }
    const id = randomUUID();
    this.plans.set(id, {
      id,
      ws: ws.id,
      root: ws.path,
      rel: relativePath(ws.path, abs),
      abs,
      beforeHash: hashBuffer(beforeRaw),
      beforeRaw,
      afterRaw,
      createdAt: Date.now(),
    });
    return { id, changed: true, files: makePatch(relativePath(ws.path, abs), before, after), before, after };
  }

  async apply(ws: Workspace, id: string): Promise<{ id: string; undoId: string; path: string; backup: string }> {
    this.gc();
    const plan = this.plans.get(id);
    if (!plan) throw new HttpError(410, '格式化预览已过期，请重新预览', 'preview_expired');
    if (plan.root.toLowerCase() !== ws.path.toLowerCase()) throw new HttpError(403, 'workspace mismatch', 'forbidden');
    const current = await fs.promises.readFile(plan.abs);
    if (hashBuffer(current) !== plan.beforeHash) {
      throw new HttpError(409, '文件在预览后已变化，请重新预览', 'conflict');
    }
    const dir = path.join(paths.backups(), `format-${plan.id}`);
    await fs.promises.mkdir(dir, { recursive: true });
    const backup = path.join(dir, plan.rel.replace(/[\\/]/g, '__'));
    await fs.promises.writeFile(backup, current);
    const written = await writeTextFileAtomic(plan.abs, plan.afterRaw.toString('utf8'), { baseHash: plan.beforeHash });
    const appliedHash = written.hash;
    const undoId = randomUUID();
    this.undos.set(undoId, {
      id: undoId,
      dir,
      root: plan.root,
      rel: plan.rel,
      hash: appliedHash,
    });
    await fs.promises.writeFile(
      path.join(dir, 'undo.json'),
      JSON.stringify({ id: undoId, root: plan.root, rel: plan.rel, hash: appliedHash, createdAt: Date.now() }, null, 2),
      'utf8',
    );
    this.plans.delete(id);
    return { id, undoId, path: plan.rel, backup };
  }

  async undo(ws: Workspace, undoId: string): Promise<{ restored: boolean; path: string }> {
    let undo = this.undos.get(undoId);
    if (!undo) {
      const dirs = await fs.promises.readdir(paths.backups(), { withFileTypes: true }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDirectory() || !d.name.startsWith('format-')) continue;
        try {
          const json = JSON.parse(await fs.promises.readFile(path.join(paths.backups(), d.name, 'undo.json'), 'utf8'));
          if (json.id === undoId) {
            undo = { id: json.id, dir: path.join(paths.backups(), d.name), root: json.root, rel: json.rel, hash: json.hash };
            break;
          }
        } catch {
          /* noop */
        }
      }
    }
    if (!undo) throw new HttpError(404, '撤销记录不存在', 'undo_not_found');
    if (undo.root.toLowerCase() !== ws.path.toLowerCase()) throw new HttpError(403, 'workspace mismatch', 'forbidden');
    const abs = path.join(undo.root, undo.rel);
    const current = await fs.promises.readFile(abs);
    if (hashBuffer(current) !== undo.hash) throw new HttpError(409, '文件在格式化后又被修改，拒绝覆盖', 'conflict');
    const backup = path.join(undo.dir, undo.rel.replace(/[\\/]/g, '__'));
    await fs.promises.writeFile(abs, await fs.promises.readFile(backup));
    return { restored: true, path: undo.rel };
  }
}
