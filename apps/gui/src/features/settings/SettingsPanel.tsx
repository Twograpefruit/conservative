import React, { useEffect, useState } from 'react';
import type { ProbeResult, WorkspaceInfo } from '@ocg/protocol';
import { api } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { useNotify, type NotificationSource } from '../notify/notificationStore.js';
import { COMMANDS, bindingConflicts, getBindings, resetBindings, setBinding } from '../../commands/registry.js';

export function SettingsPanel() {
  const health = useApp((s) => s.health);
  const probe = useApp((s) => s.probe);
  const workspaces = useApp((s) => s.workspaces);
  const workspaceID = useApp((s) => s.workspaceID);
  const loadProbe = useApp((s) => s.loadProbe);
  const loadWorkspaces = useApp((s) => s.loadWorkspaces);
  const loadHealth = useApp((s) => s.loadHealth);
  const setWorkspace = useApp((s) => s.setWorkspace);
  const uiScale = useApp((s) => s.uiScale);
  const setUiScale = useApp((s) => s.setUiScale);
  const textScale = useApp((s) => s.textScale);
  const setTextScale = useApp((s) => s.setTextScale);
  const themeMode = useApp((s) => s.themeMode);
  const setThemeMode = useApp((s) => s.setThemeMode);
  const notify = useApp((s) => s.notify);
  const notifySettings = useNotify((s) => s.settings);
  const setNotifySettings = useNotify((s) => s.setSettings);
  const requestNative = useNotify((s) => s.requestNative);
  const [logs, setLogs] = useState<string[]>([]);
  const [newPath, setNewPath] = useState('');
  const [lintEnabled, setLintEnabled] = useState(true);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [bindings, setBindings] = useState<Record<string, string[]>>(() => getBindings());
  const [conflicts, setConflicts] = useState(() => bindingConflicts());

  useEffect(() => {
    void loadHealth();
    void loadProbe(false);
    void api<{ lines: string[] }>('/api/logs/upstream')
      .then((r) => setLogs(r.lines))
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const addWorkspace = async () => {
    if (!newPath.trim()) return;
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
      notify(err instanceof Error ? err.message : '添加失败', 'error');
    }
  };

  const removeWorkspace = async (id: string) => {
    if (!window.confirm('移除该工作区（不会删除磁盘文件）？')) return;
    try {
      await api(`/api/workspaces/${id}`, { method: 'DELETE' });
      await loadWorkspaces();
    } catch (err) {
      notify(err instanceof Error ? err.message : '移除失败', 'error');
    }
  };

  const saveLint = async (enabled: boolean) => {
    setLintEnabled(enabled);
    try {
      await api('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({ lint: { enabled } }),
        headers: { 'content-type': 'application/json' },
      });
      notify('设置已保存');
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
    }
  };

  const caps = probe?.capabilities;
  const mem = health ? health.bff.memory / 1024 / 1024 : 0;

  return (
    <div className="settings-layout">
      <div className="settings-grid">
        <section className="settings-card">
          <h3>通知</h3>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notifySettings.enabled}
              onChange={(e) => setNotifySettings({ enabled: e.target.checked })}
            />
            启用通知（关闭后不再产生新通知）
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notifySettings.native}
              onChange={(e) => {
                if (e.target.checked) void requestNative();
                else setNotifySettings({ native: false });
              }}
            />
            Windows / 浏览器系统通知（窗口失焦时）
          </label>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={notifySettings.privacy}
              onChange={(e) => setNotifySettings({ privacy: e.target.checked })}
            />
            隐私模式：通知正文隐藏，仅显示“有一条新通知”
          </label>
          <div className="checkbox-row">
            <input
              id="quiet-hours"
              type="checkbox"
              checked={notifySettings.quietHours.enabled}
              onChange={(e) =>
                setNotifySettings({
                  quietHours: { ...notifySettings.quietHours, enabled: e.target.checked },
                })
              }
            />
            <label htmlFor="quiet-hours">免打扰时段</label>
            <input
              className="input notify-time"
              type="time"
              value={notifySettings.quietHours.start}
              onChange={(e) =>
                setNotifySettings({ quietHours: { ...notifySettings.quietHours, start: e.target.value } })
              }
            />
            <span className="muted small">至</span>
            <input
              className="input notify-time"
              type="time"
              value={notifySettings.quietHours.end}
              onChange={(e) =>
                setNotifySettings({ quietHours: { ...notifySettings.quietHours, end: e.target.value } })
              }
            />
          </div>
          <div className="row wrap">
            <span className="muted small">静音来源</span>
            {(['chat', 'git', 'data', 'terminal', 'system'] as NotificationSource[]).map((source) => (
              <label className="checkbox-row" key={source}>
                <input
                  type="checkbox"
                  checked={notifySettings.muteSources.includes(source)}
                  onChange={(e) =>
                    setNotifySettings({
                      muteSources: e.target.checked
                        ? [...notifySettings.muteSources, source]
                        : notifySettings.muteSources.filter((s) => s !== source),
                    })
                  }
                />
                {source}
              </label>
            ))}
          </div>
          <div className="muted small">窗口聚焦时只弹应用内 toast；失焦时按权限走系统通知；3 秒内同源事件聚合。</div>
        </section>

        <section className="settings-card">
          <h3>快捷键</h3>
          <div className="keybinding-list">
            {COMMANDS.map((cmd) => (
              <div className="keybinding-row" key={cmd.id}>
                <span className="keybinding-title" title={cmd.id}>
                  {cmd.title}
                </span>
                <input
                  className="input keybinding-input"
                  value={(bindings[cmd.id] ?? []).join(', ')}
                  onChange={(e) => setBindings({ ...bindings, [cmd.id]: e.target.value.split(',').map((s) => s.trim()) })}
                  onBlur={() => {
                    const keys = (bindings[cmd.id] ?? []).filter(Boolean);
                    setBinding(cmd.id, keys);
                    setConflicts(bindingConflicts());
                  }}
                  placeholder="例如 Ctrl+Shift+P"
                />
              </div>
            ))}
          </div>
          {conflicts.length ? (
            <div className="banner banner-warn">
              键位冲突：
              {conflicts.map((c) => `${c.key} → ${c.commands.join(' / ')}`).join('；')}
            </div>
          ) : null}
          <button
            className="btn btn-small"
            onClick={() => {
              resetBindings();
              setBindings(getBindings());
              setConflicts(bindingConflicts());
              notify('已重置快捷键');
            }}
          >
            重置为默认
          </button>
        </section>

        <section className="settings-card">
          <h3>运行状态</h3>
          <div className="kv">
            <span>BFF</span>
            <span className={health?.ok ? 'text-ok' : 'text-error'}>
              {health ? `v${health.bff.version} · pid ${health.bff.pid} · ${health.bff.port}` : '不可用'}
            </span>
            <span>运行时长</span>
            <span>{health ? `${health.bff.uptime}s` : '-'}</span>
            <span>内存 (RSS)</span>
            <span>{mem.toFixed(1)} MB</span>
            <span>上游</span>
            <span className={health?.upstream.healthy ? 'text-ok' : 'text-error'}>
              {health?.upstream.healthy
                ? `${health.upstream.mode} · v${health.upstream.version ?? '?'} · ${health.upstream.url}`
                : health?.upstream.error ?? '离线'}
            </span>
            <span>事件流</span>
            <span>
              {health?.eventBus.connected ? '已连接' : '断开'} · 缓冲 {health?.eventBus.buffered ?? 0} · seq {health?.eventBus.lastSeq ?? 0} · 客户端{' '}
              {health?.eventBus.clients ?? 0}
            </span>
          </div>
        </section>

        <section className="settings-card">
          <h3>能力探测（M0/T0.6）</h3>
          <div className="caps">
            {caps
              ? Object.entries(caps).map(([k, v]) => (
                  <span key={k} className={`cap ${v ? 'cap-ok' : 'cap-no'}`}>
                    {k}: {v ? '可用' : '缺失'}
                  </span>
                ))
              : null}
          </div>
          {probe?.hints.length ? (
            <ul className="hints">
              {probe.hints.map((h, i) => (
                <li key={i}>{h}</li>
              ))}
            </ul>
          ) : null}
          {probe ? (
            <div className="probe-meta">
              <span>规范 v{probe.spec.version ?? '?'}</span>
              <span>{probe.events.ok ? `事件 ${probe.events.contentType ?? ''}` : '事件不可用'}</span>
              <span>{probe.events.heartbeat ? '心跳正常' : '无心跳'}</span>
            </div>
          ) : null}
          <button
            className="btn btn-small"
            disabled={refreshBusy}
            onClick={async () => {
              setRefreshBusy(true);
              try {
                await loadProbe(true);
                await loadHealth();
              } finally {
                setRefreshBusy(false);
              }
            }}
          >
            重新探测
          </button>
        </section>

        <section className="settings-card">
          <h3>工作区</h3>
          <div className="workspace-list">
            {workspaces.map((w) => (
              <div key={w.id} className={`workspace-row ${w.id === workspaceID ? 'active' : ''}`}>
                <button className="workspace-main" onClick={() => setWorkspace(w.id)}>
                  <span className="workspace-label">{w.label}</span>
                  <span className="workspace-path">{w.path}</span>
                  <span className="muted">{w.venv ? `venv: ${w.venv}` : '未检测到 venv'}</span>
                </button>
                <button className="btn btn-tiny btn-danger" onClick={() => void removeWorkspace(w.id)}>
                  移除
                </button>
              </div>
            ))}
          </div>
          <div className="row">
            <input className="input grow" placeholder="C:\\path\\to\\project" value={newPath} onChange={(e) => setNewPath(e.target.value)} />
            <button className="btn btn-small btn-primary" onClick={() => void addWorkspace()}>
              添加
            </button>
          </div>
        </section>

        <section className="settings-card">
          <h3>界面大小与文字大小</h3>
          <div className="font-scale-row">
            <span className="muted small">界面</span>
            <button className="btn btn-small" onClick={() => setUiScale(uiScale - 0.05)} disabled={uiScale <= 0.8}>
              UI-
            </button>
            <input
              type="range"
              min={0.8}
              max={1.3}
              step={0.05}
              value={uiScale}
              onChange={(e) => setUiScale(Number(e.target.value))}
            />
            <button className="btn btn-small" onClick={() => setUiScale(uiScale + 0.05)} disabled={uiScale >= 1.3}>
              UI+
            </button>
            <span className="badge">{Math.round(uiScale * 100)}%</span>
          </div>
          <div className="font-scale-row">
            <span className="muted small">文字</span>
            <button className="btn btn-small" onClick={() => setTextScale(textScale - 0.05)} disabled={textScale <= 0.85}>
              A-
            </button>
            <input
              type="range"
              min={0.85}
              max={1.25}
              step={0.05}
              value={textScale}
              onChange={(e) => setTextScale(Number(e.target.value))}
            />
            <button className="btn btn-small" onClick={() => setTextScale(textScale + 0.05)} disabled={textScale >= 1.25}>
              A+
            </button>
            <span className="badge">{Math.round(textScale * 100)}%</span>
          </div>
          <div className="row">
            <span className="muted small">主题</span>
            <div className="segmented">
              <button className={themeMode === 'dark' ? 'active' : ''} onClick={() => setThemeMode('dark')}>
                暗色
              </button>
              <button className={themeMode === 'light' ? 'active' : ''} onClick={() => setThemeMode('light')}>
                亮色
              </button>
              <button className={themeMode === 'system' ? 'active' : ''} onClick={() => setThemeMode('system')}>
                跟随系统
              </button>
            </div>
          </div>
          <div className="muted small">界面大小改变整体布局；文字大小只调整正文/编辑器字号。偏好保存在本机浏览器。</div>
        </section>

        <section className="settings-card">
          <h3>编辑与诊断</h3>
          <label className="row">
            <input type="checkbox" checked={lintEnabled} onChange={(e) => void saveLint(e.target.checked)} /> 保存后运行
            pyright / ruff
          </label>
          <div className="muted small">
            诊断来自本机 pyright CLI；opencode 侧 LSP 诊断不经过本 GUI。非 UTF-8 文件默认只读，替换时跳过。
          </div>
          <div className="kv">
            <span>上游模式</span>
            <span>{health?.upstream.mode ?? '-'}</span>
            <span>能力（终端）</span>
            <span>{caps?.pty ? '上游 PTY 可用' : '不可用'}</span>
            <span>符号链接/长路径</span>
            <span>由 WindowsLocalHost 统一处理</span>
          </div>
        </section>

        <section className="settings-card settings-wide">
          <h3>上游日志（末尾）</h3>
          <pre className="log-tail">{logs.join('\n') || '暂无日志'}</pre>
        </section>
      </div>
    </div>
  );
}
