import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantStream, FileEntry, MessageInfo, PromptUploadFile, SessionInfo } from '@ocg/protocol';
import { selectVisibleMessages, useChat } from '../../store/chatStore.js';
import { useApp } from '../../store/appStore.js';
import { api, qs } from '../../api/client.js';
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

function messageText(message: MessageInfo): string {
  const anyMsg = message as unknown as {
    type?: string;
    text?: string;
    content?: Array<{ type?: string; text?: string; name?: string; state?: { input?: unknown; content?: unknown; error?: string } }>;
  };
  if (anyMsg.type === 'user') return anyMsg.text ?? '';
  const chunks: string[] = [];
  for (const part of anyMsg.content ?? []) {
    if (part.text) chunks.push(part.text);
    if (part.name) chunks.push(part.name);
    if (part.state?.input) chunks.push(JSON.stringify(part.state.input).slice(0, 2000));
    if (part.state?.content) chunks.push(JSON.stringify(part.state.content).slice(0, 4000));
    if (part.state?.error) chunks.push(part.state.error);
  }
  return chunks.join('\n');
}

function snippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, idx + query.length + 60).replace(/\s+/g, ' ')}${idx + query.length + 60 < text.length ? '…' : ''}`;
}

function SessionItem({
  session,
  active,
  permissions,
  archived,
  onClick,
  onDelete,
  onRename,
  onArchive,
}: {
  session: SessionInfo;
  active: boolean;
  permissions: number;
  archived?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
  onArchive: () => void;
}) {
  return (
    <div className={`session-item ${active ? 'active' : ''}`} onClick={onClick} onDoubleClick={onRename} title={session.title}>
      <span className={`dot ${statusDot(session.status)}`} />
      <div className="session-item-main">
        <div className="session-item-title">{session.title || '未命名会话'}</div>
        <div className="session-item-meta">
          <span>{timeAgo(session.time.updated)}</span>
          {archived ? <span>已归档</span> : null}
          {session.model ? <span>{session.model.id}</span> : null}
        </div>
      </div>
      {permissions > 0 ? <span className="badge badge-warn">{permissions}</span> : null}
      <button
        className="icon-btn session-archive"
        title={archived ? '取消归档' : '归档会话'}
        onClick={(e) => {
          e.stopPropagation();
          onArchive();
        }}
      >
        {archived ? '↩' : '▣'}
      </button>
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

function toFileUri(workspacePath: string | undefined, rel: string): string {
  if (!workspacePath) return rel;
  const abs = `${workspacePath.replace(/[\\/]+$/, '')}\\${rel.replace(/^[\\/]+/, '')}`.replace(/\\/g, '/');
  return `file:///${abs.replace(/^\/+/, '')}`;
}

function Composer({ session, busy }: { session: SessionInfo | null; busy: boolean }) {
  const [text, setText] = useState('');
  const sendPrompt = useChat((s) => s.sendPrompt);
  const interrupt = useChat((s) => s.interrupt);
  const models = useChat((s) => s.models);
  const agents = useChat((s) => s.agents);
  const setModel = useChat((s) => s.setModel);
  const setAgent = useChat((s) => s.setAgent);
  const workspaceID = useApp((s) => s.workspaceID);
  const workspaces = useApp((s) => s.workspaces);
  const notify = useApp((s) => s.notify);
  const ta = useRef<HTMLTextAreaElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionFiles, setMentionFiles] = useState<FileEntry[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([]);
  const workspacePath = workspaces.find((w) => w.id === workspaceID)?.path;

  useEffect(() => {
    if (!mentionOpen || !workspaceID) {
      setMentionFiles([]);
      return;
    }
    const ac = new AbortController();
    const timer = setTimeout(() => {
      void api<{ entries: FileEntry[] }>(`/api/fs/find${qs({ ws: workspaceID, q: mentionQuery, limit: 40 })}`, {
        signal: ac.signal,
      })
        .then((res) => {
          setMentionFiles(res.entries ?? []);
          setMentionIndex(0);
        })
        .catch(() => undefined);
    }, 120);
    return () => {
      clearTimeout(timer);
      ac.abort();
    };
  }, [mentionOpen, mentionQuery, workspaceID]);

  const detectMention = (value: string, cursor: number) => {
    const before = value.slice(0, cursor);
    const m = before.match(/(^|\s)@([^\s@]*)$/);
    if (!m) {
      setMentionOpen(false);
      return;
    }
    setMentionStart(cursor - m[2].length - 1);
    setMentionQuery(m[2]);
    setMentionOpen(true);
  };

  const insertMention = (entry: FileEntry) => {
    const end = ta.current?.selectionStart ?? text.length;
    const token = `@${entry.path} `;
    const next = text.slice(0, mentionStart) + token + text.slice(end);
    setText(next);
    setSelectedFiles((prev) => (prev.some((f) => f.path === entry.path) ? prev : [...prev, entry]));
    setMentionOpen(false);
    requestAnimationFrame(() => {
      const pos = mentionStart + token.length;
      ta.current?.focus();
      ta.current?.setSelectionRange(pos, pos);
    });
  };

  const removeMention = (path: string) => {
    const token = `@${path}`;
    const at = text.lastIndexOf(token);
    if (at >= 0) setText(text.slice(0, at) + text.slice(at + token.length));
    setSelectedFiles((prev) => prev.filter((f) => f.path !== path));
  };

  const submit = async () => {
    const value = text;
    if (!value.trim() || !session) return;
    const files: PromptUploadFile[] = [];
    for (const f of selectedFiles) {
      const token = `@${f.path}`;
      const start = value.lastIndexOf(token);
      if (start < 0) continue;
      files.push({
        uri: toFileUri(workspacePath, f.path),
        name: f.path,
        mention: { start, end: start + token.length, text: token },
      });
    }
    setText('');
    setSelectedFiles([]);
    setMentionOpen(false);
    await sendPrompt(value, files);
    ta.current?.focus();
  };

  const modelValue = session?.model ? `${session.model.providerID}/${session.model.id}` : '';
  const currentAgent = session?.agent ?? '';

  return (
    <div className="composer">
      <div className="composer-box">
        {mentionOpen ? (
          <div className="mention-popup" role="listbox">
            <div className="mention-head">
              <span>引用文件</span>
              <span className="muted">{mentionQuery ? `@${mentionQuery}` : '全部文件'}</span>
            </div>
            {mentionFiles.length === 0 ? (
              <div className="mention-empty">没有匹配文件</div>
            ) : (
              mentionFiles.map((f, i) => (
                <button
                  type="button"
                  key={f.path}
                  className={`mention-item ${i === mentionIndex ? 'active' : ''}`}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    insertMention(f);
                  }}
                  onMouseEnter={() => setMentionIndex(i)}
                >
                  <span className="mention-icon">◈</span>
                  <span className="mention-path">{f.path}</span>
                </button>
              ))
            )}
            <div className="mention-foot">↑↓ 选择 · Enter/Tab 插入 · Esc 关闭</div>
          </div>
        ) : null}
        {selectedFiles.length ? (
          <div className="mention-chips">
            {selectedFiles.map((f) => (
              <span className="mention-chip" key={f.path} title={f.path}>
                @{f.path}
                <button type="button" onClick={() => removeMention(f.path)} aria-label="移除引用">
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ta}
          value={text}
          placeholder={session ? '输入消息；输入 @ 引用文件，可连续引用多个…' : '请先创建或选择一个会话'}
          rows={3}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            detectMention(value, e.target.selectionStart ?? value.length);
          }}
          onKeyDown={(e) => {
            if (mentionOpen && mentionFiles.length > 0) {
              if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                e.preventDefault();
                setMentionIndex((i) => (e.key === 'ArrowDown' ? (i + 1) % mentionFiles.length : (i - 1 + mentionFiles.length) % mentionFiles.length));
                return;
              }
              if (e.key === 'Enter' || e.key === 'Tab') {
                e.preventDefault();
                insertMention(mentionFiles[mentionIndex] ?? mentionFiles[0]);
                return;
              }
              if (e.key === 'Escape') {
                e.preventDefault();
                setMentionOpen(false);
                return;
              }
            }
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
            <span className="composer-hint" title="输入 @ 可连续引用多个文件">
              @ 引用文件
            </span>
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
  const archivedSessions = useChat((s) => s.archivedSessions);
  const showArchived = useChat((s) => s.showArchived);
  const setShowArchived = useChat((s) => s.setShowArchived);
  const archiveSession = useChat((s) => s.archiveSession);
  const [filter, setFilter] = useState('');
  const [chatQuery, setChatQuery] = useState('');
  const [chatSearchOpen, setChatSearchOpen] = useState(false);
  const [jumpIndex, setJumpIndex] = useState(0);
  const [flashID, setFlashID] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const anchors = useRef(new Map<string, HTMLDivElement>());
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const sessions = useMemo(
    () =>
      state.sessionOrder
        .map((id) => state.sessions[id])
        .filter(Boolean)
        .filter((s) => !filter || (s.title ?? '').toLowerCase().includes(filter.toLowerCase())),
    [state.sessionOrder, state.sessions, filter],
  );
  const active = activeID ? state.sessions[activeID] ?? archivedSessions.find((s) => s.id === activeID) ?? null : null;
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
  const searchMatches = useMemo(() => {
    const q = chatQuery.trim().toLowerCase();
    if (!q) return [];
    return messages
      .map((m) => ({ message: m, text: messageText(m) }))
      .filter((m) => m.text.toLowerCase().includes(q))
      .slice(0, 80)
      .map((m) => ({ id: m.message.id, type: (m.message as { type?: string }).type ?? 'event', text: snippet(m.text, q) }));
  }, [messages, chatQuery]);

  const jumpToId = (id: string) => {
    const el = anchors.current.get(id);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashID(id);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashID(null), 1400);
    const idx = messages.findIndex((m) => m.id === id);
    if (idx >= 0) setJumpIndex(idx);
  };

  const jumpBy = (delta: number) => {
    if (messages.length === 0) return;
    const next = Math.min(messages.length - 1, Math.max(0, jumpIndex + delta));
    setJumpIndex(next);
    jumpToId(messages[next].id);
  };

  useEffect(() => {
    if (messages.length === 0) {
      setJumpIndex(0);
      return;
    }
    setJumpIndex((i) => Math.min(i, messages.length - 1));
  }, [messages.length]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setChatSearchOpen(true);
        return;
      }
      if (e.altKey && e.key === 'ArrowUp') {
        e.preventDefault();
        jumpBy(-1);
      } else if (e.altKey && e.key === 'ArrowDown') {
        e.preventDefault();
        jumpBy(1);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      if (flashTimer.current) clearTimeout(flashTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, jumpIndex]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 220;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [messages.length, liveStreams.length, state.streams]);

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
            <button
              className={`icon-btn ${showArchived ? 'active' : ''}`}
              title={showArchived ? '隐藏归档会话' : '显示归档会话'}
              onClick={() => void setShowArchived(!showArchived)}
            >
              ▤
            </button>
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
              onArchive={() => void archiveSession(s.id, true)}
            />
          ))}
          {showArchived ? (
            <>
              <div className="session-section-title">已归档</div>
              {archivedSessions.length === 0 ? <div className="empty-hint">暂无归档会话</div> : null}
              {archivedSessions
                .filter((s) => !filter || (s.title ?? '').toLowerCase().includes(filter.toLowerCase()))
                .map((s) => (
                  <SessionItem
                    key={s.id}
                    session={s}
                    active={s.id === activeID}
                    archived
                    permissions={(state.permissions[s.id] ?? []).length}
                    onClick={() => void select(s.id)}
                    onDelete={() => {
                      if (window.confirm(`删除会话“${s.title ?? s.id}”？`)) void del(s.id);
                    }}
                    onRename={() => {
                      const title = window.prompt('新的会话标题', s.title ?? '');
                      if (title) void rename(s.id, title);
                    }}
                    onArchive={() => void archiveSession(s.id, false)}
                  />
                ))}
            </>
          ) : null}
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
              <div className="chat-tools">
                <button
                  className="icon-btn"
                  title="上一条消息（Alt+↑）"
                  disabled={messages.length === 0 || jumpIndex <= 0}
                  onClick={() => jumpBy(-1)}
                >
                  ↑
                </button>
                <button
                  className="icon-btn"
                  title="下一条消息（Alt+↓）"
                  disabled={messages.length === 0 || jumpIndex >= messages.length - 1}
                  onClick={() => jumpBy(1)}
                >
                  ↓
                </button>
                <span className="chat-jump-count">{messages.length ? `${jumpIndex + 1}/${messages.length}` : ''}</span>
                <button
                  className={`icon-btn ${chatSearchOpen ? 'active' : ''}`}
                  title="搜索会话内容（Ctrl+F）"
                  onClick={() => setChatSearchOpen((v) => !v)}
                >
                  ⌕
                </button>
                <button className="icon-btn" title="回到最新" onClick={() => jumpToId(messages[messages.length - 1]?.id ?? '')}>
                  ⇣
                </button>
              </div>
              {runtime?.error ? (
                <div className="chat-error" title={JSON.stringify(runtime.error)}>
                  上游错误
                </div>
              ) : null}
            </div>

            {chatSearchOpen ? (
              <div className="chat-searchbar">
                <input
                  className="input grow"
                  autoFocus
                  placeholder="在当前会话中搜索关键词…"
                  value={chatQuery}
                  onChange={(e) => setChatQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') setChatSearchOpen(false);
                    if (e.key === 'Enter' && searchMatches[0]) jumpToId(searchMatches[0].id);
                  }}
                />
                <span className="muted">{chatQuery.trim() ? `${searchMatches.length} 条` : ''}</span>
                <button className="icon-btn" title="关闭" onClick={() => setChatSearchOpen(false)}>
                  ×
                </button>
              </div>
            ) : null}
            {chatSearchOpen && chatQuery.trim() ? (
              <div className="chat-search-results">
                {searchMatches.length === 0 ? (
                  <div className="empty-hint">没有匹配的消息</div>
                ) : (
                  searchMatches.map((m) => (
                    <button key={m.id} className="chat-search-hit" onClick={() => jumpToId(m.id)}>
                      <span className="chat-search-type">{m.type === 'user' ? '你' : 'AI'}</span>
                      <span className="chat-search-text">{m.text}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}

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
                const inner =
                  (m as { type?: string }).type === 'user' ? (
                    <UserBlockMemo message={m} />
                  ) : (m as { type?: string }).type === 'assistant' ? (
                    <AssistantBlockMemo message={m} stream={state.streams[m.id]} />
                  ) : (
                    <div className="msg system">{String((m as { type?: string }).type ?? 'event')}</div>
                  );
                return (
                  <div
                    key={m.id}
                    ref={(el) => {
                      if (el) anchors.current.set(m.id, el);
                      else anchors.current.delete(m.id);
                    }}
                    className={`msg-anchor ${flashID === m.id ? 'msg-flash' : ''}`}
                  >
                    {inner}
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
