import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError, requireString } from '../lib/http.js';
import { persistProbe, runProbe } from '../probe.js';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { paths } from '@ocg/config';

interface InstallJob {
  id: string;
  action: string;
  status: 'running' | 'done' | 'failed';
  percent: number;
  output: string[];
  code?: number;
  startedAt: number;
}

const INSTALL_ACTIONS: Record<string, { label: string; command: string }> = {
  'node-pty': { label: '重建 node-pty', command: 'npm rebuild node-pty' },
  pyright: { label: '安装 pyright', command: 'npm install -g pyright' },
  git: {
    label: '安装 Git',
    command:
      'winget install --id Git.Git -e --source winget --accept-package-agreements --accept-source-agreements',
  },
};

const installJobs = new Map<string, InstallJob>();

export function workspaceOf(ctx: AppContext, value: unknown) {
  const ws = ctx.workspaces.get(typeof value === 'string' ? value : undefined);
  if (!ws) throw new HttpError(404, 'workspace not found', 'workspace_not_found');
  return ws;
}

export async function registerSystemRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/health', async () => {
    const upstream = ctx.upstream.status();
    return {
      ok: upstream.healthy,
      bff: {
        version: ctx.version,
        pid: process.pid,
        uptime: Math.floor((Date.now() - ctx.startedAt) / 1000),
        port: ctx.bffPort,
        memory: process.memoryUsage().rss,
      },
      upstream,
      eventBus: {
        connected: ctx.bus.connected,
        buffered: ctx.bus.size,
        lastSeq: ctx.bus.lastSeq,
        clients: ctx.bus.clientsCount,
      },
    };
  });

  app.get('/api/probe', async (req) => {
    const query = req.query as { refresh?: string };
    if (ctx.probe && query.refresh !== '1' && query.refresh !== 'true') return ctx.probe;
    const result = await runProbe(ctx.upstream);
    persistProbe(result);
    ctx.probe = result;
    return result;
  });

  app.get('/api/oc/spec', async (_req, reply) => {
    try {
      const res = await ctx.upstream.fetch('/openapi.json', {}, 8000);
      const body = Buffer.from(await res.arrayBuffer());
      reply.code(res.status).header('content-type', 'application/json').send(body);
    } catch (err) {
      throw new HttpError(502, err instanceof Error ? err.message : 'spec unavailable', 'upstream_unavailable');
    }
  });

  app.get('/api/settings', async () => ctx.settings.settings);

  app.get('/api/system/upstream', async () => {
    const settings = ctx.settings.settings.upstream;
    return {
      mode: settings.mode,
      url: settings.url,
      host: settings.host,
      port: settings.port,
      passwordSet: Boolean(settings.password),
      status: ctx.upstream.status(),
    };
  });

  app.post('/api/system/upstream', async (req) => {
    const body = req.body as { mode?: string; url?: string; password?: string };
    const mode = body.mode === 'attach' ? 'attach' : 'managed';
    const rawUrl = typeof body.url === 'string' ? body.url.trim() : '';
    let url: string | null = null;
    if (mode === 'attach') {
      if (!rawUrl) throw new HttpError(400, 'WSL / 远程模式需要填写上游地址', 'upstream_url_required');
      let parsed: URL;
      try {
        parsed = new URL(rawUrl);
      } catch {
        throw new HttpError(400, '上游地址格式无效，例如 http://172.20.10.2:4096', 'upstream_url_invalid');
      }
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        throw new HttpError(400, '上游地址只支持 http/https', 'upstream_url_invalid');
      }
      url = parsed.toString().replace(/\/$/, '');
    }
    const password =
      typeof body.password === 'string' && body.password.trim().length > 0
        ? body.password.trim()
        : undefined;
    ctx.settings.update({
      upstream: {
        mode,
        url,
        ...(password !== undefined ? { password } : {}),
      },
    });
    await ctx.upstream.configure({ mode, url, password });
    ctx.bus.reconnect();
    await new Promise((resolve) => setTimeout(resolve, 700));
    let healthy = await ctx.upstream.checkHealth(3000);
    for (let attempt = 0; attempt < 8 && !healthy; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 350));
      healthy = await ctx.upstream.checkHealth(2500);
    }
    const result = healthy ? await runProbe(ctx.upstream).catch(() => null) : null;
    if (result) {
      persistProbe(result);
      ctx.probe = result;
    }
    return {
      ok: healthy,
      mode,
      url,
      passwordSet: Boolean(ctx.settings.settings.upstream.password),
      status: ctx.upstream.status(),
      probe: result,
    };
  });

  app.put('/api/settings', async (req) => {
    const body = req.body as Record<string, unknown>;
    const updated = ctx.settings.update(body);
    return updated;
  });

  app.get('/api/workspaces', async () => ctx.workspaces.list);

  app.post('/api/workspaces', async (req) => {
    const body = req.body as Record<string, unknown>;
    const ws = ctx.workspaces.add({
      path: requireString(body.path, 'path'),
      label: typeof body.label === 'string' ? body.label : undefined,
      venv: typeof body.venv === 'string' ? body.venv : undefined,
      checkCmd: typeof body.checkCmd === 'string' ? body.checkCmd : undefined,
      lintCmd: typeof body.lintCmd === 'string' ? body.lintCmd : undefined,
    });
    return ws;
  });

  app.patch('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    const ws = ctx.workspaces.update(id, {
      ...(typeof body.label === 'string' ? { label: body.label } : {}),
      ...(typeof body.venv === 'string' || body.venv === null ? { venv: body.venv as string | null } : {}),
      ...(typeof body.checkCmd === 'string' || body.checkCmd === null ? { checkCmd: body.checkCmd as string | null } : {}),
      ...(typeof body.lintCmd === 'string' || body.lintCmd === null ? { lintCmd: body.lintCmd as string | null } : {}),
      ...(body.eol === 'auto' || body.eol === 'lf' || body.eol === 'crlf' ? { eol: body.eol } : {}),
    });
    if (!ws) throw new HttpError(404, 'workspace not found', 'workspace_not_found');
    return ws;
  });

  app.delete('/api/workspaces/:id', async (req) => {
    const { id } = req.params as { id: string };
    if (!ctx.workspaces.remove(id)) throw new HttpError(404, 'workspace not found', 'workspace_not_found');
    return { ok: true };
  });

  app.get('/api/logs/upstream', async () => ({ lines: ctx.upstream.logLines }));

  app.get('/api/system/install/actions', async () =>
    Object.entries(INSTALL_ACTIONS).map(([id, action]) => ({ id, label: action.label })),
  );

  app.get('/api/opencode/config', async () => {
    const res = await ctx.upstream.fetch('/api/config');
    if (!res.ok) throw new HttpError(502, `upstream config failed: ${res.status}`, 'upstream_unavailable');
    const json = (await res.json()) as
      | Array<{ type?: string; path?: string; info?: Record<string, unknown> }>
      | { data?: Array<{ type?: string; path?: string; info?: Record<string, unknown> }> };
    const entries = Array.isArray(json) ? json : json.data ?? [];
    const document = entries.find((e) => e.type === 'document');
    return {
      document: document ? { path: document.path, info: document.info ?? {} } : null,
      entries: entries.map((e) => ({ type: e.type, path: e.path })),
    };
  });

  app.put('/api/opencode/config', async (req) => {
    const body = req.body as { info?: unknown };
    if (!body.info || typeof body.info !== 'object' || Array.isArray(body.info)) {
      throw new HttpError(400, 'info must be a JSON object', 'invalid_config');
    }
    const res = await ctx.upstream.fetch('/api/config');
    if (!res.ok) throw new HttpError(502, `upstream config failed: ${res.status}`, 'upstream_unavailable');
    const json = (await res.json()) as
      | Array<{ type?: string; path?: string }>
      | { data?: Array<{ type?: string; path?: string }> };
    const entries = Array.isArray(json) ? json : json.data ?? [];
    const document = entries.find((e) => e.type === 'document');
    if (!document?.path) throw new HttpError(404, 'opencode config document not found', 'config_not_found');
    const target = document.path;
    const backup = `${target}.ocg-backup-${Date.now()}`;
    if (fs.existsSync(target)) fs.copyFileSync(target, backup);
    fs.writeFileSync(target, JSON.stringify(body.info, null, 2), 'utf8');
    return { ok: true, path: target, backup };
  });

  app.post('/api/system/pick-folder', async () => {
    if (process.platform !== 'win32') {
      throw new HttpError(501, 'native folder picker is only available on Windows', 'unsupported_platform');
    }
    const script = path.join(process.env.TEMP ?? process.cwd(), `ocg-pick-folder-${Date.now()}.ps1`);
    fs.writeFileSync(
      script,
      [
        'Add-Type -AssemblyName System.Windows.Forms',
        '$dialog = New-Object System.Windows.Forms.FolderBrowserDialog',
        "$dialog.Description = '选择项目文件夹'",
        '$dialog.ShowNewFolderButton = $true',
        'if ($dialog.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }',
      ].join('\r\n'),
      'utf8',
    );
    try {
      const res = await ctx.host.exec(
        'powershell.exe',
        ['-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass', '-File', script],
        { timeoutMs: 180_000 },
      );
      const folder = res.out.split(/\r?\n/).map((s) => s.trim()).filter(Boolean).pop() ?? '';
      return { path: folder, canceled: !folder, code: res.code };
    } finally {
      try {
        fs.unlinkSync(script);
      } catch {
        /* best effort */
      }
    }
  });

  app.post('/api/system/install', async (req) => {
    const body = req.body as { action?: string };
    const action = body.action ?? '';
    const entry = INSTALL_ACTIONS[action];
    if (!entry) throw new HttpError(400, `unknown install action: ${action}`, 'unknown_action');
    const id = randomUUID();
    const job: InstallJob = {
      id,
      action,
      status: 'running',
      percent: 5,
      output: [`$ ${entry.command}`],
      startedAt: Date.now(),
    };
    installJobs.set(id, job);
    for (const [key, value] of installJobs) {
      if (Date.now() - value.startedAt > 30 * 60_000) installJobs.delete(key);
    }
    const isWin = process.platform === 'win32';
    const command = isWin ? (process.env.ComSpec ?? 'cmd.exe') : 'sh';
    const args = isWin ? ['/d', '/s', '/c', entry.command] : ['-c', entry.command];
    const child = spawn(command, args, {
      cwd: process.cwd(),
      windowsHide: true,
      env: { ...process.env, NO_COLOR: '1', CI: '1' },
    });
    const append = (chunk: Buffer) => {
      const text = chunk.toString('utf8');
      job.output.push(...text.split(/\r?\n/).filter(Boolean).slice(-40));
      if (job.output.length > 300) job.output = job.output.slice(-300);
      job.percent = Math.min(90, 10 + job.output.length);
    };
    child.stdout.on('data', append);
    child.stderr.on('data', append);
    child.on('error', (err) => {
      job.status = 'failed';
      job.percent = 100;
      job.output.push(String(err.message));
    });
    child.on('close', (code) => {
      job.code = code ?? 1;
      job.status = code === 0 ? 'done' : 'failed';
      job.percent = 100;
      job.output.push(code === 0 ? '安装完成' : `安装失败（exit ${code}）`);
    });
    return { id, action, label: entry.label };
  });

  app.get('/api/system/install/:id', async (req) => {
    const { id } = req.params as { id: string };
    const job = installJobs.get(id);
    if (!job) throw new HttpError(404, 'install job not found', 'install_job_not_found');
    return job;
  });

  app.get('/api/runtime', async () => {
    try {
      if (!fs.existsSync(paths.runtime())) return {};
      return JSON.parse(fs.readFileSync(paths.runtime(), 'utf8'));
    } catch {
      return {};
    }
  });
}
