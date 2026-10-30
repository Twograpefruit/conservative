import { create } from 'zustand';
import {
  createChatState,
  hydrateMessages,
  hydrateSessions,
  reduceEvent,
  removeSession,
  type AgentInfo,
  type AssistantStream,
  type BffEvent,
  type ChatState,
  type MessageInfo,
  type ModelInfo,
  type PermissionRequest,
  type PromptUploadFile,
  type SessionInfo,
} from '@ocg/protocol';
import { api, qs } from '../api/client.js';
import { useApp } from './appStore.js';

interface ChatStore {
  state: ChatState;
  activeSessionID: string | null;
  models: ModelInfo[];
  agents: AgentInfo[];
  archivedSessions: SessionInfo[];
  showArchived: boolean;
  connected: boolean;
  lastError: string | null;
  init: () => Promise<void>;
  stop: () => void;
  refreshSessions: (select?: boolean) => Promise<void>;
  loadArchived: () => Promise<void>;
  setShowArchived: (show: boolean) => Promise<void>;
  archiveSession: (id: string, archived: boolean) => Promise<void>;
  selectSession: (id: string) => Promise<void>;
  loadMessages: (id: string) => Promise<void>;
  createSession: () => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  renameSession: (id: string, title: string) => Promise<void>;
  sendPrompt: (text: string, files?: PromptUploadFile[]) => Promise<void>;
  interrupt: () => Promise<void>;
  replyPermission: (request: PermissionRequest, decision: 'once' | 'always' | 'reject') => Promise<void>;
  setModel: (model: ModelInfo) => Promise<void>;
  setAgent: (agent: AgentInfo) => Promise<void>;
  handleEvent: (event: BffEvent) => void;
  resync: () => Promise<void>;
  loadCatalog: () => Promise<void>;
}

let source: EventSource | null = null;
let reconcileTimer: ReturnType<typeof setTimeout> | null = null;
let eventQueue: BffEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let filesChangedPending = false;

function flushEvents(): void {
  flushTimer = null;
  const events = eventQueue;
  eventQueue = [];
  if (events.length === 0) return;
  const store = useChat.getState();
  let state = store.state;
  for (const event of events) state = reduceEvent(state, event);
  useChat.setState({ state });
  let refresh = false;
  let reconcileSession: string | undefined;
  for (const event of events) {
    const type = event.type;
    if (type === 'session.created' || type === 'session.updated' || type === 'session.deleted') refresh = true;
    if (
      type === 'session.execution.succeeded' ||
      type === 'session.execution.failed' ||
      type === 'session.execution.interrupted'
    ) {
      const sid = (event.data as { sessionID?: string } | null)?.sessionID;
      if (sid && sid === useChat.getState().activeSessionID) reconcileSession = sid;
    }
    if (type === 'bff.files.changed') filesChangedPending = true;
  }
  if (refresh) void store.refreshSessions(false);
  if (reconcileSession) {
    if (reconcileTimer) clearTimeout(reconcileTimer);
    reconcileTimer = setTimeout(() => void useChat.getState().loadMessages(reconcileSession!), 350);
  }
  if (filesChangedPending) {
    filesChangedPending = false;
    useApp.getState().notify('文件已变更，编辑器与差异已刷新');
  }
}

function workspaceDir(): string | undefined {
  const app = useApp.getState();
  return app.workspaces.find((w) => w.id === app.workspaceID)?.path;
}

export const useChat = create<ChatStore>((set, get) => ({
  state: createChatState(),
  activeSessionID: localStorage.getItem('ocg.session'),
  models: [],
  agents: [],
  archivedSessions: [],
  showArchived: false,
  connected: false,
  lastError: null,

  init: async () => {
    await get().refreshSessions(true);
    await get().loadCatalog().catch(() => undefined);
    if (source) return;
    source = new EventSource('/api/events');
    source.addEventListener('open', () => set({ connected: true, lastError: null }));
    source.addEventListener('error', () => set({ connected: false, lastError: '事件流断开，正在重连…' }));
    source.addEventListener('oc', (event) => {
      try {
        const parsed = JSON.parse((event as MessageEvent).data) as BffEvent;
        get().handleEvent(parsed);
        set({ connected: true });
      } catch {
        /* ignore malformed */
      }
    });
    source.addEventListener('resync', () => {
      void get().resync();
    });
  },

  stop: () => {
    source?.close();
    source = null;
    eventQueue = [];
    if (flushTimer) clearTimeout(flushTimer);
    flushTimer = null;
    set({ connected: false });
  },

  refreshSessions: async (select = false) => {
    try {
      const res = await api<{ data: SessionInfo[] }>(`/api/oc/api/session${qs({ limit: 100, archived: 'false' })}`);
      const dir = workspaceDir()?.replace(/\\/g, '/').toLowerCase();
      const visible = dir
        ? (res.data ?? []).filter((s) => !s.location?.directory || s.location.directory.replace(/\\/g, '/').toLowerCase() === dir)
        : res.data ?? [];
      let state = hydrateSessions(get().state, visible);
      let active = get().activeSessionID;
      if (!active || !state.sessions[active]) {
        active = state.sessionOrder[0] ?? null;
      }
      if (active) localStorage.setItem('ocg.session', active);
      set({ state, activeSessionID: active, lastError: null });
      if (active && (select || !state.messages[active])) await get().loadMessages(active);
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  loadArchived: async () => {
    try {
      const res = await api<{ data: SessionInfo[] }>(`/api/oc/api/session${qs({ limit: 100, archived: 'true' })}`);
      const dir = workspaceDir()?.replace(/\\/g, '/').toLowerCase();
      const list = dir
        ? (res.data ?? []).filter((s) => !s.location?.directory || s.location.directory.replace(/\\/g, '/').toLowerCase() === dir)
        : res.data ?? [];
      set({ archivedSessions: list });
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : '归档列表加载失败', 'error');
    }
  },

  setShowArchived: async (show) => {
    set({ showArchived: show });
    if (show) await get().loadArchived();
  },

  archiveSession: async (id, archived) => {
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ archived }),
        headers: { 'content-type': 'application/json' },
      });
      if (archived && get().activeSessionID === id) {
        const state = get().state;
        const next = state.sessionOrder.find((sid) => sid !== id) ?? null;
        set({ activeSessionID: next });
        if (next) await get().loadMessages(next);
      }
      await get().refreshSessions(false);
      if (get().showArchived) await get().loadArchived();
      useApp.getState().notify(archived ? '会话已归档' : '会话已取消归档');
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : '归档操作失败', 'error');
    }
  },

  selectSession: async (id) => {
    localStorage.setItem('ocg.session', id);
    set({ activeSessionID: id });
    await get().loadMessages(id);
  },

  loadMessages: async (id) => {
    try {
      const res = await api<{ data: MessageInfo[] }>(
        `/api/oc/api/session/${encodeURIComponent(id)}/message${qs({ limit: 200, order: 'desc' })}`,
      );
      const state = hydrateMessages(get().state, id, res.data ?? []);
      set({ state });
    } catch (err) {
      set({ lastError: err instanceof Error ? err.message : String(err) });
    }
  },

  createSession: async () => {
    try {
      const dir = workspaceDir();
      const res = await api<{ data: SessionInfo }>('/api/oc/api/session', {
        method: 'POST',
        body: JSON.stringify({ title: '新会话', ...(dir ? { location: { directory: dir } } : {}) }),
        headers: { 'content-type': 'application/json' },
      });
      await get().refreshSessions();
      await get().selectSession(res.data.id);
      useApp.getState().setView('chat');
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  deleteSession: async (id) => {
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}`, { method: 'DELETE' });
      const state = removeSession(get().state, id);
      const next = state.sessionOrder[0] ?? null;
      set({ state, activeSessionID: next });
      if (next) await get().loadMessages(next);
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  renameSession: async (id, title) => {
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ title }) });
      const state = get().state;
      const s = state.sessions[id];
      if (s) {
        state.sessions[id] = { ...s, title };
        set({ state: { ...state, sessions: { ...state.sessions } } });
      }
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  sendPrompt: async (text, files) => {
    const id = get().activeSessionID;
    if (!id || !text.trim()) return;
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}/prompt`, {
        method: 'POST',
        body: JSON.stringify({ text, ...(files?.length ? { files } : {}) }),
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  interrupt: async () => {
    const id = get().activeSessionID;
    if (!id) return;
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}/interrupt`, { method: 'POST' });
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  replyPermission: async (request, decision) => {
    try {
      await api(
        `/api/oc/api/session/${encodeURIComponent(request.sessionID)}/permission/${encodeURIComponent(request.id)}/reply`,
        { method: 'POST', body: JSON.stringify({ decision }), headers: { 'content-type': 'application/json' } },
      );
      const state = get().state;
      state.permissions[request.sessionID] = (state.permissions[request.sessionID] ?? []).filter((p) => p.id !== request.id);
      set({ state: { ...state, permissions: { ...state.permissions } } });
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  setModel: async (model) => {
    const id = get().activeSessionID;
    if (!id) return;
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}/model`, {
        method: 'POST',
        body: JSON.stringify({ model: { id: model.id, providerID: model.providerID, variant: model.variants?.[0] } }),
        headers: { 'content-type': 'application/json' },
      });
      const state = get().state;
      const s = state.sessions[id];
      if (s) {
        state.sessions[id] = { ...s, model: { id: model.id, providerID: model.providerID } };
        set({ state: { ...state, sessions: { ...state.sessions } } });
      }
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  setAgent: async (agent) => {
    const id = get().activeSessionID;
    if (!id) return;
    try {
      await api(`/api/oc/api/session/${encodeURIComponent(id)}/agent`, {
        method: 'POST',
        body: JSON.stringify({ agent: agent.id }),
        headers: { 'content-type': 'application/json' },
      });
    } catch (err) {
      useApp.getState().notify(err instanceof Error ? err.message : String(err), 'error');
    }
  },

  handleEvent: (event) => {
    // Coalesce bursts of deltas into one render per frame-ish interval.
    eventQueue.push(event);
    if (!flushTimer) flushTimer = setTimeout(flushEvents, 16);
  },

  resync: async () => {
    eventQueue = [];
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await get().refreshSessions(false);
    const id = get().activeSessionID;
    if (id) await get().loadMessages(id);
  },

  // Filled below to avoid a circular import in the type declaration.
  loadCatalog: async () => {    try {
      const [models, agents] = await Promise.all([
        api<{ data: ModelInfo[] }>(`/api/oc/api/model${qs({ types: 'chat' })}`),
        api<{ data: AgentInfo[] }>('/api/oc/api/agent'),
      ]);
      set({ models: models.data ?? [], agents: agents.data ?? [] });
    } catch {
      /* upstream unavailable */
    }
  },
}));

// Attach the catalog loader to the store type without importing zod.

export function selectVisibleMessages(state: ChatState, sessionID: string | null): MessageInfo[] {
  if (!sessionID) return [];
  const order = state.messageOrder[sessionID] ?? [];
  return order.map((id) => state.messages[sessionID]?.[id]).filter(Boolean) as MessageInfo[];
}

export function selectStream(state: ChatState, messageID: string): AssistantStream | undefined {
  return state.streams[messageID];
}

export function activeWorkspaceDir(): string | undefined {
  return workspaceDir();
}
