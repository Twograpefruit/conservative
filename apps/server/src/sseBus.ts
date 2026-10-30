import type { ServerResponse } from 'node:http';
import type { BffEvent, UpstreamEvent } from '@ocg/protocol';
import type { UpstreamManager } from './upstream.js';

interface Client {
  id: number;
  res: ServerResponse;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Consumes upstream SSE, assigns monotonic ids, keeps a replay ring and fans out. */
export class EventBus {
  private buffer: BffEvent[] = [];
  private seq = 0;
  private clients = new Map<number, Client>();
  private clientSeq = 0;
  private abort: AbortController | null = null;
  private stopped = false;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private loopRunning = false;
  connected = false;
  lastUpstreamError: string | undefined;
  reconnects = 0;

  constructor(
    private readonly upstream: UpstreamManager,
    private readonly capacity: number,
  ) {}

  get lastSeq(): number {
    return this.seq;
  }

  get size(): number {
    return this.buffer.length;
  }

  get clientsCount(): number {
    return this.clients.size;
  }

  start(): void {
    if (this.loopRunning) return;
    this.stopped = false;
    this.loopRunning = true;
    void this.loop();
    this.pingTimer = setInterval(() => this.ping(), 15_000);
    this.pingTimer.unref?.();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    this.abort?.abort();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    for (const client of this.clients.values()) {
      try {
        client.res.end();
      } catch {
        /* noop */
      }
    }
    this.clients.clear();
  }

  private async loop(): Promise<void> {
    let delay = 500;
    while (!this.stopped) {
      if (!this.upstream.url) {
        await sleep(500);
        continue;
      }
      const ac = new AbortController();
      this.abort = ac;
      try {
        const res = await fetch(this.upstream.url + '/api/event', {
          headers: this.upstream.headers({ accept: 'text/event-stream' }),
          signal: ac.signal,
        });
        if (!res.ok || !res.body) {
          throw new Error(`event stream returned ${res.status}`);
        }
        this.connected = true;
        this.lastUpstreamError = undefined;
        delay = 500;
        this.reconnects += 1;
        await this.pump(res.body);
      } catch (err) {
        if (this.stopped) break;
        this.connected = false;
        this.lastUpstreamError = err instanceof Error ? err.message : String(err);
      }
      this.connected = false;
      if (this.stopped) break;
      await sleep(delay);
      delay = Math.min(delay * 1.8, 15_000);
    }
    this.loopRunning = false;
  }

  private async pump(body: ReadableStream<Uint8Array>): Promise<void> {
    const reader = body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    while (!this.stopped) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      let idx: number;
      while ((idx = buf.indexOf('\n\n')) >= 0) {
        const chunk = buf.slice(0, idx);
        buf = buf.slice(idx + 2);
        const dataLines: string[] = [];
        let eventName: string | undefined;
        for (const line of chunk.split('\n')) {
          if (line.startsWith(':')) continue;
          if (line.startsWith('event:')) eventName = line.slice(6).trim();
          if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
        }
        if (dataLines.length === 0) continue;
        const raw = dataLines.join('\n');
        try {
          const parsed = JSON.parse(raw) as UpstreamEvent;
          if (eventName && !parsed.type) parsed.type = eventName;
          if (!parsed.type) continue;
          this.publish(parsed);
        } catch {
          /* ignore malformed frame */
        }
      }
    }
  }

  publish(event: UpstreamEvent): BffEvent {
    this.seq += 1;
    const enriched = { ...event, seq: this.seq } as BffEvent;
    this.buffer.push(enriched);
    if (this.buffer.length > this.capacity) this.buffer.splice(0, this.buffer.length - this.capacity);
    this.fanout(enriched);
    return enriched;
  }

  /** Emit a BFF-local event (snapshots, replace results, ...) into the same stream. */
  local(type: string, data: unknown): BffEvent {
    return this.publish({ type, data, created: Date.now() } as UpstreamEvent);
  }

  private fanout(event: BffEvent): void {
    const frame = `id: ${event.seq}\nevent: oc\ndata: ${JSON.stringify(event)}\n\n`;
    for (const [id, client] of this.clients) {
      try {
        client.res.write(frame);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  private ping(): void {
    for (const [id, client] of this.clients) {
      try {
        client.res.write(`: ping ${Date.now()}\n\n`);
      } catch {
        this.clients.delete(id);
      }
    }
  }

  subscribe(res: ServerResponse, since?: number): () => void {
    res.writeHead(200, {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(': connected\n\n');
    if (since != null) {
      const oldest = this.buffer[0]?.seq ?? this.seq;
      if (since < oldest - 1) {
        res.write(
          `id: ${this.seq}\nevent: resync\ndata: ${JSON.stringify({ type: 'bff.resync', seq: this.seq, dropped: since })}\n\n`,
        );
      } else {
        for (const event of this.buffer) {
          if (event.seq > since) {
            res.write(`id: ${event.seq}\nevent: oc\ndata: ${JSON.stringify(event)}\n\n`);
          }
        }
      }
    }
    this.clientSeq += 1;
    const id = this.clientSeq;
    this.clients.set(id, { id, res });
    return () => {
      this.clients.delete(id);
    };
  }
}
