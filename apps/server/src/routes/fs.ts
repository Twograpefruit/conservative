import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import type { FastifyInstance } from 'fastify';
import { appDataDir } from '@ocg/config';
import type { AppContext } from '../context.js';
import { HttpError, badRequest, requireString } from '../lib/http.js';
import { findFiles, listDirectory, readTextFile, relativePath, resolveInWorkspace, writeTextFileAtomic } from '../lib/fsutil.js';
import { workspaceOf } from '../lib/workspace.js';

const IMAGE_EXT: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/gif': 'gif',
  'image/webp': 'webp',
  'image/bmp': 'bmp',
  'image/svg+xml': 'svg',
};

const EXT_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  svg: 'image/svg+xml',
};

function attachmentDir(): string {
  const dir = path.join(appDataDir(), 'attachments');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function safeAttachment(name: string): string {
  if (!/^[A-Za-z0-9._-]+$/.test(name)) throw badRequest('invalid attachment name', 'invalid_name');
  return path.join(attachmentDir(), name);
}

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

  app.post('/api/chat/attachment', async (req) => {
    const body = req.body as { data?: string; mime?: string; name?: string };
    if (typeof body.data !== 'string' || !body.data) badRequest('data (base64) is required', 'missing_data');
    const mime = (body.mime || 'image/png').toLowerCase();
    const ext = IMAGE_EXT[mime] ?? 'png';
    const raw = body.data.includes(',') ? body.data.slice(body.data.indexOf(',') + 1) : body.data;
    const buffer = Buffer.from(raw, 'base64');
    if (buffer.length === 0) badRequest('empty attachment', 'empty_attachment');
    if (buffer.length > 10 * 1024 * 1024) throw new HttpError(413, 'attachment is larger than 10MB', 'file_too_large');
    const base = (body.name ?? 'image').replace(/[^A-Za-z0-9._-]+/g, '_').replace(/\.[^.]+$/, '');
    const name = `${Date.now()}-${randomUUID().slice(0, 8)}-${base.slice(0, 40) || 'image'}.${ext}`;
    const abs = safeAttachment(name);
    await fs.promises.writeFile(abs, buffer);
    return {
      name,
      mime,
      size: buffer.length,
      url: `/api/chat/attachment?name=${encodeURIComponent(name)}`,
      uri: `file:///${abs.replace(/\\/g, '/').replace(/^\/+/, '')}`,
    };
  });

  app.get('/api/chat/attachment', async (req, reply) => {
    const query = req.query as { name?: string };
    const abs = safeAttachment(requireString(query.name, 'name'));
    const stat = await fs.promises.stat(abs).catch(() => null);
    if (!stat || !stat.isFile()) throw new HttpError(404, 'attachment not found', 'file_not_found');
    reply.header('content-type', EXT_MIME[path.extname(abs).slice(1).toLowerCase()] ?? 'application/octet-stream');
    reply.header('cache-control', 'private, max-age=3600');
    reply.send(await fs.promises.readFile(abs));
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
      encoding?: 'utf-8' | 'gb18030';
      bom?: boolean;
    };
    const ws = workspaceOf(ctx, body.ws);
    const rel = requireString(body.path, 'path');
    if (typeof body.content !== 'string') badRequest('content is required');
    if (body.encoding !== undefined && body.encoding !== 'utf-8' && body.encoding !== 'gb18030') {
      badRequest('encoding must be utf-8 or gb18030', 'invalid_encoding');
    }
    const abs = resolveInWorkspace(ws.path, rel);
    const result = await writeTextFileAtomic(abs, body.content, {
      baseHash: typeof body.baseHash === 'string' ? body.baseHash : undefined,
      expectedMtime: typeof body.expectedMtime === 'number' ? body.expectedMtime : undefined,
      eol: body.eol ?? ws.eol,
      encoding: body.encoding,
      bom: typeof body.bom === 'boolean' ? body.bom : undefined,
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
