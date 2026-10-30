import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, localDataDir, paths } from '@ocg/config';
import { createHost } from '@ocg/host';
import { buildApp } from './app.js';
import { SettingsStore } from './settings.js';
import { WorkspaceStore } from './workspaces.js';
import { UpstreamManager } from './upstream.js';
import { EventBus } from './sseBus.js';
import { SnapshotService } from './lib/snapshots.js';
import { ReplaceService } from './lib/replace.js';
import { FormatService } from './lib/format.js';
import { PtyService } from './lib/pty.js';
import { resolveRg, type SearchContext } from './lib/search.js';
import { findFreePort } from './lib/net.js';
import { loadCachedProbe, persistProbe, runProbe } from './probe.js';
import type { AppContext } from './context.js';

const VERSION = process.env.OCG_VERSION ?? '0.1.0';

function isAlive(pid: number): boolean {
  if (!pid || pid === process.pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

function acquireLock(port: number): void {
  fs.mkdirSync(localDataDir(), { recursive: true });
  const file = paths.lock();
  if (fs.existsSync(file)) {
    try {
      const info = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number; port?: number };
      if (info.pid && isAlive(info.pid)) {
        console.error(`[bff] another instance is already running (pid ${info.pid}, port ${info.port ?? '?'}).`);
        console.error('[bff] stop it first, or delete ' + file + ' if it is stale.');
        process.exit(1);
      }
    } catch {
      /* stale/corrupt */
    }
  }
  fs.writeFileSync(file, JSON.stringify({ pid: process.pid, port, startedAt: Date.now() }, null, 2), 'utf8');
}

function releaseLock(): void {
  try {
    const file = paths.lock();
    if (!fs.existsSync(file)) return;
    const info = JSON.parse(fs.readFileSync(file, 'utf8')) as { pid?: number };
    if (info.pid === process.pid) fs.unlinkSync(file);
  } catch {
    /* noop */
  }
}

async function main(): Promise<void> {
  const root = process.env.OCG_WORKSPACE ?? process.env.INIT_CWD ?? process.cwd();
  const settings = new SettingsStore();
  const workspaces = new WorkspaceStore(root);
  const active = workspaces.get(settings.settings.activeWorkspaceId ?? undefined) ?? workspaces.list[0];
  if (active && settings.settings.activeWorkspaceId !== active.id) {
    settings.settings.activeWorkspaceId = active.id;
    settings.save();
  }
  const host = createHost(active?.path ?? root);

  const preferred = settings.settings.port || DEFAULT_SETTINGS.port;
  const bffPort = await findFreePort(preferred, settings.settings.host);
  if (settings.settings.upstream.mode === 'managed' && settings.settings.upstream.port <= bffPort) {
    settings.settings.upstream.port = bffPort + 1;
  }
  acquireLock(bffPort);

  if (bffPort !== preferred) {
    console.warn(`[bff] port ${preferred} is busy; using ${bffPort}`);
  }

  const upstream = new UpstreamManager(settings.settings, host, () => active?.path ?? root);
  const bus = new EventBus(upstream, settings.settings.limits.eventBufferSize);
  const snapshots = new SnapshotService(host);
  const search: SearchContext = { host, rgPath: await resolveRg(host) };
  const replace = new ReplaceService(host, search);
  const format = new FormatService();
  const pty = new PtyService(upstream, host);

  const ctx: AppContext = {
    version: VERSION,
    startedAt: Date.now(),
    bffPort,
    settings,
    workspaces,
    host,
    upstream,
    bus,
    snapshots,
    replace,
    format,
    pty,
    search,
    probe: loadCachedProbe(),
  };

  try {
    await upstream.start();
    if (!upstream.healthy) {
      console.warn('[bff] upstream is not healthy:', upstream.error);
      console.warn('[bff] the GUI will start in degraded mode; run scripts/bootstrap.ps1 to install prerequisites.');
    }
  } catch (err) {
    console.warn('[bff] upstream start failed:', err instanceof Error ? err.message : err);
  }
  bus.start();

  const app = await buildApp(ctx);
  try {
    await app.listen({ host: settings.settings.host, port: bffPort });
  } catch (err) {
    console.error('[bff] failed to listen:', err);
    await upstream.stop();
    releaseLock();
    process.exit(1);
  }

  const runtime = {
    bff: { url: `http://${settings.settings.host}:${bffPort}`, host: settings.settings.host, port: bffPort, pid: process.pid },
    upstream: upstream.status(),
    workspaces: workspaces.list.map((w) => ({ id: w.id, path: w.path, label: w.label })),
    startedAt: Date.now(),
    version: VERSION,
  };
  try {
    fs.mkdirSync(path.dirname(paths.runtime()), { recursive: true });
    fs.writeFileSync(paths.runtime(), JSON.stringify(runtime, null, 2), 'utf8');
  } catch (err) {
    console.warn('[bff] failed to write runtime file:', err);
  }

  console.log(`[bff] listening on http://${settings.settings.host}:${bffPort}`);
  console.log(`[bff] workspace: ${active?.path ?? root}`);
  if (upstream.url) console.log(`[bff] upstream (${upstream.mode}): ${upstream.url}`);

  // Probe in the background; the health endpoint stays responsive meanwhile.
  setTimeout(() => {
    void (async () => {
      try {
        const result = await runProbe(upstream);
        persistProbe(result);
        ctx.probe = result;
        console.log(
          `[bff] probe: spec=${result.spec.ok ? 'ok' : 'missing'} events=${result.events.ok ? 'ok' : 'missing'} pty=${result.capabilities.pty} vcs=${result.capabilities.vcs}`,
        );
      } catch (err) {
        console.warn('[bff] probe failed:', err);
      }
    })();
  }, 1200).unref?.();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    console.log(`[bff] shutting down (${signal})...`);
    try {
      await app.close();
    } catch {
      /* noop */
    }
    await bus.stop();
    await upstream.stop();
    releaseLock();
    process.exit(0);
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('uncaughtException', (err) => {
    console.error('[bff] uncaught exception:', err);
    void shutdown('uncaughtException');
  });
  process.on('unhandledRejection', (err) => {
    console.error('[bff] unhandled rejection:', err);
  });
}

main().catch((err) => {
  console.error('[bff] fatal:', err);
  releaseLock();
  process.exit(1);
});
