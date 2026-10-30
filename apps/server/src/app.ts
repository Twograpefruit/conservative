import fs from 'node:fs';
import path from 'node:path';
import Fastify, { type FastifyInstance } from 'fastify';
import fastifyStatic from '@fastify/static';
import fastifyWebsocket from '@fastify/websocket';
import type { AppContext } from './context.js';
import { errorPayload } from './lib/http.js';
import { registerSystemRoutes } from './routes/system.js';
import { registerEventRoutes } from './routes/events.js';
import { registerFsRoutes } from './routes/fs.js';
import { registerSearchRoutes } from './routes/search.js';
import { registerGitRoutes } from './routes/git.js';
import { registerSnapshotRoutes } from './routes/snapshots.js';
import { registerLintRoutes } from './routes/lint.js';
import { registerPtyRoutes } from './routes/pty.js';
import { registerFormatRoutes } from './routes/format.js';

export async function buildApp(ctx: AppContext): Promise<FastifyInstance> {
  const app = Fastify({
    logger: false,
    bodyLimit: 32 * 1024 * 1024,
    trustProxy: false,
  });

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    if (req.url.startsWith('/api/')) reply.header('cache-control', 'no-store');
  });

  app.setErrorHandler((err, req, reply) => {
    const { status, body } = errorPayload(err);
    if (status >= 500) console.error(`[http] ${req.method} ${req.url} ->`, err);
    if (!reply.sent) reply.code(status).send(body);
  });

  await app.register(fastifyWebsocket, {
    options: { maxPayload: 4 * 1024 * 1024, clientTracking: false },
  });

  await registerSystemRoutes(app, ctx);
  await registerEventRoutes(app, ctx);
  await registerFsRoutes(app, ctx);
  await registerSearchRoutes(app, ctx);
  await registerGitRoutes(app, ctx);
  await registerSnapshotRoutes(app, ctx);
  await registerLintRoutes(app, ctx);
  await registerPtyRoutes(app, ctx);
  await registerFormatRoutes(app, ctx);

  const guiDir = process.env.OCG_GUI_DIR ?? path.resolve(process.cwd(), 'apps/gui/dist');
  if (fs.existsSync(guiDir) && fs.existsSync(path.join(guiDir, 'index.html'))) {
    await app.register(fastifyStatic, { root: guiDir, prefix: '/', wildcard: true });
    app.setNotFoundHandler((req, reply) => {
      if (req.url.startsWith('/api/')) {
        reply.code(404).send({ error: 'not_found', message: `no route for ${req.url}` });
        return;
      }
      if (/\.(js|mjs|css|map|png|jpe?g|gif|svg|ico|woff2?|ttf|json)$/i.test((req.url.split('?')[0] ?? ''))) {
        reply.code(404).type('text/plain').send('asset not found');
        return;
      }
      reply.sendFile('index.html');
    });
  } else {
    app.setNotFoundHandler((req, reply) => {
      reply.code(404).send({
        error: 'not_found',
        message: req.url.startsWith('/api/')
          ? `no route for ${req.url}`
          : 'GUI bundle not found. Run `npm run build` or use the Vite dev server on port 5173.',
      });
    });
  }

  return app;
}
