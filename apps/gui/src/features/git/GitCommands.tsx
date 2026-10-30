import React, { useEffect, useMemo, useState } from 'react';
import { api, qs } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { useNotify } from '../notify/notificationStore.js';

interface CatalogEntry {
  id: string;
  title: string;
  argv: string[];
  safety: 'read' | 'write' | 'danger';
  description: string;
  argsHint?: string;
}

interface RunResult {
  id: string;
  argv: string[];
  exitCode: number;
  stdout: string;
  stderr: string;
  durationMs: number;
  hints: Array<{ message: string; action?: string }>;
  snapshot?: string;
  redacted: boolean;
  time?: number;
}

export function GitCommands({ workspaceID, onChanged }: { workspaceID: string | null; onChanged: () => void }) {
  const notify = useApp((s) => s.notify);
  const [catalog, setCatalog] = useState<CatalogEntry[]>([]);
  const [history, setHistory] = useState<RunResult[]>([]);
  const [selected, setSelected] = useState('status');
  const [args, setArgs] = useState('');
  const [confirm, setConfirm] = useState('');
  const [result, setResult] = useState<RunResult | null>(null);
  const [busy, setBusy] = useState(false);

  const load = async () => {
    if (!workspaceID) return;
    try {
      const [c, h] = await Promise.all([
        api<CatalogEntry[]>('/api/git/catalog'),
        api<RunResult[]>(`/api/git/history${qs({ ws: workspaceID, limit: 30 })}`),
      ]);
      setCatalog(c);
      setHistory(h);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Git 命令目录加载失败', 'error');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceID]);

  const entry = useMemo(() => catalog.find((c) => c.id === selected), [catalog, selected]);
  const argv = useMemo(() => (entry ? ['git', ...entry.argv, ...(args.trim() ? args.trim().split(/\s+/) : [])] : []), [entry, args]);

  const run = async () => {
    if (!entry || !workspaceID) return;
    if (entry.safety === 'danger' && confirm !== 'CONFIRM') {
      notify('危险命令需要输入 CONFIRM', 'error');
      return;
    }
    setBusy(true);
    try {
      const res = await api<RunResult>('/api/git/run', {
        method: 'POST',
        body: JSON.stringify({
          ws: workspaceID,
          id: entry.id,
          args: args.trim() ? args.trim().split(/\s+/) : [],
          confirm: confirm || undefined,
        }),
        headers: { 'content-type': 'application/json' },
      });
      setResult(res);
      setConfirm('');
      await load();
      onChanged();
      useNotify.getState().push({
        source: 'git',
        level: res.exitCode === 0 ? 'info' : 'error',
        title: `${entry.title} ${res.exitCode === 0 ? '完成' : `失败（exit ${res.exitCode}）`}`,
        body: res.hints[0]?.message ?? `${res.durationMs}ms`,
        dedupKey: `git:${entry.id}`,
        view: 'git',
        workspaceID: workspaceID ?? undefined,
      });
      notify(res.exitCode === 0 ? '命令执行完成' : `命令失败（exit ${res.exitCode}）`, res.exitCode === 0 ? 'info' : 'error');
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Git 命令执行失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-commands">
      <aside className="git-command-list">
        {catalog.map((c) => (
          <button key={c.id} className={`git-command-item ${selected === c.id ? 'active' : ''}`} onClick={() => setSelected(c.id)}>
            <span className={`safety safety-${c.safety}`}>{c.safety}</span>
            <span className="git-command-title">{c.title}</span>
          </button>
        ))}
      </aside>
      <div className="git-command-work">
        {entry ? (
          <>
            <div className="git-command-head">
              <div>
                <div className="git-command-name">{entry.title}</div>
                <div className="muted small">{entry.description}</div>
              </div>
              <span className={`safety safety-${entry.safety}`}>{entry.safety}</span>
            </div>
            <div className="git-argv">
              <code>{argv.join(' ')}</code>
              <button
                className="btn btn-small"
                onClick={() => {
                  void navigator.clipboard?.writeText(argv.join(' '));
                  notify('已复制命令');
                }}
              >
                复制
              </button>
            </div>
            <div className="row">
              <input
                className="input grow"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={entry.argsHint ?? '附加参数（可选，空格分隔）'}
              />
              {entry.safety === 'danger' ? (
                <input
                  className="input"
                  value={confirm}
                  onChange={(e) => setConfirm(e.target.value)}
                  placeholder="输入 CONFIRM"
                />
              ) : null}
              <button className="btn btn-small btn-primary" onClick={() => void run()} disabled={busy}>
                运行
              </button>
            </div>
            {result ? (
              <div className="git-result">
                <div className="git-result-meta">
                  <span className={result.exitCode === 0 ? 'text-ok' : 'text-error'}>exit {result.exitCode}</span>
                  <span>{result.durationMs}ms</span>
                  {result.snapshot ? <span className="chip">快照 {result.snapshot.slice(0, 8)}</span> : null}
                  {result.redacted ? <span className="chip chip-warn">已脱敏</span> : null}
                </div>
                {result.hints.length ? (
                  <div className="git-hints">
                    {result.hints.map((h, i) => (
                      <div key={i}>
                        <strong>{h.message}</strong>
                        {h.action ? <span className="muted"> {h.action}</span> : null}
                      </div>
                    ))}
                  </div>
                ) : null}
                <div className="git-output-grid">
                  <div>
                    <div className="tool-label">stdout</div>
                    <pre className="git-output">{result.stdout || '（空）'}</pre>
                  </div>
                  <div>
                    <div className="tool-label">stderr</div>
                    <pre className="git-output">{result.stderr || '（空）'}</pre>
                  </div>
                </div>
              </div>
            ) : null}
            <div className="git-history">
              <div className="pane-title">历史</div>
              {history.length === 0 ? <div className="empty-hint">还没有执行记录</div> : null}
              {history.map((h, i) => (
                <button key={`${h.id}-${h.time ?? i}`} className="git-history-item" onClick={() => setResult(h)}>
                  <span className={h.exitCode === 0 ? 'text-ok' : 'text-error'}>exit {h.exitCode}</span>
                  <code>{h.argv.join(' ')}</code>
                  <span className="muted">{h.time ? new Date(h.time).toLocaleTimeString() : ''}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <div className="empty-hint">选择左侧命令</div>
        )}
      </div>
    </div>
  );
}
