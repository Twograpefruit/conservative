import type { RuntimeHost } from '@ocg/host';
import type { ProbeResult } from '@ocg/protocol';
import type { SettingsStore } from './settings.js';
import type { WorkspaceStore } from './workspaces.js';
import type { UpstreamManager } from './upstream.js';
import type { EventBus } from './sseBus.js';
import type { SnapshotService } from './lib/snapshots.js';
import type { ReplaceService } from './lib/replace.js';
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
  pty: PtyService;
  search: SearchContext;
  probe: ProbeResult | null;
}
