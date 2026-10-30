import type { RuntimeHost } from '@ocg/host';
import { paths, type Workspace } from '@ocg/config';
import fs from 'node:fs';
import path from 'node:path';
import { HttpError, badRequest } from './http.js';

export type GitSafety = 'read' | 'write' | 'danger';

export interface GitCatalogEntry {
  id: string;
  title: string;
  argv: string[];
  safety: GitSafety;
  description: string;
  argsHint?: string;
}

export interface GitRunResult {
  id: string;
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  hints: Array<{ message: string; action?: string }>;
  snapshot?: string;
  redacted: boolean;
}

export interface GitHistoryEntry extends GitRunResult {
  time: number;
  workspaceID: string;
}

export const GIT_CATALOG: GitCatalogEntry[] = [
  {
    id: 'status',
    title: 'git status',
    argv: ['status', '--porcelain=v2', '--branch'],
    safety: 'read',
    description: '查看分支与工作区状态（porcelain v2）。',
  },
  {
    id: 'log',
    title: 'git log',
    argv: ['log', '--oneline', '-20', '--decorate'],
    safety: 'read',
    description: '最近 20 条提交。',
  },
  {
    id: 'diff-working',
    title: 'git diff（工作区）',
    argv: ['diff', '--stat'],
    safety: 'read',
    description: '工作区相对索引的统计差异。',
  },
  {
    id: 'diff-staged',
    title: 'git diff --cached',
    argv: ['diff', '--cached', '--stat'],
    safety: 'read',
    description: '已暂存内容的统计差异。',
  },
  {
    id: 'branches',
    title: 'git branch -vv',
    argv: ['branch', '-vv'],
    safety: 'read',
    description: '本地分支与 upstream 跟踪状态。',
  },
  {
    id: 'fetch',
    title: 'git fetch --all --prune',
    argv: ['fetch', '--all', '--prune'],
    safety: 'write',
    description: '拉取所有 remote 并清理已删除的远程分支引用。',
  },
  {
    id: 'pull-rebase',
    title: 'git pull --rebase',
    argv: ['pull', '--rebase'],
    safety: 'write',
    description: '以 rebase 方式同步当前分支。',
  },
  {
    id: 'push',
    title: 'git push',
    argv: ['push'],
    safety: 'write',
    description: '推送当前分支到 upstream。',
  },
  {
    id: 'add-all',
    title: 'git add -A',
    argv: ['add', '-A'],
    safety: 'write',
    description: '暂存全部变更（含删除与新增）。',
  },
  {
    id: 'clean-dry',
    title: 'git clean -nd',
    argv: ['clean', '-nd'],
    safety: 'read',
    description: '预演将删除的未跟踪文件，不实际删除。',
  },
  {
    id: 'reset-hard',
    title: 'git reset --hard HEAD',
    argv: ['reset', '--hard', 'HEAD'],
    safety: 'danger',
    description: '丢弃工作区与索引改动（危险，会先创建影子快照）。',
  },
  {
    id: 'clean-force',
    title: 'git clean -fd',
    argv: ['clean', '-fd'],
    safety: 'danger',
    description: '删除未跟踪文件/目录（危险，会先创建影子快照）。',
  },
  {
    id: 'push-force',
    title: 'git push --force-with-lease',
    argv: ['push', '--force-with-lease'],
    safety: 'danger',
    description: '强制推送（带 lease 保护；危险，需确认）。',
  },
];

const TOKEN_RE = /(ghp_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,})/g;
const PASSWORD_RE = /(password|passwd|token|secret)\s*[=:]\s*[^\s"']+/gi;

export function redactSecrets(text: string): { text: string; redacted: boolean } {
  let redacted = false;
  let out = text.replace(TOKEN_RE, () => {
    redacted = true;
    return '***REDACTED***';
  });
  out = out.replace(PASSWORD_RE, (m) => {
    redacted = true;
    return m.replace(/[=:]\s*.+$/, '=***REDACTED***');
  });
  return { text: out, redacted };
}

export function hintsFor(stderr: string, stdout = ''): Array<{ message: string; action?: string }> {
  const text = `${stderr}\n${stdout}`;
  const hints: Array<{ message: string; action?: string }> = [];
  if (/non-fast-forward|fetch first|rejected/i.test(text)) {
    hints.push({ message: '远程分支包含本地没有的提交，直接 push 会被拒绝。', action: '先执行 git pull --rebase，再 push。' });
  }
  if (/no upstream branch|has no upstream branch|set-upstream/i.test(text)) {
    hints.push({ message: '当前分支没有 upstream。', action: '执行 git push -u origin <branch> 设置跟踪。' });
  }
  if (/index\.lock|Another git process/i.test(text)) {
    hints.push({ message: 'Git 索引被锁定。', action: '确认没有其他 git 进程后删除 .git/index.lock（需手动确认）。' });
  }
  if (/not a git repository/i.test(text)) {
    hints.push({ message: '当前工作区不是 Git 仓库。', action: '在设置中选择正确的 workspace。' });
  }
  if (/Authentication failed|Permission denied|publickey|could not read Username/i.test(text)) {
    hints.push({ message: 'Git 凭据/SSH 认证失败。', action: '检查 ssh-agent、凭据管理器或 remote URL。' });
  }
  if (/Your local changes would be overwritten|Please commit your changes or stash/i.test(text)) {
    hints.push({ message: '本地改动会被覆盖。', action: '先 commit 或 git stash，再重试。' });
  }
  return hints;
}

export function validateExtraArgs(input: unknown): string[] {
  if (input == null) return [];
  if (!Array.isArray(input) || input.some((a) => typeof a !== 'string')) {
    badRequest('extra args must be a string array', 'invalid_args');
  }
  return input.filter((a: string) => {
    if (!/^[A-Za-z0-9._/@:=+-]+$/.test(a)) throw new HttpError(400, `unsafe git argument: ${a}`, 'invalid_args');
    if (/^--force$|^-f$|^--upload-pack|^--receive-pack|^--exec|^-c$/.test(a)) {
      throw new HttpError(403, `git argument rejected: ${a}`, 'git_forbidden');
    }
    return true;
  });
}

export class GitCommandService {
  private history = new Map<string, GitHistoryEntry[]>();

  constructor(private readonly host: RuntimeHost) {}

  catalog(): GitCatalogEntry[] {
    return GIT_CATALOG;
  }

  private historyFile(ws: Workspace): string {
    return path.join(paths.cache(), `git-history-${ws.id}.json`);
  }

  private loadHistory(ws: Workspace): GitHistoryEntry[] {
    const cached = this.history.get(ws.id);
    if (cached) return cached;
    try {
      const file = this.historyFile(ws);
      if (!fs.existsSync(file)) return [];
      const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (Array.isArray(raw)) {
        this.history.set(ws.id, raw);
        return raw;
      }
    } catch {
      /* ignore corrupt history */
    }
    return [];
  }

  private saveHistory(ws: Workspace, list: GitHistoryEntry[]): void {
    try {
      fs.mkdirSync(paths.cache(), { recursive: true });
      fs.writeFileSync(this.historyFile(ws), JSON.stringify(list.slice(0, 50), null, 2), 'utf8');
    } catch {
      /* cache is best effort */
    }
  }

  listHistory(ws: Workspace, limit = 30): GitHistoryEntry[] {
    return this.loadHistory(ws).slice(0, limit);
  }

  async run(
    ws: Workspace,
    input: { id?: string; args?: unknown; confirm?: string },
    onCreateSnapshot: (reason: string) => Promise<string | null>,
  ): Promise<GitRunResult> {
    const entry = GIT_CATALOG.find((c) => c.id === input.id);
    if (!entry) throw new HttpError(404, `unknown git command: ${input.id}`, 'git_command_not_found');
    const extra = validateExtraArgs(input.args);
    if (entry.safety === 'danger' && input.confirm !== 'CONFIRM') {
      throw new HttpError(400, '危险命令需要 confirm="CONFIRM"', 'git_confirm_required');
    }
    let snapshot: string | null = null;
    if (entry.safety === 'danger') {
      snapshot = await onCreateSnapshot(`before-git:${entry.id}`);
      if (!snapshot) throw new HttpError(500, '危险命令前无法创建快照，已中止', 'snapshot_required');
    }
    const argv = [...entry.argv, ...extra];
    const start = Date.now();
    const res = await this.host.exec('git', ['-c', 'core.quotePath=false', ...argv], {
      cwd: ws.path,
      timeoutMs: 120_000,
    });
    const durationMs = Date.now() - start;
    const out = redactSecrets(res.out);
    const err = redactSecrets(res.err);
    const result: GitRunResult = {
      id: entry.id,
      argv: ['git', ...argv],
      exitCode: res.code,
      stdout: out.text,
      stderr: err.text,
      durationMs,
      hints: res.code === 0 ? [] : hintsFor(err.text, out.text),
      ...(snapshot ? { snapshot } : {}),
      redacted: out.redacted || err.redacted,
    };
    const list = this.loadHistory(ws);
    list.unshift({ ...result, time: Date.now(), workspaceID: ws.id });
    const next = list.slice(0, 50);
    this.history.set(ws.id, next);
    this.saveHistory(ws, next);
    return result;
  }
}
