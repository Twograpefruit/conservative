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
  log,
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

  app.get('/api/git/status', async (req) => {
    const query = req.query as { ws?: string };
    return status(ctxOf(ctx, workspaceOf(ctx, query.ws)));
  });

  app.get('/api/git/log', async (req) => {
    const query = req.query as { ws?: string; limit?: string };
    return log(ctxOf(ctx, workspaceOf(ctx, query.ws)), Number(query.limit ?? 40) || 40);
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
    const body = req.body as { ws?: string; message?: string };
    const ws = workspaceOf(ctx, body.ws);
    return commit(ctxOf(ctx, ws), requireString(body.message, 'message'));
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
