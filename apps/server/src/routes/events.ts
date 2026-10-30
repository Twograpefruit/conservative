import type { FastifyInstance } from 'fastify';
import type { AppContext } from '../context.js';
import { HttpError } from '../lib/http.js';

const PASS_HEADERS = [
  'content-type',
  'cache-control',
  'etag',
  'last-modified',
  'content-disposition',
  'accept-ranges',
  'content-range',
  'x-request-id',
];

export async function registerEventRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  app.get('/api/events', async (req, reply) => {
    reply.hijack();
    const query = req.query as { since?: string };
    const header = req.headers['last-event-id'];
    const rawSince = query.since ?? (typeof header === 'string' ? header : undefined);
    const since = rawSince != null && rawSince !== '' ? Number(rawSince) : undefined;
    const close = ctx.bus.subscribe(reply.raw, Number.isFinite(since) ? since : undefined);
    reply.raw.on('close', close);
  });

  app.all('/api/oc/*', async (req, reply) => {
    const url = req.raw.url ?? req.url;
    const upstreamPath = url.slice('/api/oc'.length) || '/';
    const headers: Record<string, string> = {};
    for (const name of ['accept', 'content-type', 'if-none-match', 'if-modified-since', 'range', 'x-opencode-ticket']) {
      const value = req.headers[name];
      if (typeof value === 'string') headers[name] = value;
    }
    if (!headers.accept) headers.accept = '*/*';

    let body: BodyInit | undefined;
    const method = req.method.toUpperCase();
    if (method !== 'GET' && method !== 'HEAD') {
      const raw = req.body;
      if (raw == null) body = undefined;
      else if (Buffer.isBuffer(raw)) body = new Uint8Array(raw);
      else if (typeof raw === 'string') body = raw;
      else body = JSON.stringify(raw);
    }

    const ac = new AbortController();
    const onClose = () => ac.abort();
    reply.raw.on('close', onClose);
    try {
      const res = await ctx.upstream.fetch(upstreamPath, { method, headers, body, signal: ac.signal }, 120_000);
      const contentType = res.headers.get('content-type') ?? 'application/octet-stream';
      const isSse = contentType.includes('text/event-stream');

      if (isSse) {
        reply.hijack();
        const out: Record<string, string> = {
          'content-type': contentType,
          'cache-control': 'no-cache, no-transform',
          connection: 'keep-alive',
          'x-accel-buffering': 'no',
        };
        reply.raw.writeHead(res.status, out);
        if (res.body) {
          const reader = res.body.getReader();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              reply.raw.write(Buffer.from(value));
            }
          } catch {
            /* client or upstream closed */
          }
        }
        reply.raw.end();
        return;
      }

      const outHeaders: Record<string, string> = {};
      for (const name of PASS_HEADERS) {
        const value = res.headers.get(name);
        if (value) outHeaders[name] = value;
      }
      const buf = method === 'HEAD' ? Buffer.alloc(0) : Buffer.from(await res.arrayBuffer());
      reply.code(res.status).headers(outHeaders).send(buf);
    } catch (err) {
      if (ac.signal.aborted) return;
      throw new HttpError(502, err instanceof Error ? err.message : 'upstream request failed', 'upstream_unavailable');
    } finally {
      reply.raw.off('close', onClose);
    }
  });
}
