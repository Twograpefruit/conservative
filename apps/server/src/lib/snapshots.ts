import fs from 'node:fs';
import path from 'node:path';
import { paths, projectHash, type Workspace } from '@ocg/config';
import type { SnapshotInfo } from '@ocg/protocol';
import { parseUnifiedDiff, type FileDiff } from '@ocg/diff';
import type { RuntimeHost } from '@ocg/host';
import { HttpError } from './http.js';

interface SnapshotMessage {
  reason: string;
  time: number;
  files?: number;
}

const EXCLUDES = [
  '.git/',
  '.venv/',
  'venv/',
  'env/',
  'node_modules/',
  '__pycache__/',
  '*.pyc',
  '*.pyo',
  'dist/',
  'build/',
  'coverage/',
  '.mypy_cache/',
  '.pytest_cache/',
  '.ruff_cache/',
  '.next/',
  '.turbo/',
  '.idea/',
  '.vscode/',
  'target/',
  '*.log',
  '*.tmp',
  'Thumbs.db',
  '.DS_Store',
];

export class SnapshotService {
  constructor(private readonly host: RuntimeHost) {}

  dir(ws: Workspace): string {
    return paths.projectHashDir(projectHash(ws.path));
  }

  private async git(ws: Workspace, args: string[], opts: { input?: string } = {}) {
    const dir = this.dir(ws);
    return this.host.exec('git', ['-c', 'core.quotePath=false', `--git-dir=${dir}`, `--work-tree=${ws.path}`, ...args], {
      cwd: ws.path,
      timeoutMs: 120_000,
      input: opts.input,
    });
  }

  async ensure(ws: Workspace): Promise<string> {
    const dir = this.dir(ws);
    fs.mkdirSync(dir, { recursive: true });
    const head = await this.git(ws, ['rev-parse', '--verify', 'HEAD']);
    if (head.code !== 0) {
      if (!fs.existsSync(path.join(dir, 'HEAD'))) {
        const init = await this.host.exec('git', ['init', '--bare', dir], { timeoutMs: 30_000 });
        if (init.code !== 0) throw new HttpError(500, init.err || 'failed to create snapshot repository', 'snapshot_init');
      }
      await this.git(ws, ['config', 'core.bare', 'false']);
      await this.git(ws, ['config', 'core.worktree', ws.path]);
      await this.git(ws, ['config', 'core.autocrlf', 'false']);
      await this.git(ws, ['config', 'core.safecrlf', 'false']);
      await this.git(ws, ['config', 'user.name', 'opencode-gui']);
      await this.git(ws, ['config', 'user.email', 'snapshots@opencode-gui.local']);
      const excludeFile = path.join(dir, 'exclude');
      if (!fs.existsSync(excludeFile)) fs.writeFileSync(excludeFile, EXCLUDES.join('\n') + '\n', 'utf8');
      await this.git(ws, ['config', 'core.excludesFile', excludeFile]);
      // Start from a clean index; afterwards `add -A` keeps it in sync.
      await this.git(ws, ['rm', '-r', '--cached', '.', '--ignore-unmatch']);
    }
    return dir;
  }

  async create(ws: Workspace, reason: string): Promise<SnapshotInfo> {
    await this.ensure(ws);
    const add = await this.git(ws, ['add', '-A']);
    if (add.code !== 0) throw new HttpError(500, add.err || 'snapshot add failed', 'snapshot_error');
    const time = Date.now();
    const message = JSON.stringify({ reason, time } satisfies SnapshotMessage);
    const commit = await this.git(ws, [
      'commit',
      '--allow-empty',
      '--no-verify',
      '-m',
      message,
    ]);
    if (commit.code !== 0) {
      throw new HttpError(500, commit.err || commit.out || 'snapshot commit failed', 'snapshot_error');
    }
    const head = await this.git(ws, ['rev-parse', 'HEAD']);
    let id = head.out.trim();
    const files = await this.fileCount(ws, id);
    const enriched = JSON.stringify({ reason, time, files } satisfies SnapshotMessage);
    const amend = await this.git(ws, ['commit', '--amend', '--allow-empty', '--no-verify', '-m', enriched]);
    if (amend.code === 0) {
      const head2 = await this.git(ws, ['rev-parse', 'HEAD']);
      if (head2.out.trim()) id = head2.out.trim();
    }
    return { id, reason, time, files, createdAt: new Date(time).toISOString() };
  }

  private async fileCount(ws: Workspace, id: string): Promise<number> {
    const res = await this.git(ws, ['ls-tree', '-r', '--name-only', id]);
    if (res.code !== 0) return 0;
    return res.out.split(/\r?\n/).filter(Boolean).length;
  }

  async list(ws: Workspace, limit = 50): Promise<SnapshotInfo[]> {
    const dir = this.dir(ws);
    if (!fs.existsSync(path.join(dir, 'HEAD'))) return [];
    const res = await this.git(ws, ['log', `-n${Math.max(1, Math.min(limit, 200))}`, '--pretty=format:%H%x1f%ct%x1f%s']);
    if (res.code !== 0) return [];
    return res.out
      .split(/\r?\n/)
      .filter(Boolean)
      .map((line) => {
        const [id, ct, subject] = line.split('\x1f');
        let meta: SnapshotMessage = { reason: subject ?? '', time: Number(ct) * 1000 };
        try {
          meta = JSON.parse(subject) as SnapshotMessage;
        } catch {
          /* legacy */
        }
        return {
          id,
          reason: meta.reason ?? subject ?? '',
          time: meta.time ?? Number(ct) * 1000,
          files: meta.files ?? 0,
          createdAt: new Date((meta.time ?? Number(ct) * 1000)).toISOString(),
        };
      });
  }

  async diff(ws: Workspace, a: string, b: string): Promise<FileDiff[]> {
    await this.ensure(ws);
    const res = await this.git(ws, ['diff', '--no-color', '--no-ext-diff', '--src-prefix=a/', '--dst-prefix=b/', a, b, '--']);
    if (res.code !== 0) throw new HttpError(500, res.err || 'snapshot diff failed', 'snapshot_error');
    return parseUnifiedDiff(res.out);
  }

  async restore(ws: Workspace, id: string): Promise<{ preSnapshot: string; restored: number; removed: number; skipped: string[] }> {
    await this.ensure(ws);
    const verify = await this.git(ws, ['cat-file', '-e', `${id}^{commit}`]);
    if (verify.code !== 0) throw new HttpError(404, 'snapshot not found', 'snapshot_not_found');
    const pre = await this.create(ws, `before-restore:${id}`);
    const preId = pre.id;

    // Remove files that were added after the target snapshot, moving them to a backup first.
    const compare = await this.git(ws, ['diff', '--name-status', id, preId, '--']);
    const removed: string[] = [];
    if (compare.code === 0) {
      for (const line of compare.out.split(/\r?\n/)) {
        if (!line.startsWith('A\t')) continue;
        const rel = line.slice(2);
        const abs = path.join(ws.path, rel);
        const backup = path.join(paths.backups(), `restore-${id}`, rel.replace(/[\\/]/g, '__'));
        try {
          await fs.promises.mkdir(path.dirname(backup), { recursive: true });
          await fs.promises.rename(abs, backup);
          removed.push(rel);
        } catch {
          /* keep going */
        }
      }
    }
    const checkout = await this.git(ws, ['checkout', id, '--', '.']);
    if (checkout.code !== 0) throw new HttpError(500, checkout.err || 'snapshot restore failed', 'snapshot_restore');
    const ls = await this.git(ws, ['ls-tree', '-r', '--name-only', id]);
    const restored = ls.out.split(/\r?\n/).filter(Boolean).length;
    return { preSnapshot: preId, restored, removed: removed.length, skipped: [] };
  }
}
