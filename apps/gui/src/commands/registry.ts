import { useApp, type ThemeMode, type View } from '../store/appStore.js';
import { useChat } from '../store/chatStore.js';
import { useEditor } from '../store/editorStore.js';

export type CommandScope = 'global' | 'editor' | 'terminal' | 'data';

export interface CommandDef {
  id: string;
  title: string;
  scope: CommandScope;
  defaultKeys: string[];
  keywords?: string;
  run: () => void | Promise<void>;
}

export const COMMANDS: CommandDef[] = [
  {
    id: 'palette.open',
    title: '打开命令面板',
    scope: 'global',
    defaultKeys: ['Ctrl+Shift+P'],
    keywords: 'command palette',
    run: () => window.dispatchEvent(new CustomEvent('ocg:palette-open')),
  },
  ...(
    [
      ['chat', '对话', 'Alt+1'],
      ['editor', '编辑器', 'Alt+2'],
      ['search', '搜索', 'Alt+3'],
      ['git', 'Git', 'Alt+4'],
      ['terminal', '终端', 'Alt+5'],
      ['data', '数据', 'Alt+6'],
      ['settings', '设置', 'Alt+7'],
    ] as Array<[View, string, string]>
  ).map(([view, label, key]) => ({
    id: `view.${view}`,
    title: `切换到${label}`,
    scope: 'global' as const,
    defaultKeys: [key],
    keywords: `view ${view}`,
    run: () => useApp.getState().setView(view),
  })),
  {
    id: 'session.new',
    title: '新建会话',
    scope: 'global',
    defaultKeys: ['Alt+Shift+N'],
    keywords: 'new session chat',
    run: () => useChat.getState().createSession(),
  },
  {
    id: 'session.search',
    title: '搜索当前会话',
    scope: 'global',
    defaultKeys: ['Alt+Shift+F'],
    keywords: 'find message',
    run: () => {
      useApp.getState().setView('chat');
      window.dispatchEvent(new CustomEvent('ocg:chat-search'));
    },
  },
  {
    id: 'editor.save',
    title: '保存当前文件',
    scope: 'editor',
    defaultKeys: ['Ctrl+S'],
    keywords: 'save file',
    run: () => {
      const editor = useEditor.getState();
      if (editor.active) void editor.save(editor.active);
    },
  },
  {
    id: 'editor.format',
    title: '格式化 SQL / 当前文件',
    scope: 'editor',
    defaultKeys: ['Shift+Alt+F'],
    keywords: 'format sql',
    run: () => window.dispatchEvent(new CustomEvent('ocg:editor-format')),
  },
  {
    id: 'theme.cycle',
    title: '切换主题（暗色 ↔ 亮色）',
    scope: 'global',
    defaultKeys: ['Ctrl+Alt+T'],
    keywords: 'theme dark light',
    run: () => {
      const app = useApp.getState();
      const next: ThemeMode = app.themeMode === 'dark' ? 'light' : 'dark';
      app.setThemeMode(next);
    },
  },
  {
    id: 'terminal.new',
    title: '新建终端',
    scope: 'global',
    defaultKeys: ['Alt+Shift+T'],
    keywords: 'terminal shell',
    run: () => {
      useApp.getState().setView('terminal');
      window.dispatchEvent(new CustomEvent('ocg:terminal-new'));
    },
  },
];

const STORAGE_KEY = 'ocg.keybindings';

export function getBindings(): Record<string, string[]> {
  const base: Record<string, string[]> = {};
  for (const cmd of COMMANDS) base[cmd.id] = [...cmd.defaultKeys];
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string[]>;
    for (const [id, keys] of Object.entries(saved)) {
      if (base[id] && Array.isArray(keys) && keys.every((k) => typeof k === 'string')) {
        base[id] = keys.map((k) => k.trim()).filter(Boolean);
      }
    }
  } catch {
    /* ignore */
  }
  return base;
}

export function setBinding(id: string, keys: string[]): void {
  const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Record<string, string[]>;
  saved[id] = keys.map((k) => k.trim()).filter(Boolean);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
}

export function resetBindings(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export function bindingConflicts(bindings = getBindings()): Array<{ key: string; commands: string[] }> {
  const map = new Map<string, string[]>();
  for (const cmd of COMMANDS) {
    for (const key of bindings[cmd.id] ?? []) {
      const list = map.get(key) ?? [];
      list.push(cmd.id);
      map.set(key, list);
    }
  }
  return [...map.entries()]
    .filter(([, ids]) => ids.length > 1)
    .map(([key, commands]) => ({ key, commands }));
}

export function runCommand(id: string): void {
  const cmd = COMMANDS.find((c) => c.id === id);
  if (!cmd) return;
  try {
    localStorage.setItem(
      'ocg.recentCommands',
      JSON.stringify([id, ...(JSON.parse(localStorage.getItem('ocg.recentCommands') ?? '[]') as string[]).filter((x) => x !== id)].slice(0, 8)),
    );
  } catch {
    /* ignore */
  }
  void cmd.run();
}

export function comboFromEvent(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const key = e.key;
  if (!['Control', 'Alt', 'Shift', 'Meta'].includes(key)) {
    parts.push(key.length === 1 ? key.toUpperCase() : key);
  }
  return parts.join('+');
}

export function recentCommandIds(): string[] {
  try {
    return JSON.parse(localStorage.getItem('ocg.recentCommands') ?? '[]') as string[];
  } catch {
    return [];
  }
}
