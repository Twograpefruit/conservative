import { create } from 'zustand';
import type { HealthResponse, ProbeResult, WorkspaceInfo } from '@ocg/protocol';
import { api } from '../api/client.js';

export type View = 'chat' | 'editor' | 'search' | 'git' | 'terminal' | 'data' | 'settings';
export type ThemeMode = 'dark' | 'light' | 'system';

interface OpenRequest {
  path: string;
  line?: number;
  nonce: number;
}

interface AppState {
  view: View;
  workspaceID: string | null;
  workspaces: WorkspaceInfo[];
  health: HealthResponse | null;
  probe: ProbeResult | null;
  openRequest: OpenRequest | null;
  pendingSql: { sql: string; nonce: number } | null;
  toast: { id: number; message: string; kind: 'info' | 'error' } | null;
  uiScale: number;
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  setView: (view: View) => void;
  setWorkspace: (id: string) => void;
  setUiScale: (scale: number) => void;
  setThemeMode: (mode: ThemeMode) => void;
  loadWorkspaces: () => Promise<void>;
  loadHealth: () => Promise<void>;
  loadProbe: (refresh?: boolean) => Promise<void>;
  startHealthPolling: () => () => void;
  requestOpen: (path: string, line?: number) => void;
  consumeOpen: () => void;
  requestSql: (sql: string) => void;
  consumeSql: () => void;
  notify: (message: string, kind?: 'info' | 'error') => void;
}

const savedView = (localStorage.getItem('ocg.view') as View) || 'chat';
const savedWorkspace = localStorage.getItem('ocg.workspace');
const savedScale = Number(localStorage.getItem('ocg.uiScale') ?? '1');
const initialScale = Number.isFinite(savedScale) ? Math.min(1.3, Math.max(0.8, savedScale)) : 1;
const savedTheme = (localStorage.getItem('ocg.theme') as ThemeMode) || 'dark';
const systemDark = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)').matches : true;
const resolve = (mode: ThemeMode): 'dark' | 'light' =>
  mode === 'system' ? (systemDark ? 'dark' : 'light') : mode;

export const useApp = create<AppState>((set, get) => ({
  view: savedView,
  workspaceID: savedWorkspace,
  workspaces: [],
  health: null,
  probe: null,
  openRequest: null,
  pendingSql: null,
  toast: null,
  uiScale: initialScale,
  themeMode: savedTheme,
  resolvedTheme: resolve(savedTheme),

  setView: (view) => {
    localStorage.setItem('ocg.view', view);
    set({ view });
  },

  setWorkspace: (id) => {
    localStorage.setItem('ocg.workspace', id);
    set({ workspaceID: id });
  },

  setUiScale: (scale) => {
    const clamped = Math.min(1.3, Math.max(0.8, Math.round(scale * 100) / 100));
    localStorage.setItem('ocg.uiScale', String(clamped));
    set({ uiScale: clamped });
  },

  setThemeMode: (mode) => {
    localStorage.setItem('ocg.theme', mode);
    const resolved =
      mode === 'system'
        ? window.matchMedia('(prefers-color-scheme: dark)').matches
          ? 'dark'
          : 'light'
        : mode;
    document.documentElement.dataset.theme = resolved;
    set({ themeMode: mode, resolvedTheme: resolved });
  },

  loadWorkspaces: async () => {
    const workspaces = await api<WorkspaceInfo[]>('/api/workspaces');
    let id = get().workspaceID;
    if (!id || !workspaces.some((w) => w.id === id)) id = workspaces[0]?.id ?? null;
    if (id) localStorage.setItem('ocg.workspace', id);
    set({ workspaces, workspaceID: id });
  },

  loadHealth: async () => {
    try {
      set({ health: await api<HealthResponse>('/api/health') });
    } catch {
      set({ health: null });
    }
  },

  loadProbe: async (refresh = false) => {
    try {
      set({ probe: await api<ProbeResult>(`/api/probe${refresh ? '?refresh=1' : ''}`) });
    } catch (err) {
      get().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  startHealthPolling: () => {
    void get().loadHealth();
    const timer = setInterval(() => void get().loadHealth(), 8000);
    return () => clearInterval(timer);
  },

  requestOpen: (path, line) => {
    const nonce = Date.now();
    set({ openRequest: { path, line, nonce }, view: 'editor' });
    localStorage.setItem('ocg.view', 'editor');
  },

  consumeOpen: () => set({ openRequest: null }),

  requestSql: (sql) => {
    const nonce = Date.now();
    set({ pendingSql: { sql, nonce }, view: 'data' });
    localStorage.setItem('ocg.view', 'data');
  },

  consumeSql: () => set({ pendingSql: null }),

  notify: (message, kind = 'info') => {
    const id = Date.now();
    set({ toast: { id, message, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3800);
  },
}));
