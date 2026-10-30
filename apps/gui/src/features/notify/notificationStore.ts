import { create } from 'zustand';
import type { View } from '../../store/appStore.js';
import { useApp } from '../../store/appStore.js';

export type NotificationSource = 'chat' | 'git' | 'data' | 'terminal' | 'system';
export type NotificationLevel = 'info' | 'warn' | 'error';

export interface AppNotification {
  id: string;
  source: NotificationSource;
  level: NotificationLevel;
  title: string;
  body?: string;
  at: number;
  read: boolean;
  count: number;
  dedupKey?: string;
  view?: View;
  sessionID?: string;
  workspaceID?: string;
  runId?: string;
  profileId?: string;
}

export interface NotifySettings {
  enabled: boolean;
  native: boolean;
  privacy: boolean;
  flashTitle: boolean;
  quietHours: { enabled: boolean; start: string; end: string };
  muteSources: NotificationSource[];
  muteSessions: string[];
}

export interface NotifyInput {
  source: NotificationSource;
  level?: NotificationLevel;
  title: string;
  body?: string;
  dedupKey?: string;
  view?: View;
  sessionID?: string;
  workspaceID?: string;
  runId?: string;
  profileId?: string;
}

interface NotifyStore {
  items: AppNotification[];
  settings: NotifySettings;
  push: (input: NotifyInput) => void;
  markRead: (id: string) => void;
  markAllRead: () => void;
  clear: () => void;
  open: (id: string) => void;
  setSettings: (patch: Partial<NotifySettings>) => void;
  requestNative: () => Promise<boolean>;
}

const ITEMS_KEY = 'ocg.notifications.v1';
const SETTINGS_KEY = 'ocg.notify.settings.v1';
const DEDUP_MS = 3000;
const MAX_ITEMS = 200;

const DEFAULT_SETTINGS: NotifySettings = {
  enabled: true,
  native: false,
  privacy: false,
  flashTitle: true,
  quietHours: { enabled: false, start: '22:00', end: '08:00' },
  muteSources: [],
  muteSessions: [],
};

let flashTimer: ReturnType<typeof setInterval> | null = null;
let flashBase = '';
let flashPhase = false;

function startTitleFlash(count: number, enabled: boolean): void {
  if (!enabled || flashTimer) return;
  flashBase = document.title.replace(/^\(\d+\+?\)\s*/, '').replace(/^⏺\s*/, '');
  flashPhase = false;
  flashTimer = setInterval(() => {
    flashPhase = !flashPhase;
    document.title = flashPhase ? `(${count > 99 ? '99+' : count}) 新通知` : `⏺ 新通知`;
  }, 700);
}

function stopTitleFlash(): void {
  if (!flashTimer) return;
  clearInterval(flashTimer);
  flashTimer = null;
  document.title = flashBase || 'OpenCode GUI';
}

if (typeof window !== 'undefined') {
  window.addEventListener('focus', stopTitleFlash);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') stopTitleFlash();
  });
}

function loadItems(): AppNotification[] {
  try {
    const raw = JSON.parse(localStorage.getItem(ITEMS_KEY) ?? '[]') as AppNotification[];
    return Array.isArray(raw) ? raw.filter((n) => n && typeof n.id === 'string').slice(0, MAX_ITEMS) : [];
  } catch {
    return [];
  }
}

function loadSettings(): NotifySettings {
  try {
    const raw = JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') as Partial<NotifySettings>;
    return {
      ...DEFAULT_SETTINGS,
      ...raw,
      quietHours: { ...DEFAULT_SETTINGS.quietHours, ...(raw.quietHours ?? {}) },
      muteSources: Array.isArray(raw.muteSources) ? raw.muteSources : [],
      muteSessions: Array.isArray(raw.muteSessions) ? raw.muteSessions : [],
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function save(items: AppNotification[], settings?: NotifySettings): void {
  try {
    localStorage.setItem(ITEMS_KEY, JSON.stringify(items.slice(0, MAX_ITEMS)));
    if (settings) localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {
    /* storage may be unavailable */
  }
}

export function inQuietHours(settings: NotifySettings, now = new Date()): boolean {
  if (!settings.quietHours.enabled) return false;
  const minutes = now.getHours() * 60 + now.getMinutes();
  const parse = (hhmm: string) => {
    const [h, m] = hhmm.split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const start = parse(settings.quietHours.start);
  const end = parse(settings.quietHours.end);
  if (start === end) return false;
  return start < end ? minutes >= start && minutes < end : minutes >= start || minutes < end;
}

function toast(message: string, kind: 'info' | 'error'): void {
  const id = Date.now();
  useApp.setState({ toast: { id, message, kind } });
  setTimeout(() => {
    if (useApp.getState().toast?.id === id) useApp.setState({ toast: null });
  }, 3800);
}

function showNative(item: AppNotification, privacy: boolean): void {
  if (typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  try {
    const n = new Notification(item.title, {
      body: privacy ? '内容已隐藏（隐私模式）' : item.body,
      silent: item.level !== 'error',
      tag: item.dedupKey ?? item.id,
    });
    n.onclick = () => {
      window.focus();
      useNotify.getState().open(item.id);
      n.close();
    };
  } catch {
    /* native notifications can fail on some WebViews */
  }
}

export const useNotify = create<NotifyStore>((set, get) => ({
  items: loadItems(),
  settings: loadSettings(),

  push: (input) => {
    const settings = get().settings;
    if (!settings.enabled) return;
    if (settings.muteSources.includes(input.source)) return;
    if (input.sessionID && settings.muteSessions.includes(input.sessionID)) return;

    const now = Date.now();
    const privacy = settings.privacy;
    const quiet = inQuietHours(settings, new Date(now));
    const items = get().items;
    const existing = input.dedupKey
      ? items.find((n) => n.dedupKey === input.dedupKey && now - n.at <= DEDUP_MS)
      : undefined;

    let next: AppNotification;
    if (existing) {
      next = {
        ...existing,
        at: now,
        count: existing.count + 1,
        read: false,
        title: input.title,
        body: privacy ? undefined : input.body,
        level: input.level ?? existing.level,
      };
      set({ items: [next, ...items.filter((n) => n.id !== existing.id)] });
    } else {
      next = {
        id: `ntf_${now}_${Math.random().toString(36).slice(2, 7)}`,
        source: input.source,
        level: input.level ?? 'info',
        title: input.title,
        body: privacy ? undefined : input.body,
        at: now,
        read: false,
        count: 1,
        dedupKey: input.dedupKey,
        view: input.view,
        sessionID: input.sessionID,
        workspaceID: input.workspaceID,
        runId: input.runId,
        profileId: input.profileId,
      };
      set({ items: [next, ...items].slice(0, MAX_ITEMS) });
    }
    save(get().items, settings);

    if (quiet) return;
    const focused = document.visibilityState === 'visible' && document.hasFocus();
    if (!focused) {
      const unread = get().items.filter((n) => !n.read).length;
      startTitleFlash(unread, settings.flashTitle);
      if (settings.native) showNative(next, privacy);
      return;
    }
    if (!existing) toast(`${input.title}${input.body ? ` · ${privacy ? '内容已隐藏' : input.body}` : ''}`, input.level === 'error' ? 'error' : 'info');
  },

  markRead: (id) => {
    set({ items: get().items.map((n) => (n.id === id ? { ...n, read: true } : n)) });
    save(get().items);
  },

  markAllRead: () => {
    set({ items: get().items.map((n) => ({ ...n, read: true })) });
    save(get().items);
    stopTitleFlash();
  },

  clear: () => {
    set({ items: [] });
    save([]);
    stopTitleFlash();
  },

  open: (id) => {
    const item = get().items.find((n) => n.id === id);
    if (!item) return;
    get().markRead(id);
    window.dispatchEvent(new CustomEvent('ocg:notify-open', { detail: item }));
  },

  setSettings: (patch) => {
    const settings = { ...get().settings, ...patch };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    set({ settings });
  },

  requestNative: async () => {
    if (typeof Notification === 'undefined') {
      toast('当前浏览器不支持系统通知', 'error');
      return false;
    }
    const result = await Notification.requestPermission();
    const ok = result === 'granted';
    get().setSettings({ native: ok });
    if (!ok) toast('系统通知权限未授予，已保留应用内通知', 'error');
    return ok;
  },
}));

export function notificationSummary(): number {
  return useNotify.getState().items.filter((n) => !n.read).length;
}
