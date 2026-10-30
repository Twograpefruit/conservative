import React, { useEffect, useRef, useState } from 'react';
import { useNotify, type AppNotification } from './notificationStore.js';

function timeText(at: number): string {
  const d = new Date(at);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function levelIcon(level: AppNotification['level']): string {
  return level === 'error' ? '✕' : level === 'warn' ? '!' : 'i';
}

export function NotificationCenter() {
  const items = useNotify((s) => s.items);
  const markAllRead = useNotify((s) => s.markAllRead);
  const clear = useNotify((s) => s.clear);
  const open = useNotify((s) => s.open);
  const [visible, setVisible] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read).length;

  useEffect(() => {
    if (!visible) return;
    const onDown = (e: MouseEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setVisible(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setVisible(false);
    };
    window.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [visible]);

  return (
    <div className="notify-wrap" ref={wrap}>
      <button
        className="icon-btn notify-bell"
        title={unread ? `${unread} 条未读通知` : '通知中心'}
        onClick={() => setVisible((v) => !v)}
      >
        🔔
        {unread ? <span className="notify-badge">{unread > 99 ? '99+' : unread}</span> : null}
      </button>
      {visible ? (
        <div className="notify-panel">
          <div className="notify-head">
            <strong>通知中心</strong>
            <span className="muted small">{unread} 未读 / {items.length}</span>
            <span className="spacer" />
            <button className="btn btn-tiny" onClick={markAllRead} disabled={!unread}>
              全部已读
            </button>
            <button className="btn btn-tiny" onClick={clear} disabled={!items.length}>
              清空
            </button>
          </div>
          <div className="notify-list">
            {items.length === 0 ? <div className="empty-hint">还没有通知</div> : null}
            {items.map((n) => (
              <button
                key={n.id}
                className={`notify-item ${n.read ? '' : 'unread'} level-${n.level}`}
                onClick={() => {
                  setVisible(false);
                  open(n.id);
                }}
              >
                <span className={`notify-icon level-${n.level}`}>{levelIcon(n.level)}</span>
                <span className="notify-body">
                  <span className="notify-title">
                    {n.title}
                    {n.count > 1 ? <span className="notify-count">×{n.count}</span> : null}
                  </span>
                  {n.body ? <span className="notify-text">{n.body}</span> : null}
                  <span className="notify-meta">
                    {n.source} · {timeText(n.at)}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
