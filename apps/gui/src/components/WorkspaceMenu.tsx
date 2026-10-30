import React, { useEffect, useRef, useState } from 'react';
import type { WorkspaceInfo } from '@ocg/protocol';
import { api } from '../api/client.js';
import { useApp } from '../store/appStore.js';

export function WorkspaceMenu() {
  const workspaces = useApp((s) => s.workspaces);
  const workspaceID = useApp((s) => s.workspaceID);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const loadWorkspaces = useApp((s) => s.loadWorkspaces);
  const notify = useApp((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [newPath, setNewPath] = useState('');
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement | null>(null);
  const active = workspaces.find((w) => w.id === workspaceID);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const add = async () => {
    if (!newPath.trim()) {
      await browse();
      return;
    }
    setBusy(true);
    try {
      const ws = await api<WorkspaceInfo>('/api/workspaces', {
        method: 'POST',
        body: JSON.stringify({ path: newPath.trim() }),
        headers: { 'content-type': 'application/json' },
      });
      setNewPath('');
      await loadWorkspaces();
      setWorkspace(ws.id);
      notify(`已添加工作区 ${ws.label}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '添加工作区失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const browse = async () => {
    setBusy(true);
    try {
      const res = await api<{ path: string; canceled: boolean }>('/api/system/pick-folder', { method: 'POST' });
      if (res.path) {
        setNewPath(res.path);
        notify('已选择文件夹，点击“添加”加入工作区');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '无法打开文件夹选择器', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (w: WorkspaceInfo) => {
    if (!window.confirm(`移除工作区“${w.label}”？不会删除磁盘文件。`)) return;
    setBusy(true);
    try {
      await api(`/api/workspaces/${w.id}`, { method: 'DELETE' });
      await loadWorkspaces();
      notify('工作区已移除');
    } catch (err) {
      notify(err instanceof Error ? err.message : '移除工作区失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="workspace-menu" ref={wrap}>
      <button className="workspace-select workspace-trigger" onClick={() => setOpen((v) => !v)} title="工作区配置">
        <span className="workspace-current">
          {active ? `${active.label} — ${active.path}` : '选择工作区'}
        </span>
        <span className="workspace-caret">▾</span>
      </button>
      <button
        className="icon-btn workspace-add-trigger"
        title="添加项目（打开文件夹选择器）"
        onClick={() => {
          setOpen(true);
          void browse();
        }}
        disabled={busy}
      >
        ＋
      </button>
      {open ? (
        <div className="workspace-popover">
          <div className="workspace-popover-head">
            <strong>工作区</strong>
            <span className="muted small">切换 / 添加 / 移除</span>
          </div>
          <div className="workspace-popover-list">
            {workspaces.length === 0 ? <div className="empty-hint">还没有工作区</div> : null}
            {workspaces.map((w) => (
              <div className={`workspace-popover-row ${w.id === workspaceID ? 'active' : ''}`} key={w.id}>
                <button
                  className="workspace-pick"
                  onClick={() => {
                    setWorkspace(w.id);
                    setOpen(false);
                  }}
                >
                  <span className="workspace-label">{w.label}</span>
                  <span className="workspace-path">{w.path}</span>
                </button>
                <button className="icon-btn" title="移除工作区" onClick={() => void remove(w)} disabled={busy}>
                  ×
                </button>
              </div>
            ))}
          </div>
          <div className="workspace-add">
            <input
              className="input"
              placeholder="D:\\projects\\new-project"
              value={newPath}
              onChange={(e) => setNewPath(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void add();
              }}
            />
            <button className="btn btn-small" onClick={() => void browse()} disabled={busy} title="打开系统文件夹选择器">
              📁 浏览
            </button>
            <button className="btn btn-small btn-primary" onClick={() => void add()} disabled={busy || !newPath.trim()}>
              添加
            </button>
          </div>
          <div className="muted small">工作区配置已合并到顶栏，设置页不再单独维护。</div>
        </div>
      ) : null}
    </div>
  );
}
