import { spawn, execFile, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { IGNORED_DIRS, IGNORED_FILES } from '@ocg/config';

export interface ExecOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeoutMs?: number;
  maxBuffer?: number;
  input?: string;
  encoding?: BufferEncoding;
}

export interface ExecResult {
  code: number;
  out: string;
  err: string;
  timedOut?: boolean;
}

export interface SpawnOptions {
  cwd?: string;
  env?: Record<string, string | undefined>;
  stdio?: 'pipe' | 'ignore' | 'inherit';
}

export interface PtyOptions {
  cwd: string;
  shell?: string;
  args?: string[];
  env?: Record<string, string | undefined>;
  cols?: number;
  rows?: number;
}

export interface PtyHandle {
  id: string;
  pid: number;
  write(data: string | Buffer): void;
  resize(cols: number, rows: number): void;
  kill(): void;
  onData(cb: (data: string) => void): void;
  onExit(cb: (exitCode: number) => void): void;
}

export interface WatchEvent {
  type: 'add' | 'change' | 'unlink';
  path: string;
}

/** The only platform-specific extension point. Business code must not branch on OS. */
export interface RuntimeHost {
  id: 'win-local' | 'wsl';
  platform: NodeJS.Platform;
  shellName: string;
  resolve(root: string, rel: string): string;
  isIgnored(name: string, isDir: boolean): boolean;
  exec(cmd: string, args: string[], opts?: ExecOptions): Promise<ExecResult>;
  spawn(cmd: string, args: string[], opts?: SpawnOptions): ChildProcess;
  which(cmd: string): Promise<string | null>;
  resolveOpencode(): Promise<string | null>;
  createPty(options: PtyOptions): Promise<PtyHandle | null>;
  watch(paths: string[], cb: (events: WatchEvent[]) => void): () => void;
  killTree(pid: number): Promise<void>;
  attachJobWatchdog(pid: number): { stop(): void } | null;
}

function toEnv(extra?: Record<string, string | undefined>): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = { ...process.env };
  for (const [k, v] of Object.entries(extra ?? {})) {
    if (v === undefined) delete env[k];
    else env[k] = v;
  }
  return env;
}

export function isIgnoredName(name: string, isDir: boolean): boolean {
  if (isDir) return IGNORED_DIRS.has(name);
  return IGNORED_FILES.has(name) || name.endsWith('.tmp');
}

export class WindowsLocalHost implements RuntimeHost {
  readonly id = 'win-local' as const;
  readonly platform = process.platform;
  readonly shellName = 'cmd.exe';

  constructor(private readonly root: string) {}

  resolve(root: string, rel: string): string {
    const base = root || this.root;
    const abs = path.isAbsolute(rel) ? rel : path.resolve(base, rel);
    return abs;
  }

  isIgnored(name: string, isDir: boolean): boolean {
    return isIgnoredName(name, isDir);
  }

  exec(cmd: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
    let command = cmd;
    let commandArgs = args;
    if (process.platform === 'win32' && /\.(cmd|bat)$/i.test(cmd)) {
      // npm/pip shims are batch files; run them through cmd.exe with explicit quoting.
      const quote = (value: string) => (/[\s"&|<>^]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value);
      command = process.env.ComSpec ?? 'cmd.exe';
      commandArgs = ['/d', '/s', '/c', [cmd, ...args].map(quote).join(' ')];
    }
    return new Promise((resolve) => {
      const child = execFile(
        command,
        commandArgs,
        {
          cwd: opts.cwd ?? this.root,
          env: toEnv({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...opts.env }),
          timeout: opts.timeoutMs ?? 30_000,
          maxBuffer: opts.maxBuffer ?? 32 * 1024 * 1024,
          windowsHide: true,
          encoding: 'utf8',
        },
        (error, stdout, stderr) => {
          const err = error as NodeJS.ErrnoException & { code?: number | string; killed?: boolean };
          resolve({
            code: typeof err?.code === 'number' ? err.code : error ? 1 : 0,
            out: stdout?.toString() ?? '',
            err: stderr?.toString() ?? (error ? String(error.message) : ''),
            timedOut: Boolean(err?.killed),
          });
        },
      );
      if (opts.input != null && child.stdin) {
        child.stdin.end(opts.input);
      }
    });
  }

  spawn(cmd: string, args: string[], opts: SpawnOptions = {}): ChildProcess {
    return spawn(cmd, args, {
      cwd: opts.cwd ?? this.root,
      env: toEnv({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...opts.env }),
      stdio: opts.stdio === 'ignore' ? 'ignore' : opts.stdio === 'inherit' ? 'inherit' : ['pipe', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false,
    });
  }

  async which(cmd: string): Promise<string | null> {
    if (path.isAbsolute(cmd)) return fs.existsSync(cmd) ? cmd : null;
    const res = await this.exec('where.exe', [cmd], { timeoutMs: 5000 });
    if (res.code === 0) {
      const lines = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      const preferred =
        lines.find((p) => p.toLowerCase().endsWith('.exe')) ??
        lines.find((p) => p.toLowerCase().endsWith('.cmd')) ??
        lines.find((p) => p.toLowerCase().endsWith('.bat')) ??
        lines[0];
      if (preferred) return preferred;
    }
    // npm global bin fallback (not always on PATH for GUI-launched processes).
    const npmBin = path.join(process.env.APPDATA ?? '', 'npm', `${cmd}.cmd`);
    if (fs.existsSync(npmBin)) return npmBin;
    return null;
  }

  async resolveOpencode(): Promise<string | null> {
    if (process.env.OCG_OPENCODE_BIN && fs.existsSync(process.env.OCG_OPENCODE_BIN)) {
      return process.env.OCG_OPENCODE_BIN;
    }
    const candidates: string[] = [];
    const where = await this.which('opencode');
    if (where) {
      candidates.push(where);
      const dir = path.dirname(where);
      candidates.push(
        path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
        path.join(dir, 'node_modules', '@opencode', 'cli', 'bin', 'opencode'),
      );
    }
    const npmRoot = path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@opencode', 'cli', 'bin');
    candidates.push(path.join(npmRoot, 'opencode.exe'), path.join(npmRoot, 'opencode'));
    for (const c of candidates) {
      if (c.toLowerCase().endsWith('.exe') && fs.existsSync(c)) return c;
    }
    return where && !where.toLowerCase().endsWith('.cmd') ? where : null;
  }

  async createPty(options: PtyOptions): Promise<PtyHandle | null> {
    try {
      // Optional native module. If it is unavailable we fall back to the upstream PTY bridge.
      const mod = (await import('node-pty')) as unknown as {
        spawn: (shell: string, args: string[], opts: Record<string, unknown>) => {
          pid: number;
          write: (d: string) => void;
          resize: (c: number, r: number) => void;
          kill: () => void;
          onData: (cb: (d: string) => void) => void;
          onExit: (cb: (e: { exitCode: number }) => void) => void;
        };
      };
      const shell = options.shell ?? process.env.COMSPEC ?? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'cmd.exe');
      const p = mod.spawn(shell, options.args ?? [], {
        name: 'xterm-256color',
        cols: options.cols ?? 120,
        rows: options.rows ?? 30,
        cwd: options.cwd,
        env: toEnv({ PYTHONUTF8: '1', PYTHONIOENCODING: 'utf-8', ...options.env }),
        useConpty: true,
      });
      return {
        id: `local-${p.pid}`,
        pid: p.pid,
        write: (d) => p.write(d.toString()),
        resize: (c, r) => p.resize(c, r),
        kill: () => {
          try {
            p.kill();
          } catch {
            /* already gone */
          }
        },
        onData: (cb) => p.onData(cb),
        onExit: (cb) => p.onExit((e) => cb(e.exitCode)),
      };
    } catch {
      return null;
    }
  }

  watch(paths: string[], cb: (events: WatchEvent[]) => void): () => void {
    const watchers: fs.FSWatcher[] = [];
    const pending = new Map<string, WatchEvent['type']>();
    let timer: NodeJS.Timeout | null = null;
    const flush = () => {
      timer = null;
      if (pending.size === 0) return;
      const events: WatchEvent[] = [];
      for (const [p, type] of pending) events.push({ type, path: p });
      pending.clear();
      cb(events);
    };
    for (const dir of paths) {
      try {
        const w = fs.watch(dir, { recursive: true, persistent: false }, (event, filename) => {
          if (!filename) return;
          const rel = filename.toString();
          const parts = rel.split(/[\\/]/);
          if (parts.some((part) => IGNORED_DIRS.has(part))) return;
          if (IGNORED_FILES.has(parts[parts.length - 1])) return;
          const type: WatchEvent['type'] = event === 'rename' ? 'unlink' : 'change';
          pending.set(rel, type);
          if (timer) clearTimeout(timer);
          timer = setTimeout(flush, 200);
        });
        watchers.push(w);
      } catch {
        /* directory missing */
      }
    }
    return () => {
      if (timer) clearTimeout(timer);
      for (const w of watchers) {
        try {
          w.close();
        } catch {
          /* noop */
        }
      }
    };
  }

  async killTree(pid: number): Promise<void> {
    if (!pid) return;
    await this.exec('taskkill.exe', ['/PID', String(pid), '/T', '/F'], { timeoutMs: 8000 });
  }

  attachJobWatchdog(pid: number): { stop(): void } | null {
    if (process.platform !== 'win32') return null;
    const script = path.join(process.env.TEMP ?? process.env.LOCALAPPDATA ?? '.', `ocg-job-${pid}-${Date.now()}.ps1`);
    const ps = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;
public static class OcgJob {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode)]
  public static extern IntPtr CreateJobObject(IntPtr a, string name);
  [DllImport("kernel32.dll")]
  public static extern bool SetInformationJobObject(IntPtr hJob, int infoClass, IntPtr lpInfo, uint cbInfo);
  [DllImport("kernel32.dll")]
  public static extern bool AssignProcessToJobObject(IntPtr hJob, IntPtr hProcess);
  [DllImport("kernel32.dll")]
  public static extern IntPtr OpenProcess(uint access, bool inherit, int pid);
  [DllImport("kernel32.dll")]
  public static extern bool CloseHandle(IntPtr h);
}
"@
$job = [OcgJob]::CreateJobObject([IntPtr]::Zero, $null)
if ($job -eq [IntPtr]::Zero) { exit 1 }
$info = [Runtime.InteropServices.Marshal]::AllocHGlobal(144)
try {
  for ($i=0; $i -lt 144; $i++) { [Runtime.InteropServices.Marshal]::WriteByte($info, $i, 0) }
  # JOBOBJECT_EXTENDED_LIMIT_INFORMATION.BasicLimitInformation.LimitFlags @ offset 16
  [Runtime.InteropServices.Marshal]::WriteInt32($info, 16, 0x2000)
  if (-not [OcgJob]::SetInformationJobObject($job, 9, $info, 144)) { exit 2 }
} finally { [Runtime.InteropServices.Marshal]::FreeHGlobal($info) }
$proc = [OcgJob]::OpenProcess(0x0100 -bor 0x1000, $false, ${pid})
if ($proc -eq [IntPtr]::Zero) { exit 3 }
if (-not [OcgJob]::AssignProcessToJobObject($job, $proc)) { exit 4 }
# Stay alive for exactly as long as the BFF keeps our stdin open.
[void][Console]::In.ReadToEnd()
`;
    try {
      fs.writeFileSync(script, ps, 'utf8');
      const child = spawn(
        'powershell.exe',
        ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script],
        { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true },
      );
      child.on('exit', () => {
        try {
          fs.unlinkSync(script);
        } catch {
          /* noop */
        }
      });
      return {
        stop: () => {
          try {
            child.stdin?.end();
            child.kill();
          } catch {
            /* noop */
          }
        },
      };
    } catch {
      return null;
    }
  }
}

export function createHost(root: string): RuntimeHost {
  if (process.platform === 'win32') return new WindowsLocalHost(root);
  // The abstraction is ready for a POSIX/WSL implementation; this baseline keeps the app usable.
  return new WindowsLocalHost(root);
}
