import fs from 'node:fs';
import path from 'node:path';
import type { RuntimeHost } from '@ocg/host';
import type { FileDiffInfo, GitLogEntry, GitStatusEntry } from '@ocg/protocol';
import { buildPatch, parseUnifiedDiff, type FileDiff } from '@ocg/diff';
import { HttpError, badRequest } from './http.js';

export interface GitContext {
  host: RuntimeHost;
  root: string;
}

async function git(ctx: GitContext, args: string[], opts: { input?: string; timeoutMs?: number } = {}) {
  const full = ['-c', 'core.quotePath=false', ...args];
  let res = await ctx.host.exec('git', full, { cwd: ctx.root, timeoutMs: opts.timeoutMs ?? 60_000, input: opts.input });
  if (res.code !== 0 && /index\.lock/.test(res.err)) {
    await new Promise((r) => setTimeout(r, 150));
    res = await ctx.host.exec('git', full, { cwd: ctx.root, timeoutMs: opts.timeoutMs ?? 60_000, input: opts.input });
  }
  return res;
}

export async function ensureGitRepo(ctx: GitContext): Promise<boolean> {
  const res = await git(ctx, ['rev-parse', '--is-inside-work-tree']);
  return res.code === 0 && res.out.trim() === 'true';
}

function mapStatus(x: string, y: string): GitStatusEntry['status'] {
  if (x === '?' || y === '?') return 'untracked';
  if (x === 'U' || y === 'U' || (x === 'A' && y === 'A') || (x === 'D' && y === 'D')) return 'conflict';
  if (x === 'R' || y === 'R') return 'renamed';
  if (x === 'A' || y === 'A') return 'added';
  if (x === 'D' || y === 'D') return 'deleted';
  if (x === 'M' || y === 'M') return 'modified';
  return 'unknown';
}

export async function status(ctx: GitContext): Promise<GitStatusEntry[]> {
  const res = await git(ctx, ['status', '--porcelain=v1', '-z', '--untracked-files=all']);
  if (res.code !== 0) throw new HttpError(500, res.err.trim() || 'git status failed', 'git_error');
  const parts = res.out.split('\0');
  const out: GitStatusEntry[] = [];
  for (let i = 0; i < parts.length; i++) {
    const entry = parts[i];
    if (!entry) continue;
    const x = entry[0];
    const y = entry[1];
    let file = entry.slice(3);
    if (x === 'R' || x === 'C') {
      const old = parts[++i] ?? '';
      if (old) file = `${old} -> ${file}`;
    }
    out.push({ path: file, index: x, worktree: y, status: mapStatus(x, y) });
  }
  return out;
}

export async function log(ctx: GitContext, limit = 40): Promise<GitLogEntry[]> {
  const res = await git(ctx, [
    'log',
    `-n${Math.max(1, Math.min(limit, 200))}`,
    '--pretty=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s',
  ]);
  if (res.code !== 0) {
    if (/not a git repository/i.test(res.err)) return [];
    throw new HttpError(500, res.err.trim() || 'git log failed', 'git_error');
  }
  return res.out
    .split(/\r?\n/)
    .filter(Boolean)
    .map((line) => {
      const [hash, short, author, date, subject] = line.split('\x1f');
      return { hash, short, author, date, subject };
    });
}

export async function info(ctx: GitContext): Promise<{
  repo: boolean;
  root?: string;
  branch?: string;
  head?: string;
  detached?: boolean;
  shallow?: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}> {
  const inside = await ensureGitRepo(ctx);
  if (!inside) return { repo: false };
  const branch = await git(ctx, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const head = await git(ctx, ['rev-parse', 'HEAD']);
  const shallow = await git(ctx, ['rev-parse', '--is-shallow-repository']);
  const upstreamRes = await git(ctx, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  const upstream = upstreamRes.code === 0 ? upstreamRes.out.trim() : undefined;
  let ahead = 0;
  let behind = 0;
  if (upstream) {
    const counts = await git(ctx, ['rev-list', '--left-right', '--count', `@{u}...HEAD`]);
    if (counts.code === 0) {
      const [behindRaw, aheadRaw] = counts.out.trim().split(/\s+/);
      behind = Number(behindRaw) || 0;
      ahead = Number(aheadRaw) || 0;
    }
  }
  const name = branch.out.trim();
  return {
    repo: true,
    root: ctx.root,
    branch: name === 'HEAD' ? undefined : name,
    head: head.code === 0 ? head.out.trim() : undefined,
    detached: name === 'HEAD',
    shallow: shallow.out.trim() === 'true',
    upstream,
    ahead,
    behind,
  };
}

export type DiffMode = 'working' | 'staged' | 'commit' | 'head';

export async function diff(ctx: GitContext, mode: DiffMode, base?: string): Promise<FileDiff[]> {
  let args: string[];
  switch (mode) {
    case 'staged':
      args = ['diff', '--cached', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
      break;
    case 'commit':
      if (!base) badRequest('base is required for commit diffs');
      args = ['show', '--format=', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', base];
      break;
    case 'head':
      args = ['diff', 'HEAD', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
      break;
    case 'working':
    default:
      args = ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/'];
      break;
  }
  const res = await git(ctx, args, { timeoutMs: 120_000 });
  if (res.code !== 0) {
    if (/not a git repository/i.test(res.err)) return [];
    throw new HttpError(500, res.err.trim() || 'git diff failed', 'git_error');
  }
  const files = parseUnifiedDiff(res.out);
  if (mode === 'working' || mode === 'head') {
    const st = await status(ctx);
    const known = new Set(files.map((f) => f.path));
    for (const entry of st.filter((e) => e.status === 'untracked')) {
      if (known.has(entry.path)) continue;
      const synthetic = await untrackedDiff(ctx.root, entry.path);
      if (synthetic) files.push(synthetic);
    }
  }
  return files;
}

async function untrackedDiff(root: string, rel: string): Promise<FileDiff | null> {
  const abs = path.join(root, rel);
  try {
    const stat = await fs.promises.stat(abs);
    if (!stat.isFile() || stat.size > 2 * 1024 * 1024) return null;
    const buf = await fs.promises.readFile(abs);
    if (buf.includes(0)) return null;
    const text = new TextDecoder('utf-8', { fatal: true }).decode(buf);
    const lines = text.split(/\r?\n/);
    if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
    const body = lines.map((l) => '+' + l).join('\n');
    const patch = `diff --git a/${rel} b/${rel}\nnew file mode 100644\nindex 0000000..1111111\n--- /dev/null\n+++ b/${rel}\n@@ -0,0 +1,${lines.length} @@\n${body}\n`;
    return parseUnifiedDiff(patch)[0] ?? null;
  } catch {
    return null;
  }
}

export async function toFileDiffInfo(files: FileDiff[]): Promise<FileDiffInfo[]> {
  return files.map((f) => ({
    file: f.path,
    patch: buildPatch(f),
    additions: f.additions,
    deletions: f.deletions,
    status: f.status === 'added' || f.status === 'deleted' ? f.status : 'modified',
  }));
}

const WHITELIST = new Set([
  'status',
  'log',
  'diff',
  'show',
  'branch',
  'rev-parse',
  'ls-files',
  'add',
  'restore',
  'reset',
  'commit',
  'stash',
  'checkout',
  'switch',
  'mv',
  'rm',
  'tag',
  'config',
  'remote',
  'merge-base',
  'blame',
]);

export async function execWhitelisted(ctx: GitContext, args: string[]): Promise<{ code: number; out: string; err: string }> {
  if (!Array.isArray(args) || args.length === 0) badRequest('args is required');
  const first = args[0];
  if (!WHITELIST.has(first)) throw new HttpError(403, `git "${first}" is not allowed`, 'git_forbidden');
  if (args.some((a) => /^(--exec|-c|--upload-pack|--receive-pack|--config)$/.test(a))) {
    throw new HttpError(403, 'unsafe git argument rejected', 'git_forbidden');
  }
  if (first === 'config' && !args.includes('--get')) {
    throw new HttpError(403, 'only `git config --get` is allowed', 'git_forbidden');
  }
  const res = await git(ctx, args, { timeoutMs: 120_000 });
  return { code: res.code, out: res.out, err: res.err };
}

export type HunkAction = 'stage' | 'unstage' | 'discard';

export async function applyHunk(
  ctx: GitContext,
  input: { path: string; hunkIndex: number; action: HunkAction; mode?: DiffMode; base?: string },
): Promise<{ ok: true }> {
  const mode: DiffMode = input.action === 'unstage' ? 'staged' : 'working';
  const files = await diff(ctx, input.mode ?? mode, input.base);
  const file = files.find((f) => f.path === input.path || f.oldPath === input.path);
  if (!file) throw new HttpError(404, `file not found in diff: ${input.path}`, 'diff_not_found');
  if (input.hunkIndex < 0 || input.hunkIndex >= file.hunks.length) {
    throw new HttpError(400, `hunk index out of range: ${input.hunkIndex}`, 'hunk_out_of_range');
  }
  const patch = buildPatch(file, input.hunkIndex);
  const args =
    input.action === 'stage'
      ? ['apply', '--cached', '--whitespace=nowarn', '-']
      : input.action === 'unstage'
        ? ['apply', '--cached', '-R', '--whitespace=nowarn', '-']
        : ['apply', '-R', '--whitespace=nowarn', '-'];
  const res = await git(ctx, args, { input: patch, timeoutMs: 30_000 });
  if (res.code !== 0) throw new HttpError(409, res.err.trim() || 'git apply failed', 'apply_failed');
  return { ok: true };
}

export async function commit(
  ctx: GitContext,
  message: string,
  stageAll = false,
): Promise<{ ok: true; out: string }> {
  if (!message.trim()) badRequest('commit message is required');
  if (stageAll) {
    const add = await git(ctx, ['add', '-A'], { timeoutMs: 120_000 });
    if (add.code !== 0) throw new HttpError(409, add.err.trim() || 'git add failed', 'add_failed');
  }
  const staged = await git(ctx, ['diff', '--cached', '--name-only']);
  if (staged.code === 0 && staged.out.trim() === '') {
    throw new HttpError(409, '没有已暂存的改动。请先暂存文件，或勾选“提交前暂存全部变更”。', 'nothing_staged');
  }
  const res = await git(ctx, ['commit', '-m', message], { timeoutMs: 120_000 });
  if (res.code !== 0) throw new HttpError(409, res.err.trim() || res.out.trim() || 'git commit failed', 'commit_failed');
  return { ok: true, out: res.out + res.err };
}

export async function push(
  ctx: GitContext,
  input: { remote?: string; branch?: string; setUpstream?: boolean } = {},
): Promise<{ ok: true; out: string; remote: string; branch: string; setUpstream: boolean }> {
  const repoInfo = await info(ctx);
  if (!repoInfo.repo) throw new HttpError(400, 'not a git repository', 'not_repo');
  if (!repoInfo.branch) throw new HttpError(409, '当前处于 detached HEAD，无法直接推送，请先切换分支', 'detached_head');
  const branch = (input.branch ?? repoInfo.branch).trim();
  const remote = (input.remote ?? repoInfo.upstream?.split('/')[0] ?? 'origin').trim();
  const safeName = /^[A-Za-z0-9._-]+$/;
  if (!safeName.test(remote)) throw new HttpError(400, 'invalid remote name', 'invalid_remote');
  if (!/^[A-Za-z0-9._/-]+$/.test(branch) || branch.startsWith('-') || branch.includes('..')) {
    throw new HttpError(400, 'invalid branch name', 'invalid_branch');
  }
  const remotes = await git(ctx, ['remote']);
  if (remotes.code !== 0) throw new HttpError(500, remotes.err || 'git remote failed', 'git_error');
  if (!remotes.out.split(/\r?\n/).map((s) => s.trim()).includes(remote)) {
    throw new HttpError(409, `远程仓库 "${remote}" 不存在；请先配置 git remote`, 'remote_not_found');
  }
  const shouldSetUpstream = input.setUpstream ?? !repoInfo.upstream;
  const args = ['push', ...(shouldSetUpstream ? ['-u'] : []), remote, branch];
  const res = await git(ctx, args, { timeoutMs: 180_000 });
  if (res.code !== 0) {
    throw new HttpError(409, res.err.trim() || res.out.trim() || 'git push failed', 'push_failed');
  }
  return { ok: true, out: (res.out + res.err).trim(), remote, branch, setUpstream: shouldSetUpstream };
}
