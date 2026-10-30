import React, { Suspense, useEffect, useMemo, useRef, useState } from 'react';
import type { FileDiff } from '@ocg/diff';
import { FileTree } from '../../components/FileTree.js';
import { ContextMenu, type MenuPosition } from '../../components/ContextMenu.js';
import { DiffView } from '../diff/DiffView.js';
import { useApp } from '../../store/appStore.js';
import { useEditor } from '../../store/editorStore.js';
import { api } from '../../api/client.js';
import { CodeEditor } from './CodeEditor.js';
import { LANGUAGE_DEFS, languageName, type SqlDialect } from './languages.js';

const MarkdownPreview = React.lazy(() =>
  import('./MarkdownPreview.js').then((m) => ({ default: m.MarkdownPreview })),
);

type MarkdownMode = 'source' | 'split' | 'preview';

interface FormatPreview {
  id: string;
  path: string;
  files: FileDiff[];
  before: string;
  after: string;
}

export function EditorPanel() {
  const workspaceID = useApp((s) => s.workspaceID);
  const openRequest = useApp((s) => s.openRequest);
  const consumeOpen = useApp((s) => s.consumeOpen);
  const notify = useApp((s) => s.notify);
  const requestSql = useApp((s) => s.requestSql);
  const resolvedTheme = useApp((s) => s.resolvedTheme);
  const tabs = useEditor((s) => s.tabs);
  const active = useEditor((s) => s.active);
  const diagnostics = useEditor((s) => s.diagnostics);
  const open = useEditor((s) => s.open);
  const setActive = useEditor((s) => s.setActive);
  const close = useEditor((s) => s.close);
  const update = useEditor((s) => s.update);
  const save = useEditor((s) => s.save);
  const reload = useEditor((s) => s.reload);
  const consumeLine = useEditor((s) => s.consumeLine);
  const closeAll = useEditor((s) => s.closeAll);
  const setLanguage = useEditor((s) => s.setLanguage);
  const setSqlDialect = useEditor((s) => s.setSqlDialect);
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null);
  const [mdMode, setMdMode] = useState<MarkdownMode>('source');
  const [scrollRatio, setScrollRatio] = useState(0);
  const [selection, setSelection] = useState<{ from: number; to: number; text: string } | null>(null);
  const [resolvedLanguage, setResolvedLanguage] = useState('纯文本');
  const [formatPreview, setFormatPreview] = useState<FormatPreview | null>(null);
  const [lastFormatUndo, setLastFormatUndo] = useState<{ id: string; path: string } | null>(null);
  const [formatError, setFormatError] = useState<string | null>(null);
  const [formatBusy, setFormatBusy] = useState(false);
  const [contextMenu, setContextMenu] = useState<MenuPosition | null>(null);
  const prevWorkspace = useRef<string | null>(workspaceID);
  const scrollFrame = useRef<number | null>(null);

  const tab = tabs.find((t) => t.path === active) ?? null;
  const activeDiagnostics = tab ? diagnostics[tab.path] ?? [] : [];
  const isMarkdown = tab ? /\.(md|markdown|mdx)$/i.test(tab.path) : false;
  const isSql = tab ? /\.sql$/i.test(tab.path) : false;

  useEffect(() => {
    if (!openRequest) return;
    void open(openRequest.path, openRequest.line);
    consumeOpen();
  }, [openRequest, open, consumeOpen]);

  useEffect(() => {
    // Only clear tabs when the workspace actually changes; closing on first mount
    // would immediately discard a file opened from search (the original jump bug).
    if (prevWorkspace.current !== workspaceID) {
      prevWorkspace.current = workspaceID;
      closeAll();
    }
  }, [workspaceID, closeAll]);

  useEffect(() => {
    if (!tab?.pendingLine) return;
    const line = consumeLine(tab.path);
    if (line) setJump({ line, nonce: Date.now() });
  }, [tab?.pendingLine, tab?.path, consumeLine]);

  useEffect(() => {
    setResolvedLanguage(languageName(tab?.path ?? '', tab?.language));
  }, [tab?.path, tab?.language]);

  useEffect(() => {
    setSelection(null);
    setScrollRatio(0);
  }, [tab?.path]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (tab) void save(tab.path);
      }
      if (e.altKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        void formatFull();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && tab && isSql) {
        e.preventDefault();
        requestSql(selection?.text?.trim() || tab.content);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        // Let the chat search use Ctrl+F; only intercept here when the editor has a selection.
        if (tab && selection) {
          e.preventDefault();
          void formatSelection();
        }
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, save, selection, requestSql, isSql]);

  useEffect(() => {
    const onFormat = () => void formatFull();
    window.addEventListener('ocg:editor-format', onFormat);
    return () => window.removeEventListener('ocg:editor-format', onFormat);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab?.path, isSql, formatBusy]);

  const onSourceScroll = (ratio: number) => {
    if (scrollFrame.current != null) return;
    scrollFrame.current = requestAnimationFrame(() => {
      scrollFrame.current = null;
      setScrollRatio(ratio);
    });
  };

  const ensureSaved = async (): Promise<boolean> => {
    if (!tab) return false;
    if (tab.content === tab.original) return true;
    await save(tab.path);
    const now = useEditor.getState().tabs.find((t) => t.path === tab.path);
    if (!now || now.conflict || now.content !== now.original) {
      notify('请先解决保存冲突或等待保存完成', 'error');
      return false;
    }
    return true;
  };

  const formatFull = async () => {
    if (!tab || !isSql || formatBusy) return;
    if (!(await ensureSaved())) return;
    setFormatBusy(true);
    setFormatError(null);
    try {
      const res = await api<{ id: string; changed: boolean; files: FileDiff[]; before: string; after: string }>(
        '/api/format/preview',
        {
          method: 'POST',
          body: JSON.stringify({ ws: workspaceID, path: tab.path, dialect: tab.sqlDialect, indent: 2, keywordCase: 'upper' }),
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!res.changed) {
        notify('SQL 已经是格式化状态');
        return;
      }
      setFormatPreview({ id: res.id, path: tab.path, files: res.files, before: res.before, after: res.after });
    } catch (err) {
      reportFormatError(err);
    } finally {
      setFormatBusy(false);
    }
  };

  const reportFormatError = (err: unknown) => {
    const e = err as { message?: string; body?: { line?: number; column?: number; hint?: string } };
    const pos = e.body?.line != null ? `（第 ${e.body.line} 行${e.body.column != null ? ` 第 ${e.body.column} 列` : ''}）` : '';
    const hint = e.body?.hint ? ` ${e.body.hint}` : ' 可尝试切换 SQL 方言后重试。';
    const message = `${e.message ?? 'SQL 格式化失败'}${pos}${hint}`;
    setFormatError(message);
    notify(message, 'error');
  };

  // CodeMirror normalizes CRLF to LF; map selection offsets back to the on-disk text.
  const toServerOffset = (offset: number): number => {
    if (!tab || tab.eol !== 'crlf') return offset;
    const text = tab.content.replace(/\r\n/g, '\n');
    let seen = 0;
    for (let i = 0; i < text.length && i < offset; i++) if (text[i] === '\n') seen++;
    return offset + seen;
  };

  const formatSelection = async () => {
    if (!tab || !isSql || !selection || formatBusy) return;
    if (!(await ensureSaved())) return;
    setFormatBusy(true);
    setFormatError(null);
    try {
      const res = await api<{ id: string; changed: boolean; files: FileDiff[]; before: string; after: string }>(
        '/api/format/preview',
        {
          method: 'POST',
          body: JSON.stringify({
            ws: workspaceID,
            path: tab.path,
            dialect: tab.sqlDialect,
            indent: 2,
            keywordCase: 'upper',
            selection: { from: toServerOffset(selection.from), to: toServerOffset(selection.to) },
          }),
          headers: { 'content-type': 'application/json' },
        },
      );
      if (!res.changed) {
        notify('选中的 SQL 已经是格式化状态');
        return;
      }
      setFormatPreview({ id: res.id, path: tab.path, files: res.files, before: res.before, after: res.after });
    } catch (err) {
      reportFormatError(err);
    } finally {
      setFormatBusy(false);
    }
  };

  const applyFormat = async () => {
    if (!formatPreview || !tab) return;
    setFormatBusy(true);
    try {
      const applied = await api<{ undoId: string; path: string }>('/api/format/apply', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, id: formatPreview.id }),
        headers: { 'content-type': 'application/json' },
      });
      setLastFormatUndo({ id: applied.undoId, path: applied.path });
      setFormatPreview(null);
      await reload(tab.path);
      setJump({ line: 1, nonce: Date.now() });
      notify('SQL 格式化已应用（已备份，可撤销）');
    } catch (err) {
      notify(err instanceof Error ? err.message : '应用格式化失败', 'error');
    } finally {
      setFormatBusy(false);
    }
  };

  const undoFormat = async () => {
    if (!lastFormatUndo || !tab) return;
    setFormatBusy(true);
    try {
      await api('/api/format/undo', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, id: lastFormatUndo.id }),
        headers: { 'content-type': 'application/json' },
      });
      setLastFormatUndo(null);
      await reload(lastFormatUndo.path);
      notify('已撤销 SQL 格式化');
    } catch (err) {
      notify(err instanceof Error ? err.message : '撤销格式化失败', 'error');
    } finally {
      setFormatBusy(false);
    }
  };

  const toggleTask = (index: number, checked: boolean) => {
    if (!tab) return;
    const lines = tab.content.split('\n');
    let seen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^(\s*[-*+]\s+\[)([ xX])(\])/);
      if (!m) continue;
      if (seen++ !== index) continue;
      lines[i] = `${m[1]}${checked ? 'x' : ' '}${m[3]}${lines[i].slice(m[0].length)}`;
      break;
    }
    update(tab.path, lines.join('\n'));
    window.setTimeout(() => void save(tab.path), 0);
  };

  const dirty = tab ? tab.content !== tab.original : false;
  const lines = useMemo(() => (tab ? tab.content.split('\n').length : 0), [tab?.content]);

  const tabMenu = (e: React.MouseEvent, path: string) => {
    e.preventDefault();
    e.stopPropagation();
    const target = tabs.find((t) => t.path === path);
    if (!target) return;
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      items: [
        { label: '关闭', onClick: () => close(path) },
        {
          label: '关闭其他标签',
          disabled: tabs.length <= 1,
          onClick: () => useEditor.setState({ tabs: [target], active: target.path }),
        },
        { label: '关闭全部', onClick: () => closeAll() },
        {
          label: '复制相对路径',
          onClick: () => {
            void navigator.clipboard?.writeText(path);
            notify('已复制路径');
          },
        },
        {
          label: '重新加载',
          onClick: () => void reload(path),
        },
        {
          label: dirty ? '放弃改动并关闭' : '关闭（无改动）',
          danger: dirty,
          disabled: !dirty,
          onClick: () => {
            update(path, target.original);
            close(path);
          },
        },
      ],
    });
  };

  return (
    <div className="editor-layout">
      <aside className="editor-side">
        <FileTree workspaceID={workspaceID} onOpen={(path) => void open(path)} />
      </aside>
      <section className="editor-main">
        <div className="tabs">
          {tabs.map((t) => (
            <div
              key={t.path}
              className={`tab ${t.path === active ? 'active' : ''}`}
              onClick={() => setActive(t.path)}
              onContextMenu={(e) => tabMenu(e, t.path)}
              title={t.path}
            >
              <span className="tab-name">
                {t.content !== t.original ? <span className="dirty-dot">●</span> : null}
                {t.name}
              </span>
              <button
                className="tab-close"
                onClick={(e) => {
                  e.stopPropagation();
                  close(t.path);
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>

        {tab ? (
          <>
            <div className="editor-toolbar">
              <span className="editor-path">{tab.path}</span>
              <div className="editor-tools">
                {tab.readonly ? <span className="chip chip-warn">只读</span> : null}
                <select
                  className="editor-language"
                  value={tab.language ?? 'auto'}
                  onChange={(e) => setLanguage(tab.path, e.target.value === 'auto' ? null : e.target.value)}
                  title="语法高亮语言"
                >
                  <option value="auto">语言: 自动</option>
                  {LANGUAGE_DEFS.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
                {isSql ? (
                  <>
                    <select
                      className="editor-language"
                      value={tab.sqlDialect}
                      onChange={(e) => setSqlDialect(tab.path, e.target.value as SqlDialect)}
                      title="SQL 方言"
                    >
                      <option value="sqlite">SQLite</option>
                      <option value="postgresql">PostgreSQL</option>
                      <option value="mysql">MySQL</option>
                      <option value="mariadb">MariaDB</option>
                      <option value="tsql">T-SQL</option>
                      <option value="plsql">PL/SQL</option>
                    </select>
                    <button className="btn btn-small" onClick={() => void formatFull()} disabled={formatBusy} title="Shift+Alt+F">
                      格式化
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => void formatSelection()}
                      disabled={!selection || formatBusy}
                      title="只格式化选中部分"
                    >
                      格式化选区
                    </button>
                    <button
                      className="btn btn-small"
                      onClick={() => requestSql(selection?.text?.trim() || tab.content)}
                      title="在数据面板执行选中 SQL 或整个文件（Ctrl+Enter）"
                    >
                      数据面板执行
                    </button>
                    {lastFormatUndo && lastFormatUndo.path === tab.path ? (
                      <button className="btn btn-small" onClick={() => void undoFormat()} disabled={formatBusy}>
                        撤销格式化
                      </button>
                    ) : null}
                  </>
                ) : null}
                {isMarkdown ? (
                  <div className="segmented editor-md-mode">
                    <button className={mdMode === 'source' ? 'active' : ''} onClick={() => setMdMode('source')}>
                      源码
                    </button>
                    <button className={mdMode === 'split' ? 'active' : ''} onClick={() => setMdMode('split')}>
                      分屏
                    </button>
                    <button className={mdMode === 'preview' ? 'active' : ''} onClick={() => setMdMode('preview')}>
                      预览
                    </button>
                  </div>
                ) : null}
                <span className="chip">{tab.encoding}</span>
                <span className="chip">{tab.eol.toUpperCase()}</span>
                <button className="btn btn-small" onClick={() => void reload(tab.path)}>
                  重新加载
                </button>
                <button
                  className="btn btn-small btn-primary"
                  disabled={tab.readonly || tab.binary || !dirty}
                  onClick={() => void save(tab.path)}
                >
                  保存
                </button>
              </div>
            </div>

            {tab.conflict ? (
              <div className="banner banner-warn">
                文件已在磁盘上被修改（hash {tab.conflict.currentHash.slice(0, 8)}）。选择重新加载会丢弃本地改动；保存会被拒绝以避免覆盖。
                <button className="btn btn-small" onClick={() => void reload(tab.path)}>
                  重新加载
                </button>
              </div>
            ) : null}
            {formatError ? (
              <div className="banner banner-error">
                <span>{formatError}</span>
                <button className="btn btn-small" onClick={() => setFormatError(null)}>
                  关闭
                </button>
              </div>
            ) : null}
            {tab.truncated ? (
              <div className="banner banner-warn">文件超过 2MB，仅加载前 2MB 且为只读，避免内存和渲染压力。</div>
            ) : null}
            {tab.error ? <div className="banner banner-error">{tab.error}</div> : null}

            <div className={`editor-area ${isMarkdown && mdMode !== 'source' ? 'editor-split' : ''}`}>
              {tab.loading ? (
                <div className="empty-hint">加载中…</div>
              ) : tab.binary ? (
                <div className="empty-state">
                  <h3>二进制文件</h3>
                  <p>该文件为二进制（{formatSize(tab.size)}），编辑器不会尝试解码。</p>
                </div>
              ) : (
                <>
                  <div className="editor-pane" style={{ display: isMarkdown && mdMode === 'preview' ? 'none' : 'flex' }}>
                    <CodeEditor
                      key={tab.path}
                      tab={tab}
                      diagnostics={activeDiagnostics}
                      onChange={(content) => update(tab.path, content)}
                      onSave={() => void save(tab.path)}
                      onCursor={(line, column) => setCursor({ line, column })}
                      onSelection={setSelection}
                      onLanguage={setResolvedLanguage}
                      onScrollRatio={onSourceScroll}
                      jumpLine={jump}
                      languageOverride={tab.language}
                      sqlDialect={tab.sqlDialect}
                      theme={resolvedTheme}
                    />
                  </div>
                  {isMarkdown && mdMode !== 'source' ? (
                    <div className="preview-pane">
                      <Suspense fallback={<div className="empty-hint">加载 Markdown 预览…</div>}>
                        <MarkdownPreview
                          content={tab.content}
                          path={tab.path}
                          workspaceID={workspaceID}
                          scrollRatio={scrollRatio}
                          onToggleTask={toggleTask}
                        />
                      </Suspense>
                    </div>
                  ) : null}
                </>
              )}
            </div>

            <div className="editor-status">
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
              <span>{resolvedLanguage}</span>
              <span>{lines} 行</span>
              <span>{formatSize(tab.size)}</span>
              <span className={activeDiagnostics.some((d) => d.severity === 'error') ? 'text-error' : ''}>
                {activeDiagnostics.length} 个诊断
              </span>
              <span className="spacer" />
              <span>{dirty ? '未保存' : '已保存'}</span>
            </div>

            {activeDiagnostics.length ? (
              <div className="diag-list">
                {activeDiagnostics.slice(0, 100).map((d, i) => (
                  <button
                    key={`${d.line}-${d.column}-${i}`}
                    className={`diag-item diag-${d.severity}`}
                    onClick={() => setJump({ line: d.line, nonce: Date.now() })}
                    title={d.message}
                  >
                    <span className="diag-loc">
                      {d.line}:{d.column}
                    </span>
                    <span className="diag-source">{d.source}</span>
                    <span className="diag-msg">{d.message}</span>
                  </button>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <div className="empty-state">
            <h2>编辑器</h2>
            <p>从左侧选择文件打开；支持多语言高亮、Markdown 预览、SQL 格式化、保存冲突检测与诊断。</p>
            <button className="btn" onClick={() => notify('从左侧文件树选择文件')}>
              提示
            </button>
          </div>
        )}
      </section>

      {formatPreview ? (
        <div className="format-overlay">
          <div className="format-dialog">
            <div className="format-head">
              <strong>SQL 格式化预览</strong>
              <span className="muted">{formatPreview.path}</span>
              <span className="spacer" />
              <button className="btn btn-small" onClick={() => setFormatPreview(null)}>
                取消
              </button>
              <button className="btn btn-small btn-primary" onClick={() => void applyFormat()} disabled={formatBusy}>
                应用
              </button>
            </div>
            <div className="format-body">
              <DiffView files={formatPreview.files} emptyText="没有差异" />
            </div>
          </div>
        </div>
      ) : null}
      <ContextMenu menu={contextMenu} onClose={() => setContextMenu(null)} />
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}
