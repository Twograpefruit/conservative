import React, { useCallback, useEffect, useState } from 'react';
import type { FileEntry } from '@ocg/protocol';
import type { FileDiff } from '@ocg/diff';
import { api, qs } from '../api/client.js';
import { useApp } from '../store/appStore.js';
import { useEditor } from '../store/editorStore.js';
import { ContextMenu, type MenuPosition } from './ContextMenu.js';
import { Icon } from './icon/Icon.js';
import type { IconName } from './icon/icons.js';
import { DiffView } from '../features/diff/DiffView.js';

export function FileTree({ workspaceID, onOpen }: { workspaceID: string | null; onOpen: (path: string) => void }) {
  const [entries, setEntries] = useState<Record<string, FileEntry[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['']));
  const [loading, setLoading] = useState<Set<string>>(new Set());
  const [filter, setFilter] = useState('');
  const [menu, setMenu] = useState<MenuPosition | null>(null);
  const [comparePick, setComparePick] = useState<string[]>([]);
  const [compare, setCompare] = useState<{ a: string; b: string; files: FileDiff[] } | null>(null);
  const [compareBusy, setCompareBusy] = useState(false);
  const notify = useApp((s) => s.notify);
  const requestSearch = useApp((s) => s.requestSearch);
  const closeTab = useEditor((s) => s.close);

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

  const renameEntry = async (entry: FileEntry) => {
    const next = window.prompt('新路径（相对于工作区）', entry.path);
    if (!next || next === entry.path) return;
    try {
      await api('/api/fs/rename', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, from: entry.path, to: next }),
        headers: { 'content-type': 'application/json' },
      });
      if (entry.type === 'file') closeTab(entry.path);
      const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      await load(parent);
      notify('已重命名');
    } catch (err) {
      notify(err instanceof Error ? err.message : '重命名失败', 'error');
    }
  };

  const deleteEntry = async (entry: FileEntry) => {
    if (!window.confirm(`删除 ${entry.path}？`)) return;
    try {
      await api('/api/fs/delete', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, path: entry.path, recursive: true }),
        headers: { 'content-type': 'application/json' },
      });
      if (entry.type === 'file') closeTab(entry.path);
      const parent = entry.path.includes('/') ? entry.path.slice(0, entry.path.lastIndexOf('/')) : '';
      await load(parent);
      notify('已删除');
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const runCompare = async (a: string, b: string) => {
    setCompareBusy(true);
    try {
      const res = await api<{ files: FileDiff[] }>(`/api/fs/compare${qs({ ws: workspaceID, a, b })}`);
      setCompare({ a, b, files: res.files });
    } catch (err) {
      notify(err instanceof Error ? err.message : '文件对比失败', 'error');
    } finally {
      setCompareBusy(false);
    }
  };

  const compareEntry = (entry: FileEntry) => {
    if (comparePick.includes(entry.path)) {
      setComparePick((prev) => prev.filter((p) => p !== entry.path));
      return;
    }
    if (comparePick.length === 0) {
      setComparePick([entry.path]);
      notify(`已选择对比文件 A：${entry.path}`);
      return;
    }
    const other = comparePick[0];
    setComparePick([]);
    void runCompare(other, entry.path);
  };

  const entryMenu = (e: React.MouseEvent, entry: FileEntry) => {
    e.preventDefault();
    e.stopPropagation();
    const items = entry.type === 'file'
      ? [
          { label: '打开', onClick: () => onOpen(entry.path) },
          {
            label: '在此文件中搜索',
            onClick: () => requestSearch({ glob: entry.path }),
          },
          {
            label: comparePick.includes(entry.path)
              ? '取消对比选择'
              : comparePick.length === 0
                ? '选为对比文件 A'
                : `与 ${comparePick[0]} 对比`,
            disabled: compareBusy,
            onClick: () => compareEntry(entry),
          },
          { label: '重命名…', onClick: () => void renameEntry(entry) },
          { label: '删除', danger: true, onClick: () => void deleteEntry(entry) },
        ]
      : [
          {
            label: '在此文件夹中搜索',
            onClick: () => requestSearch({ glob: `${entry.path}/**` }),
          },
          { label: '新建文件…', onClick: () => void createFile() },
          { label: '刷新目录', onClick: () => void load(entry.path) },
          { label: '重命名…', onClick: () => void renameEntry(entry) },
          { label: '删除目录', danger: true, onClick: () => void deleteEntry(entry) },
        ];
    setMenu({ x: e.clientX, y: e.clientY, items });
  };

  const renderDir = (dir: string, depth: number): React.ReactNode => {
    const list = (entries[dir] ?? []).filter((e) => !filter || e.name.toLowerCase().includes(filter.toLowerCase()));
    return list.map((entry) => (
      <React.Fragment key={entry.path}>
        <div
          className={`tree-row ${entry.type}`}
          style={{ paddingLeft: 10 + depth * 14 }}
          onClick={() => toggle(entry)}
          onContextMenu={(e) => entryMenu(e, entry)}
          title={entry.path}
        >
          <span className="tree-caret">
            {entry.type === 'dir' ? (expanded.has(entry.path) ? '▾' : '▸') : ''}
          </span>
          <span className="tree-icon">{entry.type === 'dir' ? <Icon name="folder-6" /> : <Icon name={fileIcon(entry.name)} />}</span>
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
      {comparePick.length ? (
        <div className="compare-pick-bar">
          <span>对比 A</span>
          <code title={comparePick[0]}>{comparePick[0]}</code>
          <button className="icon-btn" title="取消对比选择" onClick={() => setComparePick([])}>
            ×
          </button>
        </div>
      ) : null}
      <div
        className="tree-scroll"
        onContextMenu={(e) => {
          if (e.target !== e.currentTarget) return;
          e.preventDefault();
          setMenu({
            x: e.clientX,
            y: e.clientY,
            items: [
              { label: '新建文件…', onClick: () => void createFile() },
              { label: '刷新', onClick: () => void load('') },
            ],
          });
        }}
      >
        {renderDir('', 0)}
      </div>
      <ContextMenu menu={menu} onClose={() => setMenu(null)} />
      {compare ? (
        <div className="format-overlay" onMouseDown={() => setCompare(null)}>
          <div className="compare-dialog" onMouseDown={(e) => e.stopPropagation()}>
            <div className="format-head">
              <strong>文件对比</strong>
              <span className="muted">{compare.a}</span>
              <span className="muted">↔ {compare.b}</span>
              <span className="spacer" />
              <button className="btn btn-small" onClick={() => setCompare(null)}>
                关闭
              </button>
            </div>
            <div className="format-body">
              <DiffView files={compare.files} emptyText="两个文件内容相同" selectable={false} />
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function fileIcon(name: string): IconName {
  const ext = name.split('.').pop()?.toLowerCase();
  if (['py', 'ts', 'tsx', 'js', 'jsx', 'go', 'rs', 'java', 'c', 'cpp', 'php', 'css', 'html', 'sh', 'ps1'].includes(ext ?? '')) {
    return 'file-code';
  }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'ico'].includes(ext ?? '')) return 'file-image';
  if (ext === 'json') return 'braces';
  if (['md', 'txt', 'log', 'yaml', 'yml', 'toml', 'ini', 'sql'].includes(ext ?? '')) return 'file-text';
  return 'file';
}
