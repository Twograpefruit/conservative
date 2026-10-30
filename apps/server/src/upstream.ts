import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import type { ChildProcess } from 'node:child_process';
import type { RuntimeHost } from '@ocg/host';
import { paths, type Settings } from '@ocg/config';
import { findFreePort } from './lib/net.js';

interface AttachConfig {
  url: string;
  password: string;
}

export interface UpstreamStatus {
  mode: 'managed' | 'attach';
  url: string | null;
  healthy: boolean;
  version?: string;
  pid?: number;
  error?: string;
  reconnects?: number;
}

function readServicePassword(): string | null {
  try {
    const file = path.join(process.env.USERPROFILE ?? '', '.config', 'opencode', 'service.json');
    if (!fs.existsSync(file)) return null;
    const json = JSON.parse(fs.readFileSync(file, 'utf8'));
    return typeof json.password === 'string' ? json.password : null;
  } catch {
    return null;
  }
}

export class UpstreamManager {
  url: string | null = null;
  password = '';
  mode: 'managed' | 'attach' = 'managed';
  healthy = false;
  version: string | undefined;
  pid: number | undefined;
  error: string | undefined;
  reconnects = 0;
  private child: ChildProcess | null = null;
  private watchdog: { stop(): void } | null = null;
  private stopping = false;
  private restartAttempts = 0;
  private restartTimer: NodeJS.Timeout | null = null;
  private healthTimer: NodeJS.Timeout | null = null;
  private starting: Promise<void> | null = null;
  private logTail: string[] = [];

  constructor(
    private readonly settings: Settings,
    private readonly host: RuntimeHost,
    private readonly workspaceRoot: () => string,
  ) {
    this.mode = settings.upstream.mode;
  }

  get logLines(): string[] {
    return this.logTail.slice(-120);
  }

  authHeader(): string {
    return 'Basic ' + Buffer.from(`opencode:${this.password}`).toString('base64');
  }

  /** Wait for the upstream to become healthy (managed mode starts it). */
  async start(): Promise<void> {
    if (this.starting) return this.starting;
    this.starting = this.doStart().finally(() => {
      this.starting = null;
    });
    return this.starting;
  }

  private async doStart(): Promise<void> {
    if (this.mode === 'attach') {
      const attach = await this.resolveAttach();
      if (!attach) {
        this.healthy = false;
        this.error = 'attach mode requires OCG_OC_URL (or settings.upstream.url)';
        return;
      }
      this.url = attach.url.replace(/\/$/, '');
      this.password = attach.password;
      await this.checkHealth(4000);
      if (!this.healthy) this.error = `cannot reach upstream at ${this.url}`;
      return;
    }
    await this.startManaged();
  }

  private async resolveAttach(): Promise<AttachConfig | null> {
    const url = process.env.OCG_OC_URL ?? this.settings.upstream.url;
    if (!url) return null;
    const password = process.env.OCG_OC_PASSWORD ?? readServicePassword() ?? '';
    return { url, password };
  }

  private async startManaged(): Promise<void> {
    const bin = await this.host.resolveOpencode();
    if (!bin) {
      this.healthy = false;
      this.error = 'opencode binary not found (run scripts/bootstrap.ps1)';
      return;
    }
    const port = await findFreePort(this.settings.upstream.port, this.settings.upstream.host);
    this.password = randomBytes(24).toString('hex');
    this.url = `http://${this.settings.upstream.host}:${port}`;
    fs.mkdirSync(paths.logs(), { recursive: true });
    const logFile = path.join(paths.logs(), 'opencode.log');
    try {
      fs.appendFileSync(logFile, `\n=== spawn ${new Date().toISOString()} ${bin} serve --port ${port} ===\n`);
    } catch {
      /* noop */
    }
    const child = this.host.spawn(
      bin,
      ['serve', '--hostname', this.settings.upstream.host, '--port', String(port)],
      {
        cwd: this.workspaceRoot(),
        stdio: 'pipe',
        env: {
          OPENCODE_SERVER_USERNAME: 'opencode',
          OPENCODE_SERVER_PASSWORD: this.password,
          OPENCODE_SERVER_PORT: String(port),
        },
      },
    );
    this.child = child;
    this.pid = child.pid;
    const collect = (buf: Buffer) => {
      const text = buf.toString('utf8');
      for (const line of text.split(/\r?\n/)) {
        if (!line.trim()) continue;
        this.logTail.push(line);
        if (this.logTail.length > 300) this.logTail.shift();
        try {
          fs.appendFileSync(logFile, line + '\n');
        } catch {
          /* noop */
        }
      }
    };
    child.stdout?.on('data', collect);
    child.stderr?.on('data', collect);
    child.once('exit', (code, signal) => {
      this.healthy = false;
      this.child = null;
      this.watchdog?.stop();
      this.watchdog = null;
      if (this.stopping) return;
      this.error = `opencode exited (code=${code ?? 'null'} signal=${signal ?? 'null'})`;
      this.scheduleRestart();
    });
    if (child.pid) this.watchdog = this.host.attachJobWatchdog(child.pid);

    const deadline = Date.now() + 30_000;
    while (Date.now() < deadline) {
      if (this.stopping) return;
      await this.checkHealth(1500);
      if (this.healthy) {
        this.error = undefined;
        this.restartAttempts = 0;
        this.startHealthMonitor();
        return;
      }
      if (!this.child) return; // exited; restart scheduled
      await new Promise((r) => setTimeout(r, 300));
    }
    this.error = 'timed out waiting for opencode /api/info';
  }

  private scheduleRestart(): void {
    if (this.stopping || this.mode !== 'managed') return;
    if (this.restartAttempts >= 5) return;
    this.restartAttempts += 1;
    this.reconnects += 1;
    const delay = Math.min(1000 * this.restartAttempts, 10_000);
    if (this.restartTimer) clearTimeout(this.restartTimer);
    this.restartTimer = setTimeout(() => {
      this.restartTimer = null;
      void this.startManaged().catch((err) => {
        this.error = err instanceof Error ? err.message : String(err);
        this.scheduleRestart();
      });
    }, delay);
  }

  async checkHealth(timeoutMs = 3000): Promise<boolean> {
    if (!this.url) {
      this.healthy = false;
      return false;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(this.url + '/api/info', {
        headers: this.password ? { authorization: this.authHeader() } : {},
        signal: ac.signal,
      });
      if (!res.ok) {
        this.healthy = false;
        if (res.status === 401) this.error = 'upstream rejected credentials (401)';
        else this.error = `upstream /api/info returned ${res.status}`;
        return false;
      }
      const json = (await res.json()) as { version?: string; pid?: number };
      this.healthy = true;
      this.version = json.version;
      this.pid = json.pid ?? this.pid;
      this.error = undefined;
      return true;
    } catch (err) {
      this.healthy = false;
      this.error = err instanceof Error ? err.message : String(err);
      return false;
    } finally {
      clearTimeout(timer);
    }
  }

  private startHealthMonitor(): void {
    if (this.healthTimer) return;
    this.healthTimer = setInterval(() => {
      if (this.stopping) return;
      void this.checkHealth(4000);
    }, 10_000);
    this.healthTimer.unref?.();
  }

  headers(extra: Record<string, string> = {}): Record<string, string> {
    return { ...(this.password ? { authorization: this.authHeader() } : {}), ...extra };
  }

  async fetch(pathname: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<Response> {
    if (!this.url) throw new Error('upstream is not started');
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), timeoutMs);
    const headers = new Headers(init.headers);
    if (this.password && !headers.has('authorization')) headers.set('authorization', this.authHeader());
    try {
      return await fetch(this.url + pathname, { ...init, headers, signal: init.signal ?? ac.signal });
    } finally {
      clearTimeout(timer);
    }
  }

  async json<T = unknown>(pathname: string, init: RequestInit = {}, timeoutMs = 30_000): Promise<T> {
    const res = await this.fetch(pathname, init, timeoutMs);
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`upstream ${init.method ?? 'GET'} ${pathname} -> ${res.status} ${text.slice(0, 300)}`);
    }
    return (await res.json()) as T;
  }

  wsUrl(pathname: string): string | null {
    if (!this.url) return null;
    return this.url.replace(/^http/, 'ws') + pathname;
  }

  status(): UpstreamStatus {
    return {
      mode: this.mode,
      url: this.url,
      healthy: this.healthy,
      version: this.version,
      pid: this.pid,
      error: this.error,
      reconnects: this.reconnects,
    };
  }

  async stop(): Promise<void> {
    this.stopping = true;
    if (this.restartTimer) clearTimeout(this.restartTimer);
    if (this.healthTimer) clearInterval(this.healthTimer);
    this.watchdog?.stop();
    this.watchdog = null;
    const child = this.child;
    this.child = null;
    if (child?.pid) {
      await Promise.race([
        this.host.killTree(child.pid),
        new Promise((r) => setTimeout(r, 6000)),
      ]);
    }
  }
}
