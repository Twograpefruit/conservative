import fs from 'node:fs';
import path from 'node:path';
import { appDataDir, paths, projectHash, type Workspace } from '@ocg/config';

function detectVenv(root: string): string | null {
  const candidates = [
    path.join(root, '.venv', 'Scripts', 'python.exe'),
    path.join(root, 'venv', 'Scripts', 'python.exe'),
    path.join(root, '.venv', 'bin', 'python'),
  ];
  return candidates.find((p) => fs.existsSync(p)) ?? null;
}

export class WorkspaceStore {
  private file = paths.workspaces();
  list: Workspace[] = [];

  constructor(activePath: string) {
    this.load();
    if (this.list.length === 0) {
      this.add({ path: activePath });
    }
    if (!this.list.some((w) => fs.existsSync(w.path))) {
      // Keep stale workspaces visible but ensure the current repo is usable.
      if (!this.list.some((w) => path.resolve(w.path).toLowerCase() === path.resolve(activePath).toLowerCase())) {
        this.add({ path: activePath });
      }
    }
  }

  private load(): void {
    fs.mkdirSync(appDataDir(), { recursive: true });
    try {
      if (fs.existsSync(this.file)) {
        const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
        if (Array.isArray(raw)) this.list = raw.filter((w) => w && typeof w.path === 'string');
      }
    } catch (err) {
      console.warn('[workspaces] failed to read:', err);
    }
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.list, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  add(input: { path: string; label?: string; venv?: string | null; checkCmd?: string | null; lintCmd?: string | null }): Workspace {
    const abs = path.resolve(input.path);
    const existing = this.list.find((w) => path.resolve(w.path).toLowerCase() === abs.toLowerCase());
    if (existing) return existing;
    const ws: Workspace = {
      id: projectHash(abs),
      path: abs,
      label: input.label ?? (path.basename(abs) || abs),
      venv: input.venv ?? detectVenv(abs),
      checkCmd: input.checkCmd ?? null,
      lintCmd: input.lintCmd ?? null,
      encoding: 'utf-8',
      eol: 'auto',
      createdAt: Date.now(),
    };
    this.list.push(ws);
    this.save();
    return ws;
  }

  get(idOrPath: string | undefined): Workspace | null {
    if (!idOrPath) return this.list[0] ?? null;
    const lower = idOrPath.toLowerCase();
    return (
      this.list.find((w) => w.id === idOrPath) ??
      this.list.find((w) => w.path.toLowerCase() === lower) ??
      null
    );
  }

  remove(id: string): boolean {
    const before = this.list.length;
    this.list = this.list.filter((w) => w.id !== id);
    if (this.list.length !== before) this.save();
    return this.list.length !== before;
  }

  update(id: string, patch: Partial<Workspace>): Workspace | null {
    const ws = this.get(id);
    if (!ws) return null;
    Object.assign(ws, patch, { id: ws.id, path: ws.path });
    this.save();
    return ws;
  }
}
