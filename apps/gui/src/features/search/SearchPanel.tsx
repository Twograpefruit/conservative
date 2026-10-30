import React, { useRef, useState } from 'react';
import type {
  ReplaceApplyResult,
  ReplacePreview,
  SearchFileResult,
  SearchOptions,
  SearchStreamMessage,
} from '@ocg/protocol';
import { api, streamNdjson } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';

export function SearchPanel() {
  const workspaceID = useApp((s) => s.workspaceID);
  const requestOpen = useApp((s) => s.requestOpen);
  const notify = useApp((s) => s.notify);
  const [mode, setMode] = useState<'search' | 'replace'>('search');
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [regex, setRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [wholeWord, setWholeWord] = useState(false);
  const [glob, setGlob] = useState('');
  const [results, setResults] = useState<Record<string, SearchFileResult>>({});
  const [order, setOrder] = useState<string[]>([]);
  const [stats, setStats] = useState({ files: 0, matches: 0, truncated: false, cursor: '' });
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReplacePreview | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [applied, setApplied] = useState<ReplaceApplyResult | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const options = (): SearchOptions => ({
    ws: workspaceID ?? '',
    query,
    regex,
    caseSensitive,
    wholeWord,
    glob: glob || undefined,
    maxResults: 2000,
  });

  const run = async (append = false) => {
    if (!workspaceID || !query.trim()) return;
    abortRef.current?.abort();
    const ac = new AbortController();
    abortRef.current = ac;
    if (!append) {
      setResults({});
      setOrder([]);
      setStats({ files: 0, matches: 0, truncated: false, cursor: '' });
    }
    setRunning(true);
    setError(null);
    try {
      await streamNdjson<SearchStreamMessage>(
        '/api/search',
        { ...options(), cursor: append ? stats.cursor : undefined },
        (msg) => {
          if (msg.type === 'file') {
            setResults((prev) => ({ ...prev, [msg.file.path]: msg.file }));
            setOrder((prev) => (prev.includes(msg.file.path) ? prev : [...prev, msg.file.path]));
          } else if (msg.type === 'done') {
            setStats((prev) => ({
              files: append ? prev.files + msg.files : msg.files,
              matches: append ? prev.matches + msg.matches : msg.matches,
              truncated: msg.truncated,
              cursor: msg.cursor ?? '',
            }));
          } else if (msg.type === 'error') {
            setError(msg.message);
          }
        },
        ac.signal,
      );
    } catch (err) {
      if (!ac.signal.aborted) setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const stop = () => {
    abortRef.current?.abort();
    setRunning(false);
  };

  const doPreview = async () => {
    if (!workspaceID || !query.trim()) return;
    setRunning(true);
    setError(null);
    setApplied(null);
    try {
      const p = await api<ReplacePreview>('/api/replace/preview', {
        method: 'POST',
        body: JSON.stringify({ ...options(), replacement }),
        headers: { 'content-type': 'application/json' },
      });
      setPreview(p);
      setSelected(new Set(p.files.map((f) => f.path)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setRunning(false);
    }
  };

  const toggleFile = (path: string, checked: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (checked) next.add(path);
      else next.delete(path);
      return next;
    });
  };

  const selectedFiles = preview ? preview.files.filter((f) => selected.has(f.path)) : [];
  const selectedMatches = selectedFiles.reduce((n, f) => n + f.matches, 0);
  const allSelected = Boolean(preview && preview.files.length > 0 && selectedFiles.length === preview.files.length);

  const doApply = async () => {
    if (!preview) return;
    if (selectedFiles.length === 0) {
      notify('请至少勾选一个文件', 'error');
      return;
    }
    if (
      !window.confirm(
        `将修改所选 ${selectedFiles.length} 个文件中的 ${selectedMatches} 处命中，并先创建快照。未勾选的文件保持原样。继续？`,
      )
    )
      return;
    setRunning(true);
    try {
      const res = await api<ReplaceApplyResult>('/api/replace/apply', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, id: preview.id, paths: selectedFiles.map((f) => f.path) }),
        headers: { 'content-type': 'application/json' },
      });
      setApplied(res);
      setPreview(null);
      setSelected(new Set());
      notify(`已替换 ${res.appliedFiles} 个文件 / ${res.appliedMatches} 处，备份在 ${res.backupDir}`);
      await run(false);
    } catch (err) {
      const e = err as { body?: { conflicts?: Array<{ path: string; reason: string }> }; message?: string };
      setError(
        e.body?.conflicts?.length
          ? `以下文件在预览后发生变化，已中止：${e.body.conflicts.map((c) => c.path).join(', ')}`
          : e.message ?? '替换失败',
      );
    } finally {
      setRunning(false);
    }
  };

  const undo = async () => {
    if (!applied) return;
    try {
      const res = await api<{ restored: number; skipped: Array<{ path: string; reason: string }> }>('/api/replace/undo', {
        method: 'POST',
        body: JSON.stringify({ id: applied.undoId }),
        headers: { 'content-type': 'application/json' },
      });
      notify(`已恢复 ${res.restored} 个文件${res.skipped.length ? `，跳过 ${res.skipped.length} 个` : ''}`);
      setApplied(null);
      await run(false);
    } catch (err) {
      notify(err instanceof Error ? err.message : '撤销失败', 'error');
    }
  };

  return (
    <div className="search-layout">
      <div className="search-head">
        <div className="segmented">
          <button className={mode === 'search' ? 'active' : ''} onClick={() => setMode('search')}>
            搜索
          </button>
          <button className={mode === 'replace' ? 'active' : ''} onClick={() => setMode('replace')}>
            批量替换
          </button>
        </div>
        <div className="search-form">
          <input
            className="input grow"
            placeholder="搜索内容（支持正则）"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void run(false);
            }}
          />
          {mode === 'replace' ? (
            <input
              className="input grow"
              placeholder="替换为（支持 $1 捕获组）"
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
            />
          ) : null}
          <input className="input glob" placeholder="glob，例如 *.py" value={glob} onChange={(e) => setGlob(e.target.value)} />
        </div>
        <div className="search-toggles">
          <label>
            <input type="checkbox" checked={regex} onChange={(e) => setRegex(e.target.checked)} /> 正则
          </label>
          <label>
            <input type="checkbox" checked={caseSensitive} onChange={(e) => setCaseSensitive(e.target.checked)} /> 区分大小写
          </label>
          <label>
            <input type="checkbox" checked={wholeWord} onChange={(e) => setWholeWord(e.target.checked)} /> 全词
          </label>
          <span className="spacer" />
          {running ? (
            <button className="btn btn-danger" onClick={stop}>
              取消
            </button>
          ) : mode === 'search' ? (
            <button className="btn btn-primary" onClick={() => void run(false)} disabled={!query.trim()}>
              搜索
            </button>
          ) : (
            <>
              <button className="btn" onClick={() => void doPreview()} disabled={!query.trim()}>
                预览替换
              </button>
              <button
                className="btn btn-primary"
                onClick={() => void doApply()}
                disabled={!preview || selectedFiles.length === 0}
                title={preview ? `已选 ${selectedFiles.length}/${preview.files.length} 个文件` : ''}
              >
                应用所选{selectedFiles.length ? `（${selectedFiles.length} 文件 / ${selectedMatches} 处）` : ''}
              </button>
            </>
          )}
        </div>
        {error ? <div className="banner banner-error">{error}</div> : null}
        {applied ? (
          <div className="banner banner-info">
            已替换 {applied.appliedFiles} 个文件 / {applied.appliedMatches} 处，撤销 ID {applied.undoId.slice(0, 8)}
            <button className="btn btn-small" onClick={() => void undo()}>
              撤销
            </button>
            {applied.skipped.length ? <span>跳过 {applied.skipped.length} 个文件</span> : null}
          </div>
        ) : null}
      </div>

      <div className="search-body">
        {preview ? (
          <div className="preview">
            <div className="preview-head">
              <label className="preview-select-all">
                <input
                  type="checkbox"
                  checked={allSelected}
                  onChange={(e) => setSelected(e.target.checked ? new Set(preview.files.map((f) => f.path)) : new Set())}
                />
                全选
              </label>
              <strong>{selectedFiles.length}</strong> / {preview.files.length} 个文件 ·{' '}
              <strong>{selectedMatches}</strong> / {preview.totalMatches} 处命中
              {preview.skippedFiles ? <span className="muted"> · 跳过 {preview.skippedFiles} 个</span> : null}
              {preview.truncated ? <span className="muted"> · 结果已截断</span> : null}
              <span className="spacer" />
              <button className="btn btn-small" onClick={() => setSelected(new Set())} disabled={!selectedFiles.length}>
                全不选
              </button>
              <button
                className="btn btn-small"
                onClick={() => {
                  setPreview(null);
                  setSelected(new Set());
                }}
              >
                关闭
              </button>
            </div>
            {preview.files.slice(0, 200).map((f) => (
              <div className={`preview-file ${selected.has(f.path) ? '' : 'preview-unselected'}`} key={f.path}>
                <div className="preview-path">
                  <label className="preview-check">
                    <input
                      type="checkbox"
                      checked={selected.has(f.path)}
                      onChange={(e) => toggleFile(f.path, e.target.checked)}
                    />
                  </label>
                  <button className="link" onClick={() => requestOpen(f.path, f.sample[0]?.line)}>
                    {f.path}
                  </button>
                  <span className="muted">{f.matches} 处</span>
                </div>
                {f.sample.map((s) => (
                  <div className="preview-sample" key={`${f.path}-${s.line}`}>
                    <span className="ln">{s.line}</span>
                    <div>
                      <div className="preview-before">- {s.before}</div>
                      <div className="preview-after">+ {s.after}</div>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <>
            <div className="search-stats">
              {stats.files} 个文件 · {stats.matches} 处命中{stats.truncated ? ' · 已达上限' : ''}
              <span className="spacer" />
              {stats.truncated ? (
                <button className="btn btn-small" onClick={() => void run(true)} disabled={!stats.cursor}>
                  加载更多
                </button>
              ) : null}
            </div>
            <div className="search-results">
              {order.slice(0, 400).map((file) => {
                const result = results[file];
                if (!result) return null;
                return (
                  <div className="search-file" key={file}>
                    <button className="search-file-head" onClick={() => requestOpen(file, result.matches[0]?.line)}>
                      <span className="search-file-path">{file}</span>
                      <span className="badge">{result.matches.length}</span>
                    </button>
                    {result.matches.slice(0, 50).map((m, i) => (
                      <button className="search-hit" key={i} onClick={() => requestOpen(file, m.line)} title={m.text}>
                        <span className="ln">{m.line}</span>
                        <code>{highlight(m.text, m.column, m.endColumn)}</code>
                      </button>
                    ))}
                    {result.matches.length > 50 ? <div className="muted pad-l">+{result.matches.length - 50} 处未显示</div> : null}
                  </div>
                );
              })}
              {!running && order.length === 0 ? <div className="empty-hint">输入关键词开始搜索（ripgrep 流式）</div> : null}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function highlight(text: string, start: number, end: number): React.ReactNode {
  const a = Math.max(0, start - 1);
  const b = Math.max(a, end - 1);
  return (
    <>
      {text.slice(0, a)}
      <mark>{text.slice(a, b)}</mark>
      {text.slice(b)}
    </>
  );
}
