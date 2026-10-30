import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { appDataDir } from '@ocg/config';
import type { RuntimeHost } from '@ocg/host';
import type { Workspace } from '@ocg/config';
import { HttpError, badRequest } from './http.js';
import type { CredentialStore } from './credentials.js';

export type GitProvider = 'gitee' | 'github' | 'git';

export interface GitProfilePublic {
  id: string;
  label: string;
  provider: GitProvider;
  remoteUrl: string;
  username?: string;
  hasToken: boolean;
  createdAt: number;
}

interface StoredGitProfile extends Omit<GitProfilePublic, 'hasToken'> {
  authRef?: string;
}

export interface GitProfileInput {
  label?: string;
  provider?: GitProvider;
  remoteUrl?: string;
  username?: string;
  secret?: string;
  clearToken?: boolean;
}

const PROVIDERS: GitProvider[] = ['gitee', 'github', 'git'];

export function validateRemote(url: string): string {
  const trimmed = url.trim();
  if (!trimmed) badRequest('remoteUrl is required', 'missing_remote');
  if (trimmed.length > 500) badRequest('remoteUrl is too long', 'invalid_remote');
  if (/^https?:\/\/[^/]*@/i.test(trimmed)) {
    badRequest('remoteUrl 不能包含明文用户名/密码，请把令牌放到密码字段', 'remote_contains_credentials');
  }
  if (/^(https?:\/\/|ssh:\/\/|git@)/i.test(trimmed)) return trimmed;
  badRequest('remoteUrl 必须是 https://、ssh:// 或 git@ 形式', 'invalid_remote');
  return trimmed;
}

export class GitProfileStore {
  private file = path.join(appDataDir(), 'git-profiles.json');
  private list: StoredGitProfile[] = [];

  constructor(
    private readonly host: RuntimeHost,
    private readonly credentials: CredentialStore,
  ) {
    this.load();
  }

  private load(): void {
    fs.mkdirSync(appDataDir(), { recursive: true });
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.list = raw.filter((p) => p && typeof p.id === 'string');
    } catch (err) {
      console.warn('[git-profiles] failed to read:', err);
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.list, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  private public(p: StoredGitProfile): GitProfilePublic {
    const { authRef, ...rest } = p;
    return { ...rest, hasToken: Boolean(authRef && this.credentials.has(authRef)) };
  }

  listPublic(): GitProfilePublic[] {
    return this.list.map((p) => this.public(p));
  }

  get(id: string): StoredGitProfile {
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'git profile not found', 'git_profile_not_found');
    return p;
  }

  async create(input: GitProfileInput): Promise<GitProfilePublic> {
    const provider = input.provider ?? 'git';
    if (!PROVIDERS.includes(provider)) badRequest('unsupported git provider', 'invalid_provider');
    const id = randomUUID();
    const authRef = input.secret ? `git_${id}` : undefined;
    if (authRef && input.secret) await this.credentials.set(authRef, input.secret);
    const profile: StoredGitProfile = {
      id,
      label: input.label?.trim() || `${provider} profile`,
      provider,
      remoteUrl: validateRemote(input.remoteUrl ?? ''),
      username: input.username?.trim() || undefined,
      createdAt: Date.now(),
      ...(authRef ? { authRef } : {}),
    };
    this.list.push(profile);
    this.save();
    return this.public(profile);
  }

  async update(id: string, input: GitProfileInput): Promise<GitProfilePublic> {
    const p = this.get(id);
    if (input.label !== undefined) p.label = input.label.trim() || p.label;
    if (input.provider !== undefined) {
      if (!PROVIDERS.includes(input.provider)) badRequest('unsupported git provider', 'invalid_provider');
      p.provider = input.provider;
    }
    if (input.remoteUrl !== undefined) p.remoteUrl = validateRemote(input.remoteUrl);
    if (input.username !== undefined) p.username = input.username.trim() || undefined;
    if (input.clearToken) {
      if (p.authRef) this.credentials.delete(p.authRef);
      delete p.authRef;
    }
    if (input.secret) {
      if (!p.authRef) p.authRef = `git_${p.id}`;
      await this.credentials.set(p.authRef, input.secret);
    }
    this.save();
    return this.public(p);
  }

  remove(id: string): void {
    const p = this.get(id);
    if (p.authRef) this.credentials.delete(p.authRef);
    this.list = this.list.filter((x) => x.id !== id);
    this.save();
  }

  private token(p: StoredGitProfile): Promise<string | null> {
    return p.authRef ? this.credentials.get(p.authRef) : Promise.resolve(null);
  }

  private async askpass(): Promise<{ file: string; cleanup: () => void }> {
    const file = path.join(os.tmpdir(), `ocg-git-askpass-${randomUUID()}.cmd`);
    const script = [
      '@echo off',
      'echo %1 | findstr /I "Username" >nul',
      'if %errorlevel%==0 (echo %OCG_GIT_USER%) else (echo %OCG_GIT_TOKEN%)',
    ].join('\r\n');
    fs.writeFileSync(file, script, 'utf8');
    return {
      file,
      cleanup: () => {
        try {
          fs.unlinkSync(file);
        } catch {
          /* best effort */
        }
      },
    };
  }

  private async gitWithAuth(
    ws: Workspace | null,
    args: string[],
    profile: StoredGitProfile,
  ): Promise<{ code: number; out: string; err: string }> {
    const token = await this.token(profile);
    const ask = await this.askpass();
    try {
      return await this.host.exec('git', ['-c', 'core.quotePath=false', ...args], {
        cwd: ws?.path,
        timeoutMs: 60_000,
        env: {
          ...process.env,
          GIT_TERMINAL_PROMPT: '0',
          GIT_ASKPASS: ask.file,
          OCG_GIT_USER: profile.username || 'oauth2',
          OCG_GIT_TOKEN: token ?? '',
        },
      });
    } finally {
      ask.cleanup();
    }
  }

  async apply(ws: Workspace, id: string): Promise<{ remote: string; url: string }> {
    const profile = this.get(id);
    const remote = 'origin';
    const exists = await this.host.exec('git', ['remote'], { cwd: ws.path, timeoutMs: 10_000 });
    if (exists.code !== 0) throw new HttpError(409, exists.err.trim() || 'not a git repository', 'git_error');
    const names = exists.out.split(/\r?\n/).map((s) => s.trim());
    const args = names.includes(remote)
      ? ['remote', 'set-url', remote, profile.remoteUrl]
      : ['remote', 'add', remote, profile.remoteUrl];
    const res = await this.host.exec('git', args, { cwd: ws.path, timeoutMs: 15_000 });
    if (res.code !== 0) throw new HttpError(409, res.err.trim() || 'git remote failed', 'git_error');
    return { remote, url: profile.remoteUrl };
  }

  async test(ws: Workspace, id: string): Promise<{ ok: true; out: string; remoteUrl: string; hasToken: boolean }> {
    const profile = this.get(id);
    const res = await this.gitWithAuth(ws, ['ls-remote', '--heads', profile.remoteUrl], profile);
    if (res.code !== 0) throw new HttpError(409, res.err.trim() || 'git ls-remote failed', 'git_test_failed');
    const out = res.out.split(/\r?\n/).filter(Boolean).slice(0, 20).join('\n');
    return { ok: true, out, remoteUrl: profile.remoteUrl, hasToken: Boolean(profile.authRef) };
  }
}
