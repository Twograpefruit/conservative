import React, { useCallback, useEffect, useState } from 'react';
import type { FileEntry } from '@ocg/protocol';
import { api, qs } from '../api/client.js';
import { useApp } from '../store/appStore.js';

export function FileTree({ workspaceID, onOpen }: { workspaceID: string | null; onOpen: (path: string) => void }) {
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const notify = useApp((s) => s.notify);

  const load = useCallback(
    async (dir: string) => {
      if (!workspaceID) return;
      setLoading((s) => new Set(s).add(dir));
      try {
        const res = await api<{ entries: FileEntry[] }>(`/api/fs/tree${qs({ ws: workspaceID, path: dir })}`);
        setEntries((s) => ({ ...s, [dir]: res.entries }));
      } catch (err) {
        notify(err instanceof Error ? err.message : '目录加载失败', 'error');
      } finally {
        setLoading((s) => {
          const next = new Set(s);
          next.delete(dir);
          return next;
        });
      }
    },
    [workspaceID, notify],
  );

  useEffect(() => {
    setEntries({});
    setExpanded(new Set(['']));
    void load('');
  }, [workspaceID, load]);

  const toggle = (entry: FileEntry) => {
    if (entry.type === 'file') {
      onOpen(entry.path);
      return;
    }
    const next = new Set(expanded);
    if (next.has(entry.path)) next.delete(entry.path);
    else {
      next.add(entry.path);
      if (!entries[entry.path]) void load(entry.path);
    }
    setExpanded(next);
  };

  const createFile = async () => {
    const name = window.prompt('新文件路径（相对于工作区）');
    if (!name) return;
    try {
      await api('/api/fs/file', {
        method: 'PUT',
        body: JSON.stringify({ ws: workspaceID, path: name, content: '' }),
        headers: { 'content-type': 'application/json' },
      });
      onOpen(name);
      const dir = name.includes('/') ? name.slice(0, name.lastIndexOf('/')) : '';
      await load(dir);
    } catch (err) {
      notify(err instanceof Error ? err.message : '创建失败', 'error');
    }
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const list = (entries[dir] ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
    return list.map((entry) => (
      <React.Fragment key={entry.path}>
        <div
          className={`tree-row ${entry.type}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => toggle(entry)}
          title={entry.path}
        >
          <span className="tree-caret">
            {entry.type === 'dir' ? (expanded.has(entry.path) ? '▾' : '▸') : ''}
          </span>
          <span className="tree-icon">{entry.type === 'dir' ? '▣' : fileIcon(entry.name)}</span>
          <span className="tree-name">{entry.name}</span>
          {loading.has(entry.path) ? <span className="tree-loading">…</span> : null}
        </div>
        {entry.type === 'dir' && expanded.has(entry.path) ? renderDir(entry.path, depth + 1) : null}
      </React.Fragment>
    ));
  };

  return (
    <div className="file-tree">
      <div className="pane-head">
        <div className="pane-title">文件</div>
        <div className="pane-actions">
          <button className="icon-btn" title="新建文件" onClick={() => void createFile()}>
            +
          </button>
          <button className="icon-btn" title="刷新" onClick={() => void load('')}>
            ↻
          </button>
        </div>
      </div>
      <input className="input tree-filter" placeholder="筛选已展开文件…" value={filter} onChange={(e) => setFilter(e.target.value)} />
      <div className="tree-scroll">{renderDir('', 0)}</div>
    </div>
  );
}

function fileIcon(name: string): string {
  const ext = name.split('.').pop()?.toLowerCase();
  if (ext === 'py') return '🐍';
  if (ext === 'ts' || ext === 'tsx' || ext === 'js' || ext === 'jsx') return '◆';
  if (ext === 'json') return '{}';
  if (ext === 'md') return 'M';
  if (ext === 'css') return '#';
  return '·';
}
