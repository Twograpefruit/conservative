import os from 'node:os';
import path from 'node:path';

export const APP_NAME = 'opencode-gui';

export interface Workspace {
  id: string;
  path: string;
  label: string;
  venv: string | null;
  checkCmd: string | null;
  lintCmd: string | null;
  encoding: string;
  eol: 'auto' | 'lf' | 'crlf';
  createdAt: number;
}

export interface Settings {
  version: 1;
  host: string;
  port: number;
  upstream: {
    mode: 'managed' | 'attach';
    host: string;
    port: number;
    url: string | null;
  };
  activeWorkspaceId: string | null;
  editor: {
    fontSize: number;
    tabSize: number;
    wordWrap: boolean;
  };
  limits: {
    editorMaxBytes: number;
    searchMaxResults: number;
    eventBufferSize: number;
    snapshotKeep: number;
  };
  lint: {
    enabled: boolean;
    pyrightCommand: string;
    ruffCommand: string | null;
  };
  terminal: {
    shell: string | null;
    scrollback: number;
  };
}

export const DEFAULT_SETTINGS: Settings = {
  version: 1,
  host: '127.0.0.1',
  port: 4310,
  upstream: {
    mode: 'managed',
    host: '127.0.0.1',
    port: 4311,
    url: null,
  },
  activeWorkspaceId: null,
  editor: {
    fontSize: 13,
    tabSize: 4,
    wordWrap: false,
  },
  limits: {
    editorMaxBytes: 2 * 1024 * 1024,
    searchMaxResults: 2000,
    eventBufferSize: 5000,
    snapshotKeep: 200,
  },
  lint: {
    enabled: true,
    pyrightCommand: 'pyright',
    ruffCommand: 'ruff',
  },
  terminal: {
    shell: null,
    scrollback: 5000,
  },
};

export const IGNORED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  '.venv',
  'venv',
  'env',
  '__pycache__',
  'node_modules',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  'dist',
  'build',
  'coverage',
  '.next',
  '.turbo',
  '.idea',
  '.vscode',
  'target',
  '.tox',
  'site-packages',
]);

export const IGNORED_FILES = new Set([
  '.DS_Store',
  'Thumbs.db',
  'desktop.ini',
]);

export const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.webp', '.ico', '.bmp', '.pdf', '.zip', '.gz',
  '.tar', '.7z', '.rar', '.exe', '.dll', '.so', '.dylib', '.pyc', '.pyo', '.woff',
  '.woff2', '.ttf', '.otf', '.mp3', '.mp4', '.mov', '.avi', '.sqlite', '.db', '.bin',
]);

export function appDataDir(): string {
  return path.join(process.env.APPDATA ?? path.join(os.homedir(), 'AppData', 'Roaming'), APP_NAME);
}

export function localDataDir(): string {
  return path.join(
    process.env.LOCALAPPDATA ?? path.join(os.homedir(), 'AppData', 'Local'),
    APP_NAME,
  );
}

export const paths = {
  settings: () => path.join(appDataDir(), 'settings.json'),
  workspaces: () => path.join(appDataDir(), 'workspaces.json'),
  runtime: () => path.join(localDataDir(), 'runtime.json'),
  lock: () => path.join(localDataDir(), 'instance.lock'),
  logs: () => path.join(localDataDir(), 'logs'),
  cache: () => path.join(localDataDir(), 'cache'),
  snapshots: () => path.join(localDataDir(), 'snapshots'),
  backups: () => path.join(localDataDir(), 'backups'),
  previews: () => path.join(localDataDir(), 'previews'),
  projectHashDir: (hash: string) => path.join(localDataDir(), 'snapshots', hash),
};

export function projectHash(workspacePath: string): string {
  // Stable, case-insensitive hash of the normalised absolute path (Windows semantics).
  const normalised = path.resolve(workspacePath).replace(/\\/g, '/').toLowerCase();
  let h1 = 0x811c9dc5;
  let h2 = 0x01000193;
  for (let i = 0; i < normalised.length; i++) {
    const c = normalised.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 + c, 0x85ebca6b) >>> 0;
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0');
}

export function clampPort(port: number): number {
  return Number.isFinite(port) && port > 0 && port < 65536 ? Math.floor(port) : DEFAULT_SETTINGS.port;
}
