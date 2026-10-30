import React, { useCallback, useEffect, useState } from 'react';
import type { FileDiff } from '@ocg/diff';
import type { GitLogEntry, GitStatusEntry, SnapshotInfo } from '@ocg/protocol';
import { api, qs } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { DiffView, type HunkAction } from '../diff/DiffView.js';

type Tab = 'changes' | 'log' | 'snapshots';

interface GitInfo {
  repo: boolean;
  branch?: string;
  head?: string;
  detached?: boolean;
  shallow?: boolean;
  upstream?: string;
  ahead?: number;
  behind?: number;
}

export function GitPanel() {
  const workspaceID = useApp((s) => s.workspaceID);
  const requestOpen = useApp((s) => s.requestOpen);
  const notify = useApp((s) => s.notify);
  const [tab, setTab] = useState<Tab>('changes');
  const [info, setInfo] = useState<GitInfo | null>(null);
  const [status, setStatus] = useState<GitStatusEntry[]>([]);
  const [log, setLog] = useState<GitLogEntry[]>([]);
  const [snapshots, setSnapshots] = useState<SnapshotInfo[]>([]);
  const [snapshotPick, setSnapshotPick] = useState<string[]>([]);
  const [snapshotDiff, setSnapshotDiff] = useState<FileDiff[] | null>(null);
  const [mode, setMode] = useState<'working' | 'staged' | 'commit'>('working');
  const [base, setBase] = useState<string | undefined>();
  const [files, setFiles] = useState<FileDiff[]>([]);
  const [message, setMessage] = useState('');
  const [stageAll, setStageAll] = useState(true);
  const [pushBusy, setPushBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadDiff = useCallback(
    async (nextMode = mode, nextBase = base) => {
      if (!workspaceID) return;
      try {
        const res = await api<{ files: FileDiff[] }>(
          `/api/git/diff${qs({ ws: workspaceID, mode: nextMode, base: nextBase })}`,
        );
        setFiles(res.files);
      } catch (err) {
        setError(err instanceof Error ? err.message : String(err));
      }
    },
    [workspaceID, mode, base],
  );

  const reload = useCallback(async () => {
    if (!workspaceID) return;
    setLoading(true);
    setError(null);
    try {
      const [i, st, lg, sn] = await Promise.all([
        api<GitInfo>(`/api/git/info${qs({ ws: workspaceID })}`),
        api<GitStatusEntry[]>(`/api/git/status${qs({ ws: workspaceID })}`),
        api<GitLogEntry[]>(`/api/git/log${qs({ ws: workspaceID, limit: 60 })}`),
        api<SnapshotInfo[]>(`/api/snapshots${qs({ ws: workspaceID, limit: 40 })}`),
      ]);
      setInfo(i);
      setStatus(st);
      setLog(lg);
      setSnapshots(sn);
      await loadDiff(mode, base);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [workspaceID, loadDiff, mode, base]);

  useEffect(() => {
    void reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceID, tab]);

  const switchMode = async (next: 'working' | 'staged' | 'commit', nextBase?: string) => {
    setMode(next);
    setBase(nextBase);
    setSnapshotDiff(null);
    await loadDiff(next, nextBase);
  };

  const applyHunk = async (file: FileDiff, hunkIndex: number, action: 'stage' | 'unstage' | 'discard') => {
    try {
      await api('/api/git/apply-hunk', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, path: file.path, hunkIndex, action, mode: mode === 'staged' ? 'staged' : 'working', base }),
        headers: { 'content-type': 'application/json' },
      });
      notify(action === 'stage' ? '已暂存该 hunk' : action === 'unstage' ? '已取消暂存' : '已回滚该 hunk');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'hunk 操作失败', 'error');
    }
  };

  const exec = async (args: string[]) => {
    try {
      const res = await api<{ code: number; out: string; err: string }>('/api/git/exec', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, args }),
        headers: { 'content-type': 'application/json' },
      });
      if (res.code !== 0) notify(res.err || 'git 命令失败', 'error');
      else notify(res.out.trim().slice(0, 200) || '完成');
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : 'git 命令失败', 'error');
    }
  };

  const commit = async () => {
    if (!message.trim()) return;
    try {
      await api('/api/git/commit', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, message, stageAll }),
        headers: { 'content-type': 'application/json' },
      });
      setMessage('');
      const ahead = info?.ahead ?? 0;
      notify(ahead > 0 || info?.upstream ? `已提交到本地，尚有 ${ahead + 1} 个提交未推送` : '已提交到本地');
      await reload();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message ?? '提交失败');
      notify(e.message ?? '提交失败', 'error');
    }
  };

  const pushNow = async () => {
    if (!workspaceID) return;
    if (info?.ahead === 0 && info?.upstream) {
      notify('没有需要推送的提交');
      return;
    }
    const target = info?.upstream ?? `${info?.branch ?? '当前分支'} → origin`;
    if (!window.confirm(`推送 ${target}？这会把本地提交上传到远程仓库（不会强制推送）。`)) return;
    setPushBusy(true);
    setError(null);
    try {
      const res = await api<{ out: string; remote: string; branch: string; setUpstream: boolean }>('/api/git/push', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID }),
        headers: { 'content-type': 'application/json' },
      });
      notify(
        res.out
          ? `已推送 ${res.remote}/${res.branch}：${res.out.split('\n')[0]}`
          : `已推送 ${res.remote}/${res.branch}`,
      );
      await reload();
    } catch (err) {
      const e = err as { message?: string };
      setError(e.message ?? '推送失败');
      notify(e.message ?? '推送失败', 'error');
    } finally {
      setPushBusy(false);
    }
  };

  const createSnapshot = async () => {
    try {
      const snap = await api<SnapshotInfo>('/api/snapshots', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, reason: 'manual' }),
        headers: { 'content-type': 'application/json' },
      });
      notify(`快照已创建 ${snap.id.slice(0, 8)}`);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : '快照失败', 'error');
    }
  };

  const compareSnapshots = async () => {
    if (snapshotPick.length !== 2) return;
    try {
      const res = await api<{ files: FileDiff[] }>(
        `/api/snapshots/diff${qs({ ws: workspaceID, a: snapshotPick[0], b: snapshotPick[1] })}`,
      );
      setSnapshotDiff(res.files);
    } catch (err) {
      notify(err instanceof Error ? err.message : '快照对比失败', 'error');
    }
  };

  const restoreSnapshot = async (id: string) => {
    if (!window.confirm(`恢复到快照 ${id.slice(0, 8)}？当前状态会先自动创建快照，新增文件会移到备份目录。`)) return;
    try {
      const res = await api<{ restored: number; removed: number }>('/api/snapshots/restore', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, id }),
        headers: { 'content-type': 'application/json' },
      });
      notify(`已恢复 ${res.restored} 个文件，移除 ${res.removed} 个后加文件`);
      await reload();
    } catch (err) {
      notify(err instanceof Error ? err.message : '恢复失败', 'error');
    }
  };

  const actions: HunkAction[] | undefined =
    mode === 'commit'
      ? undefined
      : mode === 'staged'
        ? [{ label: '取消暂存', action: (f, i) => void applyHunk(f, i, 'unstage') }]
        : [
            { label: '暂存', variant: 'primary', action: (f, i) => void applyHunk(f, i, 'stage') },
            { label: '回滚', variant: 'danger', action: (f, i) => void applyHunk(f, i, 'discard') },
          ];

  return (
    <div className="git-layout">
      <aside className="git-side">
        <div className="pane-head">
          <div className="pane-title">
            Git {info?.branch ? <span className="chip">{info.branch}</span> : null}
            {info?.ahead ? (
              <span className="badge badge-warn" title={`本地领先 ${info.ahead} 个提交，尚未推送`}>
                未推送 {info.ahead}
              </span>
            ) : null}
            {info?.behind ? (
              <span className="badge" title={`远程领先 ${info.behind} 个提交，建议先拉取`}>
                落后 {info.behind}
              </span>
            ) : null}
          </div>
          <div className="pane-actions">
            <button className="icon-btn" title="刷新" onClick={() => void reload()}>
              ↻
            </button>
          </div>
        </div>
        <div className="segmented segmented-full">
          <button className={tab === 'changes' ? 'active' : ''} onClick={() => setTab('changes')}>
            变更 {status.length}
          </button>
          <button className={tab === 'log' ? 'active' : ''} onClick={() => setTab('log')}>
            历史
          </button>
          <button className={tab === 'snapshots' ? 'active' : ''} onClick={() => setTab('snapshots')}>
            快照
          </button>
        </div>

        {tab === 'changes' ? (
          <div className="git-scroll">
            <div className="git-toolbar">
              <button className="btn btn-small" onClick={() => void exec(['add', '-A'])}>
                全部暂存
              </button>
              <button className="btn btn-small" onClick={() => void exec(['reset'])}>
                全部取消
              </button>
            </div>
            {status.length === 0 ? <div className="empty-hint">工作区干净</div> : null}
            {status.map((s) => (
              <div className="git-file" key={s.path}>
                <span className={`git-badge git-${s.status}`}>{s.status[0].toUpperCase()}</span>
                <button className="git-file-path" onClick={() => requestOpen(s.path.split(' -> ').pop() ?? s.path)}>
                  {s.path}
                </button>
                <span className="muted">
                  {s.index}
                  {s.worktree}
                </span>
              </div>
            ))}
          </div>
        ) : null}

        {tab === 'log' ? (
          <div className="git-scroll">
            {log.map((l) => (
              <button
                key={l.hash}
                className={`log-item ${mode === 'commit' && base === l.hash ? 'active' : ''}`}
                onClick={() => void switchMode('commit', l.hash)}
                title={l.hash}
              >
                <div className="log-subject">{l.subject}</div>
                <div className="log-meta">
                  <code>{l.short}</code>
                  <span>{l.author}</span>
                  <span>{new Date(l.date).toLocaleDateString()}</span>
                </div>
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'snapshots' ? (
          <div className="git-scroll">
            <div className="git-toolbar">
              <button className="btn btn-small btn-primary" onClick={() => void createSnapshot()}>
                立即快照
              </button>
              <button className="btn btn-small" disabled={snapshotPick.length !== 2} onClick={() => void compareSnapshots()}>
                对比所选
              </button>
            </div>
            {snapshots.length === 0 ? <div className="empty-hint">还没有快照</div> : null}
            {snapshots.map((s) => (
              <div className="snapshot-item" key={s.id}>
                <input
                  type="checkbox"
                  checked={snapshotPick.includes(s.id)}
                  onChange={(e) =>
                    setSnapshotPick((prev) => (e.target.checked ? [...prev, s.id].slice(-2) : prev.filter((x) => x !== s.id)))
                  }
                />
                <div className="snapshot-main">
                  <div className="snapshot-reason">{s.reason}</div>
                  <div className="muted">
                    {new Date(s.time).toLocaleString()} · {s.files} 个文件 · {s.id.slice(0, 8)}
                  </div>
                </div>
                <button className="btn btn-tiny" onClick={() => void restoreSnapshot(s.id)}>
                  恢复
                </button>
              </div>
            ))}
          </div>
        ) : null}
      </aside>

      <section className="git-main">
        <div className="git-diff-head">
          <div className="segmented">
            <button className={mode === 'working' ? 'active' : ''} onClick={() => void switchMode('working')}>
              工作区
            </button>
            <button className={mode === 'staged' ? 'active' : ''} onClick={() => void switchMode('staged')}>
              已暂存
            </button>
            <button className={mode === 'commit' ? 'active' : ''} onClick={() => void switchMode('commit', base ?? log[0]?.hash)}>
              提交 {base ? base.slice(0, 7) : ''}
            </button>
          </div>
          <span className="spacer" />
          {loading ? <span className="muted">加载中…</span> : null}
          {error ? <span className="text-error">{error}</span> : null}
        </div>

        {tab === 'changes' ? (
          <div className="git-diff-scroll">
            {mode !== 'commit' ? (
              <div className="commit-box">
                <div className="commit-input">
                  <textarea
                    className="input"
                    rows={2}
                    placeholder="提交说明（默认先暂存全部变更）"
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                  />
                  <label className="commit-option">
                    <input type="checkbox" checked={stageAll} onChange={(e) => setStageAll(e.target.checked)} />
                    提交前暂存全部变更
                  </label>
                </div>
                <div className="commit-actions">
                  <button className="btn btn-primary" disabled={!message.trim()} onClick={() => void commit()}>
                    提交到本地
                  </button>
                  <button
                    className="btn"
                    disabled={pushBusy || Boolean(info?.upstream && !info.ahead)}
                    title={info?.upstream ? `推送到 ${info.upstream}` : '首次推送会自动设置 upstream'}
                    onClick={() => void pushNow()}
                  >
                    {pushBusy ? '推送中…' : info?.upstream ? `推送${info.ahead ? ` (${info.ahead})` : ''}` : '推送并设置 upstream'}
                  </button>
                </div>
              </div>
            ) : null}
            <DiffView files={files} actions={actions} />
          </div>
        ) : tab === 'snapshots' ? (
          <div className="git-diff-scroll">
            <DiffView files={snapshotDiff ?? []} emptyText="勾选两个快照后点击“对比所选”" />
          </div>
        ) : (
          <div className="git-diff-scroll">
            <DiffView files={files} emptyText={mode === 'commit' ? '选择一条提交查看差异' : '没有差异'} />
          </div>
        )}
      </section>
    </div>
  );
}
