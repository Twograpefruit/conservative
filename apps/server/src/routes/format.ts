import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError, requireString } from '../lib/http.js';
import { workspaceOf } from '../lib/workspace.js';
import { formatSql, type FormatOptions, type SqlDialect } from '../lib/format.js';

export async function registerFormatRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/format/text', async (req) => {
    const body = req.body as { text?: string; dialect?: SqlDialect; indent?: number; keywordCase?: string; linesBetweenQueries?: number };
    const text = requireString(body.text, 'text');
    const options: FormatOptions = {
      dialect: body.dialect,
      indent: body.indent,
      keywordCase: (body.keywordCase as FormatOptions['keywordCase']) ?? 'upper',
      linesBetweenQueries: body.linesBetweenQueries,
    };
    return { text: formatSql(text, options) };
  });

  app.post('/api/format/preview', async (req) => {
    const body = req.body as {
      ws?: string;
      path?: string;
      dialect?: SqlDialect;
      indent?: number;
      keywordCase?: string;
      linesBetweenQueries?: number;
      selection?: { from: number; to: number };
    };
    const ws = workspaceOf(ctx, body.ws);
    const rel = requireString(body.path, 'path');
    const result = await ctx.format.preview(ws, rel, {
      dialect: body.dialect,
      indent: body.indent,
      keywordCase: (body.keywordCase as FormatOptions['keywordCase']) ?? 'upper',
      linesBetweenQueries: body.linesBetweenQueries,
      selection: body.selection,
    });
    return result;
  });

  app.post('/api/format/apply', async (req) => {
    const body = req.body as { ws?: string; id?: string };
    const ws = workspaceOf(ctx, body.ws);
    const id = requireString(body.id, 'id');
    const result = await ctx.format.apply(ws, id);
    ctx.bus.local('bff.files.changed', { reason: 'format', files: 1 });
    return result;
  });

  app.post('/api/format/undo', async (req) => {
    const body = req.body as { ws?: string; id?: string };
    const ws = workspaceOf(ctx, body.ws);
    const id = requireString(body.id, 'id');
    const result = await ctx.format.undo(ws, id);
    ctx.bus.local('bff.files.changed', { reason: 'format-undo', files: 1 });
    return result;
  });

  app.post('/api/format/sql', async (req) => {
    const body = req.body as { text?: string; dialect?: SqlDialect };
    if (typeof body.text !== 'string') throw new HttpError(400, 'text is required', 'invalid_field');
    return { text: formatSql(body.text, { dialect: body.dialect }) };
  });
}
