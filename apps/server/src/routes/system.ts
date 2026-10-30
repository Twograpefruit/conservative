import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError, requireString } from '../lib/http.js';
import { persistProbe, runProbe } from '../probe.js';
import fs from 'node:fs';
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
