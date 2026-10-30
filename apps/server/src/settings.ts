import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_SETTINGS, appDataDir, paths, type Settings } from '@ocg/config';

function deepMerge<T>(base: T, patch: unknown): T {
  if (patch == null || typeof patch !== 'object' || Array.isArray(patch)) return base;
  const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
  for (const [k, v] of Object.entries(patch as Record<string, unknown>)) {
    const cur = out[k];
    if (v && typeof v === 'object' && !Array.isArray(v) && cur && typeof cur === 'object' && !Array.isArray(cur)) {
      out[k] = deepMerge(cur, v);
    } else if (v !== undefined) {
      out[k] = v;
    }
  }
  return out as T;
}

export class SettingsStore {
  settings: Settings;
  private readonly file = paths.settings();

  constructor() {
    this.settings = this.load();
  }

  private load(): Settings {
    fs.mkdirSync(appDataDir(), { recursive: true });
    let loaded: Settings = { ...DEFAULT_SETTINGS };
    try {
      if (fs.existsSync(this.file)) {
        loaded = deepMerge(DEFAULT_SETTINGS, JSON.parse(fs.readFileSync(this.file, 'utf8')));
      }
    } catch (err) {
      console.warn('[settings] failed to read, using defaults:', err);
    }
    const env = process.env;
    if (env.OCG_PORT) loaded.port = Number(env.OCG_PORT) || loaded.port;
    if (env.OCG_OC_MODE === 'attach' || env.OCG_OC_MODE === 'managed') loaded.upstream.mode = env.OCG_OC_MODE;
    if (env.OCG_OC_URL) {
      loaded.upstream.mode = 'attach';
      loaded.upstream.url = env.OCG_OC_URL;
    }
    if (env.OCG_OC_PORT) loaded.upstream.port = Number(env.OCG_OC_PORT) || loaded.upstream.port;
    return loaded;
  }

  save(): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.settings, null, 2), 'utf8');
    fs.renameSync(tmp, this.file);
  }

  update(patch: unknown): Settings {
    this.settings = deepMerge(this.settings, patch);
    this.save();
    return this.settings;
  }
}
