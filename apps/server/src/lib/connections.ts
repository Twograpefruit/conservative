import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { appDataDir, paths } from '@ocg/config';
import type { ConnectionKind, ConnectionProfile } from '@ocg/protocol';
import { HttpError, badRequest } from './http.js';
import type { CredentialStore } from './credentials.js';

export interface StoredProfile extends Omit<ConnectionProfile, 'hasPassword'> {
  authRef?: string;
}

export interface ConnectionInput {
  label?: string;
  kind?: ConnectionKind;
  readOnly?: boolean;
  timeoutMs?: number;
  rowLimit?: number;
  file?: string;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  secret?: string;
  clearPassword?: boolean;
}

const KINDS: ConnectionKind[] = ['sqlite', 'postgres', 'mysql', 'redis'];

export class ConnectionStore {
  private file = path.join(appDataDir(), 'connections.json');
  private list: StoredProfile[] = [];

  constructor(private readonly credentials: CredentialStore) {
    this.load();
  }

  private load(): void {
    fs.mkdirSync(appDataDir(), { recursive: true });
    try {
      if (!fs.existsSync(this.file)) return;
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (Array.isArray(raw)) this.list = raw.filter((p) => p && typeof p.id === 'string');
    } catch (err) {
      console.warn('[connections] failed to read:', err);
    }
  }

  private save(): void {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.list, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  private public(p: StoredProfile): ConnectionProfile {
    const { authRef, ...rest } = p;
    return { ...rest, hasPassword: Boolean(authRef && this.credentials.has(authRef)) };
  }

  listPublic(): ConnectionProfile[] {
    return this.list.map((p) => this.public(p));
  }

  get(id: string): StoredProfile {
    const p = this.list.find((x) => x.id === id);
    if (!p) throw new HttpError(404, 'connection profile not found', 'connection_not_found');
    return p;
  }

  async create(input: ConnectionInput): Promise<ConnectionProfile> {
    const kind = input.kind ?? 'sqlite';
    if (!KINDS.includes(kind)) badRequest(`unsupported connection kind: ${kind}`, 'invalid_kind');
    const id = randomUUID();
    const authRef = input.secret ? `auth_${id}` : undefined;
    if (authRef && input.secret) await this.credentials.set(authRef, input.secret);
    const profile: StoredProfile = {
      id,
      label: input.label?.trim() || `${kind} ${this.list.length + 1}`,
      kind,
      readOnly: input.readOnly !== false,
      timeoutMs: Math.max(1000, Math.min(120_000, input.timeoutMs ?? 5000)),
      rowLimit: Math.max(1, Math.min(10_000, input.rowLimit ?? 500)),
      ...(kind === 'sqlite' ? { file: this.requireFile(input.file) } : {}),
      ...(kind === 'postgres' || kind === 'mysql' || kind === 'redis'
        ? {
            host: input.host?.trim() || '127.0.0.1',
            port: input.port ?? (kind === 'postgres' ? 5432 : kind === 'mysql' ? 3306 : 6379),
            database: input.database?.trim() || (kind === 'redis' ? '0' : undefined),
            user: input.user?.trim(),
          }
        : {}),
      ...(authRef ? { authRef } : {}),
    };
    this.list.push(profile);
    this.save();
    return this.public(profile);
  }

  async update(id: string, input: ConnectionInput): Promise<ConnectionProfile> {
    const p = this.get(id);
    if (input.kind && input.kind !== p.kind) badRequest('connection kind cannot be changed', 'invalid_kind');
    if (input.label !== undefined) p.label = input.label.trim() || p.label;
    if (input.readOnly !== undefined) p.readOnly = input.readOnly;
    if (input.timeoutMs !== undefined) p.timeoutMs = Math.max(1000, Math.min(120_000, input.timeoutMs));
    if (input.rowLimit !== undefined) p.rowLimit = Math.max(1, Math.min(10_000, input.rowLimit));
    if (input.file !== undefined && p.kind === 'sqlite') p.file = this.requireFile(input.file);
    if (input.host !== undefined) p.host = input.host.trim();
    if (input.port !== undefined) p.port = input.port;
    if (input.database !== undefined) p.database = input.database.trim();
    if (input.user !== undefined) p.user = input.user.trim();
    if (input.clearPassword) {
      if (p.authRef) this.credentials.delete(p.authRef);
      delete p.authRef;
    }
    if (input.secret) {
      if (!p.authRef) p.authRef = `auth_${p.id}`;
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

  getSecret(p: StoredProfile): Promise<string | null> {
    return p.authRef ? this.credentials.get(p.authRef) : Promise.resolve(null);
  }

  private requireFile(file: string | undefined): string {
    if (!file?.trim()) badRequest('SQLite 连接需要 file 路径', 'missing_file');
    return path.resolve(file.trim());
  }
}
