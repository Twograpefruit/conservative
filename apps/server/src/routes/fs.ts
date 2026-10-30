import fs from 'node:fs';
import path from 'node:path';
import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, requireString } from '../lib/http.js';
import { findFiles, listDirectory, readTextFile, relativePath, resolveInWorkspace, writeTextFileAtomic } from '../lib/fsutil.js';
import { workspaceOf } from '../lib/workspace.js';

export async function registerFsRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/fs/tree', async (req) => {
    const query = req.query as { ws?: string; path?: string };
    const ws = workspaceOf(ctx, query.ws);
    const entries = await listDirectory(ws.path, query.path ?? '');
    return { ws: ws.id, path: query.path ?? '', entries };
  });

  app.get('/api/fs/find', async (req) => {
    const query = req.query as { ws?: string; q?: string; query?: string; limit?: string };
    const ws = workspaceOf(ctx, query.ws);
    const q = query.q ?? query.query ?? '';
    const limit = Math.max(1, Math.min(Number(query.limit ?? 50) || 50, 200));
    return { ws: ws.id, query: q, entries: await findFiles(ws.path, q, limit) };
  });

  app.get('/api/fs/file', async (req) => {
    const query = req.query as { ws?: string; path?: string };
    const ws = workspaceOf(ctx, query.ws);
    const rel = requireString(query.path, 'path');
    const abs = resolveInWorkspace(ws.path, rel);
    const info = await readTextFile(abs, { maxBytes: ctx.settings.settings.limits.editorMaxBytes });
    return { ...info, path: relativePath(ws.path, abs) };
  });

  app.get('/api/fs/raw', async (req, reply) => {
    const query = req.query as { ws?: string; path?: string };
    const ws = workspaceOf(ctx, query.ws);
    const abs = resolveInWorkspace(ws.path, requireString(query.path, 'path'));
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw new HttpError(404, 'file not found', 'file_not_found');
    if (stat.size > 20 * 1024 * 1024) throw new HttpError(413, 'file is larger than 20MB', 'file_too_large');
    const ext = path.extname(abs).toLowerCase();
    const types: Record<string, string> = {
      '.png': 'image/png',
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.svg': 'image/svg+xml',
      '.ico': 'image/x-icon',
      '.bmp': 'image/bmp',
      '.pdf': 'application/pdf',
      '.mp4': 'video/mp4',
      '.mp3': 'audio/mpeg',
    };
    reply.header('content-type', types[ext] ?? 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=60');
    reply.send(await fs.promises.readFile(abs));
  });

  app.put('/api/fs/file', async (req) => {
    const body = req.body as {
      ws?: string;
      path?: string;
      content?: string;
      baseHash?: string;
      expectedMtime?: number;
      eol?: 'auto' | 'lf' | 'crlf';
    };
    const ws = workspaceOf(ctx, body.ws);
    const rel = requireString(body.path, 'path');
    if (typeof body.content !== 'string') badRequest('content is required');
    const abs = resolveInWorkspace(ws.path, rel);
    const result = await writeTextFileAtomic(abs, body.content, {
      baseHash: typeof body.baseHash === 'string' ? body.baseHash : undefined,
      expectedMtime: typeof body.expectedMtime === 'number' ? body.expectedMtime : undefined,
      eol: body.eol ?? ws.eol,
    });
    return result;
  });

  app.post('/api/fs/rename', async (req) => {
    const body = req.body as { ws?: string; from?: string; to?: string };
    const ws = workspaceOf(ctx, body.ws);
    const from = resolveInWorkspace(ws.path, requireString(body.from, 'from'));
    const to = resolveInWorkspace(ws.path, requireString(body.to, 'to'));
    if (from === to) return { ok: true };
    if (!fs.existsSync(from)) throw new HttpError(404, 'source not found', 'not_found');
    if (fs.existsSync(to)) throw new HttpError(409, 'destination already exists', 'conflict');
    await fs.promises.mkdir(path.dirname(to), { recursive: true });
    const caseOnly = from.toLowerCase() === to.toLowerCase();
    if (caseOnly) {
      // NTFS is case-insensitive: a two-step rename is required for case-only changes.
      const tmp = path.join(path.dirname(from), `.ocg-case-${Date.now()}`);
      await fs.promises.rename(from, tmp);
      await fs.promises.rename(tmp, to);
    } else {
      await fs.promises.rename(from, to);
    }
    return { ok: true };
  });

  app.post('/api/fs/delete', async (req) => {
    const body = req.body as { ws?: string; path?: string; recursive?: boolean };
    const ws = workspaceOf(ctx, body.ws);
    const abs = resolveInWorkspace(ws.path, requireString(body.path, 'path'));
    if (path.resolve(abs) === path.resolve(ws.path)) badRequest('refusing to delete the workspace root');
    if (!fs.existsSync(abs)) throw new HttpError(404, 'path not found', 'not_found');
    await fs.promises.rm(abs, { recursive: body.recursive !== false, force: false });
    return { ok: true };
  });

  app.post('/api/fs/mkdir', async (req) => {
    const body = req.body as { ws?: string; path?: string };
    const ws = workspaceOf(ctx, body.ws);
    const abs = resolveInWorkspace(ws.path, requireString(body.path, 'path'));
    await fs.promises.mkdir(abs, { recursive: true });
    return { ok: true };
  });
}
