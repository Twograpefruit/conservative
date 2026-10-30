import React, { useEffect } from 'react';
import { useApp, type View } from './store/appStore.js';
import { useChat } from './store/chatStore.js';
import { ChatPanel } from './features/chat/ChatPanel.js';
import { EditorPanel } from './features/editor/EditorPanel.js';
import { SearchPanel } from './features/search/SearchPanel.js';
import { GitPanel } from './features/git/GitPanel.js';
import { TerminalPanel } from './features/terminal/TerminalPanel.js';
import { DataPanel } from './features/data/DataPanel.js';
import { SettingsPanel } from './features/settings/SettingsPanel.js';

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
  }, [uiScale]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey) return;
      const idx = Number(e.key) - 1;
      if (idx >= 0 && idx < NAV.length) {
        e.preventDefault();
        setView(NAV[idx].id);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [setView]);

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
          <div className="font-controls" title={`界面字号 ${Math.round(uiScale * 100)}%`}>
            <button className="icon-btn" onClick={() => setUiScale(uiScale - 0.05)} disabled={uiScale <= 0.8}>
              A-
            </button>
            <span>{Math.round(uiScale * 100)}%</span>
            <button className="icon-btn" onClick={() => setUiScale(uiScale + 0.05)} disabled={uiScale >= 1.3}>
              A+
            </button>
          </div>
          {permissionCount > 0 ? <span className="badge badge-warn">{permissionCount} 待授权</span> : null}
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
    </div>
  );
}
