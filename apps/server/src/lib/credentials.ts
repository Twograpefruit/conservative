import fs from 'node:fs';
import path from 'node:path';
import { appDataDir } from '@ocg/config';
import type { RuntimeHost } from '@ocg/host';
import { HttpError } from './http.js';

/**
 * DPAPI-backed credential store (CurrentUser). Secrets never enter
 * connections.json or frontend responses; only an opaque authRef is stored there.
 */
export class CredentialStore {
  private dir = path.join(appDataDir(), 'credentials');

  constructor(private readonly host: RuntimeHost) {
    fs.mkdirSync(this.dir, { recursive: true });
  }

  private file(id: string): string {
    return path.join(this.dir, `${id.replace(/[^a-zA-Z0-9_-]/g, '_')}.bin`);
  }

  async set(id: string, secret: string): Promise<void> {
    if (!secret) return;
    const ps = [
      'Add-Type -AssemblyName System.Security',
      '$plain=[Console]::In.ReadToEnd()',
      '$bytes=[Text.Encoding]::UTF8.GetBytes($plain)',
      '$enc=[Security.Cryptography.ProtectedData]::Protect($bytes,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Convert]::ToBase64String($enc)',
    ].join('; ');
    const res = await this.host.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      input: secret,
      timeoutMs: 15_000,
    });
    if (res.code !== 0 || !res.out.trim()) {
      throw new HttpError(500, `凭据加密失败（DPAPI）：${(res.err || res.out).slice(0, 200)}`, 'credential_store');
    }
    fs.writeFileSync(this.file(id), res.out.trim(), 'utf8');
  }

  async get(id: string): Promise<string | null> {
    const file = this.file(id);
    if (!fs.existsSync(file)) return null;
    const b64 = fs.readFileSync(file, 'utf8').trim();
    if (!b64) return null;
    const ps = [
      'Add-Type -AssemblyName System.Security',
      '$b64=[Console]::In.ReadToEnd()',
      '$enc=[Convert]::FromBase64String($b64)',
      '$bytes=[Security.Cryptography.ProtectedData]::Unprotect($enc,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser)',
      '[Text.Encoding]::UTF8.GetString($bytes)',
    ].join('; ');
    const res = await this.host.exec('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', ps], {
      input: b64,
      timeoutMs: 15_000,
    });
    if (res.code !== 0) {
      throw new HttpError(500, `凭据解密失败（DPAPI）：${(res.err || res.out).slice(0, 200)}`, 'credential_store');
    }
    // PowerShell adds a trailing newline to stdout; do not include it in AUTH.
    return res.out.replace(/\r?\n$/, '');
  }

  has(id: string): boolean {
    return fs.existsSync(this.file(id));
  }

  delete(id: string): void {
    try {
      fs.unlinkSync(this.file(id));
    } catch {
      /* noop */
    }
  }
}
