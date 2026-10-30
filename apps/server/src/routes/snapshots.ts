import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { FileDiff } from '@ocg/diff';
import { summarize } from '@ocg/diff';
import { requireString } from '../lib/http.js';
import { workspaceOf } from '../lib/workspace.js';

export async function registerSnapshotRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/snapshots', async (req) => {
    const query = req.query as { ws?: string; limit?: string };
    const ws = workspaceOf(ctx, query.ws);
    return ctx.snapshots.list(ws, Number(query.limit ?? 50) || 50);
  });

  app.post('/api/snapshots', async (req) => {
    const body = req.body as { ws?: string; reason?: string };
    const ws = workspaceOf(ctx, body.ws);
    const snap = await ctx.snapshots.create(ws, body.reason?.trim() || 'manual');
    ctx.bus.local('bff.snapshot.created', snap);
    return snap;
  });

  app.get('/api/snapshots/diff', async (req) => {
    const query = req.query as { ws?: string; a?: string; b?: string };
    const ws = workspaceOf(ctx, query.ws);
    const files = await ctx.snapshots.diff(ws, requireString(query.a, 'a'), requireString(query.b, 'b'));
    return { files, summary: summarize(files) };
  });

  app.post('/api/snapshots/restore', async (req) => {
    const body = req.body as { ws?: string; id?: string };
    const ws = workspaceOf(ctx, body.ws);
    const result = await ctx.snapshots.restore(ws, requireString(body.id, 'id'));
    ctx.bus.local('bff.files.changed', { reason: 'snapshot-restore', files: result.restored });
    return result as { preSnapshot: string; restored: number; removed: number; skipped: string[] };
  });
}
