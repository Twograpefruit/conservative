import type { Extension } from '@codemirror/state';
import { StreamLanguage } from '@codemirror/language';
import { languages } from '@codemirror/language-data';

export type SqlDialect = 'sqlite' | 'postgresql' | 'mysql' | 'mariadb' | 'tsql' | 'plsql';

export interface LanguageDef {
  id: string;
  name: string;
  exts: string[];
  filenames?: string[];
  load: (opts: { sqlDialect: SqlDialect }) => Promise<Extension>;
}

async function legacyMode(
  loader: () => Promise<Record<string, unknown>>,
): Promise<Extension> {
  const mod = await loader();
  const mode = mod.default ?? Object.values(mod).find((v) => typeof v === 'object');
  return StreamLanguage.define(mode as never);
}

export const LANGUAGE_DEFS: LanguageDef[] = [
  {
    id: 'python',
    name: 'Python',
    exts: ['py', 'pyi'],
    load: async () => (await import('@codemirror/lang-python')).python(),
  },
  {
    id: 'javascript',
    name: 'JavaScript',
    exts: ['js', 'jsx', 'mjs', 'cjs'],
    load: async () => (await import('@codemirror/lang-javascript')).javascript({ jsx: true }),
  },
  {
    id: 'typescript',
    name: 'TypeScript',
    exts: ['ts', 'tsx'],
    load: async () =>
      (await import('@codemirror/lang-javascript')).javascript({ jsx: true, typescript: true }),
  },
  {
    id: 'json',
    name: 'JSON',
    exts: ['json', 'jsonc'],
    load: async () => (await import('@codemirror/lang-json')).json(),
  },
  {
    id: 'markdown',
    name: 'Markdown',
    exts: ['md', 'markdown', 'mdx'],
    load: async () => (await import('@codemirror/lang-markdown')).markdown({ codeLanguages: languages }),
  },
  {
    id: 'yaml',
    name: 'YAML',
    exts: ['yaml', 'yml'],
    load: async () => (await import('@codemirror/lang-yaml')).yaml(),
  },
  {
    id: 'xml',
    name: 'XML',
    exts: ['xml', 'xsl', 'xsd', 'svg'],
    load: async () => (await import('@codemirror/lang-xml')).xml(),
  },
  {
    id: 'html',
    name: 'HTML',
    exts: ['html', 'htm', 'vue', 'svelte'],
    load: async () => (await import('@codemirror/lang-html')).html(),
  },
  {
    id: 'css',
    name: 'CSS',
    exts: ['css', 'scss', 'sass', 'less'],
    load: async () => (await import('@codemirror/lang-css')).css(),
  },
  {
    id: 'sql',
    name: 'SQL',
    exts: ['sql'],
    load: async ({ sqlDialect }) => {
      const mod = await import('@codemirror/lang-sql');
      const dialect =
        sqlDialect === 'postgresql'
          ? mod.PostgreSQL
          : sqlDialect === 'mysql' || sqlDialect === 'mariadb'
            ? mod.MySQL
            : sqlDialect === 'tsql'
              ? mod.MSSQL
              : sqlDialect === 'plsql'
                ? mod.PLSQL
                : mod.SQLite;
      return mod.sql({ dialect });
    },
  },
  {
    id: 'java',
    name: 'Java',
    exts: ['java'],
    load: async () => (await import('@codemirror/lang-java')).java(),
  },
  {
    id: 'cpp',
    name: 'C/C++',
    exts: ['c', 'h', 'cc', 'cpp', 'cxx', 'hpp', 'hh'],
    load: async () => (await import('@codemirror/lang-cpp')).cpp(),
  },
  {
    id: 'php',
    name: 'PHP',
    exts: ['php'],
    load: async () => (await import('@codemirror/lang-php')).php(),
  },
  {
    id: 'go',
    name: 'Go',
    exts: ['go'],
    load: async () => (await import('@codemirror/lang-go')).go(),
  },
  {
    id: 'rust',
    name: 'Rust',
    exts: ['rs'],
    load: async () => (await import('@codemirror/lang-rust')).rust(),
  },
  {
    id: 'shell',
    name: 'Shell',
    exts: ['sh', 'bash', 'zsh', 'ps1', 'psm1', 'bat', 'cmd'],
    load: async () => legacyMode(() => import('@codemirror/legacy-modes/mode/shell')),
  },
  {
    id: 'toml',
    name: 'TOML',
    exts: ['toml'],
    load: async () => legacyMode(() => import('@codemirror/legacy-modes/mode/toml')),
  },
  {
    id: 'properties',
    name: 'Properties',
    exts: ['properties', 'ini', 'cfg', 'conf'],
    load: async () => legacyMode(() => import('@codemirror/legacy-modes/mode/properties')),
  },
  {
    id: 'nginx',
    name: 'Nginx',
    exts: ['nginx'],
    filenames: ['nginx.conf'],
    load: async () => legacyMode(() => import('@codemirror/legacy-modes/mode/nginx')),
  },
  {
    id: 'dockerfile',
    name: 'Dockerfile',
    exts: ['dockerfile'],
    filenames: ['Dockerfile'],
    load: async () => legacyMode(() => import('@codemirror/legacy-modes/mode/dockerfile')),
  },
  {
    id: 'text',
    name: '纯文本',
    exts: [],
    load: async () => [],
  },
];

export function languageName(path: string, override?: string | null): string {
  if (override) return LANGUAGE_DEFS.find((l) => l.id === override)?.name ?? override;
  const def = languageForPath(path);
  return def?.name ?? '纯文本';
}

export function languageForPath(path: string): LanguageDef | null {
  const lower = path.toLowerCase().replace(/\\/g, '/');
  const base = lower.split('/').pop() ?? lower;
  const named = LANGUAGE_DEFS.find((l) => l.filenames?.some((f) => f.toLowerCase() === base));
  if (named) return named;
  if (base.endsWith('.nginx.conf')) return LANGUAGE_DEFS.find((l) => l.id === 'nginx') ?? null;
  const ext = base.includes('.') ? base.split('.').pop() ?? '' : '';
  return LANGUAGE_DEFS.find((l) => l.exts.includes(ext)) ?? null;
}

export async function loadLanguage(
  path: string,
  opts: { override?: string | null; sqlDialect?: SqlDialect } = {},
): Promise<{ name: string; extension: Extension }> {
  const def = (opts.override && LANGUAGE_DEFS.find((l) => l.id === opts.override)) || languageForPath(path) || LANGUAGE_DEFS[LANGUAGE_DEFS.length - 1];
  try {
    const extension = await def.load({ sqlDialect: opts.sqlDialect ?? 'sqlite' });
    return { name: def.name, extension };
  } catch {
    return { name: '纯文本', extension: [] };
  }
}
