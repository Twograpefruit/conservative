import React, { useEffect, useMemo, useRef, useState } from 'react';
import { COMMANDS, recentCommandIds, runCommand } from '../commands/registry.js';

export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [index, setIndex] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const recent = recentCommandIds();
    const list = COMMANDS.filter(
      (c) => !q || c.title.toLowerCase().includes(q) || c.id.includes(q) || (c.keywords ?? '').includes(q),
    );
    return list.sort((a, b) => {
      const ra = recent.indexOf(a.id);
      const rb = recent.indexOf(b.id);
      return (ra < 0 ? 999 : ra) - (rb < 0 ? 999 : rb);
    });
  }, [query]);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setIndex(0);
    setTimeout(() => input.current?.focus(), 20);
  }, [open]);

  useEffect(() => {
    setIndex(0);
  }, [query]);

  if (!open) return null;

  const choose = (id: string) => {
    onClose();
    runCommand(id);
  };

  return (
    <div className="palette-overlay" onMouseDown={onClose}>
      <div className="palette" onMouseDown={(e) => e.stopPropagation()}>
        <input
          ref={input}
          className="palette-input"
          placeholder="输入命令、视图或关键字…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Escape') {
              e.preventDefault();
              onClose();
            } else if (e.key === 'ArrowDown') {
              e.preventDefault();
              setIndex((i) => Math.min(filtered.length - 1, i + 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setIndex((i) => Math.max(0, i - 1));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              if (filtered[index]) choose(filtered[index].id);
            }
          }}
        />
        <div className="palette-list">
          {filtered.length === 0 ? <div className="empty-hint">没有匹配命令</div> : null}
          {filtered.map((cmd, i) => (
            <button
              key={cmd.id}
              className={`palette-item ${i === index ? 'active' : ''}`}
              onMouseEnter={() => setIndex(i)}
              onClick={() => choose(cmd.id)}
            >
              <span className="palette-title">{cmd.title}</span>
              <span className="palette-id">{cmd.id}</span>
              <span className="palette-key">{cmd.defaultKeys.join(' / ')}</span>
            </button>
          ))}
        </div>
        <div className="palette-foot">↑↓ 选择 · Enter 执行 · Esc 关闭</div>
      </div>
    </div>
  );
}
