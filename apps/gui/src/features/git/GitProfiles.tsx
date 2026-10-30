import React, { useEffect, useState } from 'react';
import { api } from '../../api/client.js';
import { useApp } from '../../store/appStore.js';

type Provider = 'gitee' | 'github' | 'git';

interface Profile {
  id: string;
  label: string;
  provider: Provider;
  remoteUrl: string;
  username?: string;
  hasToken: boolean;
  createdAt: number;
}

interface Form {
  id?: string;
  label: string;
  provider: Provider;
  remoteUrl: string;
  username: string;
  secret: string;
}

const providerHost: Record<Provider, string> = {
  gitee: 'https://gitee.com/<owner>/<repo>.git',
  github: 'https://github.com/<owner>/<repo>.git',
  git: 'https://git.example.com/<owner>/<repo>.git',
};

const empty = (): Form => ({ label: '', provider: 'gitee', remoteUrl: '', username: '', secret: '' });

export function GitProfiles({ workspaceID, onChanged }: { workspaceID: string | null; onChanged: () => void }) {
  const notify = useApp((s) => s.notify);
  const [profiles, setProfiles] = useState<Profile[]>([]);
  const [form, setForm] = useState<Form>(empty());
  const [busy, setBusy] = useState(false);
  const [testOut, setTestOut] = useState<string | null>(null);

  const load = async () => {
    try {
      setProfiles(await api<Profile[]>('/api/git/profiles'));
    } catch (err) {
      notify(err instanceof Error ? err.message : 'Git 配置加载失败', 'error');
    }
  };

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const save = async () => {
    if (!form.remoteUrl.trim()) {
      notify('请填写远端仓库地址', 'error');
      return;
    }
    setBusy(true);
    try {
      const body = {
        label: form.label,
        provider: form.provider,
        remoteUrl: form.remoteUrl,
        username: form.username || undefined,
        secret: form.secret || undefined,
      };
      if (form.id) {
        await api(`/api/git/profiles/${form.id}`, {
          method: 'PUT',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
      } else {
        await api('/api/git/profiles', {
          method: 'POST',
          body: JSON.stringify(body),
          headers: { 'content-type': 'application/json' },
        });
      }
      setForm(empty());
      await load();
      notify('Git 远端配置已保存（令牌仅进入 DPAPI）');
    } catch (err) {
      notify(err instanceof Error ? err.message : '保存失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (p: Profile) => {
    if (!window.confirm(`删除 Git 配置“${p.label}”？`)) return;
    try {
      await api(`/api/git/profiles/${p.id}`, { method: 'DELETE' });
      await load();
    } catch (err) {
      notify(err instanceof Error ? err.message : '删除失败', 'error');
    }
  };

  const applyRemote = async (p: Profile) => {
    if (!workspaceID) return;
    setBusy(true);
    try {
      const res = await api<{ remote: string; url: string }>(`/api/git/profiles/${p.id}/apply`, {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID }),
        headers: { 'content-type': 'application/json' },
      });
      notify(`已把 ${res.remote} 指向 ${res.url}`);
      onChanged();
    } catch (err) {
      notify(err instanceof Error ? err.message : '应用远端失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  const test = async (p: Profile) => {
    if (!workspaceID) return;
    setBusy(true);
    setTestOut(null);
    try {
      const res = await api<{ ok: boolean; out: string }>(`/api/git/profiles/${p.id}/test`, {
        method: 'POST',
        body: JSON.stringify({ ws: workspaceID }),
        headers: { 'content-type': 'application/json' },
      });
      setTestOut(res.out || '连接成功（远端没有返回分支）');
      notify('远端连接成功');
    } catch (err) {
      notify(err instanceof Error ? err.message : '远端连接失败', 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="git-profiles">
      <div className="git-profile-list">
        <div className="pane-title">Git / Gitee 远端配置</div>
        {profiles.length === 0 ? <div className="empty-hint">尚未配置自定义远端</div> : null}
        {profiles.map((p) => (
          <div className={`git-profile ${form.id === p.id ? 'active' : ''}`} key={p.id}>
            <div className="git-profile-main">
              <div>
                <span className={`provider provider-${p.provider}`}>{p.provider}</span>
                <strong>{p.label}</strong>
                {p.hasToken ? <span className="chip">令牌已保存</span> : null}
              </div>
              <div className="git-profile-url">{p.remoteUrl}</div>
            </div>
            <div className="git-profile-actions">
              <button className="btn btn-tiny" onClick={() => setForm({ id: p.id, label: p.label, provider: p.provider, remoteUrl: p.remoteUrl, username: p.username ?? '', secret: '' })}>
                编辑
              </button>
              <button className="btn btn-tiny" onClick={() => void test(p)} disabled={busy}>
                测试
              </button>
              <button className="btn btn-tiny btn-primary" onClick={() => void applyRemote(p)} disabled={busy}>
                设为 origin
              </button>
              <button className="btn btn-tiny btn-danger" onClick={() => void remove(p)}>
                删除
              </button>
            </div>
          </div>
        ))}
      </div>
      <div className="git-profile-form">
        <div className="pane-title">{form.id ? '编辑配置' : '新增配置'}</div>
        <label>
          名称
          <input className="input" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="例如：Gitee 主仓库" />
        </label>
        <label>
          类型
          <select
            className="input"
            value={form.provider}
            onChange={(e) => setForm({ ...form, provider: e.target.value as Provider })}
          >
            <option value="gitee">Gitee</option>
            <option value="github">GitHub</option>
            <option value="git">通用 Git</option>
          </select>
        </label>
        <label>
          远端地址
          <input
            className="input"
            value={form.remoteUrl}
            onChange={(e) => setForm({ ...form, remoteUrl: e.target.value })}
            placeholder={providerHost[form.provider]}
          />
        </label>
        <label>
          用户名（可选）
          <input className="input" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} placeholder="Gitee 常用 oauth2" />
        </label>
        <label>
          访问令牌 / 密码
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={form.secret}
            onChange={(e) => setForm({ ...form, secret: e.target.value })}
            placeholder={form.id ? '留空保持不变' : '仅进入 DPAPI，不写入 git 配置'}
          />
        </label>
        <div className="row">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy}>
            {form.id ? '保存修改' : '新增配置'}
          </button>
          <button className="btn" onClick={() => setForm(empty())}>
            清空
          </button>
        </div>
        {testOut ? <pre className="git-output">{testOut}</pre> : null}
        <div className="muted small">
          令牌只保存在 Windows DPAPI；测试时通过临时 askpass，不写入 `.git/config`，也不会出现在 remote URL 中。
        </div>
      </div>
    </div>
  );
}
