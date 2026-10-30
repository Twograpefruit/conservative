import type { FastifyInstance } from 'fastify';
import type { WebSocket } from 'ws';
import type { AppContext } from '../context.js';
import { requireString } from '../lib/http.js';
import { workspaceOf } from '../lib/workspace.js';

export async function registerPtyRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.post('/api/pty/token', async (req) => {
    const body = req.body as { ws?: string; title?: string; cols?: number; rows?: number; shell?: string };
    const ws = workspaceOf(ctx, body.ws);
    return ctx.pty.create(ws, {
      title: body.title,
      cols: body.cols,
      rows: body.rows,
      shell: body.shell,
    });
  });

  app.get('/api/pty/list', async (req) => {
    const query = req.query as { ws?: string };
    return ctx.pty.list(workspaceOf(ctx, query.ws));
  });

  app.post('/api/pty/resize', async (req) => {
    const body = req.body as { ws?: string; id?: string; cols?: number; rows?: number };
    const ws = workspaceOf(ctx, body.ws);
    await ctx.pty.resize(requireString(body.id, 'id'), ws.path, body.cols ?? 80, body.rows ?? 24);
    return { ok: true };
  });

  app.delete('/api/pty/:id', async (req) => {
    const { id } = req.params as { id: string };
    const query = req.query as { ws?: string };
    const ws = workspaceOf(ctx, query.ws);
    await ctx.pty.remove(id, ws.path);
    return { ok: true };
  });

  app.get('/api/pty', { websocket: true }, (socket: WebSocket, req) => {
    const query = req.query as { ticket?: string; cols?: string; rows?: string };
    const ticket = query.ticket;
    if (!ticket) {
      socket.close(4400, 'ticket is required');
      return;
    }
    const cols = Number(query.cols ?? 120) || 120;
    const rows = Number(query.rows ?? 30) || 30;
    ctx.pty.attach(socket, ticket, cols, rows);
  });
}
