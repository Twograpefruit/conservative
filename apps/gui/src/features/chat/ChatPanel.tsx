import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { AssistantStream, FileEntry, MessageInfo, PromptUploadFile, SessionInfo } from '@ocg/protocol';
import { selectVisibleMessages, useChat } from '../../store/chatStore.js';
import { useApp } from '../../store/appStore.js';
import { api, qs } from '../../api/client.js';
import { Markdown } from '../../components/Markdown.js';
import { ToolCard } from '../../components/ToolCard.js';
import { PermissionCard } from '../../components/PermissionCard.js';
import { ContextMenu, type MenuPosition } from '../../components/ContextMenu.js';
import { Icon } from '../../components/icon/Icon.js';
import { useNotify } from '../notify/notificationStore.js';
import { renderParts } from '../../lib/parts.js';

function timeAgo(ts?: number): string {
  if (!ts) return '';
  const diff = Date.now() - ts;
  if (diff < 60_000) return '刚刚';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分钟前`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)} 小时前`;
  return new Date(ts).toLocaleDateString();
}

function timeText(ts?: number): string {
  if (!ts) return '';
  const d = new Date(ts);
  const today = new Date();
  const sameDay = d.toDateString() === today.toDateString();
  return sameDay
    ? d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
    : d.toLocaleString([], { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export interface QuoteRef {
  id: string;
  role: string;
  text: string;
}

export interface ChatImage {
  name: string;
  url: string;
  uri: string;
  mime: string;
  size: number;
}

function attachmentPreview(uri?: string): string | null {
  if (!uri) return null;
  const name = uri.split('/').pop();
  if (!name) return null;
  if (!/\.(png|jpe?g|gif|webp|bmp|svg)$/i.test(name)) return null;
  return `/api/chat/attachment?name=${encodeURIComponent(name)}`;
}

function UserAttachments({ files }: { files?: Array<{ source?: { type?: string; uri?: string }; name?: string; mime?: string }> }) {
  if (!files?.length) return null;
  return (
    <div className="msg-attachments">
      {files.map((f, i) => {
        const src = attachmentPreview(f.source?.uri);
        return src ? (
          <a key={`${f.name ?? i}`} href={src} target="_blank" rel="noreferrer" className="msg-image">
            <img src={src} alt={f.name ?? 'image'} />
          </a>
        ) : (
          <span className="msg-attachment" key={`${f.name ?? i}`}>
            📎 {f.name ?? f.mime ?? '附件'}
          </span>
        );
      })}
    </div>
  );
}

function MessageMeta({
  message,
  role,
  onQuote,
  onBranch,
  textOverride,
}: {
  message: MessageInfo;
  role: string;
  onQuote: (quote: QuoteRef) => void;
  onBranch: (messageID: string) => void;
  textOverride?: string;
}) {
  const [copied, setCopied] = useState(false);
  const text = textOverride ?? copyText(message);
  return (
    <div className="msg-actions">
      <button
        className="icon-btn"
        title="复制消息内容"
        onClick={() => {
          void navigator.clipboard?.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 1200);
          });
        }}
      >
        {copied ? '已复制' : '复制'}
      </button>
      <button
        className="icon-btn"
        title="在输入框中引用此消息"
        onClick={() => onQuote({ id: message.id, role, text: text.slice(0, 1200) })}
      >
        引用
      </button>
      <button className="icon-btn" title="从此消息之前创建新会话分支" onClick={() => onBranch(message.id)}>
        分支
      </button>
    </div>
  );
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

function copyText(message: MessageInfo): string {
  const anyMsg = message as {
    type?: string;
    text?: string;
    content?: Array<{ type?: string; text?: string }>;
  };
  if (anyMsg.type === 'user') return anyMsg.text ?? '';
  return (anyMsg.content ?? [])
    .filter((part) => part.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text)
    .join('\n\n')
    .trim();
}

function snippet(text: string, query: string): string {
  const idx = text.toLowerCase().indexOf(query.toLowerCase());
  if (idx < 0) return text.slice(0, 120);
  const start = Math.max(0, idx - 40);
  return `${start > 0 ? '…' : ''}${text.slice(start, idx + query.length + 60).replace(/\s+/g, ' ')}${idx + query.length + 60 < text.length ? '…' : ''}`;
}

interface Turn {
  id: string;
  user: MessageInfo;
  replies: MessageInfo[];
  preview: string;
}

function buildTurns(messages: MessageInfo[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;
  for (const message of messages) {
    const type = (message as { type?: string }).type;
    if (type === 'user') {
      current = {
        id: message.id,
        user: message,
        replies: [],
        preview: ((message as { text?: string }).text ?? '').replace(/\s+/g, ' ').trim(),
      };
      turns.push(current);
    } else if (type === 'assistant' && current) {
      current.replies.push(message);
      const text = messageText(message).replace(/\s+/g, ' ').trim();
      if (text) current.preview = `${current.preview}\n${text}`;
    }
  }
  return turns;
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
  onContextMenu,
}: {
  session: SessionInfo;
  active: boolean;
  permissions: number;
  archived?: boolean;
  onClick: () => void;
  onDelete: () => void;
  onRename: () => void;
  onArchive: () => void;
  onContextMenu: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className={`session-item ${active ? 'active' : ''}`}
      onClick={onClick}
      onDoubleClick={onRename}
      onContextMenu={onContextMenu}
      title={session.title}
    >
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
  onQuote,
  onBranch,
}: {
  message?: MessageInfo;
  stream?: AssistantStream;
  onQuote: (quote: QuoteRef) => void;
  onBranch: (messageID: string) => void;
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
        {assistant?.time?.created ? <span className="msg-time">{timeText(assistant.time.created)}</span> : null}
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
      {message ? <MessageMeta message={message} role="assistant" onQuote={onQuote} onBranch={onBranch} /> : null}
    </div>
  );
}

function UserBlock({
  message,
  onQuote,
  onBranch,
}: {
  message: MessageInfo;
  onQuote: (quote: QuoteRef) => void;
  onBranch: (messageID: string) => void;
}) {
  const text = (message as { text?: string }).text ?? '';
  const files = (message as { files?: Array<{ source?: { type?: string; uri?: string }; name?: string; mime?: string }> }).files;
  const created = (message as { time?: { created?: number } }).time?.created;
  return (
    <div className="msg user">
      <div className="bubble">
        {text ? <Markdown text={text} /> : null}
        <UserAttachments files={files} />
        <div className="bubble-time">{timeText(created)}</div>
      </div>
      <MessageMeta message={message} role="user" onQuote={onQuote} onBranch={onBranch} />
    </div>
  );
}

const AssistantBlockMemo = React.memo(AssistantBlock);
const UserBlockMemo = React.memo(UserBlock);

function AssistantTurnBlock({
  messages,
  stream,
  onQuote,
  onBranch,
}: {
  messages: MessageInfo[];
  stream?: AssistantStream;
  onQuote: (quote: QuoteRef) => void;
  onBranch: (messageID: string) => void;
}) {
  const last = messages[messages.length - 1];
  const meta = last as { agent?: string; model?: { id?: string }; time?: { created?: number }; cost?: number } | undefined;
  const mergedText = messages
    .map((message) => copyText(message))
    .filter(Boolean)
    .join('\n\n');
  const rendered = messages.flatMap((message, index) =>
    renderParts(message, stream && last.id === message.id ? stream : undefined).map((part) => ({
      key: `${index}:${part.key}`,
      part,
    })),
  );
  const reasoning = rendered.filter((entry) => entry.part.kind === 'reasoning');
  const reasoningText = reasoning
    .map((entry) => entry.part.text ?? '')
    .filter(Boolean)
    .join('\n\n');
  const reasoningDone = reasoning.every((entry) => entry.part.done);
  const toolEntries = rendered.filter((entry) => entry.part.kind === 'tool' && entry.part.tool);
  const textEntries = rendered.filter((entry) => entry.part.kind === 'text');
  const toolsBusy = Boolean(stream);
  const toolsFailed = toolEntries.filter((entry) => entry.part.tool?.status === 'error').length;
  const [toolsOpen, setToolsOpen] = useState(false);
  const streamingRef = useRef(false);
  useEffect(() => {
    if (stream && !streamingRef.current) {
      streamingRef.current = true;
      setToolsOpen(true);
    }
  }, [stream]);
  return (
    <div className="msg assistant">
      <div className="msg-head">
        <span className="msg-role">assistant</span>
        {meta?.agent ? <span className="msg-chip">{meta.agent}</span> : null}
        {meta?.model?.id ? <span className="msg-chip">{meta.model.id}</span> : null}
        {meta?.time?.created ? <span className="msg-time">{timeText(meta.time.created)}</span> : null}
      </div>
      <div className="msg-body">
        {reasoningText ? (
          <details className="reasoning">
            <summary>
              思考过程 · {reasoning.length} 段{reasoningDone ? '' : '（进行中）'}
            </summary>
            <pre>{reasoningText}</pre>
          </details>
        ) : null}
        {toolEntries.length ? (
          <details
            className="tool-group"
            open={toolsOpen}
            onToggle={(event) => setToolsOpen(event.currentTarget.open)}
          >
            <summary>
              工作过程 · {toolEntries.length} 步
              {toolsFailed ? ` · ${toolsFailed} 失败` : ''}
              {toolsBusy ? '（进行中）' : ''}
            </summary>
            <div className="tool-group-body">
              {toolsOpen
                ? toolEntries.map(({ key, part }) =>
                    part.tool ? <ToolCard key={key} tool={part.tool} /> : null,
                  )
                : null}
            </div>
          </details>
        ) : null}
        {textEntries.map(({ key, part }) => {
          if (!part.text && part.done) return null;
          return <Markdown key={key} text={part.text ?? ''} />;
        })}
        {(last as { error?: { message?: string } })?.error?.message ? (
          <div className="msg-error">{(last as { error?: { message?: string } }).error?.message}</div>
        ) : null}
      </div>
      <MessageMeta
        message={last}
        role="assistant"
        textOverride={mergedText}
        onQuote={onQuote}
        onBranch={onBranch}
      />
    </div>
  );
}

const AssistantTurnBlockMemo = React.memo(AssistantTurnBlock);

function toFileUri(workspacePath: string | undefined, rel: string): string {
  if (!workspacePath) return rel;
  const abs = `${workspacePath.replace(/[\\/]+$/, '')}\\${rel.replace(/^[\\/]+/, '')}`.replace(/\\/g, '/');
  return `file:///${abs.replace(/^\/+/, '')}`;
}

function Composer({
  session,
  busy,
  quote,
  onClearQuote,
}: {
  session: SessionInfo | null;
  busy: boolean;
  quote: QuoteRef | null;
  onClearQuote: () => void;
}) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<ChatImage[]>([]);
  const [uploading, setUploading] = useState(false);
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
  const fileInput = useRef<HTMLInputElement>(null);
  const [mentionOpen, setMentionOpen] = useState(false);
  const [mentionStart, setMentionStart] = useState(0);
  const [mentionQuery, setMentionQuery] = useState('');
  const [mentionFiles, setMentionFiles] = useState<FileEntry[]>([]);
  const [mentionIndex, setMentionIndex] = useState(0);
  const [selectedFiles, setSelectedFiles] = useState<FileEntry[]>([]);
  const workspacePath = workspaces.find((w) => w.id === workspaceID)?.path;
  const draftKey = session ? `ocg.draft.${session.id}` : '';
  const draftLoaded = useRef(false);
  const skipNextDraftSave = useRef(false);

  useEffect(() => {
    draftLoaded.current = false;
    if (!draftKey) {
      setText('');
      setImages([]);
      setSelectedFiles([]);
      return;
    }
    try {
      const raw = localStorage.getItem(draftKey);
      if (raw) {
        const draft = JSON.parse(raw) as {
          text?: string;
          images?: ChatImage[];
          files?: FileEntry[];
        };
        setText(draft.text ?? '');
        setImages(Array.isArray(draft.images) ? draft.images : []);
        setSelectedFiles(Array.isArray(draft.files) ? draft.files : []);
        skipNextDraftSave.current = true;
      } else {
        setText('');
        setImages([]);
        setSelectedFiles([]);
        skipNextDraftSave.current = true;
      }
    } catch {
      /* ignore corrupt draft */
    }
    draftLoaded.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draftKey]);

  useEffect(() => {
    if (!draftKey || !draftLoaded.current) return;
    if (skipNextDraftSave.current) {
      skipNextDraftSave.current = false;
      return;
    }
    try {
      localStorage.setItem(draftKey, JSON.stringify({ text, images, files: selectedFiles, at: Date.now() }));
    } catch {
      /* storage full */
    }
  }, [draftKey, text, images, selectedFiles]);

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

  const uploadImages = async (files: File[]) => {
    const list = files.filter((f) => f.type.startsWith('image/'));
    if (!list.length) return;
    setUploading(true);
    try {
      const uploaded: ChatImage[] = [];
      for (const file of list.slice(0, 8)) {
        const data = await new Promise<string>((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(String(reader.result ?? ''));
          reader.onerror = () => reject(reader.error ?? new Error('读取图片失败'));
          reader.readAsDataURL(file);
        });
        const res = await api<ChatImage>('/api/chat/attachment', {
          method: 'POST',
          body: JSON.stringify({ data, mime: file.type || 'image/png', name: file.name }),
          headers: { 'content-type': 'application/json' },
        });
        uploaded.push(res);
      }
      setImages((prev) => [...prev, ...uploaded].slice(0, 12));
    } catch (err) {
      notify(err instanceof Error ? err.message : '图片上传失败', 'error');
    } finally {
      setUploading(false);
    }
  };

  const submit = async () => {
    const value = text;
    if ((!value.trim() && !images.length && !quote) || !session) return;
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
    for (const image of images) {
      files.push({ uri: image.uri, name: image.name, description: `image:${image.mime}` });
    }
    const quoted = quote
      ? `> 引用 ${quote.role}：${quote.text.replace(/\n/g, '\n> ')}\n\n`
      : '';
    setText('');
    setSelectedFiles([]);
    setImages([]);
    setMentionOpen(false);
    onClearQuote();
    await sendPrompt(`${quoted}${value}`, files);
    if (draftKey) localStorage.removeItem(draftKey);
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
        {quote ? (
          <div className="quote-chip" title={quote.text}>
            <span className="quote-label">引用 {quote.role}</span>
            <span className="quote-text">{quote.text.replace(/\s+/g, ' ').slice(0, 140)}</span>
            <button type="button" onClick={onClearQuote} aria-label="取消引用">
              ×
            </button>
          </div>
        ) : null}
        {images.length ? (
          <div className="image-chips">
            {images.map((img) => (
              <span className="image-chip" key={img.url}>
                <img src={img.url} alt={img.name} />
                <button type="button" onClick={() => setImages((prev) => prev.filter((x) => x.url !== img.url))}>
                  ×
                </button>
              </span>
            ))}
          </div>
        ) : null}
        <textarea
          ref={ta}
          value={text}
          placeholder={session ? '输入消息；@ 引用文件，可粘贴/选择图片；Enter 发送' : '请先创建或选择一个会话'}
          rows={3}
          onChange={(e) => {
            const value = e.target.value;
            setText(value);
            detectMention(value, e.target.selectionStart ?? value.length);
          }}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.items ?? [])
              .filter((item) => item.kind === 'file' && item.type.startsWith('image/'))
              .map((item) => item.getAsFile())
              .filter((f): f is File => Boolean(f));
            if (files.length) {
              e.preventDefault();
              void uploadImages(files);
            }
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
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              multiple
              hidden
              onChange={(e) => {
                void uploadImages(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />
            <button
              className="btn btn-small btn-icon"
              type="button"
              onClick={() => fileInput.current?.click()}
              disabled={!session || uploading}
              title="选择图片或直接粘贴剪切板图片"
            >
              {uploading ? '…' : <Icon name="image" />}
            </button>
          </div>
          {busy ? (
            <button className="btn btn-danger" onClick={() => void interrupt()}>
              停止
            </button>
          ) : (
            <button
              className="btn btn-primary"
              onClick={() => void submit()}
              disabled={!session || (!text.trim() && !images.length && !quote)}
            >
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
  const fork = useChat((s) => s.forkSession);
  const del = useChat((s) => s.deleteSession);
  const rename = useChat((s) => s.renameSession);
  const reply = useChat((s) => s.replyPermission);
  const archivedSessions = useChat((s) => s.archivedSessions);
  const showArchived = useChat((s) => s.showArchived);
  const setShowArchived = useChat((s) => s.setShowArchived);
  const archiveSession = useChat((s) => s.archiveSession);
  const [filter, setFilter] = useState('');
  const [chatQuery, setChatQuery] = useState(() => sessionStorage.getItem('ocg.chatQuery') ?? '');
  const [chatSearchOpen, setChatSearchOpen] = useState(() => sessionStorage.getItem('ocg.chatSearchOpen') === '1');
  const [jumpIndex, setJumpIndex] = useState(0);
  const [flashID, setFlashID] = useState<string | null>(null);
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const [quote, setQuote] = useState<QuoteRef | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<SessionInfo | null>(null);
  const [archiveName, setArchiveName] = useState('');
  const [chatHistory, setChatHistory] = useState<string[]>(() => {
    try {
      const raw = JSON.parse(localStorage.getItem('ocg.chatSearchHistory') ?? '[]') as string[];
      return Array.isArray(raw) ? raw.slice(0, 20) : [];
    } catch {
      return [];
    }
  });
  const [followBottom, setFollowBottom] = useState(true);
  const [turnCardOpen, setTurnCardOpen] = useState(false);
  const [hoverTurn, setHoverTurn] = useState<number | null>(null);
  const archiveGroups = useApp((s) => s.archiveGroups);
  const setArchiveGroup = useApp((s) => s.setArchiveGroup);
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
  const turns = useMemo(() => buildTurns(messages), [messages]);
  const [activeTurn, setActiveTurn] = useState(0);
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

  useEffect(() => {
    setQuote(null);
  }, [activeID]);

  useEffect(() => {
    sessionStorage.setItem('ocg.chatQuery', chatQuery);
  }, [chatQuery]);

  useEffect(() => {
    sessionStorage.setItem('ocg.chatSearchOpen', chatSearchOpen ? '1' : '0');
  }, [chatSearchOpen]);

  useEffect(() => {
    setFollowBottom(true);
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [activeID]);

  useEffect(() => {
    if (!followBottom) return;
    const el = scrollRef.current;
    if (!el) return;
    const started = performance.now();
    let raf = 0;
    const toEnd = () => {
      el.scrollTop = el.scrollHeight;
      bottomRef.current?.scrollIntoView({ block: 'end' });
      if (performance.now() - started < 500) raf = requestAnimationFrame(toEnd);
    };
    toEnd();
    return () => cancelAnimationFrame(raf);
  }, [activeID, followBottom, messages.length, liveStreams.length, state.streams]);

  useEffect(() => {
    const onSearch = () => setChatSearchOpen(true);
    window.addEventListener('ocg:chat-search', onSearch);
    return () => window.removeEventListener('ocg:chat-search', onSearch);
  }, []);

  const jumpToId = (id: string) => {
    let target = id;
    if (!anchors.current.has(target)) {
      const turn = turns.find((t) => t.replies.some((reply) => reply.id === id));
      if (turn) target = turn.id;
    }
    const el = anchors.current.get(target);
    if (!el) return;
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    setFlashID(target);
    if (flashTimer.current) clearTimeout(flashTimer.current);
    flashTimer.current = setTimeout(() => setFlashID(null), 1400);
  };

  const rememberChatSearch = (value: string) => {
    const q = value.trim();
    if (!q) return;
    const next = [q, ...chatHistory.filter((x) => x !== q)].slice(0, 20);
    setChatHistory(next);
    localStorage.setItem('ocg.chatSearchHistory', JSON.stringify(next));
  };

  const jumpToTurn = (index: number) => {
    const turn = turns[index];
    if (!turn) return;
    setJumpIndex(index);
    setActiveTurn(index);
    jumpToId(turn.id);
  };

  const jumpBy = (delta: number) => {
    if (turns.length === 0) return;
    const next = Math.min(turns.length - 1, Math.max(0, jumpIndex + delta));
    jumpToTurn(next);
  };

  useEffect(() => {
    if (turns.length === 0) {
      setJumpIndex(0);
      setActiveTurn(0);
      return;
    }
    setJumpIndex((i) => Math.min(i, turns.length - 1));
    setActiveTurn((i) => Math.min(i, turns.length - 1));
  }, [turns.length]);

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
    if (!el || !followBottom) return;
    el.scrollTop = el.scrollHeight;
  }, [followBottom, messages.length, liveStreams.length, state.streams]);

  const onMessagesScroll = (e: React.UIEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    const near = el.scrollHeight - el.scrollTop - el.clientHeight < 72;
    if (near !== followBottom) setFollowBottom(near);
    const top = el.getBoundingClientRect().top + 90;
    let next = 0;
    turns.forEach((turn, index) => {
      const anchor = anchors.current.get(turn.id);
      if (anchor && anchor.getBoundingClientRect().top <= top) next = index;
    });
    if (next !== activeTurn) {
      setActiveTurn(next);
      setJumpIndex(next);
    }
  };

  const statusText =
    runtime?.status === 'retry'
      ? '重试中'
      : runtime?.status === 'busy'
        ? '生成中'
        : runtime?.status === 'error'
          ? '错误'
          : '空闲';

  const openArchive = (s: SessionInfo) => {
    setArchiveName(archiveGroups[s.id] ?? '默认归档');
    setArchiveTarget(s);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const group = archiveName.trim() || '默认归档';
    await archiveSession(archiveTarget.id, true);
    setArchiveGroup(archiveTarget.id, group);
    setArchiveTarget(null);
  };

  const groupNames = Array.from(
    new Set([...Object.values(archiveGroups), ...archivedSessions.map((s) => archiveGroups[s.id] ?? '未分组')]),
  ).filter(Boolean);

  const archivedFiltered = archivedSessions
    .filter((s) => !filter || (s.title ?? '').toLowerCase().includes(filter.toLowerCase()))
    .sort((a, b) => (archiveGroups[a.id] ?? '未分组').localeCompare(archiveGroups[b.id] ?? '未分组'));

  const sessionMenu = (e: React.MouseEvent, s: SessionInfo, archived = false) => {
    e.preventDefault();
    e.stopPropagation();
    const muted = useNotify.getState().settings.muteSessions.includes(s.id);
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: archived ? '取消归档' : '归档会话', onClick: () => archived ? void archiveSession(s.id, false) : openArchive(s) },
        {
          label: '重命名…',
          onClick: () => {
            const title = window.prompt('新的会话标题', s.title ?? '');
            if (title) void rename(s.id, title);
          },
        },
        {
          label: muted ? '取消静音通知' : '静音该会话通知',
          onClick: () => {
            const settings = useNotify.getState().settings;
            useNotify.getState().setSettings({
              muteSessions: muted
                ? settings.muteSessions.filter((id) => id !== s.id)
                : [...settings.muteSessions, s.id],
            });
          },
        },
        {
          label: '删除会话',
          danger: true,
          onClick: () => {
            if (window.confirm(`删除会话“${s.title ?? s.id}”？`)) void del(s.id);
          },
        },
      ],
    });
  };

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
              <Icon name="archive" />
            </button>
            <button className="icon-btn" title="新建会话" aria-label="新建会话" onClick={() => void create()}>
              <Icon name="add" />
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
              onArchive={() => openArchive(s)}
              onContextMenu={(e) => sessionMenu(e, s)}
            />
          ))}
          {showArchived ? (
            <>
              <div className="session-section-title">已归档</div>
              {archivedFiltered.length === 0 ? <div className="empty-hint">暂无归档会话</div> : null}
              {archivedFiltered.map((s, index) => {
                const group = archiveGroups[s.id] ?? '未分组';
                const prev = index > 0 ? archiveGroups[archivedFiltered[index - 1].id] ?? '未分组' : null;
                return (
                  <React.Fragment key={s.id}>
                    {group !== prev ? <div className="archive-group-title">📁 {group}</div> : null}
                    <SessionItem
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
                      onContextMenu={(e) => sessionMenu(e, s, true)}
                    />
                  </React.Fragment>
                );
              })}
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
              {runtime?.error ? (
                <div className="chat-error" title={JSON.stringify(runtime.error)}>
                  上游错误
                </div>
              ) : null}
            </div>

            <div className={`chat-search-float ${chatSearchOpen ? 'open' : ''}`}>
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
                    if (e.key === 'Enter') {
                      rememberChatSearch(chatQuery);
                      if (searchMatches[0]) jumpToId(searchMatches[0].id);
                    }
                  }}
                />
                <span className="muted">{chatQuery.trim() ? `${searchMatches.length} 条` : ''}</span>
                <button className="icon-btn" title="关闭" onClick={() => setChatSearchOpen(false)}>
                  ×
                </button>
              </div>
            ) : null}
            {chatSearchOpen && chatHistory.length ? (
              <div className="chat-search-history">
                <span className="muted small">历史</span>
                {chatHistory.slice(0, 10).map((h) => (
                  <button
                    key={h}
                    className="history-chip"
                    title={h}
                    onClick={() => {
                      setChatQuery(h);
                      rememberChatSearch(h);
                    }}
                  >
                    {h}
                  </button>
                ))}
                <button
                  className="icon-btn"
                  title="清空会话搜索历史"
                  onClick={() => {
                    setChatHistory([]);
                    localStorage.removeItem('ocg.chatSearchHistory');
                  }}
                >
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
                    <button
                      key={m.id}
                      className="chat-search-hit"
                      onClick={() => {
                        rememberChatSearch(chatQuery);
                        jumpToId(m.id);
                      }}
                    >
                      <span className="chat-search-type">{m.type === 'user' ? '你' : 'AI'}</span>
                      <span className="chat-search-text">{m.text}</span>
                    </button>
                  ))
                )}
              </div>
            ) : null}
            </div>

            <div className="messages" ref={scrollRef} onScroll={onMessagesScroll}>
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
              {turns.map((turn) => {
                const onQuote = (q: QuoteRef) => setQuote(q);
                const onBranch = (messageID: string) => {
                  if (!activeID) return;
                  void fork(activeID, messageID);
                };
                const lastReply = turn.replies[turn.replies.length - 1];
                return (
                  <React.Fragment key={turn.id}>
                    <div
                      ref={(el) => {
                        if (el) anchors.current.set(turn.id, el);
                        else anchors.current.delete(turn.id);
                      }}
                      className={`msg-anchor ${flashID === turn.id ? 'msg-flash' : ''}`}
                    >
                      <UserBlockMemo message={turn.user} onQuote={onQuote} onBranch={onBranch} />
                    </div>
                    {turn.replies.length ? (
                      <div className="msg-anchor">
                        <AssistantTurnBlockMemo
                          messages={turn.replies}
                          stream={lastReply ? state.streams[lastReply.id] : undefined}
                          onQuote={onQuote}
                          onBranch={onBranch}
                        />
                      </div>
                    ) : null}
                  </React.Fragment>
                );
              })}
              {liveStreams.map((s) => (
                <AssistantBlockMemo
                  key={s.messageID}
                  stream={s}
                  onQuote={(q) => setQuote(q)}
                  onBranch={(messageID) => activeID && void fork(activeID, messageID)}
                />
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
            <div className="chat-jump-latest">
              <button
                className={`btn btn-small ${followBottom ? '' : 'btn-primary'}`}
                onClick={() => {
                  setFollowBottom(true);
                  if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
                }}
              >
                <Icon name="arrow-down" /> 
              </button>
            </div>
            <Composer session={active} busy={busy} quote={quote} onClearQuote={() => setQuote(null)} />
            {quote ? (
              <div className="composer-quote-hint">
                正在引用 {quote.role} 消息；发送时会作为引用块附在消息前。
                <button className="icon-btn" onClick={() => setQuote(null)}>
                  ×
                </button>
              </div>
            ) : null}
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
      {active ? (
        <aside
          className="chat-turn-rail"
          aria-label="对话轮次导航"
          onMouseEnter={() => setTurnCardOpen(true)}
          onMouseLeave={() => {
            setTurnCardOpen(false);
            setHoverTurn(null);
          }}
        >
          <div className="turn-bar-list">
            {turns.map((turn, index) => (
              <button
                key={turn.id}
                className={`turn-bar ${activeTurn === index ? 'active' : ''}`}
                onClick={() => jumpToTurn(index)}
                aria-label={`第 ${index + 1} 轮对话`}
              />
            ))}
          </div>
          {turnCardOpen && turns.length ? (
            <>
              <div className="turn-card">
                <div className="turn-card-head">
                  <span className="turn-counter">
                    {jumpIndex + 1}/{turns.length}
                  </span>
                  <span className="spacer" />
                  <button
                    className={`icon-btn ${chatSearchOpen ? 'active' : ''}`}
                    title="搜索会话"
                    onClick={() => {
                      setChatSearchOpen((v) => !v);
                      setTurnCardOpen(false);
                    }}
                  >
                    <Icon name="search" />
                  </button>
                </div>
                <div className="turn-card-list">
                  {turns.map((turn, index) => (
                    <button
                      key={turn.id}
                      className={`turn-card-item ${activeTurn === index ? 'active' : ''}`}
                      onClick={() => jumpToTurn(index)}
                      onMouseEnter={() => setHoverTurn(index)}
                      onMouseLeave={() => setHoverTurn(null)}
                    >
                      <span className="turn-card-text">{turn.preview.split('\n')[0] || '（空消息）'}</span>
                      <span className="turn-card-index">{index + 1}</span>
                    </button>
                  ))}
                </div>
              </div>
              {hoverTurn !== null && turns[hoverTurn] ? (
                <div className="turn-full-tip">
                  <strong>第 {hoverTurn + 1} 轮 · 完整内容</strong>
                  <div>{turns[hoverTurn].preview || '（空消息）'}</div>
                </div>
              ) : null}
            </>
          ) : null}
        </aside>
      ) : null}
      {archiveTarget ? (
        <div className="format-overlay" onMouseDown={() => setArchiveTarget(null)}>
          <div className="archive-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="format-head">
              <strong>归档会话</strong>
              <span className="muted">{archiveTarget.title || archiveTarget.id}</span>
              <span className="spacer" />
              <button className="btn btn-small" onClick={() => setArchiveTarget(null)}>
                取消
              </button>
              <button className="btn btn-small btn-primary" onClick={() => void confirmArchive()}>
                归档
              </button>
            </div>
            <div className="archive-body">
              <label className="muted small">选择已有归档名称，或直接输入新名称</label>
              <input
                className="input"
                autoFocus
                value={archiveName}
                onChange={(e) => setArchiveName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void confirmArchive();
                }}
                placeholder="例如：2026-Q4、旧需求、待复盘"
              />
              <div className="archive-group-picks">
                {groupNames.map((g) => (
                  <button
                    key={g}
                    type="button"
                    className={`btn btn-small ${archiveName === g ? 'btn-primary' : ''}`}
                    onClick={() => setArchiveName(g)}
                  >
                    📁 {g}
                  </button>
                ))}
                {groupNames.length === 0 ? <span className="muted small">还没有归档分组</span> : null}
              </div>
            </div>
          </div>
        </div>
      ) : null}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}
