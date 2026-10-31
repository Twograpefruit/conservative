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
import { WorkspaceMenu } from './components/WorkspaceMenu.js';
import { useT } from './lib/i18n.js';
import { Icon } from './components/icon/Icon.js';
import type { IconName } from './components/icon/icons.js';

const NAV: Array<{ id: View; label: string; icon: string }> = [
  { id: 'chat', label: '对话', icon: 'chat' },
  { id: 'editor', label: '编辑', icon: 'editor' },
  { id: 'search', label: '搜索', icon: 'search' },
  { id: 'git', label: 'Git', icon: 'git' },
  { id: 'terminal', label: '终端', icon: 'terminal' },
  { id: 'data', label: '数据', icon: 'data' },
  { id: 'settings', label: '设置', icon: 'settings' },
];

const NAV_ICONS: Record<string, IconName> = {
  chat: 'chat-3',
  editor: 'code-sslash',
  search: 'search',
  git: 'git-branch',
  terminal: 'terminal-box',
  data: 'database-2',
  settings: 'settings-3',
};

function NavGlyph({ name }: { name: string }) {
  return <Icon name={NAV_ICONS[name] ?? 'apps'} />;
}

export function App() {
  const view = useApp((s) => s.view);
  const setView = useApp((s) => s.setView);
  const workspaces = useApp((s) => s.workspaces);
  const workspaceID = useApp((s) => s.workspaceID);
  const health = useApp((s) => s.health);
  const toast = useApp((s) => s.toast);
  const uiScale = useApp((s) => s.uiScale);
  const textScale = useApp((s) => s.textScale);
  const fontFamily = useApp((s) => s.fontFamily);
  const codeFontFamily = useApp((s) => s.codeFontFamily);
  const codeFontSize = useApp((s) => s.codeFontSize);
  const themeMode = useApp((s) => s.themeMode);
  const resolvedTheme = useApp((s) => s.resolvedTheme);
  const setThemeMode = useApp((s) => s.setThemeMode);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem('ocg.sidebarCollapsed') === '1');
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
  const t = useT();

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
    localStorage.setItem('ocg.sidebarCollapsed', sidebarCollapsed ? '1' : '0');
  }, [sidebarCollapsed]);

  useEffect(() => {
    const root = document.documentElement;
    const apply = () => {
      root.style.setProperty('--viewport-w', `${window.innerWidth}px`);
      root.style.setProperty('--viewport-h', `${window.innerHeight}px`);
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(root);
    window.addEventListener('resize', apply);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', apply);
    };
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--ui-scale', String(uiScale));
    document.documentElement.style.setProperty('--font-scale', String(textScale));
    document.documentElement.style.setProperty(
      '--font-family',
      fontFamily || "-apple-system, 'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif",
    );
    document.documentElement.style.setProperty('--code-font-family', codeFontFamily);
    document.documentElement.style.setProperty('--code-font-size', `${codeFontSize}px`);
    document.documentElement.dataset.theme = resolvedTheme;
    document.documentElement.dataset.textScale = textScale > 2 ? 'xxl' : textScale > 1.5 ? 'xl' : 'normal';
  }, [uiScale, textScale, fontFamily, codeFontFamily, codeFontSize, resolvedTheme]);

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
      <aside className={`app-sidebar ${sidebarCollapsed ? 'collapsed' : ''}`}>
        <div className="sidebar-brand" title={sidebarCollapsed ? '展开导航' : '收起导航'}>
          <button
            className="sidebar-logo"
            onClick={() => setSidebarCollapsed((v) => !v)}
            title={sidebarCollapsed ? '展开导航' : '收起导航'}
            aria-label={sidebarCollapsed ? '展开导航' : '收起导航'}
          >
            <svg viewBox="0 0 24 24" aria-hidden="true">
              <path d="M16.8 7.7a6.2 6.2 0 1 0 0 8.6" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" />
              <circle cx="12" cy="12" r="9.2" fill="none" stroke="currentColor" strokeWidth="1.2" opacity="0.35" />
            </svg>
          </button>
          <span className="sidebar-brand-name">Conser</span>
        </div>
        <nav className="side-nav">
          {NAV.map((item, i) => (
            <button
              key={item.id}
              className={`side-nav-item nav-${item.id} ${view === item.id ? 'active' : ''}`}
              onClick={() => setView(item.id)}
              title={`${t(`nav.${item.id}`)} (Alt+${i + 1})`}
              data-label={t(`nav.${item.id}`)}
            >
              <NavGlyph name={item.icon} />
              <span className="side-nav-label">{t(`nav.${item.id}`)}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-foot">
          <span className={`conn-dot ${connected ? 'ok' : 'bad'}`} role="img" aria-label={connected ? '事件流已连接' : '事件流断开'} title={connected ? '事件流已连接' : lastError ?? '事件流断开'} />
          <span
            className={`conn-dot ${upstreamOk ? 'ok' : 'bad'}`}
            role="img"
            aria-label={upstreamOk ? `opencode ${health?.upstream.version ?? ''} 已连接` : '上游离线'}
            title={upstreamOk ? `opencode ${health?.upstream.version ?? ''}` : health?.upstream.error ?? '上游离线'}
          />
          <span className="sidebar-version">{health ? `v${health.bff.version}` : ''}</span>
        </div>
      </aside>

      <div className="app-body">
        <header className="topbar toolbar">
          <div className="toolbar-leading">
            <WorkspaceMenu />
            <span className="toolbar-divider" />
            <h1 className="toolbar-title">{t(`nav.${view}`)}</h1>
          </div>
          <div className="toolbar-trailing">
            <button
              className="icon-btn toolbar-symbol"
              aria-label={`切换主题，当前${themeMode === 'dark' ? '暗色' : '亮色'}`}
              title={`主题：${themeMode === 'dark' ? '暗色' : '亮色'}`}
              onClick={() => setThemeMode(themeMode === 'dark' ? 'light' : 'dark')}
            >
              {resolvedTheme === 'dark' ? '☾' : '☀'}
            </button>
            {permissionCount > 0 ? <span className="badge badge-warn">{permissionCount} 待授权</span> : null}
            <NotificationCenter />
          </div>
        </header>

        {!upstreamOk && health ? (
          <div className="banner banner-warn global-banner">
            上游 opencode 未连接：{health.upstream.error ?? '未知错误'}。对话不可用；编辑、Git、搜索仍可离线使用。
          </div>
        ) : null}
        {workspace ? null : (
          <div className="banner banner-warn global-banner">尚未选择工作区，请从顶部工作区菜单添加项目路径。</div>
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
      </div>

      {toast ? <div className={`toast toast-${toast.kind}`}>{toast.message}</div> : null}
      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
