import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import type { LintDiagnostic } from '@ocg/protocol';
import { lintFiles } from '../lib/lint.js';
import { workspaceOf } from '../lib/workspace.js';

export async function registerLintRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/lint', async (req) => {
    const body = req.body as { ws?: string; files?: string[]; path?: string };
    const ws = workspaceOf(ctx, body.ws);
    const files = body.files ?? (body.path ? [body.path] : []);
    if (!Array.isArray(files) || files.length === 0) return { diagnostics: [] as LintDiagnostic[] };
    const diagnostics = await lintFiles(ctx.host, ws, ctx.settings.settings, files.slice(0, 20));
    return { diagnostics };
  });
}
