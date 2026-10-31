import { create } from 'zustand';
import type { HealthResponse, ProbeResult, WorkspaceInfo } from '@ocg/protocol';
import { api } from '../api/client.js';

export type View = 'chat' | 'editor' | 'search' | 'git' | 'terminal' | 'data' | 'settings';
export type ThemeMode = 'dark' | 'light';

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
  searchRequest: { query?: string; glob?: string; nonce: number } | null;
  toast: { id: number; message: string; kind: 'info' | 'error' } | null;
  uiScale: number;
  textScale: number;
  fontFamily: string;
  codeFontFamily: string;
  codeFontSize: number;
  locale: string;
  customLocale: { label: string; strings: Record<string, string> } | null;
  themeMode: ThemeMode;
  resolvedTheme: 'dark' | 'light';
  archiveGroups: Record<string, string>;
  setView: (view: View) => void;
  setWorkspace: (id: string) => void;
  setUiScale: (scale: number) => void;
  setTextScale: (scale: number) => void;
  setFontFamily: (family: string) => void;
  setCodeFontFamily: (family: string) => void;
  setCodeFontSize: (size: number) => void;
  setLocale: (locale: string, custom?: { label: string; strings: Record<string, string> } | null) => void;
  resetAppearance: () => void;
  setThemeMode: (mode: ThemeMode) => void;
  setArchiveGroup: (sessionID: string, group: string | null) => void;
  loadWorkspaces: () => Promise<void>;
  loadHealth: () => Promise<void>;
  loadProbe: (refresh?: boolean) => Promise<void>;
  startHealthPolling: () => () => void;
  requestOpen: (path: string, line?: number) => void;
  consumeOpen: () => void;
  requestSql: (sql: string) => void;
  consumeSql: () => void;
  requestSearch: (input: { query?: string; glob?: string }) => void;
  consumeSearch: () => void;
  notify: (message: string, kind?: 'info' | 'error') => void;
}

const savedView = (localStorage.getItem('ocg.view') as View) || 'chat';
const savedWorkspace = localStorage.getItem('ocg.workspace');
const savedScale = Number(localStorage.getItem('ocg.uiScale') ?? '1');
const initialScale = Number.isFinite(savedScale) ? Math.min(2.5, Math.max(0.5, savedScale)) : 1;
const savedTextScale = Number(localStorage.getItem('ocg.textScale') ?? '1');
const initialTextScale = Number.isFinite(savedTextScale) ? Math.min(3, Math.max(0.6, savedTextScale)) : 1;
const savedFont = localStorage.getItem('ocg.fontFamily') ?? '';
const savedCodeFont = localStorage.getItem('ocg.codeFontFamily') ?? "'Cascadia Code', Consolas, monospace";
const savedCodeSize = Number(localStorage.getItem('ocg.codeFontSize') ?? '13');
const initialCodeSize = Number.isFinite(savedCodeSize) ? Math.min(24, Math.max(10, savedCodeSize)) : 13;
const savedLocale = localStorage.getItem('ocg.locale') || 'zh';
const savedCustomLocale = (() => {
  try {
    return JSON.parse(localStorage.getItem('ocg.customLocale') ?? 'null') as {
      label: string;
      strings: Record<string, string>;
    } | null;
  } catch {
    return null;
  }
})();
const savedGroups = (() => {
  try {
    const raw = JSON.parse(localStorage.getItem('ocg.archiveGroups') ?? '{}') as Record<string, string>;
    return raw && typeof raw === 'object' ? raw : {};
  } catch {
    return {};
  }
})();
const savedThemeRaw = localStorage.getItem('ocg.theme');
const savedTheme: ThemeMode = savedThemeRaw === 'dark' ? 'dark' : 'light';
const resolve = (mode: ThemeMode): 'dark' | 'light' => mode;

export const useApp = create<AppState>((set, get) => ({
  view: savedView,
  workspaceID: savedWorkspace,
  workspaces: [],
  health: null,
  probe: null,
  openRequest: null,
  pendingSql: null,
  searchRequest: null,
  toast: null,
  uiScale: initialScale,
  textScale: initialTextScale,
  fontFamily: savedFont,
  codeFontFamily: savedCodeFont,
  codeFontSize: initialCodeSize,
  locale: savedLocale,
  customLocale: savedCustomLocale,
  themeMode: savedTheme,
  resolvedTheme: resolve(savedTheme),
  archiveGroups: savedGroups,

  setView: (view) => {
    localStorage.setItem('ocg.view', view);
    set({ view });
  },

  setWorkspace: (id) => {
    localStorage.setItem('ocg.workspace', id);
    set({ workspaceID: id });
  },

  setUiScale: (scale) => {
    const clamped = Math.min(2.5, Math.max(0.5, Math.round(scale * 100) / 100));
    localStorage.setItem('ocg.uiScale', String(clamped));
    set({ uiScale: clamped });
  },

  setTextScale: (scale) => {
    const clamped = Math.min(3, Math.max(0.6, Math.round(scale * 100) / 100));
    localStorage.setItem('ocg.textScale', String(clamped));
    set({ textScale: clamped });
  },

  setFontFamily: (family) => {
    localStorage.setItem('ocg.fontFamily', family);
    set({ fontFamily: family });
  },

  setCodeFontFamily: (family) => {
    localStorage.setItem('ocg.codeFontFamily', family);
    set({ codeFontFamily: family });
  },

  setCodeFontSize: (size) => {
    const clamped = Math.min(24, Math.max(10, Math.round(size)));
    localStorage.setItem('ocg.codeFontSize', String(clamped));
    set({ codeFontSize: clamped });
  },

  setLocale: (locale, custom) => {
    localStorage.setItem('ocg.locale', locale);
    if (custom !== undefined) {
      if (custom) localStorage.setItem('ocg.customLocale', JSON.stringify(custom));
      else localStorage.removeItem('ocg.customLocale');
    }
    set({ locale, ...(custom !== undefined ? { customLocale: custom } : {}) });
  },

  resetAppearance: () => {
    localStorage.setItem('ocg.uiScale', '1');
    localStorage.setItem('ocg.textScale', '1');
    localStorage.setItem('ocg.fontFamily', '');
    localStorage.setItem('ocg.codeFontFamily', "'Cascadia Code', Consolas, monospace");
    localStorage.setItem('ocg.codeFontSize', '13');
    set({
      uiScale: 1,
      textScale: 1,
      fontFamily: '',
      codeFontFamily: "'Cascadia Code', Consolas, monospace",
      codeFontSize: 13,
    });
  },

  setArchiveGroup: (sessionID, group) => {
    const next = { ...get().archiveGroups };
    if (group?.trim()) next[sessionID] = group.trim();
    else delete next[sessionID];
    localStorage.setItem('ocg.archiveGroups', JSON.stringify(next));
    set({ archiveGroups: next });
  },

  setThemeMode: (mode) => {
    localStorage.setItem('ocg.theme', mode);
    document.documentElement.dataset.theme = mode;
    set({ themeMode: mode, resolvedTheme: mode });
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

  requestSearch: (input) => {
    set({ searchRequest: { ...input, nonce: Date.now() }, view: 'search' });
    localStorage.setItem('ocg.view', 'search');
  },

  consumeSearch: () => set({ searchRequest: null }),

  notify: (message, kind = 'info') => {
    const id = Date.now();
    set({ toast: { id, message, kind } });
    setTimeout(() => {
      if (get().toast?.id === id) set({ toast: null });
    }, 3800);
  },
}));
