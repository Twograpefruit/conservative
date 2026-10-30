import React, { useEffect, useMemo, useRef, useState } from 'react';
import { FileTree } from '../../components/FileTree.js';
import { useApp } from '../../store/appStore.js';
import { useEditor } from '../../store/editorStore.js';
import { CodeEditor } from './CodeEditor.js';

export function EditorPanel() {
  const workspaceID = useApp((s) => s.workspaceID);
  const openRequest = useApp((s) => s.openRequest);
  const consumeOpen = useApp((s) => s.consumeOpen);
  const notify = useApp((s) => s.notify);
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
  const [cursor, setCursor] = useState({ line: 1, column: 1 });
  const [jump, setJump] = useState<{ line: number; nonce: number } | null>(null);
  const prevWorkspace = useRef<string | null>(workspaceID);

  const tab = tabs.find((t) => t.path === active) ?? null;
  const activeDiagnostics = tab ? diagnostics[tab.path] ?? [] : [];

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
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
        e.preventDefault();
        if (tab) void save(tab.path);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [tab, save]);

  const dirty = tab ? tab.content !== tab.original : false;
  const lines = useMemo(() => (tab ? tab.content.split('\n').length : 0), [tab?.content]);

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
            {tab.truncated ? (
              <div className="banner banner-warn">文件超过 2MB，仅加载前 2MB 且为只读，避免内存和渲染压力。</div>
            ) : null}
            {tab.error ? <div className="banner banner-error">{tab.error}</div> : null}

            <div className="editor-area">
              {tab.loading ? (
                <div className="empty-hint">加载中…</div>
              ) : tab.binary ? (
                <div className="empty-state">
                  <h3>二进制文件</h3>
                  <p>该文件为二进制（{formatSize(tab.size)}），编辑器不会尝试解码。</p>
                </div>
              ) : (
                <CodeEditor
                  key={tab.path}
                  tab={tab}
                  diagnostics={activeDiagnostics}
                  onChange={(content) => update(tab.path, content)}
                  onSave={() => void save(tab.path)}
                  onCursor={(line, column) => setCursor({ line, column })}
                  jumpLine={jump}
                />
              )}
            </div>

            <div className="editor-status">
              <span>
                Ln {cursor.line}, Col {cursor.column}
              </span>
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
            <p>从左侧选择文件打开；支持保存冲突检测、EOL/编码保真与保存后诊断。</p>
            <button className="btn" onClick={() => notify('从左侧文件树选择文件')}>
              提示
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function formatSize(size: number): string {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(2)} MB`;
}
