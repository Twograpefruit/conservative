import type { PermissionRequest, SessionInfo } from './types.js';

/** Envelope emitted by opencode v2 on GET /api/event (SSE `data:`). */
export interface UpstreamEvent {
  id?: string;
  created?: number;
  type: string;
  location?: { directory?: string };
  data: unknown;
  durable?: { aggregateID?: string; seq?: number; version?: number };
  metadata?: Record<string, unknown>;
}

/** Envelope forwarded by the BFF (adds a monotonic sequence for replay). */
export interface BffEvent extends UpstreamEvent {
  seq: number;
}

export interface StreamingText {
  ordinal: number;
  text: string;
  done: boolean;
  at: number;
}

export interface StreamingReasoning extends StreamingText {}

export interface StreamingTool {
  id: string;
  name: string;
  status: 'streaming' | 'running' | 'completed' | 'error';
  inputText: string;
  input?: unknown;
  content?: Array<{ type: string; text?: string; [k: string]: unknown }>;
  metadata?: Record<string, unknown>;
  error?: string;
  at: number;
  completedAt?: number;
}

export interface AssistantStream {
  messageID: string;
  sessionID: string;
  agent?: string;
  model?: { id: string; providerID: string; variant?: string };
  texts: Record<number, StreamingText>;
  reasoning: Record<number, StreamingReasoning>;
  tools: Record<string, StreamingTool>;
  toolOrder: string[];
  finish?: string;
  tokens?: { input: number; output: number; reasoning: number; cache: { read: number; write: number } };
  cost?: number;
  error?: unknown;
  startedAt: number;
}

export type RuntimeStatus = 'idle' | 'busy' | 'retry' | 'error';

export interface SessionRuntime {
  status: RuntimeStatus;
  lastStatusAt: number;
  startedAt?: number;
  error?: unknown;
  retry?: { attempt?: number; message?: string; at?: number };
}

export interface ChatState {
  sessions: Record<string, SessionInfo>;
  sessionOrder: string[];
  messages: Record<string, Record<string, import('./types.js').MessageInfo>>;
  messageOrder: Record<string, string[]>;
  streams: Record<string, AssistantStream>;
  permissions: Record<string, PermissionRequest[]>;
  runtime: Record<string, SessionRuntime>;
  seen: Set<string>;
  seenOrder: string[];
  diffVersion: number;
  fileVersion: number;
  vcsVersion: number;
  lastEventAt: number;
}

export function createChatState(): ChatState {
  return {
    sessions: {},
    sessionOrder: [],
    messages: {},
    messageOrder: {},
    streams: {},
    permissions: {},
    runtime: {},
    seen: new Set(),
    seenOrder: [],
    diffVersion: 0,
    fileVersion: 0,
    vcsVersion: 0,
    lastEventAt: 0,
  };
}

const MAX_SEEN = 8000;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' ? (value as Record<string, unknown>) : null;
}

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string') : [];
}

function eventKey(event: UpstreamEvent): string {
  if (event.id) return event.id;
  if (event.durable?.aggregateID != null && event.durable.seq != null) {
    return `${event.durable.aggregateID}:${event.durable.seq}:${event.durable.version ?? 0}:${event.type}`;
  }
  return `${event.type}:${event.created ?? 0}:${JSON.stringify(event.data).slice(0, 120)}`;
}

function isDuplicate(state: ChatState, key: string): boolean {
  return state.seen.has(key);
}

function remember(state: ChatState, key: string): void {
  state.seen.add(key);
  state.seenOrder.push(key);
  if (state.seenOrder.length > MAX_SEEN) {
    const drop = state.seenOrder.splice(0, state.seenOrder.length - MAX_SEEN);
    for (const k of drop) state.seen.delete(k);
  }
}

function sessionIdFromData(data: unknown): string | undefined {
  const d = asRecord(data);
  if (!d) return undefined;
  return (
    asString(d.sessionID) ??
    asString(d.id) ??
    asString(asRecord(d.session)?.id) ??
    asString(asRecord(d.session)?.sessionID)
  );
}

function normalizeSession(raw: unknown, fallbackId?: string): SessionInfo | null {
  const d = asRecord(raw);
  if (!d) return null;
  const id = asString(d.id) ?? asString(d.sessionID) ?? fallbackId;
  if (!id) return null;
  const time = asRecord(d.time) ?? {};
  const now = Date.now();
  return {
    ...(d as unknown as SessionInfo),
    id,
    time: {
      created: asNumber(time.created) ?? now,
      updated: asNumber(time.updated) ?? asNumber(time.created) ?? now,
      ...(asNumber(time.idle) != null ? { idle: asNumber(time.idle) } : {}),
      ...(asNumber(time.archived) != null ? { archived: asNumber(time.archived) } : {}),
    },
    title: asString(d.title),
    location: asRecord(d.location) as SessionInfo['location'],
  };
}

function upsertSession(state: ChatState, session: SessionInfo, prepend = false): void {
  const prev = state.sessions[session.id];
  state.sessions[session.id] = prev
    ? { ...prev, ...session, time: { ...prev.time, ...session.time } }
    : session;
  if (!prev) {
    if (prepend) state.sessionOrder.unshift(session.id);
    else state.sessionOrder.push(session.id);
  }
  state.sessionOrder.sort((a, b) => {
    const ta = state.sessions[a]?.time.updated ?? 0;
    const tb = state.sessions[b]?.time.updated ?? 0;
    return tb - ta;
  });
}

function ensureRuntime(state: ChatState, sessionID: string): SessionRuntime {
  let r = state.runtime[sessionID];
  if (!r) {
    r = { status: 'idle', lastStatusAt: 0 };
    state.runtime[sessionID] = r;
  }
  return r;
}

function setRuntime(
  state: ChatState,
  sessionID: string,
  patch: Partial<SessionRuntime> & { status: RuntimeStatus },
  at: number,
): void {
  const r = ensureRuntime(state, sessionID);
  if (at && r.lastStatusAt && at < r.lastStatusAt) return;
  state.runtime[sessionID] = {
    ...r,
    ...patch,
    lastStatusAt: Math.max(r.lastStatusAt, at || 0),
  };
}

function ensureStream(
  state: ChatState,
  messageID: string,
  sessionID: string,
  at: number,
  extra: Partial<AssistantStream> = {},
): AssistantStream {
  let s = state.streams[messageID];
  if (!s) {
    s = {
      messageID,
      sessionID,
      texts: {},
      reasoning: {},
      tools: {},
      toolOrder: [],
      startedAt: at,
      ...extra,
    };
    state.streams[messageID] = s;
  } else {
    s = { ...s, ...extra, texts: s.texts, reasoning: s.reasoning, tools: s.tools, toolOrder: s.toolOrder };
    state.streams[messageID] = s;
  }
  return s;
}

function dropSessionLocalState(state: ChatState, sessionID: string): void {
  delete state.messages[sessionID];
  delete state.messageOrder[sessionID];
  delete state.permissions[sessionID];
  delete state.runtime[sessionID];
  for (const [id, s] of Object.entries(state.streams)) {
    if (s.sessionID === sessionID) delete state.streams[id];
  }
}

/** Pure event reducer. Callers may pass a shallow-cloned state. */
export function reduceEvent(prev: ChatState, event: UpstreamEvent): ChatState {
  const key = eventKey(event);
  if (isDuplicate(prev, key)) return prev;
  const state: ChatState = {
    ...prev,
    sessions: { ...prev.sessions },
    sessionOrder: prev.sessionOrder.slice(),
    messages: prev.messages,
    messageOrder: prev.messageOrder,
    streams: { ...prev.streams },
    permissions: { ...prev.permissions },
    runtime: { ...prev.runtime },
    seen: new Set(prev.seen),
    seenOrder: prev.seenOrder.slice(),
  };
  remember(state, key);
  state.lastEventAt = Math.max(state.lastEventAt, event.created ?? 0);

  const data = event.data;
  const d = asRecord(data) ?? {};
  const at = event.created ?? Date.now();
  const sid = sessionIdFromData(data) ?? asString(d.sessionID);
  const type = event.type;

  switch (type) {
    case 'server.connected':
    case 'server.heartbeat':
      return state;

    case 'session.created': {
      const s = normalizeSession(d, sid);
      if (s) {
        upsertSession(state, { ...s, time: { ...s.time, updated: s.time.updated || at } }, true);
        setRuntime(state, s.id, { status: 'idle', startedAt: undefined }, at);
      }
      return state;
    }

    case 'session.updated':
    case 'session.metadata.updated': {
      const raw = asRecord(d.session) ?? d;
      const s = normalizeSession(raw, sid);
      if (s) upsertSession(state, s);
      return state;
    }

    case 'session.deleted':
    case 'session.destroyed': {
      const id = sid;
      if (!id) return state;
      delete state.sessions[id];
      state.sessionOrder = state.sessionOrder.filter((x) => x !== id);
      dropSessionLocalState(state, id);
      return state;
    }

    case 'session.execution.started': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'busy', startedAt: at, error: undefined, retry: undefined }, at);
      return state;
    }

    case 'session.execution.succeeded': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'idle', startedAt: undefined, retry: undefined }, at);
      const s = state.sessions[sid];
      if (s) state.sessions[sid] = { ...s, status: 'idle', error: undefined, time: { ...s.time, updated: at } };
      return state;
    }

    case 'session.execution.failed': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'error', error: d.error ?? d, startedAt: undefined }, at);
      const s = state.sessions[sid];
      if (s) state.sessions[sid] = { ...s, status: 'error', error: d.error ?? d, time: { ...s.time, updated: at } };
      return state;
    }

    case 'session.execution.interrupted': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'idle', startedAt: undefined }, at);
      return state;
    }

    case 'session.retry.scheduled': {
      if (!sid) return state;
      setRuntime(state, sid, {
        status: 'retry',
        retry: {
          attempt: asNumber(d.attempt) ?? asNumber(asRecord(d.retry)?.attempt),
          message: asString(d.message) ?? asString(asRecord(d.retry)?.message),
          at,
        },
      }, at);
      const s = state.sessions[sid];
      if (s) state.sessions[sid] = { ...s, status: 'retry' };
      return state;
    }

    case 'session.idle': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'idle', retry: undefined }, at);
      return state;
    }

    case 'session.error': {
      if (!sid) return state;
      setRuntime(state, sid, { status: 'error', error: d.error ?? d, startedAt: undefined }, at);
      return state;
    }

    case 'session.step.started': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (mid) {
        ensureStream(state, mid, sid, at, {
          agent: asString(d.agent),
          model: asRecord(d.model) as AssistantStream['model'],
        });
      }
      setRuntime(state, sid, { status: 'busy', startedAt: at }, at);
      return state;
    }

    case 'session.step.ended': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (mid) {
        const s = ensureStream(state, mid, sid, at);
        state.streams[mid] = {
          ...s,
          finish: asString(d.finish),
          tokens: asRecord(d.tokens) as AssistantStream['tokens'],
          cost: asNumber(d.cost),
        };
      }
      return state;
    }

    case 'session.step.failed': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (mid) {
        const s = ensureStream(state, mid, sid, at);
        state.streams[mid] = { ...s, error: d.error ?? d };
      }
      setRuntime(state, sid, { status: 'error', error: d.error ?? d, startedAt: undefined }, at);
      return state;
    }

    case 'session.text.started': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const s = ensureStream(state, mid, sid, at);
      state.streams[mid] = {
        ...s,
        texts: { ...s.texts, [ordinal]: { ordinal, text: '', done: false, at } },
      };
      return state;
    }

    case 'session.text.delta': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const delta = asString(d.delta) ?? '';
      const s = ensureStream(state, mid, sid, at);
      const cur = s.texts[ordinal];
      if (cur?.done) return state;
      state.streams[mid] = {
        ...s,
        texts: {
          ...s.texts,
          [ordinal]: { ordinal, text: (cur?.text ?? '') + delta, done: false, at: cur?.at ?? at },
        },
      };
      return state;
    }

    case 'session.text.ended': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const text = asString(d.text) ?? '';
      const s = ensureStream(state, mid, sid, at);
      state.streams[mid] = {
        ...s,
        texts: { ...s.texts, [ordinal]: { ordinal, text, done: true, at: s.texts[ordinal]?.at ?? at } },
      };
      return state;
    }

    case 'session.reasoning.started': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const s = ensureStream(state, mid, sid, at);
      state.streams[mid] = {
        ...s,
        reasoning: { ...s.reasoning, [ordinal]: { ordinal, text: '', done: false, at } },
      };
      return state;
    }

    case 'session.reasoning.delta': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const delta = asString(d.delta) ?? '';
      const s = ensureStream(state, mid, sid, at);
      const cur = s.reasoning[ordinal];
      if (cur?.done) return state;
      state.streams[mid] = {
        ...s,
        reasoning: {
          ...s.reasoning,
          [ordinal]: { ordinal, text: (cur?.text ?? '') + delta, done: false, at: cur?.at ?? at },
        },
      };
      return state;
    }

    case 'session.reasoning.ended': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      if (!mid) return state;
      const ordinal = asNumber(d.ordinal) ?? 0;
      const text = asString(d.text) ?? '';
      const s = ensureStream(state, mid, sid, at);
      state.streams[mid] = {
        ...s,
        reasoning: { ...s.reasoning, [ordinal]: { ordinal, text, done: true, at: s.reasoning[ordinal]?.at ?? at } },
      };
      return state;
    }

    case 'session.tool.input.started': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const tools = {
        ...s.tools,
        [id]: {
          id,
          name: asString(d.name) ?? s.tools[id]?.name ?? 'tool',
          status: 'streaming' as const,
          inputText: '',
          at,
        },
      };
      state.streams[mid] = {
        ...s,
        tools,
        toolOrder: s.toolOrder.includes(id) ? s.toolOrder : [...s.toolOrder, id],
      };
      return state;
    }

    case 'session.tool.input.delta': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const cur = s.tools[id] ?? { id, name: asString(d.name) ?? 'tool', status: 'streaming' as const, inputText: '', at };
      state.streams[mid] = {
        ...s,
        tools: { ...s.tools, [id]: { ...cur, inputText: cur.inputText + (asString(d.delta) ?? '') } },
        toolOrder: s.toolOrder.includes(id) ? s.toolOrder : [...s.toolOrder, id],
      };
      return state;
    }

    case 'session.tool.input.ended':
    case 'session.tool.called': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const cur = s.tools[id] ?? { id, name: asString(d.name) ?? 'tool', status: 'streaming' as const, inputText: '', at };
      let input = d.input;
      if (input === undefined && typeof d.text === 'string') {
        try {
          input = JSON.parse(d.text);
        } catch {
          input = d.text;
        }
      }
      state.streams[mid] = {
        ...s,
        tools: {
          ...s.tools,
          [id]: {
            ...cur,
            name: asString(d.name) ?? cur.name,
            input: input ?? cur.input,
            status: type === 'session.tool.called' ? 'running' : cur.status,
          },
        },
        toolOrder: s.toolOrder.includes(id) ? s.toolOrder : [...s.toolOrder, id],
      };
      return state;
    }

    case 'session.tool.progress': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const cur = s.tools[id];
      if (!cur) return state;
      state.streams[mid] = {
        ...s,
        tools: {
          ...s.tools,
          [id]: {
            ...cur,
            status: cur.status === 'completed' || cur.status === 'error' ? cur.status : 'running',
            metadata: { ...cur.metadata, ...(asRecord(d.metadata) ?? {}) },
          },
        },
      };
      return state;
    }

    case 'session.tool.success': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const cur = s.tools[id] ?? { id, name: asString(d.name) ?? 'tool', status: 'running' as const, inputText: '', at };
      state.streams[mid] = {
        ...s,
        tools: {
          ...s.tools,
          [id]: {
            ...cur,
            status: 'completed',
            content: Array.isArray(d.content) ? (d.content as StreamingTool['content']) : cur.content,
            metadata: { ...cur.metadata, ...(asRecord(d.metadata) ?? {}) },
            completedAt: at,
          },
        },
        toolOrder: s.toolOrder.includes(id) ? s.toolOrder : [...s.toolOrder, id],
      };
      return state;
    }

    case 'session.tool.failed': {
      if (!sid) return state;
      const mid = asString(d.assistantMessageID);
      const id = asString(d.id);
      if (!mid || !id) return state;
      const s = ensureStream(state, mid, sid, at);
      const cur = s.tools[id] ?? { id, name: asString(d.name) ?? 'tool', status: 'running' as const, inputText: '', at };
      state.streams[mid] = {
        ...s,
        tools: {
          ...s.tools,
          [id]: {
            ...cur,
            status: 'error',
            error: asString(d.error) ?? asString(asRecord(d.error)?.message) ?? '工具调用失败',
            completedAt: at,
          },
        },
        toolOrder: s.toolOrder.includes(id) ? s.toolOrder : [...s.toolOrder, id],
      };
      return state;
    }

    case 'message.updated': {
      const raw = asRecord(d.message) ?? d;
      const msg = asRecord(raw);
      const id = asString(msg?.id);
      if (!id || !sid) return state;
      const list = { ...(state.messages[sid] ?? {}) };
      list[id] = msg as unknown as import('./types.js').MessageInfo;
      state.messages = { ...state.messages, [sid]: list };
      const order = state.messageOrder[sid] ? state.messageOrder[sid].slice() : [];
      if (!order.includes(id)) order.push(id);
      order.sort((a, b) => {
        const ta = asRecord(list[a]?.time)?.created;
        const tb = asRecord(list[b]?.time)?.created;
        return (asNumber(ta) ?? 0) - (asNumber(tb) ?? 0);
      });
      state.messageOrder = { ...state.messageOrder, [sid]: order };
      return state;
    }

    case 'message.removed': {
      const mid = asString(d.messageID) ?? asString(d.id);
      if (!sid || !mid) return state;
      if (state.messages[sid]) {
        const list = { ...state.messages[sid] };
        delete list[mid];
        state.messages = { ...state.messages, [sid]: list };
        state.messageOrder = { ...state.messageOrder, [sid]: (state.messageOrder[sid] ?? []).filter((x) => x !== mid) };
      }
      if (state.streams[mid]) {
        const streams = { ...state.streams };
        delete streams[mid];
        state.streams = streams;
      }
      return state;
    }

    case 'session.inbox.enqueued': {
      if (!sid) return state;
      const inboxID = asString(d.inboxID);
      const item = asRecord(d.item);
      if (!inboxID || !item) return state;
      if (item.type === 'compaction') return state;
      const payload = asRecord(item.payload) ?? {};
      const text = asString(payload.text);
      if (text == null) return state;
      const list = { ...(state.messages[sid] ?? {}) };
      list[inboxID] = {
        id: inboxID,
        type: 'user',
        time: { created: at },
        text,
      };
      state.messages = { ...state.messages, [sid]: list };
      const order = state.messageOrder[sid] ? state.messageOrder[sid].slice() : [];
      if (!order.includes(inboxID)) order.push(inboxID);
      state.messageOrder = { ...state.messageOrder, [sid]: order };
      return state;
    }

    case 'session.usage.updated': {
      if (!sid) return state;
      const s = state.sessions[sid];
      if (!s) return state;
      state.sessions[sid] = {
        ...s,
        tokens: (asRecord(d.tokens) as unknown as SessionInfo['tokens']) ?? s.tokens,
        cost: asNumber(d.cost) ?? s.cost,
        time: { ...s.time, updated: at },
      };
      return state;
    }

    case 'permission.asked': {
      const req = (asRecord(d.request) ?? d) as unknown as PermissionRequest;
      if (!req?.id) return state;
      const target = req.sessionID ?? sid;
      if (!target) return state;
      const cur = state.permissions[target] ?? [];
      if (cur.some((p) => p.id === req.id)) return state;
      state.permissions = {
        ...state.permissions,
        [target]: [...cur, { ...req, sessionID: target }],
      };
      return state;
    }

    case 'permission.replied':
    case 'permission.rejected': {
      const rid = asString(d.requestID) ?? asString(d.id) ?? asString(asRecord(d.request)?.id);
      const target = sid ?? asString(d.sessionID);
      if (!rid) return state;
      if (target) {
        state.permissions = {
          ...state.permissions,
          [target]: (state.permissions[target] ?? []).filter((p) => p.id !== rid),
        };
      } else {
        for (const [sidKey, list] of Object.entries(state.permissions)) {
          if (list.some((p) => p.id === rid)) {
            state.permissions = { ...state.permissions, [sidKey]: list.filter((p) => p.id !== rid) };
          }
        }
      }
      return state;
    }

    case 'session.diff':
    case 'session.step.diff':
      state.diffVersion += 1;
      return state;

    case 'file.edited':
    case 'file.written':
    case 'file.removed':
    case 'bff.files.changed': {
      state.fileVersion += 1;
      state.diffVersion += 1;
      return state;
    }

    case 'vcs.branch.updated':
    case 'vcs.updated':
      state.vcsVersion += 1;
      return state;

    default: {
      // Legacy/message-part fallbacks (v1 compatibility, harmless on v2).
      if (type.startsWith('message.part.')) {
        const mid = asString(d.messageID) ?? asString(asRecord(d.part)?.messageID);
        if (!sid || !mid) return state;
        const s = ensureStream(state, mid, sid, at);
        const part = asRecord(d.part) ?? d;
        if (part.type === 'text' && typeof part.text === 'string') {
          state.streams[mid] = {
            ...s,
            texts: { ...s.texts, 0: { ordinal: 0, text: part.text, done: type === 'message.part.updated', at } },
          };
        }
        return state;
      }
      return state;
    }
  }
}

export function hydrateSessions(state: ChatState, sessions: SessionInfo[]): ChatState {
  const next: ChatState = { ...state, sessions: { ...state.sessions }, sessionOrder: [] };
  for (const raw of sessions) {
    const s = normalizeSession(raw);
    if (!s) continue;
    next.sessions[s.id] = { ...(next.sessions[s.id] ?? { time: { created: 0, updated: 0 } }), ...s };
  }
  next.sessionOrder = Object.keys(next.sessions).sort(
    (a, b) => (next.sessions[b]?.time.updated ?? 0) - (next.sessions[a]?.time.updated ?? 0),
  );
  return next;
}

export function hydrateMessages(
  state: ChatState,
  sessionID: string,
  messages: import('./types.js').MessageInfo[],
): ChatState {
  const list: Record<string, import('./types.js').MessageInfo> = {};
  const order: string[] = [];
  for (const m of messages) {
    if (!m?.id) continue;
    list[m.id] = m;
    order.push(m.id);
  }
  order.sort((a, b) => {
    const ta = asRecord(list[a]?.time)?.created;
    const tb = asRecord(list[b]?.time)?.created;
    return (asNumber(ta) ?? 0) - (asNumber(tb) ?? 0);
  });
  return {
    ...state,
    messages: { ...state.messages, [sessionID]: list },
    messageOrder: { ...state.messageOrder, [sessionID]: order },
  };
}

export function removeSession(state: ChatState, sessionID: string): ChatState {
  const next: ChatState = {
    ...state,
    sessions: { ...state.sessions },
    sessionOrder: state.sessionOrder.filter((x) => x !== sessionID),
    messages: { ...state.messages },
    messageOrder: { ...state.messageOrder },
    streams: { ...state.streams },
    permissions: { ...state.permissions },
    runtime: { ...state.runtime },
  };
  delete next.sessions[sessionID];
  dropSessionLocalState(next, sessionID);
  return next;
}

export function permissionsForSession(state: ChatState, sessionID: string): PermissionRequest[] {
  return state.permissions[sessionID] ?? [];
}

export function allPermissionCount(state: ChatState): number {
  return Object.values(state.permissions).reduce((sum, list) => sum + list.length, 0);
}

export function streamFor(state: ChatState, messageID: string): AssistantStream | undefined {
  return state.streams[messageID];
}
