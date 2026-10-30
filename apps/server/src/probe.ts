import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@ocg/config';
import type { ProbeResult } from '@ocg/protocol';
import type { UpstreamManager } from './upstream.js';

interface SpecShape {
  info?: { version?: string };
  paths?: Record<string, unknown>;
}

async function timed(fn: () => Promise<{ ok: boolean; status?: number; error?: string }>): Promise<{ ok: boolean; status?: number; error?: string; latencyMs: number }> {
  const start = Date.now();
  const result = await fn();
  return { ...result, latencyMs: Date.now() - start };
}

async function checkEndpoint(upstream: UpstreamManager, pathname: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  try {
    const res = await upstream.fetch(pathname, { method: 'GET' }, 5000);
    return { ok: res.ok, status: res.status, error: res.ok ? undefined : `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  }
}

async function probeEvents(upstream: UpstreamManager): Promise<ProbeResult['events']> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 3000);
  let envelope: ProbeResult['events']['envelope'] = null;
  let heartbeat = false;
  try {
    const res = await fetch((upstream.url ?? '') + '/api/event', {
      headers: upstream.headers({ accept: 'text/event-stream' }),
      signal: ac.signal,
    });
    if (!res.ok || !res.body) {
      return { ok: false, path: '/api/event', heartbeat: false, envelope: null, error: `HTTP ${res.status}` };
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buf = '';
    const deadline = Date.now() + 2500;
    while (Date.now() < deadline) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true }).replace(/\r\n/g, '\n');
      if (buf.includes(': heartbeat') || /^: (ping|heartbeat)/m.test(buf)) heartbeat = true;
      const match = buf.match(/(?:^|\n)data: (\{.*\})/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1]) as Record<string, unknown>;
          const data = parsed.data as Record<string, unknown> | undefined;
          envelope = {
            id: typeof parsed.id === 'string' ? parsed.id : '',
            type: typeof parsed.type === 'string' ? parsed.type : '',
            data: data && typeof data === 'object' ? Object.keys(data).join(',') : typeof parsed.data,
            seq: parsed.durable ? 'durable.seq' : '',
          };
          if (envelope.type && envelope.type !== 'server.connected') break;
        } catch {
          /* keep reading */
        }
      }
    }
    ac.abort();
    return {
      ok: true,
      path: '/api/event',
      contentType: res.headers.get('content-type') ?? undefined,
      heartbeat,
      envelope,
    };
  } catch (err) {
    if (envelope) {
      return {
        ok: true,
        path: '/api/event',
        heartbeat,
        envelope,
        error: err instanceof Error && err.name !== 'AbortError' ? err.message : undefined,
      };
    }
    return {
      ok: false,
      path: '/api/event',
      heartbeat: false,
      envelope: null,
      error: err instanceof Error ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function runProbe(upstream: UpstreamManager): Promise<ProbeResult> {
  const time = Date.now();
  const hints: string[] = [];
  const endpoints: ProbeResult['endpoints'] = {};
  let spec: ProbeResult['spec'] = { ok: false };
  let paths: Record<string, unknown> = {};

  if (!upstream.url) {
    return {
      time,
      upstream: { url: '', version: 'unknown' },
      spec,
      endpoints,
      events: { ok: false, path: '/api/event', heartbeat: false, envelope: null, error: 'upstream not started' },
      capabilities: {
        streaming: false,
        tools: false,
        permissions: false,
        sessionDiff: false,
        pty: false,
        vcs: false,
        snapshots: false,
        lint: false,
      },
      hints: ['opencode is not running; run scripts/bootstrap.ps1 and restart the BFF'],
    };
  }

  try {
    const res = await upstream.fetch('/openapi.json', {}, 8000);
    if (res.ok) {
      const json = (await res.json()) as SpecShape;
      spec = { ok: true, path: '/openapi.json', version: json.info?.version };
      paths = json.paths ?? {};
    } else {
      spec = { ok: false, error: `HTTP ${res.status}` };
    }
  } catch (err) {
    spec = { ok: false, error: err instanceof Error ? err.message : String(err) };
  }

  const checks: Array<[string, string]> = [
    ['info', '/api/info'],
    ['session.list', '/api/session'],
    ['permission.list', '/api/permission/request'],
    ['vcs.status', '/api/vcs/status'],
    ['pty.list', '/api/pty'],
    ['model.list', '/api/model'],
    ['agent.list', '/api/agent'],
  ];
  for (const [name, pathname] of checks) {
    endpoints[name] = await timed(() => checkEndpoint(upstream, pathname));
  }

  const events = await probeEvents(upstream);
  if (!events.heartbeat) hints.push('upstream event stream did not show a heartbeat within 2.5s');

  const has = (p: string) => Object.prototype.hasOwnProperty.call(paths, p);
  const capabilities: ProbeResult['capabilities'] = {
    streaming: events.ok && (has('/api/session/{sessionID}/prompt') || endpoints['session.list']?.ok === true),
    tools: events.ok,
    permissions: has('/api/session/{sessionID}/permission/{requestID}/reply') || endpoints['permission.list']?.ok === true,
    sessionDiff: has('/api/session/{sessionID}/diff'),
    pty: has('/api/pty') && endpoints['pty.list']?.ok === true,
    vcs: has('/api/vcs') || endpoints['vcs.status']?.ok === true,
    snapshots: true,
    lint: true,
  };
  if (!capabilities.sessionDiff) hints.push('session diff endpoint missing: use local snapshots for diffs');

  return {
    time,
    upstream: { url: upstream.url, version: upstream.version ?? spec.version ?? 'unknown', pid: upstream.pid },
    spec,
    endpoints,
    events,
    capabilities,
    hints,
  };
}

export function persistProbe(result: ProbeResult): void {
  try {
    fs.mkdirSync(paths.cache(), { recursive: true });
    fs.writeFileSync(path.join(paths.cache(), 'probe.json'), JSON.stringify(result, null, 2), 'utf8');
  } catch (err) {
    console.warn('[probe] failed to persist:', err);
  }
}

export function loadCachedProbe(): ProbeResult | null {
  try {
    const file = path.join(paths.cache(), 'probe.json');
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as ProbeResult;
  } catch {
    return null;
  }
}
