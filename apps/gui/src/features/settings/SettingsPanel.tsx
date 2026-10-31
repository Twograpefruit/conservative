import React, { useEffect, useRef, useState } from 'react';
import type { ProbeResult } from '@ocg/protocol';
import { api } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { useNotify, type NotificationSource } from '../notify/notificationStore.js';
import { COMMANDS, bindingConflicts, getBindings, resetBindings, setBinding } from '../../commands/registry.js';

const CAP_INSTALL: Record<string, { action: string; label: string }> = {
  pty: { action: 'node-pty', label: '重建 node-pty' },
  lint: { action: 'pyright', label: '安装 pyright' },
  vcs: { action: 'git', label: '安装 Git' },
  snapshots: { action: 'git', label: '安装 Git' },
};

interface InstallJob {
  id: string;
  action: string;
  status: 'running' | 'done' | 'failed';
  percent: number;
  output: string[];
  code?: number;
}

export function SettingsPanel() {
  const health = useApp((s) => s.health);
  const probe = useApp((s) => s.probe);
  const loadProbe = useApp((s) => s.loadProbe);
  const loadHealth = useApp((s) => s.loadHealth);
  const uiScale = useApp((s) => s.uiScale);
  const setUiScale = useApp((s) => s.setUiScale);
  const textScale = useApp((s) => s.textScale);
  const setTextScale = useApp((s) => s.setTextScale);
  const fontFamily = useApp((s) => s.fontFamily);
  const setFontFamily = useApp((s) => s.setFontFamily);
  const codeFontFamily = useApp((s) => s.codeFontFamily);
  const setCodeFontFamily = useApp((s) => s.setCodeFontFamily);
  const codeFontSize = useApp((s) => s.codeFontSize);
  const setCodeFontSize = useApp((s) => s.setCodeFontSize);
  const resetAppearance = useApp((s) => s.resetAppearance);
  const themeMode = useApp((s) => s.themeMode);
  const setThemeMode = useApp((s) => s.setThemeMode);
  const notify = useApp((s) => s.notify);
  const notifySettings = useNotify((s) => s.settings);
  const setNotifySettings = useNotify((s) => s.setSettings);
  const requestNative = useNotify((s) => s.requestNative);
  const [logs, setLogs] = useState<string[]>([]);
  const [lintEnabled, setLintEnabled] = useState(true);
  const [refreshBusy, setRefreshBusy] = useState(false);
  const [bindings, setBindings] = useState<Record<string, string[]>>(() => getBindings());
  const [conflicts, setConflicts] = useState(() => bindingConflicts());
  const [fontOptions, setFontOptions] = useState<string[]>(['Cascadia Code', 'Consolas', 'Microsoft YaHei', 'Segoe UI', 'SimSun', 'KaiTi']);
  const [fontBusy, setFontBusy] = useState(false);
  const [installJob, setInstallJob] = useState<InstallJob | null>(null);
  const [ocConfigPath, setOcConfigPath] = useState('');
  const [coreJson, setCoreJson] = useState('');
  const [apiJson, setApiJson] = useState('{}');
  const [pluginJson, setPluginJson] = useState('{}');
  const [ocBusy, setOcBusy] = useState(false);
  const [ocPlugins, setOcPlugins] = useState<Array<{ id: string; source?: { type?: string; target?: string; path?: string }; state?: { status?: string; error?: string } }>>([]);
  const fontFile = useRef<HTMLInputElement | null>(null);

  const loadFontFile = async (file: File) => {
    setFontBusy(true);
    try {
      const family = file.name.replace(/\.[^.]+$/, '').replace(/[^\w\u4e00-\u9fa5-]+/g, ' ') || 'Custom Font';
      const buffer = await file.arrayBuffer();
      const face = new FontFace(family, buffer);
      await face.load();
      document.fonts.add(face);
      setFontOptions((prev) => (prev.includes(family) ? prev : [family, ...prev]));
      setFontFamily(`"${family}", "Microsoft YaHei", sans-serif`);
      notify(`已加载字体：${family}`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '字体文件加载失败', 'error');
    } finally {
      setFontBusy(false);
    }
  };

  const loadLocalFonts = async () => {
    const api = (window as unknown as {
      queryLocalFonts?: () => Promise<Array<{ family: string }>>;
    }).queryLocalFonts;
    if (!api) {
      notify('当前浏览器不支持枚举本机字体；可手动选择内置字体', 'error');
      return;
    }
    setFontBusy(true);
    try {
      const list = await api();
      const families = [...new Set(list.map((f) => f.family))].sort((a, b) => a.localeCompare(b));
      setFontOptions(families);
      await Promise.all(families.slice(0, 80).map((family) => document.fonts.load(`13px "${family}"`).catch(() => undefined)));
      notify(`已加载 ${families.length} 个本机字体`);
    } catch (err) {
      notify(err instanceof Error ? err.message : '字体加载失败（可能未授予权限）', 'error');
    } finally {
      setFontBusy(false);
    }
  };

  useEffect(() => {
    void loadHealth();
    void loadProbe(false);
    void api<{ lines: string[] }>('/api/logs/upstream')
      .then((r) => setLogs(r.lines))
      .catch(() => undefined);
    void loadOpenCode();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const loadOpenCode = async () => {
    try {
      const cfg = await api<{ document: { path?: string; info: Record<string, unknown> } | null }>('/api/opencode/config');
      if (cfg.document) {
        setOcConfigPath(cfg.document.path ?? '');
        const info = cfg.document.info ?? {};
        const { providers, plugins, ...rest } = info as Record<string, unknown>;
        setCoreJson(JSON.stringify(rest, null, 2));
        setApiJson(JSON.stringify(providers ?? {}, null, 2));
        setPluginJson(JSON.stringify(plugins ?? {}, null, 2));
      }
      const plugins = await api<{ data: typeof ocPlugins }>('/api/oc/api/plugin');
      setOcPlugins(plugins.data ?? []);
    } catch (err) {
      notify(err instanceof Error ? err.message : 'OpenCode 配置加载失败', 'error');
    }
  };

  const saveOpenCode = async () => {
    setOcBusy(true);
    try {
      const core = JSON.parse(coreJson) as Record<string, unknown>;
      const providers = JSON.parse(apiJson) as unknown;
      const plugins = JSON.parse(pluginJson) as unknown;
      const info: Record<string, unknown> = { ...core };
      if (providers && (Array.isArray(providers) ? providers.length : Object.keys(providers as object).length)) {
        info.providers = providers;
      } else {
        delete info.providers;
      }
      if (plugins && (Array.isArray(plugins) ? plugins.length : Object.keys(plugins as object).length)) {
        info.plugins = plugins;
      } else {
        delete info.plugins;
      }
      await api('/api/opencode/config', {
        method: 'PUT',
        body: JSON.stringify({ info }),
        headers: { 'content-type': 'application/json' },
      });
      notify('服务配置已保存；重启 opencode 后生效');
    } catch (err) {
      notify(err instanceof Error ? err.message : '服务配置保存失败（JSON 格式？）', 'error');
    } finally {
      setOcBusy(false);
    }
  };

  const pluginAction = async (kind: 'check' | 'update', id?: string) => {
    setOcBusy(true);
    try {
      if (kind === 'check') {
        await api('/api/oc/api/plugin/check', { method: 'POST' });
        notify('插件更新检查完成');
      } else if (id) {
        await api('/api/oc/api/plugin/update', {
          method: 'POST',
          body: JSON.stringify({ targets: [id] }),
          headers: { 'content-type': 'application/json' },
        });
        notify(`已更新插件 ${id}`);
      }
      await loadOpenCode();
    } catch (err) {
      notify(err instanceof Error ? err.message : '插件操作失败', 'error');
    } finally {
      setOcBusy(false);
    }
  };

  const pollInstall = async (id: string) => {
    try {
      const job = await api<InstallJob>(`/api/system/install/${id}`);
      setInstallJob(job);
      if (job.status === 'running') {
        window.setTimeout(() => void pollInstall(id), 900);
      } else {
        setRefreshBusy(true);
        try {
          await loadProbe(true);
          await loadHealth();
        } finally {
          setRefreshBusy(false);
        }
        notify(job.status === 'done' ? '安装完成，能力已重新探测' : '安装失败，请查看输出', job.status === 'done' ? 'info' : 'error');
      }
    } catch (err) {
      notify(err instanceof Error ? err.message : '安装状态获取失败', 'error');
    }
  };

  const startInstall = async (capKey: string) => {
    const target = CAP_INSTALL[capKey];
    if (!target) return;
    setRefreshBusy(true);
    try {
      const res = await api<{ id: string; label: string }>('/api/system/install', {
        method: 'POST',
        body: JSON.stringify({ action: target.action }),
        headers: { 'content-type': 'application/json' },
      });
      setInstallJob({
        id: res.id,
        action: target.action,
        status: 'running',
        percent: 5,
        output: [`开始：${res.label}`],
      });
      void pollInstall(res.id);
    } catch (err) {
      notify(err instanceof Error ? err.message : '安装启动失败', 'error');
    } finally {
      setRefreshBusy(false);
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
        <section className="settings-card notify-settings">
          <h3>通知</h3>
          <div className="settings-group-title">通道</div>
          <div className="switch-grid">
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notifySettings.enabled}
                onChange={(e) => setNotifySettings({ enabled: e.target.checked })}
              />
              <span>
                <strong>启用通知</strong>
                <small>关闭后不再产生新通知</small>
              </span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notifySettings.native}
                onChange={(e) => {
                  if (e.target.checked) void requestNative();
                  else setNotifySettings({ native: false });
                }}
              />
              <span>
                <strong>系统通知</strong>
                <small>窗口失焦时使用 Windows/浏览器通知</small>
              </span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notifySettings.flashTitle}
                onChange={(e) => setNotifySettings({ flashTitle: e.target.checked })}
              />
              <span>
                <strong>标题闪烁</strong>
                <small>失焦时在标题显示未读计数</small>
              </span>
            </label>
            <label className="switch-row">
              <input
                type="checkbox"
                checked={notifySettings.privacy}
                onChange={(e) => setNotifySettings({ privacy: e.target.checked })}
              />
              <span>
                <strong>隐私模式</strong>
                <small>隐藏通知正文，只显示类型</small>
              </span>
            </label>
          </div>

          <div className="settings-group-title">免打扰</div>
          <div className="quiet-row">
            <label className="switch-row compact">
              <input
                type="checkbox"
                checked={notifySettings.quietHours.enabled}
                onChange={(e) =>
                  setNotifySettings({
                    quietHours: { ...notifySettings.quietHours, enabled: e.target.checked },
                  })
                }
              />
              <span>启用时段</span>
            </label>
            <div className="quiet-times">
              <input
                className="input notify-time"
                type="time"
                value={notifySettings.quietHours.start}
                onChange={(e) =>
                  setNotifySettings({ quietHours: { ...notifySettings.quietHours, start: e.target.value } })
                }
              />
              <span className="muted">至</span>
              <input
                className="input notify-time"
                type="time"
                value={notifySettings.quietHours.end}
                onChange={(e) =>
                  setNotifySettings({ quietHours: { ...notifySettings.quietHours, end: e.target.value } })
                }
              />
            </div>
          </div>

          <div className="settings-group-title">静音来源</div>
          <div className="mute-chips">
            {(['chat', 'git', 'data', 'terminal', 'system'] as NotificationSource[]).map((source) => (
              <label className={`mute-chip ${notifySettings.muteSources.includes(source) ? 'active' : ''}`} key={source}>
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

        <section className="settings-card shortcuts-settings">
          <h3>快捷键</h3>
          <div className="keybinding-list">
            {COMMANDS.map((cmd) => (
              <div className="keybinding-row" key={cmd.id}>
                <div className="keybinding-info">
                  <span className="keybinding-title">{cmd.title}</span>
                  <span className="keybinding-id">
                    {cmd.id} · {cmd.scope}
                  </span>
                </div>
                <input
                  className="input keybinding-input"
                  value={(bindings[cmd.id] ?? []).join(', ')}
                  onChange={(e) =>
                    setBindings({ ...bindings, [cmd.id]: e.target.value.split(',').map((s) => s.trim()) })
                  }
                  onBlur={() => {
                    const keys = (bindings[cmd.id] ?? []).filter(Boolean);
                    setBinding(cmd.id, keys);
                    setConflicts(bindingConflicts());
                  }}
                  placeholder="例如 Ctrl+Shift+P"
                />
                <button
                  className="icon-btn"
                  title="清除该快捷键"
                  onClick={() => {
                    setBinding(cmd.id, []);
                    setBindings(getBindings());
                    setConflicts(bindingConflicts());
                  }}
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          {conflicts.length ? (
            <div className="banner banner-warn">
              键位冲突：
              {conflicts.map((c) => `${c.key} → ${c.commands.join(' / ')}`).join('；')}
            </div>
          ) : null}
          <div className="row">
            <span className="muted small">修改后失去焦点即保存；多个键位用逗号分隔。</span>
            <span className="spacer" />
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
          </div>
        </section>

        <div className="settings-break break-one" />

        <section className="settings-card editor-settings">
          <h3>环境诊断</h3>
          <label className="row">
            <input type="checkbox" checked={lintEnabled} onChange={(e) => void saveLint(e.target.checked)} /> 保存后运行
            pyright / ruff
          </label>
          <div className="muted small">
            诊断来自本机 pyright CLI；opencode 侧 LSP 诊断不经过本 GUI。GB18030 文件可在编辑器工具栏转换为 UTF-8，替换时跳过非 UTF-8 文件。
          </div>
          <div className="kv">
            <span>上游模式</span>
            <span>{health?.upstream.mode ?? '-'}</span>
            <span>符号链接/长路径</span>
            <span>由 WindowsLocalHost 统一处理</span>
          </div>
          <div className="settings-group-title">能力与依赖</div>
          <div className="caps">
            {caps
              ? Object.entries(caps).map(([k, v]) => (
                  <div key={k} className={`cap-item ${v ? 'cap-ok' : 'cap-no'}`}>
                    <span className="cap-name">{k}</span>
                    <span>{v ? '可用' : '缺失'}</span>
                    {CAP_INSTALL[k] ? (
                      <button
                        className={`btn btn-tiny ${v ? '' : 'btn-primary'}`}
                        disabled={refreshBusy || installJob?.status === 'running'}
                        onClick={() => void startInstall(k)}
                        title={v ? `重新执行：${CAP_INSTALL[k].label}` : CAP_INSTALL[k].label}
                      >
                        {v ? '重装' : CAP_INSTALL[k].label}
                      </button>
                    ) : null}
                  </div>
                ))
              : null}
          </div>
          {installJob ? (
            <div className="install-progress">
              <div className="install-head">
                <span>{installJob.action}</span>
                <span>{installJob.percent}%</span>
                <span className={installJob.status === 'failed' ? 'text-error' : 'muted'}>{installJob.status}</span>
              </div>
              <div className="progress-track">
                <div className="progress-fill" style={{ width: `${installJob.percent}%` }} />
              </div>
              <pre className="log-tail install-log">{installJob.output.slice(-8).join('\n')}</pre>
            </div>
          ) : null}
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

        <section className="settings-card settings-wide oc-config">
          <h3>服务配置</h3>
          <div className="oc-config-head">
            <span className="muted small">{ocConfigPath || '未找到 opencode.json 配置文档'}</span>
            <span className="spacer" />
            <button className="btn btn-small" onClick={() => void loadOpenCode()} disabled={ocBusy}>
              重新加载
            </button>
            <button className="btn btn-small" onClick={() => void pluginAction('check')} disabled={ocBusy || !ocConfigPath}>
              检查插件更新
            </button>
            <button className="btn btn-small btn-primary" onClick={() => void saveOpenCode()} disabled={ocBusy || !ocConfigPath}>
              保存全部
            </button>
          </div>
          <div className="service-blocks">
            <section className="service-block">
              <div className="service-block-head">
                <h4>配置</h4>
                <span className="muted small">shell、模型、MCP、agents、权限</span>
              </div>
              <textarea
                className="input oc-json"
                spellCheck={false}
                value={coreJson}
                onChange={(e) => setCoreJson(e.target.value)}
                placeholder='{ "shell": "...", "mcp": {...} }'
              />
            </section>
            <section className="service-block">
              <div className="service-block-head">
                <h4>API</h4>
                <span className="muted small">providers 与自定义 API 地址 / 凭据引用</span>
              </div>
              <textarea
                className="input oc-json"
                spellCheck={false}
                value={apiJson}
                onChange={(e) => setApiJson(e.target.value)}
                placeholder='{ "providers": { "name": { "settings": { "baseURL": "..." } } } }'
              />
            </section>
            <section className="service-block">
              <div className="service-block-head">
                <h4>插件</h4>
                <span className="muted small">已加载 {ocPlugins.length} 个 · 可直接编辑 plugins 配置</span>
              </div>
              <div className="oc-plugins">
                {ocPlugins.length === 0 ? <span className="muted small">没有已加载插件</span> : null}
                {ocPlugins.map((plugin) => {
                  const outdated = (plugin.source as { outdated?: boolean })?.outdated;
                  return (
                    <div className="oc-plugin" key={plugin.id}>
                      <span className="chip">{plugin.source?.type ?? 'plugin'}</span>
                      <span className="oc-plugin-name">{plugin.id}</span>
                      <span className={plugin.state?.status === 'active' ? 'text-ok' : 'text-error'}>
                        {plugin.state?.status ?? 'unknown'}
                      </span>
                      {outdated ? (
                        <button className="btn btn-tiny btn-primary" onClick={() => void pluginAction('update', plugin.id)} disabled={ocBusy}>
                          更新
                        </button>
                      ) : null}
                    </div>
                  );
                })}
              </div>
              <textarea
                className="input oc-json"
                spellCheck={false}
                value={pluginJson}
                onChange={(e) => setPluginJson(e.target.value)}
                placeholder='{ "plugins": [...], "plugin": [...] }'
              />
            </section>
          </div>
          <div className="muted small">
            三个区块分别写入同一份 opencode.json；保存前自动备份为
            <code> .ocg-backup-时间戳</code>，重启 opencode 后生效。
          </div>
        </section>

        <section className="settings-card appearance-settings">
          <h3>外观与字体</h3>
          <div className="appearance-row">
            <div className="appearance-label">
              <strong>界面大小</strong>
              <small>整体布局，50–250%</small>
            </div>
            <div className="appearance-control">
              <button className="btn btn-small" onClick={() => setUiScale(uiScale - 0.05)} disabled={uiScale <= 0.5}>
                UI-
              </button>
              <input
                type="range"
                min={0.5}
                max={2.5}
                step={0.05}
                value={uiScale}
                onChange={(e) => setUiScale(Number(e.target.value))}
              />
              <button className="btn btn-small" onClick={() => setUiScale(uiScale + 0.05)} disabled={uiScale >= 2.5}>
                UI+
              </button>
              <div className="scale-box">
                <input
                  className="input scale-number"
                  type="number"
                  min={50}
                  max={250}
                  step={5}
                  value={Math.round(uiScale * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setUiScale(v / 100);
                  }}
                />
                <span>%</span>
              </div>
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-label">
              <strong>文字大小</strong>
              <small>正文/编辑器/终端，60–300%</small>
            </div>
            <div className="appearance-control">
              <button className="btn btn-small" onClick={() => setTextScale(textScale - 0.05)} disabled={textScale <= 0.6}>
                A-
              </button>
              <input
                type="range"
                min={0.6}
                max={3}
                step={0.05}
                value={textScale}
                onChange={(e) => setTextScale(Number(e.target.value))}
              />
              <button className="btn btn-small" onClick={() => setTextScale(textScale + 0.05)} disabled={textScale >= 3}>
                A+
              </button>
              <div className="scale-box">
                <input
                  className="input scale-number"
                  type="number"
                  min={60}
                  max={300}
                  step={5}
                  value={Math.round(textScale * 100)}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) setTextScale(v / 100);
                  }}
                />
                <span>%</span>
              </div>
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-label">
              <strong>字体</strong>
              <small>界面与正文优先字体</small>
            </div>
            <div className="appearance-control font-control">
              <select
                className="input grow"
                value={fontFamily}
                onChange={(e) => setFontFamily(e.target.value)}
                title="界面与正文优先使用的字体"
              >
                <option value="">默认（Segoe UI / 微软雅黑）</option>
                {fontOptions.map((f) => (
                  <option key={f} value={`"${f}", "Microsoft YaHei", sans-serif`}>
                    {f}
                  </option>
                ))}
              </select>
              <button className="btn btn-small" onClick={() => void loadLocalFonts()} disabled={fontBusy}>
                {fontBusy ? '加载中…' : '加载本机字体'}
              </button>
              <input
                ref={fontFile}
                type="file"
                accept=".ttf,.otf,.woff,.woff2"
                hidden
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void loadFontFile(file);
                  e.target.value = '';
                }}
              />
              <button className="btn btn-small" onClick={() => fontFile.current?.click()} disabled={fontBusy}>
                加载字体文件
              </button>
              <button
                className="btn btn-small"
                onClick={() => {
                  resetAppearance();
                  notify('已重置界面、文字与字体为默认');
                }}
              >
                重置默认
              </button>
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-label">
              <strong>代码字体</strong>
              <small>只影响编辑器与代码块</small>
            </div>
            <div className="appearance-control font-control">
              <select
                className="input grow"
                value={codeFontFamily}
                onChange={(e) => setCodeFontFamily(e.target.value)}
                title="代码字体"
              >
                <option value="'Cascadia Code', Consolas, monospace">Cascadia Code</option>
                <option value="Consolas, monospace">Consolas</option>
                <option value="'JetBrains Mono', Consolas, monospace">JetBrains Mono</option>
                <option value="'Fira Code', Consolas, monospace">Fira Code</option>
                <option value="'Microsoft YaHei Mono', Consolas, monospace">微软雅黑等宽</option>
              </select>
              <label className="code-size-box">
                字号
                <input
                  className="input scale-number"
                  type="number"
                  min={10}
                  max={24}
                  step={1}
                  value={codeFontSize}
                  onChange={(e) => setCodeFontSize(Number(e.target.value))}
                />
                px
              </label>
            </div>
          </div>

          <div className="appearance-row">
            <div className="appearance-label">
              <strong>主题</strong>
              <small>暗色 / 亮色 / 跟随系统</small>
            </div>
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
          <div className="muted small">界面大小实时跟随窗口可视区域缩放；文字放大时控件会自动换行和增高，不再挤压边框。</div>
        </section>

        <div className="settings-break break-two" />

        <section className="settings-card settings-wide logs-settings">
          <h3>运行状态与上游日志</h3>
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
          <div className="settings-group-title">日志</div>
          <pre className="log-tail">{logs.join('\n') || '暂无日志'}</pre>
        </section>
      </div>
    </div>
  );
}
