import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { FileDiff } from '@ocg/diff';
import { parseUnifiedDiff, summarize } from '@ocg/diff';
import { HttpError, requireString } from '../lib/http.js';
import { workspaceOf } from '../lib/workspace.js';
import {
  applyHunk,
  commit,
  diff,
  execWhitelisted,
  info,
  branches,
  pull,
  log,
  overwriteLines,
  push,
  status,
  type DiffMode,
  type GitContext,
} from '../lib/git.js';

function ctxOf(ctx: AppContext, ws: ReturnType<typeof workspaceOf>): GitContext {
  return { host: ctx.host, root: ws.path };
}

export async function registerGitRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/git/info', async (req) => {
    const query = req.query as { ws?: string };
    return info(ctxOf(ctx, workspaceOf(ctx, query.ws)));
  });

  app.get('/api/git/catalog', async () => ctx.gitCommands.catalog());

  app.get('/api/git/history', async (req) => {
    const query = req.query as { ws?: string; limit?: string };
    const ws = workspaceOf(ctx, query.ws);
    return ctx.gitCommands.listHistory(ws, Number(query.limit ?? 30) || 30);
  });

  app.post('/api/git/run', async (req) => {
    const body = req.body as { ws?: string; id?: string; args?: unknown; confirm?: string };
    const ws = workspaceOf(ctx, body.ws);
    const result = await ctx.gitCommands.run(
      ws,
      { id: body.id, args: body.args, confirm: body.confirm },
      async (reason) => {
        try {
          const snap = await ctx.snapshots.create(ws, reason);
          ctx.bus.local('bff.snapshot.created', snap);
          return snap.id;
        } catch {
          return null;
        }
      },
    );
    ctx.bus.local('bff.git.changed', { action: body.id, ws: ws.id });
    return result;
  });

  app.get('/api/git/status', async (req) => {
    const query = req.query as { ws?: string };
    return status(ctxOf(ctx, workspaceOf(ctx, query.ws)));
  });

  app.get('/api/git/log', async (req) => {
    const query = req.query as { ws?: string; limit?: string };
    return log(ctxOf(ctx, workspaceOf(ctx, query.ws)), Number(query.limit ?? 40) || 40);
  });

  app.get('/api/git/branches', async (req) => {
    const query = req.query as { ws?: string };
    const ws = workspaceOf(ctx, query.ws);
    return branches(ctxOf(ctx, ws));
  });

  app.post('/api/git/pull', async (req) => {
    const body = req.body as { ws?: string; remote?: string; branch?: string; rebase?: boolean };
    const ws = workspaceOf(ctx, body.ws);
    const result = await pull(ctxOf(ctx, ws), {
      remote: body.remote,
      branch: body.branch,
      rebase: body.rebase,
    });
    ctx.bus.local('bff.git.changed', { action: 'pull', ws: ws.id });
    return result;
  });

  app.get('/api/git/diff', async (req) => {
    const query = req.query as { ws?: string; mode?: string; base?: string };
    const ws = workspaceOf(ctx, query.ws);
    const mode = (query.mode ?? 'working') as DiffMode;
    const files = await diff(ctxOf(ctx, ws), mode, query.base);
    return { files, summary: summarize(files) };
  });

  app.post('/api/git/exec', async (req) => {
    const body = req.body as { ws?: string; args?: string[] };
    const ws = workspaceOf(ctx, body.ws);
    if (!Array.isArray(body.args) || body.args.some((a) => typeof a !== 'string')) {
      throw new HttpError(400, 'args must be a string array', 'invalid_field');
    }
    return execWhitelisted(ctxOf(ctx, ws), body.args);
  });

  app.post('/api/git/commit', async (req) => {
    const body = req.body as { ws?: string; message?: string; stageAll?: boolean };
    const ws = workspaceOf(ctx, body.ws);
    const result = await commit(ctxOf(ctx, ws), requireString(body.message, 'message'), body.stageAll !== false);
    ctx.bus.local('bff.git.changed', { action: 'commit', ws: ws.id });
    return result;
  });

  app.post('/api/git/push', async (req) => {
    const body = req.body as { ws?: string; remote?: string; branch?: string; setUpstream?: boolean };
    const ws = workspaceOf(ctx, body.ws);
    const result = await push(ctxOf(ctx, ws), {
      remote: typeof body.remote === 'string' ? body.remote : undefined,
      branch: typeof body.branch === 'string' ? body.branch : undefined,
      setUpstream: typeof body.setUpstream === 'boolean' ? body.setUpstream : undefined,
    });
    ctx.bus.local('bff.git.changed', { action: 'push', ws: ws.id });
    return result;
  });

  app.post('/api/git/apply-hunk', async (req) => {
    const body = req.body as {
      ws?: string;
      path?: string;
      hunkIndex?: number;
      action?: 'stage' | 'unstage' | 'discard';
      mode?: DiffMode;
      base?: string;
    };
    const ws = workspaceOf(ctx, body.ws);
    const action = body.action;
    if (action !== 'stage' && action !== 'unstage' && action !== 'discard') {
      throw new HttpError(400, 'action must be stage|unstage|discard', 'invalid_field');
    }
    if (typeof body.hunkIndex !== 'number') throw new HttpError(400, 'hunkIndex is required', 'invalid_field');
    return applyHunk(ctxOf(ctx, ws), {
      path: requireString(body.path, 'path'),
      hunkIndex: body.hunkIndex,
      action,
      mode: body.mode,
      base: body.base,
    });
  });

  app.post('/api/git/overwrite-lines', async (req) => {
    const body = req.body as {
      ws?: string;
      path?: string;
      changes?: Array<{ kind: 'add' | 'del'; newLine: number; text: string }>;
    };
    const ws = workspaceOf(ctx, body.ws);
    if (!Array.isArray(body.changes)) throw new HttpError(400, 'changes is required', 'invalid_field');
    return overwriteLines(ctxOf(ctx, ws), {
      path: requireString(body.path, 'path'),
      changes: body.changes,
    });
  });

  app.get('/api/git/profiles', async () => ctx.gitProfiles.listPublic());

  app.post('/api/git/profiles', async (req) => {
    const body = req.body as Record<string, unknown>;
    return ctx.gitProfiles.create({
      label: typeof body.label === 'string' ? body.label : undefined,
      provider: typeof body.provider === 'string' ? (body.provider as 'gitee' | 'github' | 'git') : undefined,
      remoteUrl: typeof body.remoteUrl === 'string' ? body.remoteUrl : undefined,
      username: typeof body.username === 'string' ? body.username : undefined,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
    });
  });

  app.put('/api/git/profiles/:id', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as Record<string, unknown>;
    return ctx.gitProfiles.update(id, {
      label: typeof body.label === 'string' ? body.label : undefined,
      provider: typeof body.provider === 'string' ? (body.provider as 'gitee' | 'github' | 'git') : undefined,
      remoteUrl: typeof body.remoteUrl === 'string' ? body.remoteUrl : undefined,
      username: typeof body.username === 'string' ? body.username : undefined,
      secret: typeof body.secret === 'string' ? body.secret : undefined,
      clearToken: body.clearToken === true,
    });
  });

  app.delete('/api/git/profiles/:id', async (req) => {
    const { id } = req.params as { id: string };
    ctx.gitProfiles.remove(id);
    return { ok: true };
  });

  app.post('/api/git/profiles/:id/apply', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { ws?: string };
    const ws = workspaceOf(ctx, body.ws);
    return ctx.gitProfiles.apply(ws, id);
  });

  app.post('/api/git/profiles/:id/test', async (req) => {
    const { id } = req.params as { id: string };
    const body = req.body as { ws?: string };
    const ws = workspaceOf(ctx, body.ws);
    return ctx.gitProfiles.test(ws, id);
  });

  app.get('/api/diff/session', async (req) => {
    const query = req.query as { ws?: string; sessionId?: string; from?: string; to?: string; context?: string };
    workspaceOf(ctx, query.ws);
    const sessionId = requireString(query.sessionId, 'sessionId');
    const params = new URLSearchParams();
    if (query.from) params.set('from', query.from);
    if (query.to) params.set('to', query.to);
    if (query.context) params.set('context', query.context);
    const res = await ctx.upstream.fetch(`/api/session/${encodeURIComponent(sessionId)}/diff?${params.toString()}`);
    if (!res.ok) throw new HttpError(502, `upstream session diff failed: ${res.status}`, 'upstream_unavailable');
    const json = (await res.json()) as { data?: Array<{ file: string; patch: string; additions: number; deletions: number; status: string }> };
    const files: FileDiff[] = [];
    for (const item of json.data ?? []) {
      const parsed = parseUnifiedDiff(item.patch);
      if (parsed.length === 0) {
        files.push({
          path: item.file,
          status: item.status === 'added' ? 'added' : item.status === 'deleted' ? 'deleted' : 'modified',
          binary: false,
          hunks: [],
          additions: item.additions,
          deletions: item.deletions,
          header: [],
          patch: item.patch,
        });
      } else {
        files.push(...parsed);
      }
    }
    return { files, summary: summarize(files) };
  });

  app.get('/api/diff/snapshot', async (req) => {
    const query = req.query as { ws?: string; a?: string; b?: string };
    const ws = workspaceOf(ctx, query.ws);
    const a = requireString(query.a, 'a');
    const b = requireString(query.b, 'b');
    const files = await ctx.snapshots.diff(ws, a, b);
    return { files, summary: summarize(files) };
  });
}
