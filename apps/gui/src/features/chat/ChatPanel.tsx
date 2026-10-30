import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantStream, MessageInfo, SessionInfo } from '@ocg/protocol';
import { selectVisibleMessages, useChat } from '../../store/chatStore.js';
import { useApp } from '../../store/appStore.js';
import { Markdown } from '../../components/Markdown.js';
import { ToolCard } from '../../components/ToolCard.js';
import { PermissionCard } from '../../components/PermissionCard.js';
import { renderParts } from '../../lib/parts.js';

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString();
}

function statusDot(status?: string): string {
  switch (status) {
    case 'busy':
    case 'retry':
      return 'dot-busy';
    case 'error':
      return 'dot-error';
    default:
      return 'dot-idle';
  }
}

function SessionItem({
  session,
  active,
  permissions,
  onClick,
  onDelete,
  onRename,
}: {
  session: SessionInfo;
  active: boolean;
  permissions: number;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
}) {
  return (
    <div className={`session-item ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onRename} title={session.title}>
      <span className={`dot ${statusDot(session.status)}`} />
      <div className="session-item-main">
        <div className="session-item-title">{session.title || '未命名会话'}</div>
        <div className="session-item-meta">
          <span>{timeAgo(session.time.updated)}</span>
          {session.model ? <span>{session.model.id}</span> : null}
        </div>
      </div>
      {permissions > 0 ? <span className="badge badge-warn">{permissions}</span> : null}
      <button
        className="icon-btn session-delete"
        title="删除会话"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
      >
        ×
      </button>
    </div>
  );
}

function AssistantBlock({
  message,
  stream,
}: {
  message?: MessageInfo;
  stream?: AssistantStream;
}) {
  const parts = renderParts(message, stream);
  const assistant = message && (message as { type?: string }).type === 'assistant' ? (message as { agent?: string; model?: { id?: string }; time?: { created?: number }; cost?: number; error?: { message?: string } }) : null;
  return (
    <div className="msg assistant">
      <div className="msg-head">
        <span className="msg-role">assistant</span>
        {assistant?.agent ? <span className="msg-chip">{assistant.agent}</span> : null}
        {assistant?.model?.id ? <span className="msg-chip">{assistant.model.id}</span> : null}
        {assistant?.cost ? <span className="msg-chip">${assistant.cost.toFixed(4)}</span> : null}
      </div>
      <div className="msg-body">
        {parts.map((part) => {
          if (part.kind === 'reasoning') {
            return (
              <details className="reasoning" key={part.key}>
                <summary>思考过程{part.done ? '' : '（进行中）'}</summary>
                <pre>{part.text}</pre>
              </details>
            );
          }
          if (part.kind === 'tool' && part.tool) return <ToolCard key={part.key} tool={part.tool} />;
          if (part.kind === 'text') {
            if (!part.text && part.done) return null;
            return <Markdown key={part.key} text={part.text ?? ''} />;
          }
          return null;
        })}
        {assistant?.error?.message ? <div className="msg-error">{assistant.error.message}</div> : null}
      </div>
    </div>
  );
}

function UserBlock({ message }: { message: MessageInfo }) {
  const text = (message as { text?: string }).text ?? '';
  return (
    <div className="msg user">
      <div className="bubble">
        <Markdown text={text} />
      </div>
    </div>
  );
}

const AssistantBlockMemo = React.memo(AssistantBlock);
const UserBlockMemo = React.memo(UserBlock);

function Composer({ session, busy }: { session: SessionInfo | null; busy: boolean }) {
  const [text, setText] = useState('');
  const sendPrompt = useChat((s) => s.sendPrompt);
  const interrupt = useChat((s) => s.interrupt);
  const models = useChat((s) => s.models);
  const agents = useChat((s) => s.agents);
  const setModel = useChat((s) => s.setModel);
  const setAgent = useChat((s) => s.setAgent);
  const ta = useRef<HTMLTextAreaElement>(null);

  const submit = async () => {
    const value = text.trim();
    if (!value || !session) return;
    setText('');
    await sendPrompt(value);
    ta.current?.focus();
  };

  const modelValue = session?.model ? `${session.model.providerID}/${session.model.id}` : '';
  const currentAgent = session?.agent ?? '';

  return (
    <div className="composer">
      <div className="composer-box">
        <textarea
          ref={ta}
          value={text}
          placeholder={session ? '输入消息，Enter 发送，Shift+Enter 换行…' : '请先创建或选择一个会话'}
          rows={3}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              void submit();
            }
          }}
          disabled={!session}
        />
        <div className="composer-actions">
          <div className="composer-selects">
            <select
              value={currentAgent}
              onChange={(e) => {
                const agent = agents.find((a) => a.id === e.target.value);
                if (agent) void setAgent(agent);
              }}
              title="Agent"
            >
              <option value="">默认 Agent</option>
              {agents.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name ?? a.id}
                </option>
              ))}
            </select>
            <select
              value={modelValue}
              onChange={(e) => {
                const [providerID, ...rest] = e.target.value.split('/');
                const id = rest.join('/');
                const model = models.find((m) => m.providerID === providerID && m.id === id);
                if (model) void setModel(model);
              }}
              title="模型"
            >
              <option value="">默认模型</option>
              {models.slice(0, 200).map((m) => (
                <option key={`${m.providerID}/${m.id}`} value={`${m.providerID}/${m.id}`}>
                  {m.name ?? m.id} · {m.providerID}
                </option>
              ))}
            </select>
          </div>
          {busy ? (
            <button className="btn btn-danger" onClick={() => void interrupt()}>
              停止
            </button>
          ) : (
            <button className="btn btn-primary" onClick={() => void submit()} disabled={!session || !text.trim()}>
              发送
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

export function ChatPanel() {
  const state = useChat((s) => s.state);
  const activeID = useChat((s) => s.activeSessionID);
  const connected = useChat((s) => s.connected);
  const refresh = useChat((s) => s.refreshSessions);
  const select = useChat((s) => s.selectSession);
  const create = useChat((s) => s.createSession);
  const del = useChat((s) => s.deleteSession);
  const rename = useChat((s) => s.renameSession);
  const reply = useChat((s) => s.replyPermission);
  const [filter, setFilter] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const sessions = useMemo(
    () =>
      state.sessionOrder
        .map((id) => state.sessions[id])
        .filter(Boolean)
        .filter((s) => !filter || (s.title ?? '').toLowerCase().includes(filter.toLowerCase())),
    [state.sessionOrder, state.sessions, filter],
  );
  const active = activeID ? state.sessions[activeID] : null;
  const messages = useMemo(() => selectVisibleMessages(state, activeID), [state, activeID]);
  const streams = useMemo(
    () => Object.values(state.streams).filter((s) => s.sessionID === activeID),
    [state.streams, activeID],
  );
  const messageIDs = useMemo(() => new Set((activeID ? state.messageOrder[activeID] : []) ?? []), [state.messageOrder, activeID]);
  const liveStreams = streams.filter((s) => !messageIDs.has(s.messageID));
  const permissions = activeID ? state.permissions[activeID] ?? [] : [];
  const runtime = activeID ? state.runtime[activeID] : undefined;
  const busy = runtime?.status === 'busy' || runtime?.status === 'retry';

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom || busy) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveStreams.length, state.streams, busy]);

  const statusText =
    runtime?.status === 'retry'
      ? '重试中'
      : runtime?.status === 'busy'
        ? '生成中'
        : runtime?.status === 'error'
          ? '错误'
          : '空闲';

  return (
    <div className="chat-layout">
      <aside className="session-pane">
        <div className="pane-head">
          <div className="pane-title">会话</div>
          <div className="pane-actions">
            <button className="icon-btn" title="刷新" onClick={() => void refresh(false)}>
              ↻
            </button>
            <button className="btn btn-small btn-primary" onClick={() => void create()}>
              + 新建
            </button>
          </div>
        </div>
        <input className="input session-filter" placeholder="筛选会话…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <div className="session-list">
          {sessions.length === 0 ? <div className="empty-hint">还没有会话</div> : null}
          {sessions.map((s) => (
            <SessionItem
              key={s.id}
              session={s}
              active={s.id === activeID}
              permissions={(state.permissions[s.id] ?? []).length}
              onClick={() => void select(s.id)}
              onDelete={() => {
                if (window.confirm(`删除会话“${s.title ?? s.id}”？`)) void del(s.id);
              }}
              onRename={() => {
                const title = window.prompt('新的会话标题', s.title ?? '');
                if (title) void rename(s.id, title);
              }}
            />
          ))}
        </div>
        <div className="session-pane-foot">
          <span className={`dot ${connected ? 'dot-idle' : 'dot-error'}`} />
          {connected ? '事件流已连接' : '事件流断开'}
        </div>
      </aside>

      <section className="chat-main">
        {active ? (
          <>
            <div className="chat-head">
              <div>
                <div className="chat-title">{active.title || '未命名会话'}</div>
                <div className="chat-sub">
                  <span className={`status-pill status-${runtime?.status ?? 'idle'}`}>{statusText}</span>
                  {active.tokens ? (
                    <span>
                      ↑{active.tokens.input} ↓{active.tokens.output} · 缓存 {active.tokens.cache?.read ?? 0}
                    </span>
                  ) : null}
                  {active.model ? <span>{active.model.id}</span> : null}
                </div>
              </div>
              {runtime?.error ? (
                <div className="chat-error" title={JSON.stringify(runtime.error)}>
                  上游错误
                </div>
              ) : null}
            </div>

            <div className="messages" ref={scrollRef}>
              {messages.length === 0 && liveStreams.length === 0 ? (
                <div className="welcome">
                  <h2>连接 opencode v2</h2>
                  <p>在下方输入消息开始对话。所有状态来自 opencode 事件流，断线会自动补帧。</p>
                  <div className="welcome-tips">
                    <span>Enter 发送</span>
                    <span>Shift+Enter 换行</span>
                    <span>双击会话标题重命名</span>
                  </div>
                </div>
              ) : null}
              {messages.map((m) => {
                if ((m as { type?: string }).type === 'user') return <UserBlockMemo key={m.id} message={m} />;
                if ((m as { type?: string }).type === 'assistant')
                  return <AssistantBlockMemo key={m.id} message={m} stream={state.streams[m.id]} />;
                return (
                  <div className="msg system" key={m.id}>
                    {String((m as { type?: string }).type ?? 'event')}
                  </div>
                );
              })}
              {liveStreams.map((s) => (
                <AssistantBlockMemo key={s.messageID} stream={s} />
              ))}
              {busy && liveStreams.length === 0 && messages.length > 0 ? (
                <div className="typing">
                  <span />
                  <span />
                  <span />
                </div>
              ) : null}
              <div ref={bottomRef} />
            </div>

            <div className="permissions">
              {permissions.map((p) => (
                <PermissionCard key={p.id} request={p} onReply={(decision) => void reply(p, decision)} />
              ))}
            </div>
            <Composer session={active} busy={busy} />
          </>
        ) : (
          <div className="empty-state">
            <h2>没有可用会话</h2>
            <p>创建会话后即可与 opencode 对话。</p>
            <button className="btn btn-primary" onClick={() => void create()}>
              新建会话
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
