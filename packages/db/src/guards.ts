/** Pure SQL statement guards shared by the BFF and tests. */

export class SqlGuardError extends Error {
  constructor(
    message: string,
    public readonly code: 'multiple_statements' | 'not_read_only' | 'unsafe_pragma' | 'empty',
  ) {
    super(message);
  }
}

export type SqlKind = 'read' | 'write';

interface Masked {
  masked: string;
  semicolons: number[];
}

/**
 * Replace string literals and comments with spaces while preserving length.
 * This prevents keywords inside strings/comments from affecting guard decisions.
 */
export function maskSql(sql: string): Masked {
  const chars = sql.split('');
  const semicolons: number[] = [];
  let i = 0;
  let state: 'normal' | 'single' | 'double' | 'backtick' | 'bracket' | 'line' | 'block' = 'normal';
  while (i < sql.length) {
    const c = sql[i];
    const next = sql[i + 1];
    if (state === 'normal') {
      if (c === "'") state = 'single';
      else if (c === '"') state = 'double';
      else if (c === '`') state = 'backtick';
      else if (c === '[') state = 'bracket';
      else if (c === '-' && next === '-') {
        state = 'line';
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
        continue;
      } else if (c === '/' && next === '*') {
        state = 'block';
        chars[i] = ' ';
        chars[i + 1] = ' ';
        i += 2;
        continue;
      } else if (c === ';') semicolons.push(i);
      i++;
      continue;
    }
    if (state === 'line') {
      if (c === '\n') state = 'normal';
      chars[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    if (state === 'block') {
      if (c === '*' && next === '/') {
        chars[i] = ' ';
        chars[i + 1] = ' ';
        state = 'normal';
        i += 2;
        continue;
      }
      chars[i] = c === '\n' ? '\n' : ' ';
      i++;
      continue;
    }
    // Inside quoted values.
    if (state === 'bracket') {
      if (c === ']') state = 'normal';
    } else {
      const closing = state === 'single' ? "'" : state === 'double' ? '"' : state === 'backtick' ? '`' : null;
      if (closing && c === closing) {
        if (state === 'single' && next === "'") {
          chars[i] = ' ';
          chars[i + 1] = ' ';
          i += 2;
          continue;
        }
        state = 'normal';
      }
    }
    chars[i] = c === '\n' ? '\n' : ' ';
    i++;
  }
  return { masked: chars.join(''), semicolons };
}

export function assertSingleStatement(sql: string): void {
  if (!sql.trim()) throw new SqlGuardError('SQL 不能为空', 'empty');
  const { masked, semicolons } = maskSql(sql);
  if (semicolons.length <= 1) return;
  for (let i = 0; i < semicolons.length; i++) {
    const after = masked.slice(semicolons[i] + 1).trim();
    if (after) {
      throw new SqlGuardError('只允许单条语句；检测到多条 SQL', 'multiple_statements');
    }
  }
}

const WRITE_RE = /\b(insert|update|delete|replace|create|drop|alter|attach|detach|vacuum|reindex|truncate|grant|revoke|merge|call|exec|execute|unlock|lock|begin|commit|rollback|savepoint|release)\b/i;
const READ_PRAGMAS = new Set([
  'table_info',
  'table_list',
  'table_xinfo',
  'index_list',
  'index_info',
  'index_xinfo',
  'foreign_key_list',
  'database_list',
  'compile_options',
  'collation_list',
  'function_list',
  'module_list',
  'pragma_list',
]);

export function classifySql(sql: string): SqlKind {
  const { masked } = maskSql(sql);
  const clean = masked.trim().toLowerCase();
  if (!clean) return 'read';
  if (clean.startsWith('pragma')) {
    const body = clean.slice('pragma'.length).trim();
    const name = body.split(/[\s(;]/)[0] ?? '';
    if (body.includes('=') || !READ_PRAGMAS.has(name)) {
      throw new SqlGuardError(`PRAGMA ${name} 不是只读诊断语句`, 'unsafe_pragma');
    }
    return 'read';
  }
  if (!/^(select|with|explain)\b/.test(clean)) return 'write';
  if (WRITE_RE.test(clean)) return 'write';
  return 'read';
}

export function assertReadOnly(sql: string): SqlKind {
  assertSingleStatement(sql);
  const kind = classifySql(sql);
  if (kind === 'write') {
    throw new SqlGuardError('当前连接档案为只读，拒绝执行写操作', 'not_read_only');
  }
  return kind;
}

export function assertStatement(sql: string, readOnly: boolean): SqlKind {
  assertSingleStatement(sql);
  const kind = classifySql(sql);
  if (readOnly && kind !== 'read') {
    throw new SqlGuardError('当前连接档案为只读，拒绝执行写操作', 'not_read_only');
  }
  return kind;
}
