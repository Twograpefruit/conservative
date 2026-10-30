import { create } from 'zustand';
import type { FileContent, LintDiagnostic, WriteFileResult } from '@ocg/protocol';
import { api, qs } from '../api/client.js';
import { useApp } from './appStore.js';
import type { SqlDialect } from '../features/editor/languages.js';

export interface EditorTab {
  path: string;
  name: string;
  content: string;
  original: string;
  hash: string;
  mtime: number;
  encoding: string;
  eol: 'lf' | 'crlf' | 'mixed';
  readonly: boolean;
  binary: boolean;
  truncated: boolean;
  size: number;
  loading: boolean;
  error: string | null;
  pendingLine: number | null;
  conflict: { currentHash: string; currentMtime: number } | null;
  language: string | null;
  sqlDialect: SqlDialect;
}

interface EditorStore {
  tabs: EditorTab[];
  active: string | null;
  diagnostics: Record<string, LintDiagnostic[]>;
  open: (path: string, line?: number) => Promise<void>;
  setActive: (path: string) => void;
  close: (path: string) => void;
  closeAll: () => void;
  update: (path: string, content: string) => void;
  setLanguage: (path: string, language: string | null) => void;
  setSqlDialect: (path: string, dialect: SqlDialect) => void;
  save: (path: string) => Promise<void>;
  reload: (path: string) => Promise<void>;
  consumeLine: (path: string) => number | null;
  lint: (path: string) => Promise<void>;
}

function ws(): string | undefined {
  return useApp.getState().workspaceID ?? undefined;
}

function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

export const useEditor = create<EditorStore>((set, get) => ({
  tabs: [],
  active: null,
  diagnostics: {},

  open: async (path, line) => {
    const existing = get().tabs.find((t) => t.path === path);
    if (existing) {
      set({
        active: path,
        tabs: get().tabs.map((t) => (t.path === path ? { ...t, pendingLine: line ?? t.pendingLine } : t)),
      });
      return;
    }
    const blank: EditorTab = {
      path,
      name: baseName(path),
      content: '',
      original: '',
      hash: '',
      mtime: 0,
      encoding: 'utf-8',
      eol: 'lf',
      readonly: true,
      binary: false,
      truncated: false,
      size: 0,
      loading: true,
      error: null,
      pendingLine: line ?? null,
      conflict: null,
      language: null,
      sqlDialect: 'sqlite',
    };
    set({ tabs: [...get().tabs, blank], active: path });
    try {
      const info = await api<FileContent>(`/api/fs/file${qs({ ws: ws(), path })}`);
      const normalized = info.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      set({
        tabs: get().tabs.map((t) =>
          t.path === path
            ? {
                ...t,
                content: normalized,
                original: normalized,
                hash: info.hash,
                mtime: info.mtime,
                encoding: info.encoding,
                eol: info.eol,
                readonly: info.readonly,
                binary: info.binary,
                truncated: info.truncated,
                size: info.size,
                loading: false,
              }
            : t,
        ),
      });
    } catch (err) {
      set({
        tabs: get().tabs.map((t) =>
          t.path === path ? { ...t, loading: false, error: err instanceof Error ? err.message : String(err) } : t,
        ),
      });
    }
  },

  setActive: (path) => set({ active: path }),

  close: (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (tab && tab.content !== tab.original) {
      if (!window.confirm(`“${tab.name}”有未保存的修改，仍要关闭吗？`)) return;
    }
    const tabs = get().tabs.filter((t) => t.path !== path);
    const active = get().active === path ? (tabs[tabs.length - 1]?.path ?? null) : get().active;
    set({ tabs, active });
  },

  closeAll: () => set({ tabs: [], active: null }),

  update: (path, content) => {
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, content } : t)) });
  },

  setLanguage: (path, language) => {
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, language } : t)) });
  },

  setSqlDialect: (path, dialect) => {
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, sqlDialect: dialect } : t)) });
  },

  save: async (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab || tab.readonly || tab.binary) return;
    try {
      const res = await api<WriteFileResult>('/api/fs/file', {
        method: 'PUT',
        body: JSON.stringify({
          ws: ws(),
          path,
          content: tab.content,
          baseHash: tab.hash,
          expectedMtime: tab.mtime,
        }),
        headers: { 'content-type': 'application/json' },
      });
      set({
        tabs: get().tabs.map((t) =>
          t.path === path
            ? { ...t, original: t.content, hash: res.hash, mtime: res.mtime, eol: res.eol, size: res.size, conflict: null }
            : t,
        ),
      });
      useApp.getState().notify(`已保存 ${tab.name}`);
      void get().lint(path);
    } catch (err) {
      const e = err as { status?: number; body?: { currentHash?: string; currentMtime?: number }; message?: string };
      if (e.status === 409) {
        set({
          tabs: get().tabs.map((t) =>
            t.path === path
              ? {
                  ...t,
                  conflict: { currentHash: e.body?.currentHash ?? '', currentMtime: e.body?.currentMtime ?? 0 },
                }
              : t,
          ),
        });
        useApp.getState().notify('文件已被外部修改，请选择重新加载或另存', 'error');
      } else {
        useApp.getState().notify(e.message ?? '保存失败', 'error');
      }
    }
  },

  reload: async (path) => {
    if (!get().tabs.some((t) => t.path === path)) {
      await get().open(path);
      return;
    }
    try {
      const info = await api<FileContent>(`/api/fs/file${qs({ ws: ws(), path })}`);
      const normalized = info.content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
      set({
        tabs: get().tabs.map((t) =>
          t.path === path
            ? {
                ...t,
                content: normalized,
                original: normalized,
                hash: info.hash,
                mtime: info.mtime,
                encoding: info.encoding,
                eol: info.eol,
                readonly: info.readonly,
                binary: info.binary,
                truncated: info.truncated,
                size: info.size,
                loading: false,
                error: null,
                conflict: null,
              }
            : t,
        ),
        diagnostics: { ...get().diagnostics, [path]: [] },
      });
    } catch (err) {
      set({
        tabs: get().tabs.map((t) =>
          t.path === path ? { ...t, loading: false, error: err instanceof Error ? err.message : String(err) } : t,
        ),
      });
    }
  },

  consumeLine: (path) => {
    const tab = get().tabs.find((t) => t.path === path);
    if (!tab?.pendingLine) return null;
    const line = tab.pendingLine;
    set({ tabs: get().tabs.map((t) => (t.path === path ? { ...t, pendingLine: null } : t)) });
    return line;
  },

  lint: async (path) => {
    try {
      const res = await api<{ diagnostics: LintDiagnostic[] }>('/api/lint', {
        method: 'POST',
        body: JSON.stringify({ ws: ws(), files: [path] }),
        headers: { 'content-type': 'application/json' },
      });
      set({ diagnostics: { ...get().diagnostics, [path]: res.diagnostics } });
    } catch {
      /* lint is best effort */
    }
  },
}));
