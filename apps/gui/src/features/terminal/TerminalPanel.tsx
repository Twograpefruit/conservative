import React, { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { SearchAddon } from '@xterm/addon-search';
import '@xterm/xterm/css/xterm.css';
import { api } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { useNotify } from '../notify/notificationStore.js';

interface Tab {
  id: string;
  ptyID: string;
  ticket: string;
  title: string;
}

export function TerminalPanel() {
  const workspaceID = useApp((s) => s.workspaceID);
  const notify = useApp((s) => s.notify);
  const resolvedTheme = useApp((s) => s.resolvedTheme);
  const textScale = useApp((s) => s.textScale);
  const [tabs, setTabs] = useState<Tab[]>([]);
  const [active, setActive] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const addons = useRef(new Map<string, SearchAddon>());

  const createTab = async () => {
    if (!workspaceID) return;
    try {
      const res = await api<{ id: string; ticket: string }>('/api/pty/token', {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID, title: `终端 ${tabs.length + 1}`, cols: 120, rows: 30 }),
        headers: { 'content-type': 'application/json' },
      });
      const tab: Tab = { id: `${Date.now()}`, ptyID: res.id, ticket: res.ticket, title: `终端 ${tabs.length + 1}` };
      setTabs((prev) => [...prev, tab]);
      setActive(tab.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : '终端创建失败', 'error');
    }
  };

  const closeTab = async (tab: Tab) => {
    addons.current.delete(tab.id);
    setTabs((prev) => prev.filter((t) => t.id !== tab.id));
    if (active === tab.id) {
      const next = tabs.find((t) => t.id !== tab.id);
      setActive(next?.id ?? null);
    }
    await api(`/api/pty/${encodeURIComponent(tab.ptyID)}?ws=${encodeURIComponent(workspaceID ?? '')}`, {
      method: 'DELETE',
    }).catch(() => undefined);
  };

  useEffect(() => {
    const onNew = () => void createTab();
    window.addEventListener('ocg:terminal-new', onNew);
    return () => window.removeEventListener('ocg:terminal-new', onNew);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceID, tabs.length]);

  useEffect(() => {
    if (!active && tabs.length) setActive(tabs[0].id);
  }, [tabs, active]);

  const findNext = (back = false) => {
    const addon = active ? addons.current.get(active) : null;
    if (addon) {
      if (back) addon.findPrevious(search);
      else addon.findNext(search);
    }
  };

  return (
    <div className="terminal-layout">
      <div className="terminal-tabs">
        {tabs.map((t) => (
          <div key={t.id} className={`tab ${active === t.id ? 'active' : ''}`} onClick={() => setActive(t.id)}>
            <span>{t.title}</span>
            <button
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                void closeTab(t);
              }}
            >
              ×
            </button>
          </div>
        ))}
        <button className="btn btn-small" onClick={() => void createTab()}>
          + 终端
        </button>
        <span className="spacer" />
        <button className="btn btn-small" onClick={() => setShowSearch((v) => !v)}>
          查找
        </button>
      </div>
      {showSearch ? (
        <div className="terminal-search">
          <input
            className="input"
            autoFocus
            placeholder="在终端中查找"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') findNext(e.shiftKey);
              if (e.key === 'Escape') setShowSearch(false);
            }}
          />
          <button className="btn btn-small" onClick={() => findNext(false)}>
            下一个
          </button>
          <button className="btn btn-small" onClick={() => findNext(true)}>
            上一个
          </button>
        </div>
      ) : null}
      <div className="terminal-body">
        {tabs.length === 0 ? (
          <div className="empty-state">
            <h2>终端</h2>
            <p>ConPTY + cmd.exe，自动 chcp 65001 并激活项目 venv。票据一次性、60 秒有效。</p>
            <button className="btn btn-primary" onClick={() => void createTab()}>
              打开终端
            </button>
          </div>
        ) : null}
        {tabs.map((tab) => (
          <TerminalTab
            key={tab.id}
            tab={tab}
            visible={active === tab.id}
            theme={resolvedTheme}
            textScale={textScale}
            onAddon={(addon) => addons.current.set(tab.id, addon)}
            onExit={() => {
              useNotify.getState().push({
                source: 'terminal',
                level: 'warn',
                title: `${tab.title} 已退出`,
                body: '终端进程结束',
                dedupKey: `terminal:${tab.id}`,
                view: 'terminal',
              });
              notify(`${tab.title} 已退出`, 'error');
            }}
          />
        ))}
      </div>
    </div>
  );
}

const TERMINAL_THEME = {
  background: '#0f1115',
  foreground: '#e5e7eb',
  cursor: '#9bb7e0',
  selectionBackground: '#334155',
  black: '#1f2430',
  red: '#e09a9a',
  green: '#9ac7aa',
  yellow: '#dfc08a',
  blue: '#9bb7e0',
  magenta: '#c3aed6',
  cyan: '#9ccfcf',
  white: '#f3f4f6',
  brightBlack: '#6b7280',
  brightRed: '#efb0b0',
  brightGreen: '#b4dcc2',
  brightYellow: '#ecd2a5',
  brightBlue: '#b8cdea',
  brightMagenta: '#d8c6e8',
  brightCyan: '#b5e0e0',
  brightWhite: '#ffffff',
};

function TerminalTab({
  tab,
  visible,
  theme,
  textScale,
  onAddon,
  onExit,
}: {
  tab: Tab;
  visible: boolean;
  theme: 'dark' | 'light';
  textScale: number;
  onAddon: (addon: SearchAddon) => void;
  onExit: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!host.current) return;
    const term = new Terminal({
      scrollback: 5000,
      fontSize: Math.max(9, Math.round(12 * textScale)),
      fontFamily: "'Cascadia Code', Consolas, monospace",
      theme: TERMINAL_THEME,
      convertEol: false,
      allowProposedApi: true,
    });
    const fit = new FitAddon();
    const search = new SearchAddon();
    term.loadAddon(fit);
    term.loadAddon(search);
    term.open(host.current);
    onAddon(search);
    termRef.current = term;
    fitRef.current = fit;
    try {
      fit.fit();
    } catch {
      /* not laid out yet */
    }
    const protocol = location.protocol === 'https:' ? 'wss' : 'ws';
    const ws = new WebSocket(
      `${protocol}://${location.host}/api/pty?ticket=${encodeURIComponent(tab.ticket)}&cols=${term.cols}&rows=${term.rows}`,
    );
    const sendResize = () => {
      try {
        fit.fit();
      } catch {
        /* noop */
      }
      ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      void api('/api/pty/resize', {
        method: 'POST',
        body: JSON.stringify({ ws: useApp.getState().workspaceID, id: tab.ptyID, cols: term.cols, rows: term.rows }),
        headers: { 'content-type': 'application/json' },
      }).catch(() => undefined);
    };
    ws.onopen = () => {
      term.focus();
      sendResize();
    };
    ws.onmessage = (event) => {
      if (typeof event.data !== 'string') return;
      if (event.data.startsWith('{"type":')) {
        try {
          JSON.parse(event.data);
          return;
        } catch {
          /* terminal output that happens to start with braces */
        }
      }
      term.write(event.data);
    };
    ws.onerror = () => term.writeln('\r\n\x1b[31m[终端连接错误]\x1b[0m');
    ws.onclose = (e) => {
      if (e.code !== 1000 && e.code !== 1005) {
        term.writeln(`\r\n\x1b[31m[终端已断开 ${e.code} ${e.reason}]\x1b[0m`);
        onExit();
      }
    };
    const dataSub = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(data);
    });
    const observer = new ResizeObserver(() => {
      if (ws.readyState === WebSocket.OPEN) sendResize();
    });
    observer.observe(host.current);
    return () => {
      observer.disconnect();
      dataSub.dispose();
      ws.close();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.id]);

  useEffect(() => {
    if (!termRef.current) return;
    termRef.current.options.theme = TERMINAL_THEME;
    termRef.current.options.fontSize = Math.max(9, Math.round(12 * textScale));
  }, [theme, textScale]);

  useEffect(() => {
    if (visible) {
      termRef.current?.focus();
      try {
        fitRef.current?.fit();
      } catch {
        /* noop */
      }
    }
  }, [visible]);

  return <div className="terminal-host" ref={host} style={{ display: visible ? 'block' : 'none' }} />;
}
