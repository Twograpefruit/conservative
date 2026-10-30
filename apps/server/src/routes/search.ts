import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { ReplaceOptions, SearchOptions } from '@ocg/protocol';
import { HttpError, requireString } from '../lib/http.js';
import { workspaceOf } from '../lib/workspace.js';
import { searchWorkspace } from '../lib/search.js';

export async function registerSearchRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/search', async (req, reply) => {
    const body = req.body as Partial<SearchOptions>;
    const ws = workspaceOf(ctx, body.ws);
    const query = requireString(body.query, 'query');
    const options: SearchOptions = {
      ws: ws.id,
      query,
      regex: body.regex,
      caseSensitive: body.caseSensitive,
      wholeWord: body.wholeWord,
      glob: body.glob,
      maxResults: body.maxResults ?? ctx.settings.settings.limits.searchMaxResults,
      cursor: body.cursor,
    };
    reply.hijack();
    reply.raw.writeHead(200, {
      'content-type': 'application/x-ndjson; charset=utf-8',
      'cache-control': 'no-store',
      'x-accel-buffering': 'no',
    });
    const ac = new AbortController();
    reply.raw.on('close', () => ac.abort());
    let files = 0;
    let matches = 0;
    let lastPath: string | undefined;
    try {
      reply.raw.write(JSON.stringify({ type: 'start', id: String(Date.now()), query }) + '\n');
      for await (const file of searchWorkspace(ctx.search, ws.path, options, ac.signal)) {
        files++;
        matches += file.matches.length;
        lastPath = file.path;
        reply.raw.write(JSON.stringify({ type: 'file', file }) + '\n');
        if (ac.signal.aborted) break;
        if (matches >= (options.maxResults ?? 2000)) break;
      }
      const truncated = matches >= (options.maxResults ?? 2000);
      reply.raw.write(
        JSON.stringify({ type: 'done', files, matches, truncated, cursor: truncated ? lastPath : undefined }) + '\n',
      );
    } catch (err) {
      reply.raw.write(
        JSON.stringify({ type: 'error', message: err instanceof Error ? err.message : String(err) }) + '\n',
      );
    } finally {
      reply.raw.end();
    }
  });

  app.post('/api/replace/preview', async (req) => {
    const body = req.body as Partial<ReplaceOptions>;
    const ws = workspaceOf(ctx, body.ws);
    const query = requireString(body.query, 'query');
    if (typeof body.replacement !== 'string') throw new HttpError(400, 'replacement is required', 'invalid_field');
    return ctx.replace.preview(ws.path, {
      ws: ws.id,
      query,
      replacement: body.replacement,
      regex: body.regex,
      caseSensitive: body.caseSensitive,
      wholeWord: body.wholeWord,
      glob: body.glob,
      preserveCase: body.preserveCase,
    });
  });

  app.post('/api/replace/apply', async (req) => {
    const body = req.body as { ws?: string; id?: string; snapshot?: boolean; paths?: string[] };
    const ws = workspaceOf(ctx, body.ws);
    const id = requireString(body.id, 'id');
    if (body.paths !== undefined && (!Array.isArray(body.paths) || body.paths.some((p) => typeof p !== 'string'))) {
      throw new HttpError(400, 'paths must be a string array', 'invalid_field');
    }
    let snapshot: string | null = null;
    if (body.snapshot !== false) {
      try {
        const snap = await ctx.snapshots.create(ws, `before-replace:${id}`);
        snapshot = snap.id;
        ctx.bus.local('bff.snapshot.created', snap);
      } catch (err) {
        console.warn('[replace] snapshot failed (continuing with backups):', err);
      }
    }
    const result = await ctx.replace.apply(id, body.paths);
    ctx.bus.local('bff.files.changed', { reason: 'replace', files: result.appliedFiles, snapshot });
    return { ...result, snapshot };
  });

  app.post('/api/replace/undo', async (req) => {
    const body = req.body as { id?: string };
    const id = requireString(body.id, 'id');
    const result = await ctx.replace.undo(id);
    ctx.bus.local('bff.files.changed', { reason: 'replace-undo', files: result.restored });
    return result;
  });
}
