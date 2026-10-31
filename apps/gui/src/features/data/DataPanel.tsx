import React, { useEffect, useMemo, useRef, useState } from 'react';
import type {
  ConnectionKind,
  ConnectionProfile,
  DbMetadata,
  DbQueryResult,
  DbTableInfo,
  RedisScanResult,
  RedisValue,
} from '@ocg/protocol';
import { api, qs } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';
import { useNotify } from '../notify/notificationStore.js';
import { Icon } from '../../components/icon/Icon.js';

interface FormState {
  id?: string;
  kind: ConnectionKind;
  label: string;
  file: string;
  host: string;
  port: string;
  database: string;
  user: string;
  secret: string;
  readOnly: boolean;
  rowLimit: string;
  timeoutMs: string;
}

const emptyForm = (): FormState => ({
  kind: 'sqlite',
  label: '',
  file: '',
  host: '127.0.0.1',
  port: '6379',
  database: '0',
  user: '',
  secret: '',
  readOnly: true,
  rowLimit: '500',
  timeoutMs: '5000',
});

function toForm(p: ConnectionProfile): FormState {
  return {
    id: p.id,
    kind: p.kind,
    label: p.label,
    file: p.file ?? '',
    host: p.host ?? '127.0.0.1',
    port: String(p.port ?? (p.kind === 'redis' ? 6379 : p.kind === 'mysql' ? 3306 : 5432)),
    database: p.database ?? '',
    user: p.user ?? '',
    secret: '',
    readOnly: p.readOnly,
    rowLimit: String(p.rowLimit),
    timeoutMs: String(p.timeoutMs),
  };
}

function valueText(v: unknown): string {
  if (v == null) return 'NULL';
  if (typeof v === 'string') return v;
  if (typeof v === 'object') {
    const any = v as { __binary?: string };
    if (any.__binary) return `<binary ${any.__binary.length} base64 chars>`;
    return JSON.stringify(v);
  }
  return String(v);
}

export function DataPanel() {
  const notify = useApp((s) => s.notify);
  const pendingSql = useApp((s) => s.pendingSql);
  const consumeSql = useApp((s) => s.consumeSql);
  const [profiles, setProfiles] = useState<ConnectionProfile[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [metadata, setMetadata] = useState<DbMetadata | null>(null);
  const [table, setTable] = useState<string | null>(null);
  const [schemaFilter, setSchemaFilter] = useState('');
  const [collapsedSchemas, setCollapsedSchemas] = useState<Record<string, boolean>>({});
  const [sql, setSql] = useState('SELECT 1 AS ok');
  const [paramsText, setParamsText] = useState('[]');
  const [result, setResult] = useState<DbQueryResult | null>(null);
  const [resultScrollTop, setResultScrollTop] = useState(0);
  const [resultViewH, setResultViewH] = useState(560);
  const [resultSearch, setResultSearch] = useState('');
  const [searchField, setSearchField] = useState('');
  const [resultFilter, setResultFilter] = useState('');
  const [filterField, setFilterField] = useState('');
  const resultScroll = useRef<HTMLDivElement | null>(null);
  const ROW_H = 24;

  const [pattern, setPattern] = useState('*');
  const [scan, setScan] = useState<RedisScanResult | null>(null);
  const [redisValue, setRedisValue] = useState<RedisValue | null>(null);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [command, setCommand] = useState('PING');
  const [commandResult, setCommandResult] = useState<string | null>(null);
  const [channel, setChannel] = useState('');
  const [messages, setMessages] = useState<string[]>([]);
  const subRef = useRef<EventSource | null>(null);

  const selected = profiles.find((p) => p.id === selectedId) ?? null;

  const loadProfiles = async () => {
    try {
      const list = await api<ConnectionProfile[]>('/api/connections');
      setProfiles(list);
      setSelectedId((id) => id ?? list[0]?.id ?? null);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setLoaded(true);
    }
  };

  useEffect(() => {
    void loadProfiles();
    return () => subRef.current?.close();
  }, []);

  useEffect(() => {
    if (!selected) {
      setMetadata(null);
      setResult(null);
      setScan(null);
      setRedisValue(null);
      return;
    }
    setError(null);
    setResult(null);
    setScan(null);
    setRedisValue(null);
    setSelectedKey(null);
    setTable(null);
    setMessages([]);
    subRef.current?.close();
    if (selected.kind === 'sqlite' || selected.kind === 'mysql') {
      void api<DbMetadata>(`/api/db/metadata${qs({ profileId: selected.id })}`)
        .then(setMetadata)
        .catch((err) => setError(err instanceof Error ? err.message : String(err)));
    }
  }, [selectedId, selected?.kind]);

  useEffect(() => {
    setSchemaFilter('');
    setCollapsedSchemas({});
  }, [metadata]);

  const saveProfile = async () => {
    if (!form) return;
    setBusy(true);
    setError(null);
    try {
      const body = {
        label: form.label,
        kind: form.kind,
        file: form.kind === 'sqlite' ? form.file : undefined,
        host: form.kind !== 'sqlite' ? form.host : undefined,
        port: form.kind !== 'sqlite' ? Number(form.port) || undefined : undefined,
        database: form.kind !== 'sqlite' ? form.database : undefined,
        user: form.kind !== 'sqlite' ? form.user : undefined,
        secret: form.secret || undefined,
        readOnly: form.readOnly,
        rowLimit: Number(form.rowLimit) || 500,
        timeoutMs: Number(form.timeoutMs) || 5000,
      };
      const saved = form.id
        ? await api<ConnectionProfile>(`/api/connections/${form.id}`, {
            method: 'PUT',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          })
        : await api<ConnectionProfile>('/api/connections', {
            method: 'POST',
            body: JSON.stringify(body),
            headers: { 'content-type': 'application/json' },
          });
      setForm(null);
      await loadProfiles();
      setSelectedId(saved.id);
      notify('连接档案已保存（密码仅进入 DPAPI 凭据存储）');
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存连接失败');
    } finally {
      setBusy(false);
    }
  };

  const testProfile = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ ok: boolean; version?: string; info?: string }>('/api/connections/test', {
        method: 'POST',
        body: JSON.stringify({ id: selected.id }),
        headers: { 'content-type': 'application/json' },
      });
      notify(`连接成功${res.info ? ` · ${res.info}` : res.version ? ` · ${res.version}` : ''}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : '连接测试失败');
    } finally {
      setBusy(false);
    }
  };

  const deleteProfile = async () => {
    if (!selected || !window.confirm(`删除连接“${selected.label}”？`)) return;
    try {
      await api(`/api/connections/${selected.id}`, { method: 'DELETE' });
      setSelectedId(null);
      await loadProfiles();
      notify('连接已删除');
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除失败');
    }
  };

  const runQuery = async (override?: string) => {
    if (!selected || (selected.kind !== 'sqlite' && selected.kind !== 'mysql')) return;
    const query = (override ?? sql).trim();
    if (!query) return;
    let params: unknown[] = [];
    try {
      const parsed = JSON.parse(paramsText || '[]');
      if (!Array.isArray(parsed)) throw new Error('params 必须是 JSON 数组');
      params = parsed;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'params 不是合法 JSON 数组');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await api<DbQueryResult>('/api/db/query', {
        method: 'POST',
        body: JSON.stringify({ profileId: selected.id, sql: query, params }),
        headers: { 'content-type': 'application/json' },
      });
      setResult(res);
      useNotify.getState().push({
        source: 'data',
        level: 'info',
        title: `${selected.label} 查询完成`,
        body: `${res.kind === 'read' ? `${res.rowCount} 行` : `changes ${res.changes ?? 0}`} · ${res.durationMs}ms`,
        dedupKey: `data:${selected.id}:query`,
        view: 'data',
        profileId: selected.id,
      });
      if (res.kind === 'write') {
        notify(`执行成功，changes=${res.changes ?? 0}，耗时 ${res.durationMs}ms`);
        void api<DbMetadata>(`/api/db/metadata${qs({ profileId: selected.id })}`).then(setMetadata).catch(() => undefined);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '查询失败');
      useNotify.getState().push({
        source: 'data',
        level: 'error',
        title: `${selected.label} 查询失败`,
        body: err instanceof Error ? err.message : '查询失败',
        dedupKey: `data:${selected.id}:error`,
        view: 'data',
        profileId: selected.id,
      });
    } finally {
      setBusy(false);
    }
  };

  const openTable = (name: string) => {
    setTable(name);
    const dot = name.indexOf('.');
    if (dot > 0) {
      const schema = name.slice(0, dot);
      setCollapsedSchemas((prev) => ({ ...prev, [schema]: false }));
    }
    const quoted =
      selected?.kind === 'mysql'
        ? name.split('.').map((part) => `\`${part.replace(/`/g, '``')}\``).join('.')
        : `"${name.replace(/"/g, '""')}"`;
    const q = `SELECT * FROM ${quoted} LIMIT 100`;
    setSql(q);
    void runQuery(q);
  };

  const exportResult = async (format: 'csv' | 'json') => {
    if (!selected) return;
    try {
      const res = await fetch('/api/db/export', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ profileId: selected.id, sql, format }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `${selected.label.replace(/[^\w.-]+/g, '_')}-export.${format}`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : '导出失败');
    }
  };

  const doScan = async (cursor = '0', append = false) => {
    if (!selected || selected.kind !== 'redis') return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<RedisScanResult>('/api/redis/scan', {
        method: 'POST',
        body: JSON.stringify({ profileId: selected.id, pattern, cursor, count: 100 }),
        headers: { 'content-type': 'application/json' },
      });
      setScan((prev) =>
        append && prev
          ? { ...res, keys: [...prev.keys, ...res.keys.filter((k) => !prev.keys.some((p) => p.key === k.key))] }
          : res,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'SCAN 失败');
    } finally {
      setBusy(false);
    }
  };

  const loadValue = async (key: string) => {
    if (!selected) return;
    setSelectedKey(key);
    setBusy(true);
    try {
      setRedisValue(await api<RedisValue>(`/api/redis/value${qs({ profileId: selected.id, key })}`));
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取 key 失败');
    } finally {
      setBusy(false);
    }
  };

  const runCommand = async () => {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const res = await api<{ command: string; result: unknown }>('/api/redis/command', {
        method: 'POST',
        body: JSON.stringify({ profileId: selected.id, args: command.trim().split(/\s+/) }),
        headers: { 'content-type': 'application/json' },
      });
      setCommandResult(JSON.stringify(res.result, null, 2));
    } catch (err) {
      setCommandResult(null);
      setError(err instanceof Error ? err.message : 'Redis 命令失败');
    } finally {
      setBusy(false);
    }
  };

  const toggleSubscribe = () => {
    if (!selected) return;
    if (subRef.current) {
      subRef.current.close();
      subRef.current = null;
      notify('已停止订阅');
      return;
    }
    if (!channel.trim()) {
      notify('请输入频道名', 'error');
      return;
    }
    const es = new EventSource(`/api/redis/subscribe${qs({ profileId: selected.id, channel })}`);
    es.addEventListener('message', (e) => {
      setMessages((prev) => [`${new Date().toLocaleTimeString()} ${(e as MessageEvent).data}`, ...prev].slice(0, 200));
    });
    es.addEventListener('error', () => setMessages((prev) => ['[订阅连接断开]', ...prev].slice(0, 200)));
    subRef.current = es;
    notify(`已订阅 ${channel}`);
  };

  useEffect(() => {
    setResultScrollTop(0);
    setResultSearch('');
    setResultFilter('');
    setSearchField('');
    setFilterField('');
    if (resultScroll.current) resultScroll.current.scrollTop = 0;
  }, [result]);

  useEffect(() => {
    setResultScrollTop(0);
    if (resultScroll.current) resultScroll.current.scrollTop = 0;
  }, [resultSearch, searchField, resultFilter, filterField]);

  useEffect(() => {
    if (!pendingSql || !loaded) return;
    if (!selected) {
      setSql(pendingSql.sql);
      consumeSql();
      notify('请先选择或新建一个数据库连接', 'error');
      return;
    }
    if (selected.kind !== 'sqlite' && selected.kind !== 'mysql') {
      setSql(pendingSql.sql);
      consumeSql();
      notify('当前连接不是 SQL 数据库，无法执行该查询', 'error');
      return;
    }
    setSql(pendingSql.sql);
    consumeSql();
    void runQuery(pendingSql.sql);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingSql, selectedId, loaded]);

  const tableColumns = table ? metadata?.columns[table] ?? [] : [];
  const tableGroups = useMemo(() => {
    const groups: Array<{ schema: string; tables: DbTableInfo[] }> = [];
    const bySchema = new Map<string, number>();
    for (const entry of metadata?.tables ?? []) {
      const dot = entry.name.indexOf('.');
      const schema = dot > 0 ? entry.name.slice(0, dot) : '';
      let index = bySchema.get(schema);
      if (index == null) {
        index = groups.length;
        bySchema.set(schema, index);
        groups.push({ schema, tables: [] });
      }
      groups[index].tables.push(entry);
    }
    return groups;
  }, [metadata]);
  const schemaQuery = schemaFilter.trim().toLowerCase();
  const visibleGroups = tableGroups
    .map((group) => ({
      ...group,
      tables: schemaQuery
        ? group.tables.filter((entry) => entry.name.toLowerCase().includes(schemaQuery))
        : group.tables,
    }))
    .filter((group) => group.tables.length > 0);
  const allRows = result?.rows ?? [];
  const matches = (row: unknown[], query: string, field: string): boolean => {
    if (!query.trim()) return true;
    const idx = field ? result?.columns.indexOf(field) ?? -1 : -1;
    if (field && idx < 0) return false;
    const values = idx >= 0 ? [row[idx]] : row;
    return values.some((v) => valueText(v).toLowerCase().includes(query.trim().toLowerCase()));
  };
  const filteredRows = allRows.filter((row) => matches(row, resultFilter, filterField));
  const searchHits = resultSearch.trim()
    ? filteredRows.filter((row) => matches(row, resultSearch, searchField)).length
    : filteredRows.length;
  const displayRows = filteredRows;
  const viewportRows = Math.ceil(resultViewH / ROW_H);
  const startRow = Math.min(
    Math.max(0, displayRows.length - 1),
    Math.max(0, Math.floor(resultScrollTop / ROW_H) - 4),
  );
  const endRow = Math.min(displayRows.length, startRow + viewportRows + 8);

  return (
    <div className="data-layout">
      <aside className="data-side">
        <div className="pane-head">
          <div className="pane-title">连接</div>
          <div className="pane-actions">
            <button className="icon-btn" title="新建连接" aria-label="新建连接" onClick={() => setForm(emptyForm())}>
              <Icon name="add" />
            </button>
          </div>
        </div>
        <div className="connection-list">
          {profiles.length === 0 ? <div className="empty-hint">还没有连接档案</div> : null}
          {profiles.map((p) => (
            <button
              key={p.id}
              className={`connection-item ${p.id === selectedId ? 'active' : ''}`}
              onClick={() => setSelectedId(p.id)}
            >
              <span className={`conn-kind kind-${p.kind}`}>{p.kind}</span>
              <span className="connection-main">
                <span className="connection-label">{p.label}</span>
                <span className="connection-detail">
                  {p.kind === 'sqlite' ? p.file : `${p.host}:${p.port}${p.database ? `/${p.database}` : ''}`}
                </span>
              </span>
              {p.readOnly ? <span className="chip">只读</span> : <span className="chip chip-warn">可写</span>}
            </button>
          ))}
        </div>
        <div className="session-pane-foot">
          <span className="muted">密码仅存 DPAPI；profiles 不含明文</span>
        </div>
      </aside>

      <section className="data-main">
        {!selected ? (
          <div className="empty-state">
            <h2>数据源</h2>
            <p>点击「连接」右侧 + 新建 SQLite / MySQL / Redis 连接；默认为只读，写操作需要显式关闭只读。</p>
          </div>
        ) : (
          <>
            <div className="data-head">
              <div>
                <div className="chat-title">
                  {selected.label} <span className="chip">{selected.kind}</span>
                </div>
                <div className="chat-sub">
                  <span>{selected.kind === 'sqlite' ? selected.file : `${selected.host}:${selected.port}`}</span>
                  <span>{selected.readOnly ? '只读' : '可写（高风险）'}</span>
                  <span>timeout {selected.timeoutMs}ms · rows {selected.rowLimit}</span>
                </div>
              </div>
              <div className="chat-tools">
                <button className="btn btn-small" onClick={() => setForm(toForm(selected))}>
                  编辑
                </button>
                <button className="btn btn-small" onClick={() => void testProfile()} disabled={busy}>
                  测试
                </button>
                <button className="btn btn-small btn-danger" onClick={() => void deleteProfile()}>
                  删除
                </button>
              </div>
            </div>

            {error ? <div className="banner banner-error">{error}</div> : null}

            {selected.kind === 'sqlite' || selected.kind === 'mysql' ? (
              <div className="db-layout">
                <aside className="db-schema">
                  <div className="pane-title">表 / 视图</div>
                  <div className="schema-search">
                    <input
                      className="input"
                      value={schemaFilter}
                      onChange={(e) => setSchemaFilter(e.target.value)}
                      placeholder="筛选库或表…"
                      aria-label="筛选库或表"
                    />
                  </div>
                  <div className="schema-list">
                    {visibleGroups.length ? null : (
                      <div className="empty-hint">{schemaQuery ? '没有匹配的表' : '无表'}</div>
                    )}
                    {visibleGroups.map((group) => {
                      const open = schemaQuery ? true : !(collapsedSchemas[group.schema] ?? tableGroups.length > 1);
                      return (
                        <div className="schema-group" key={group.schema || '_default'}>
                          <button
                            className={`schema-group-head ${open ? 'open' : ''}`}
                            onClick={() =>
                              setCollapsedSchemas((prev) => ({ ...prev, [group.schema]: open }))
                            }
                            title={`${group.schema || '默认库'} · ${group.tables.length} 个对象`}
                          >
                            <span className="schema-caret">▸</span>
                            <span className="schema-group-name">{group.schema || '默认库'}</span>
                            <span className="schema-group-count">{group.tables.length}</span>
                          </button>
                          {open
                            ? group.tables.map((entry) => (
                                <button
                                  key={entry.name}
                                  className={`schema-item ${table === entry.name ? 'active' : ''}`}
                                  onClick={() => openTable(entry.name)}
                                  title={entry.name}
                                >
                                  <span className="schema-icon">{entry.type === 'view' ? '◫' : '▤'}</span>
                                  <span className="schema-item-name">
                                    {group.schema && entry.name.startsWith(`${group.schema}.`)
                                      ? entry.name.slice(group.schema.length + 1)
                                      : entry.name}
                                  </span>
                                </button>
                              ))
                            : null}
                        </div>
                      );
                    })}
                  </div>
                  {table && tableColumns.length ? (
                    <div className="schema-columns">
                      <div className="pane-title">列 · {table}</div>
                      {tableColumns.map((c) => (
                        <div className="schema-column" key={c.name}>
                          <span>{c.name}</span>
                          <span className="muted">{c.type}{c.primaryKey ? ' · PK' : ''}{c.notNull ? ' · NOT NULL' : ''}</span>
                        </div>
                      ))}
                      {(metadata?.indexes[table] ?? []).map((i) => (
                        <div className="schema-column" key={i.name}>
                          <span>↳ {i.name}</span>
                          <span className="muted">{i.columns.join(', ')}{i.unique ? ' · unique' : ''}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </aside>

                <div className="db-work">
                  <div className="sql-editor">
                    <textarea
                      className="input sql-input"
                      value={sql}
                      onChange={(e) => setSql(e.target.value)}
                      onKeyDown={(e) => {
                        if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
                          e.preventDefault();
                          void runQuery();
                        }
                      }}
                      spellCheck={false}
                    />
                    <div className="sql-actions">
                      <input
                        className="input params"
                        value={paramsText}
                        onChange={(e) => setParamsText(e.target.value)}
                        title={'参数 JSON 数组，例如 [1, "a"]'}
                        placeholder='params JSON，例如 [1,"a"]'
                      />
                      <button className="btn btn-small btn-primary" onClick={() => void runQuery()} disabled={busy}>
                        执行 (Ctrl+Enter)
                      </button>
                      <button className="btn btn-small" onClick={() => void exportResult('csv')} disabled={!result || result.kind !== 'read'}>
                        CSV
                      </button>
                      <button className="btn btn-small" onClick={() => void exportResult('json')} disabled={!result || result.kind !== 'read'}>
                        JSON
                      </button>
                    </div>
                  </div>
                  <div className="db-result">
                    {result ? (
                      <>
                        <div className="result-meta">
                          <span>
                            {result.kind === 'read' ? `${result.rowCount} 行` : `changes ${result.changes ?? 0}`} · {result.durationMs}ms
                            {result.truncated ? ' · 已达行数上限' : ''}
                          </span>
                          {result.kind === 'read' ? (
                            <div className="result-tools">
                              <select
                                className="input result-scope"
                                value={searchField}
                                onChange={(e) => setSearchField(e.target.value)}
                                title="搜索范围"
                              >
                                <option value="">全部字段</option>
                                {result.columns.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input result-search"
                                value={resultSearch}
                                onChange={(e) => setResultSearch(e.target.value)}
                                placeholder="搜索结果"
                                title="在结果中搜索"
                              />
                              <select
                                className="input result-scope"
                                value={filterField}
                                onChange={(e) => setFilterField(e.target.value)}
                                title="过滤范围"
                              >
                                <option value="">全部字段</option>
                                {result.columns.map((c) => (
                                  <option key={c} value={c}>
                                    {c}
                                  </option>
                                ))}
                              </select>
                              <input
                                className="input result-search"
                                value={resultFilter}
                                onChange={(e) => setResultFilter(e.target.value)}
                                placeholder="过滤结果"
                                title="按字段或全局过滤结果"
                              />
                              <span className="result-hits">
                                {displayRows.length}/{allRows.length}
                                {resultSearch.trim() ? ` · 命中 ${searchHits}` : ''}
                              </span>
                              {resultSearch || resultFilter ? (
                                <button
                                  className="btn btn-small"
                                  onClick={() => {
                                    setResultSearch('');
                                    setResultFilter('');
                                  }}
                                >
                                  清除
                                </button>
                              ) : null}
                            </div>
                          ) : null}
                        </div>
                        {result.kind === 'read' ? (
                          <div
                            className="result-scroll"
                            ref={(el) => {
                              resultScroll.current = el;
                              if (el && el.clientHeight !== resultViewH) setResultViewH(el.clientHeight);
                            }}
                            onScroll={(e) => setResultScrollTop((e.target as HTMLDivElement).scrollTop)}
                          >
                            <table className="result-table virtual">
                              <thead>
                                <tr>
                                  <th>#</th>
                                  {result.columns.map((c) => (
                                    <th key={c}>{c}</th>
                                  ))}
                                </tr>
                              </thead>
                              <tbody>
                                {displayRows.length === 0 ? (
                                  <tr>
                                    <td className="result-empty" colSpan={result.columns.length + 1}>
                                      没有匹配的行，清空搜索或过滤条件后重试
                                    </td>
                                  </tr>
                                ) : null}
                                {startRow > 0 ? (
                                  <tr style={{ height: startRow * ROW_H }}>
                                    <td colSpan={result.columns.length + 1} />
                                  </tr>
                                ) : null}
                                {displayRows.slice(startRow, endRow).map((row, i) => (
                                  <tr key={startRow + i}>
                                    <td className="row-index">{startRow + i + 1}</td>
                                    {row.map((v, j) => (
                                      <td key={j} title={valueText(v)}>
                                        {valueText(v)}
                                      </td>
                                    ))}
                                  </tr>
                                ))}
                                {endRow < displayRows.length ? (
                                  <tr style={{ height: (displayRows.length - endRow) * ROW_H }}>
                                    <td colSpan={result.columns.length + 1} />
                                  </tr>
                                ) : null}
                              </tbody>
                            </table>
                          </div>
                        ) : null}
                      </>
                    ) : (
                      <div className="empty-hint">执行查询后在此显示结果（默认最多 {selected.rowLimit} 行）</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="redis-layout">
                <aside className="redis-keys">
                  <div className="redis-scan">
                    <input className="input" value={pattern} onChange={(e) => setPattern(e.target.value)} placeholder="MATCH pattern" />
                    <button className="btn btn-small btn-primary" onClick={() => void doScan('0', false)} disabled={busy}>
                      SCAN
                    </button>
                  </div>
                  <div className="redis-key-list">
                    {scan?.keys.map((k) => (
                      <button
                        key={k.key}
                        className={`redis-key ${selectedKey === k.key ? 'active' : ''}`}
                        onClick={() => void loadValue(k.key)}
                      >
                        <span className="chip">{k.type}</span>
                        <span className="redis-key-name">{k.key}</span>
                      </button>
                    ))}
                    {scan ? <div className="muted small pad-l">cursor {scan.cursor}</div> : <div className="empty-hint">输入 pattern 后 SCAN</div>}
                    {scan && scan.cursor !== '0' ? (
                      <button className="btn btn-small" onClick={() => void doScan(scan.cursor, true)} disabled={busy}>
                        加载更多
                      </button>
                    ) : null}
                  </div>
                </aside>
                <div className="redis-work">
                  <div className="redis-value">
                    {redisValue ? (
                      <>
                        <div className="result-meta">
                          <strong>{redisValue.key}</strong> · {redisValue.type} · TTL {redisValue.ttl}
                          {redisValue.truncated ? ' · 截断' : ''}
                        </div>
                        <pre className="redis-value-pre">
                          {typeof redisValue.value === 'string' ? redisValue.value : JSON.stringify(redisValue.value, null, 2)}
                        </pre>
                      </>
                    ) : (
                      <div className="empty-hint">选择左侧 key 查看值（按类型分派，大值截断）</div>
                    )}
                  </div>
                  <div className="redis-console">
                    <div className="pane-title">只读命令台</div>
                    <div className="row">
                      <input className="input grow" value={command} onChange={(e) => setCommand(e.target.value)} placeholder="GET key / SCAN 0 MATCH * COUNT 100" />
                      <button className="btn btn-small btn-primary" onClick={() => void runCommand()} disabled={busy}>
                        执行
                      </button>
                    </div>
                    <pre className="redis-value-pre small">{commandResult ?? '仅允许只读白名单命令；KEYS/FLUSHALL/CONFIG 等默认禁用。'}</pre>
                  </div>
                  <div className="redis-subscribe">
                    <div className="pane-title">订阅</div>
                    <div className="row">
                      <input className="input grow" value={channel} onChange={(e) => setChannel(e.target.value)} placeholder="频道名" />
                      <button className="btn btn-small" onClick={toggleSubscribe}>
                        {subRef.current ? '停止' : '订阅'}
                      </button>
                    </div>
                    <div className="subscribe-log">
                      {messages.map((m, i) => (
                        <div key={i}>{m}</div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </section>

      {form ? (
        <div className="format-overlay">
          <div className="connection-dialog">
            <div className="format-head">
              <strong>{form.id ? '编辑连接' : '新建连接'}</strong>
              <span className="spacer" />
              <button className="btn btn-small" onClick={() => setForm(null)}>
                取消
              </button>
              <button className="btn btn-small btn-primary" onClick={() => void saveProfile()} disabled={busy}>
                保存
              </button>
            </div>
            <div className="connection-form">
              <label>
                类型
                <select
                  value={form.kind}
                  onChange={(e) => {
                    const kind = e.target.value as ConnectionKind;
                    setForm({ ...form, kind, port: kind === 'redis' ? '6379' : kind === 'mysql' ? '3306' : '5432' });
                  }}
                  disabled={Boolean(form.id)}
                >
                  <option value="sqlite">SQLite</option>
                  <option value="redis">Redis</option>
                  <option value="mysql">MySQL</option>
                  <option value="postgres">PostgreSQL（未启用）</option>
                </select>
              </label>
              <label>
                名称
                <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} />
              </label>
              {form.kind === 'sqlite' ? (
                <label className="wide">
                  数据库文件（绝对路径）
                  <input className="input" value={form.file} onChange={(e) => setForm({ ...form, file: e.target.value })} />
                </label>
              ) : (
                <>
                  <label>
                    Host
                    <input className="input" value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} />
                  </label>
                  <label>
                    Port
                    <input className="input" value={form.port} onChange={(e) => setForm({ ...form, port: e.target.value })} />
                  </label>
                  <label>
                    Database
                    <input className="input" value={form.database} onChange={(e) => setForm({ ...form, database: e.target.value })} />
                  </label>
                  <label>
                    User
                    <input className="input" value={form.user} onChange={(e) => setForm({ ...form, user: e.target.value })} />
                  </label>
                  <label className="wide">
                    密码（仅 DPAPI 存储；留空保持不变）
                    <input
                      className="input"
                      type="password"
                      value={form.secret}
                      onChange={(e) => setForm({ ...form, secret: e.target.value })}
                      autoComplete="new-password"
                    />
                  </label>
                </>
              )}
              <label>
                Row limit
                <input className="input" value={form.rowLimit} onChange={(e) => setForm({ ...form, rowLimit: e.target.value })} />
              </label>
              <label>
                Timeout ms
                <input className="input" value={form.timeoutMs} onChange={(e) => setForm({ ...form, timeoutMs: e.target.value })} />
              </label>
              <label className="checkbox-row wide">
                <input type="checkbox" checked={form.readOnly} onChange={(e) => setForm({ ...form, readOnly: e.target.checked })} />
                只读档案（拒绝 INSERT/UPDATE/DELETE/DROP/PRAGMA 写操作）
              </label>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
