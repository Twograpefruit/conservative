import type { RuntimeHost } from '@ocg/host';
import type { ProbeResult } from '@ocg/protocol';
import type { SettingsStore } from './settings.js';
import type { WorkspaceStore } from './workspaces.js';
import type { UpstreamManager } from './upstream.js';
import type { EventBus } from './sseBus.js';
import type { SnapshotService } from './lib/snapshots.js';
import type { ReplaceService } from './lib/replace.js';
import type { FormatService } from './lib/format.js';
import type { ConnectionStore } from './lib/connections.js';
import type { CredentialStore } from './lib/credentials.js';
import type { SqliteService } from './lib/sqlite.js';
import type { RedisService } from './lib/redis.js';
import type { PtyService } from './lib/pty.js';
import type { SearchContext } from './lib/search.js';

export interface AppContext {
  version: string;
  startedAt: number;
  bffPort: number;
  settings: SettingsStore;
  workspaces: WorkspaceStore;
  host: RuntimeHost;
  upstream: UpstreamManager;
  bus: EventBus;
  snapshots: SnapshotService;
  replace: ReplaceService;
  format: FormatService;
  connections: ConnectionStore;
  credentials: CredentialStore;
  sqlite: SqliteService;
  redis: RedisService;
  pty: PtyService;
  search: SearchContext;
  probe: ProbeResult | null;
}
