import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IGNORED_DIRS } from '@ocg/config';
import type { SearchFileResult, SearchMatch, SearchOptions } from '@ocg/protocol';
import type { RuntimeHost } from '@ocg/host';
import { rgPath } from '@vscode/ripgrep';
import { resolveInWorkspace } from './fsutil.js';

export interface SearchContext {
  host: RuntimeHost;
  rgPath: string | null;
}

export async function resolveRg(host: RuntimeHost): Promise<string | null> {
  const system = await host.which('rg');
  if (system) return system;
  try {
    if (fs.existsSync(rgPath)) return rgPath;
  } catch {
    /* package not installed */
  }
  return null;
}

export function buildMatcher(opts: Pick<SearchOptions, 'query' | 'regex' | 'caseSensitive' | 'wholeWord'>): RegExp {
  let pattern = opts.regex ? opts.query : opts.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (opts.wholeWord) pattern = `\\b(?:${pattern})\\b`;
  return new RegExp(pattern, opts.caseSensitive ? 'g' : 'gi');
}

function toJsColumn(line: string, byteOffset: number): number {
  const buf = Buffer.from(line, 'utf8');
  return buf.subarray(0, byteOffset).toString('utf8').length;
}

async function* searchWithRg(
  ctx: SearchContext,
  root: string,
  opts: SearchOptions,
  signal?: AbortSignal,
): AsyncGenerator<SearchFileResult> {
  const args = [
    '--json',
    '--line-number',
    '--column',
    '--no-heading',
    '--color',
    'never',
    '--no-messages',
    '--max-filesize',
    '4M',
    ...(opts.regex ? [] : ['--fixed-strings']),
    ...(opts.caseSensitive ? ['--case-sensitive'] : ['--ignore-case']),
    ...(opts.wholeWord ? ['--word-regexp'] : []),
    ...(opts.glob ? ['--glob', opts.glob] : []),
    '--glob',
    '!**/{node_modules,.venv,venv,env,__pycache__,.git,dist,build,coverage,.mypy_cache,.pytest_cache,.ruff_cache,target}/**',
    '--glob',
    '!**/*.{png,jpg,jpeg,gif,webp,ico,pdf,zip,gz,exe,dll,pyc,woff,woff2,ttf,mp4,mp3}',
    '-e',
    opts.query,
    '.',
  ];

  const child = spawn(ctx.rgPath!, args, {
    cwd: root,
    windowsHide: true,
    env: { ...process.env, RIPGREP_CONFIG_PATH: '' },
  });
  const onAbort = () => child.kill();
  signal?.addEventListener('abort', onAbort, { once: true });

  let buf = '';
  let currentPath: string | null = null;
  let currentMatches: SearchMatch[] = [];
  let total = 0;

  const flush = (): SearchFileResult | null => {
    if (!currentPath) return null;
    const result = { path: currentPath, matches: currentMatches };
    currentPath = null;
    currentMatches = [];
    return result;
  };

  const stdout = child.stdout;
  for await (const chunk of stdout) {
    if (signal?.aborted) break;
    buf += (chunk as Buffer).toString('utf8');
    let idx: number;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).replace(/\r$/, '');
      buf = buf.slice(idx + 1);
      if (!line.trim()) continue;
      let parsed: {
        type: string;
        data?: {
          path?: { text?: string };
          lines?: { text?: string };
          line_number?: number;
          submatches?: Array<{ start: number; end: number; match?: { text?: string } }>;
        };
      };
      try {
        parsed = JSON.parse(line);
      } catch {
        continue;
      }
      if (parsed.type !== 'match' || !parsed.data?.path?.text || !parsed.data.lines?.text) continue;
      const file = parsed.data.path.text.replace(/\\/g, '/').replace(/^\.\//, '');
      if (opts.cursor && file <= opts.cursor) continue;
      const rawLine = parsed.data.lines.text.replace(/\r?\n$/, '');
      const lineNo = parsed.data.line_number ?? 0;
      const subs = parsed.data.submatches ?? [];
      for (const sub of subs) {
        if (total >= (opts.maxResults ?? 2000)) break;
        const startCol = toJsColumn(rawLine, sub.start);
        const endCol = toJsColumn(rawLine, sub.end);
        if (file !== currentPath) {
          const done = flush();
          if (done) yield done;
          currentPath = file;
        }
        currentMatches.push({
          line: lineNo,
          column: startCol + 1,
          endColumn: endCol + 1,
          text: rawLine.slice(0, 500),
          match: (sub.match?.text ?? rawLine.slice(startCol, endCol)).slice(0, 500),
        });
        total++;
      }
      if (total >= (opts.maxResults ?? 2000)) {
        child.kill();
        break;
      }
    }
  }
  child.kill();
  signal?.removeEventListener('abort', onAbort);
  const last = flush();
  if (last) yield last;
}

async function* searchWithNode(
  root: string,
  opts: SearchOptions,
  signal?: AbortSignal,
): AsyncGenerator<SearchFileResult> {
  const re = buildMatcher(opts);
  const max = opts.maxResults ?? 2000;
  let total = 0;
  const glob = opts.glob ? new RegExp('^' + opts.glob.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$') : null;

  async function* walk(dir: string): AsyncGenerator<string> {
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (signal?.aborted) return;
      if (entry.isDirectory()) {
        if (IGNORED_DIRS.has(entry.name)) continue;
        yield* walk(path.join(dir, entry.name));
      } else if (entry.isFile()) {
        const rel = path.relative(root, path.join(dir, entry.name)).replace(/\\/g, '/');
        if (glob && !glob.test(rel)) continue;
        yield rel;
      }
    }
  }

  for await (const rel of walk(root)) {
    if (signal?.aborted || total >= max) break;
    if (opts.cursor && rel <= opts.cursor) continue;
    const abs = path.join(root, rel);
    try {
      const stat = await fs.promises.stat(abs);
      if (stat.size > 4 * 1024 * 1024) continue;
      const buf = await fs.promises.readFile(abs);
      if (buf.includes(0)) continue;
      const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
      const lines = text.split(/\r?\n/);
      const matches: SearchMatch[] = [];
      for (let i = 0; i < lines.length && total < max; i++) {
        const line = lines[i];
        re.lastIndex = 0;
        let m: RegExpExecArray | null;
        while ((m = re.exec(line)) !== null) {
          matches.push({
            line: i + 1,
            column: m.index + 1,
            endColumn: m.index + m[0].length + 1,
            text: line.slice(0, 500),
            match: m[0].slice(0, 500),
          });
          total++;
          if (m[0].length === 0) re.lastIndex++;
          if (total >= max) break;
        }
      }
      if (matches.length) yield { path: rel, matches };
    } catch {
      /* unreadable/non-utf8 */
    }
  }
}

export function searchWorkspace(
  ctx: SearchContext,
  root: string,
  opts: SearchOptions,
  signal?: AbortSignal,
): AsyncGenerator<SearchFileResult> {
  resolveInWorkspace(root, '.');
  return ctx.rgPath ? searchWithRg(ctx, root, opts, signal) : searchWithNode(root, opts, signal);
}

export async function collectSearch(
  ctx: SearchContext,
  root: string,
  opts: SearchOptions,
  signal?: AbortSignal,
): Promise<{ files: SearchFileResult[]; truncated: boolean }> {
  const files: SearchFileResult[] = [];
  let count = 0;
  let truncated = false;
  for await (const file of searchWorkspace(ctx, root, opts, signal)) {
    files.push(file);
    count += file.matches.length;
    if (count >= (opts.maxResults ?? 2000)) {
      truncated = true;
      break;
    }
  }
  return { files, truncated };
}
