import React, { useEffect, useState } from 'react';
import { useApp, type View } from './store/appStore.js';
import { useChat } from './store/chatStore.js';
import { ChatPanel } from './features/chat/ChatPanel.js';
import { EditorPanel } from './features/editor/EditorPanel.js';
import { SearchPanel } from './features/search/SearchPanel.js';
import { GitPanel } from './features/git/GitPanel.js';
import { TerminalPanel } from './features/terminal/TerminalPanel.js';
import { DataPanel } from './features/data/DataPanel.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';
import { CommandPalette } from './components/CommandPalette.js';
import { COMMANDS, comboFromEvent, getBindings, runCommand } from './commands/registry.js';
import { NotificationCenter } from './features/notify/NotificationCenter.js';
import type { AppNotification } from './features/notify/notificationStore.js';

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'chat', label: '对话', icon: '◍' },
  { id: 'editor', label: '编辑', icon: '⌘' },
  { id: 'search', label: '搜索', icon: '⌕' },
  { id: 'git', label: 'Git', icon: '⑂' },
  { id: 'terminal', label: '终端', icon: '▣' },
  { id: 'data', label: '数据', icon: '⛁' },
  { id: 'settings', label: '设置', icon: '⚙' },
];

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const workspaces = useApp((s) => s.workspaces);
  const workspaceID = useApp((s) => s.workspaceID);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const health = useApp((s) => s.health);
  const toast = useApp((s) => s.toast);
  const uiScale = useApp((s) => s.uiScale);
  const setUiScale = useApp((s) => s.setUiScale);
  const textScale = useApp((s) => s.textScale);
  const setTextScale = useApp((s) => s.setTextScale);
  const themeMode = useApp((s) => s.themeMode);
  const resolvedTheme = useApp((s) => s.resolvedTheme);
  const setThemeMode = useApp((s) => s.setThemeMode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const loadWorkspaces = useApp((s) => s.loadWorkspaces);
  const startHealthPolling = useApp((s) => s.startHealthPolling);
  const loadProbe = useApp((s) => s.loadProbe);
  const connected = useChat((s) => s.connected);
  const lastError = useChat((s) => s.lastError);
  const permissionCount = useChat((s) =>
    Object.values(s.state.permissions).reduce((n, list) => n + list.length, 0),
  );
  const init = useChat((s) => s.init);
  const stop = useChat((s) => s.stop);

  const workspace = workspaces.find((w) => w.id === workspaceID);
  const upstreamOk = health?.upstream.healthy;

  useEffect(() => {
    void loadWorkspaces()
      .then(() => init())
      .catch((err) => useApp.getState().notify(err instanceof Error ? err.message : '初始化失败', 'error'));
    const stopPolling = startHealthPolling();
    void loadProbe(false);
    return () => {
      stopPolling();
      stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!workspaceID) return;
    void useChat.getState().refreshSessions(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [workspaceID]);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
    document.documentElement.style.setProperty('--font-scale', String(textScale));
    document.documentElement.dataset.theme = resolvedTheme;
  }, [uiScale, textScale, resolvedTheme]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = () => {
      if (themeMode === 'system') setThemeMode('system');
    };
    mq.addEventListener('change', handler);
    return () => mq.removeEventListener('change', handler);
  }, [themeMode, setThemeMode]);

  useEffect(() => {
    const onPalette = () => setPaletteOpen(true);
    const onChatSearch = () => {
      setView('chat');
      window.dispatchEvent(new CustomEvent('ocg:chat-search'));
    };
    window.addEventListener('ocg:palette-open', onPalette);
    window.addEventListener('ocg:chat-search', onChatSearch);
    return () => {
      window.removeEventListener('ocg:palette-open', onPalette);
      window.removeEventListener('ocg:chat-search', onChatSearch);
    };
  }, [setView]);

  useEffect(() => {
    const onNotify = (event: Event) => {
      const detail = (event as CustomEvent<AppNotification>).detail;
      if (!detail) return;
      if (detail.sessionID) {
        void useChat.getState().selectSession(detail.sessionID);
        setView('chat');
        return;
      }
      if (detail.view) setView(detail.view);
    };
    window.addEventListener('ocg:notify-open', onNotify);
    return () => window.removeEventListener('ocg:notify-open', onNotify);
  }, [setView]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (paletteOpen) return;
      const target = e.target as HTMLElement | null;
      const editable =
        target?.tagName === 'INPUT' ||
        target?.tagName === 'TEXTAREA' ||
        target?.tagName === 'SELECT' ||
        target?.isContentEditable === true;
      const combo = comboFromEvent(e);
      if (combo === 'Ctrl+Shift+P') {
        e.preventDefault();
        setPaletteOpen(true);
        return;
      }
      if (editable) return;
      const bindings = getBindings();
      const cmd = COMMANDS.find((c) => bindings[c.id]?.includes(combo));
      if (!cmd) return;
      e.preventDefault();
      runCommand(cmd.id);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [paletteOpen, setView]);

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <span className="brand-mark">⌬</span>
          <span className="brand-name">OpenCode GUI</span>
          <span className="brand-ver">{health ? `v${health.bff.version}` : ''}</span>
        </div>
        <select className="workspace-select" value={workspaceID ?? ''} onChange={(e) => setWorkspace(e.target.value)} title="切换工作区">
          {workspaces.map((w) => (
            <option key={w.id} value={w.id}>
              {w.label} — {w.path}
            </option>
          ))}
        </select>
        <nav className="nav">
          {NAV.map((item, i) => (
            <button
              key={item.id}
              className={`nav-item ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              title={`Alt+${i + 1}`}
            >
              <span className="nav-icon">{item.icon}</span>
              <span>{item.label}</span>
            </button>
          ))}
        </nav>
        <div className="top-status">
          <div className="font-controls" title={`文字大小 ${Math.round(textScale * 100)}%`}>
            <button className="icon-btn" onClick={() => setTextScale(textScale - 0.05)} disabled={textScale <= 0.85}>
              A-
            </button>
            <span>{Math.round(textScale * 100)}%</span>
            <button className="icon-btn" onClick={() => setTextScale(textScale + 0.05)} disabled={textScale >= 1.25}>
              A+
            </button>
          </div>
          <div className="font-controls" title={`界面大小 ${Math.round(uiScale * 100)}%`}>
            <button className="icon-btn" onClick={() => setUiScale(uiScale - 0.05)} disabled={uiScale <= 0.8}>
              UI-
            </button>
            <span>{Math.round(uiScale * 100)}%</span>
            <button className="icon-btn" onClick={() => setUiScale(uiScale + 0.05)} disabled={uiScale >= 1.3}>
              UI+
            </button>
          </div>
          <button
            className="icon-btn"
            title={`主题：${themeMode === 'system' ? `跟随系统（${resolvedTheme}）` : themeMode}`}
            onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : themeMode === 'light' ? 'system' : 'dark')}
          >
            {themeMode === 'system' ? '◐' : resolvedTheme === 'dark' ? '☾' : '☀'}
          </button>
          {permissionCount > 0 ? <span className="badge badge-warn">{permissionCount} 待授权</span> : null}
          <NotificationCenter />
          <span className={`conn ${connected ? 'ok' : 'bad'}`} title={lastError ?? ''}>
            <span className={`dot ${connected ? 'dot-idle' : 'dot-error'}`} />
            {connected ? 'SSE' : '离线'}
          </span>
          <span className={`conn ${upstreamOk ? 'ok' : 'bad'}`} title={health?.upstream.error ?? ''}>
            <span className={`dot ${upstreamOk ? 'dot-idle' : 'dot-error'}`} />
            {upstreamOk ? `opencode ${health?.upstream.version ?? ''}` : '上游离线'}
          </span>
        </div>
      </header>

      {!upstreamOk && health ? (
        <div className="banner banner-warn global-banner">
          上游 opencode 未连接：{health.upstream.error ?? '未知错误'}。对话不可用；编辑、Git、搜索仍可离线使用。
        </div>
      ) : null}
      {workspace ? null : (
        <div className="banner banner-warn global-banner">尚未选择工作区，请到“设置”中添加项目路径。</div>
      )}

      <main className="main">
        {view === 'chat' ? <ChatPanel /> : null}
        {view === 'editor' ? <EditorPanel /> : null}
        {view === 'search' ? <SearchPanel /> : null}
        {view === 'git' ? <GitPanel /> : null}
        {view === 'terminal' ? <TerminalPanel /> : null}
        {view === 'data' ? <DataPanel /> : null}
        {view === 'settings' ? <SettingsPanel /> : null}
      </main>

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.message}</div> : null}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
