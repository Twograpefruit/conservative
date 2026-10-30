import React, { useEffect, useRef, useState } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap, hoverTooltip, type Tooltip } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { LintDiagnostic } from '@ocg/protocol';
import type { EditorTab } from '../../store/editorStore.js';
import { loadLanguage, type SqlDialect } from './languages.js';

interface SymbolDef {
  name: string;
  from: number;
  line: number;
  signature: string;
  doc: string;
}

function wordAt(state: EditorState, pos: number): { name: string; from: number; to: number } | null {
  const line = state.doc.lineAt(pos);
  const text = line.text;
  const col = pos - line.from;
  if (!/[A-Za-z0-9_$]/.test(text[col] ?? text[col - 1] ?? '')) return null;
  let start = col;
  let end = col;
  while (start > 0 && /[A-Za-z0-9_$]/.test(text[start - 1])) start--;
  while (end < text.length && /[A-Za-z0-9_$]/.test(text[end])) end++;
  const name = text.slice(start, end);
  if (!name || /^\d/.test(name)) return null;
  return { name, from: line.from + start, to: line.from + end };
}

function docAbove(state: EditorState, lineNumber: number): string {
  const out: string[] = [];
  for (let n = lineNumber - 1; n >= 1 && out.length < 6; n--) {
    const text = state.doc.line(n).text.trim();
    if (!text) break;
    if (/^(\/\/|#|\*|\/\*|\*\/)/.test(text)) {
      out.unshift(text.replace(/^(\/\/|#|\*|\/\*+|\*+\/)\s?/, ''));
      continue;
    }
    break;
  }
  return out.join('\n').trim();
}

function findDefinitions(state: EditorState, name: string): SymbolDef[] {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const patterns = [
    new RegExp(`\\b(?:export\\s+)?(?:async\\s+)?function\\s+${escaped}\\b`),
    new RegExp(`\\b(?:export\\s+)?(?:const|let|var)\\s+${escaped}\\b`),
    new RegExp(`\\bclass\\s+${escaped}\\b`),
    new RegExp(`\\b(?:interface|type|enum|struct|trait)\\s+${escaped}\\b`),
    new RegExp(`\\bdef\\s+${escaped}\\b`),
    new RegExp(`\\bfunc\\s+(?:\\([^)]*\\)\\s*)?${escaped}\\b`),
    new RegExp(`\\bfn\\s+${escaped}\\b`),
    new RegExp(`^\\s*(?:(?:public|private|protected|static|async|readonly|override|export)\\s+)*${escaped}\\s*\\([^)]*\\)\\s*(?::[^{]+)?\\{`),
  ];
  const out: SymbolDef[] = [];
  const seen = new Set<number>();
  for (let n = 1; n <= state.doc.lines; n++) {
    const line = state.doc.line(n);
    const text = line.text;
    if (!text.includes(name)) continue;
    if (!patterns.some((re) => re.test(text))) continue;
    const idx = text.indexOf(name);
    if (idx < 0 || seen.has(n)) continue;
    seen.add(n);
    const signature = text.trim().replace(/\s+/g, ' ').slice(0, 180);
    out.push({
      name,
      from: line.from + idx,
      line: n,
      signature,
      doc: docAbove(state, n),
    });
    if (out.length >= 20) break;
  }
  return out;
}

function tooltipDom(def: SymbolDef, onJump: (def: SymbolDef) => void): HTMLElement {
  const dom = document.createElement('div');
  dom.className = 'code-symbol-tooltip';
  const head = document.createElement('button');
  head.type = 'button';
  head.className = 'code-symbol-head';
  head.textContent = `${def.name} · 第 ${def.line} 行`;
  head.onclick = () => onJump(def);
  const signature = document.createElement('code');
  signature.className = 'code-symbol-signature';
  signature.textContent = def.signature;
  dom.append(head, signature);
  if (def.doc) {
    const details = document.createElement('details');
    const summary = document.createElement('summary');
    summary.textContent = '定义注释';
    const pre = document.createElement('pre');
    pre.textContent = def.doc;
    details.append(summary, pre);
    dom.append(details);
  }
  return dom;
}

export function CodeEditor({
  tab,
  diagnostics,
  onChange,
  onSave,
  onCursor,
  onSelection,
  onLanguage,
  onScrollRatio,
  jumpLine,
  languageOverride,
  sqlDialect,
  theme = 'dark',
}: {
  tab: EditorTab;
  diagnostics: LintDiagnostic[];
  onChange: (content: string) => void;
  onSave: () => void;
  onCursor?: (line: number, column: number) => void;
  onSelection?: (selection: { from: number; to: number; text: string } | null) => void;
  onLanguage?: (name: string) => void;
  onScrollRatio?: (ratio: number) => void;
  jumpLine?: { line: number; nonce: number } | null;
  languageOverride?: string | null;
  sqlDialect?: SqlDialect;
  theme?: 'dark' | 'light';
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const languageCompartment = useRef(new Compartment());
  const themeCompartment = useRef(new Compartment());
  const backStack = useRef<number[]>([]);
  const jumpRef = useRef<(def: SymbolDef) => void>(() => undefined);
  const backRef = useRef<() => void>(() => undefined);
  const [defList, setDefList] = useState<{ x: number; y: number; items: SymbolDef[] } | null>(null);
  const [backCount, setBackCount] = useState(0);
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  const cursorRef = useRef(onCursor);
  const selectionRef = useRef(onSelection);
  const languageRef = useRef(onLanguage);
  const scrollRef = useRef(onScrollRatio);
  saveRef.current = onSave;
  changeRef.current = onChange;
  cursorRef.current = onCursor;
  selectionRef.current = onSelection;
  languageRef.current = onLanguage;
  scrollRef.current = onScrollRatio;

  jumpRef.current = (def) => {
    const instance = view.current;
    if (!instance) return;
    backStack.current.push(instance.state.selection.main.head);
    setBackCount(backStack.current.length);
    instance.dispatch({
      selection: { anchor: def.from },
      effects: EditorView.scrollIntoView(def.from, { y: 'center' }),
    });
    instance.focus();
    setDefList(null);
  };

  backRef.current = () => {
    const instance = view.current;
    const pos = backStack.current.pop();
    setBackCount(backStack.current.length);
    if (!instance || pos === undefined) return;
    instance.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    instance.focus();
  };

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: tab.content,
      extensions: [
        basicSetup,
        themeCompartment.current.of(theme === 'dark' ? oneDark : []),
        lintGutter(),
        EditorState.readOnly.of(tab.readonly),
        languageCompartment.current.of([]),
        keymap.of([
          {
            key: 'Mod-s',
            preventDefault: true,
            run: () => {
              saveRef.current();
              return true;
            },
          },
          ...defaultKeymap,
          ...historyKeymap,
          {
            key: 'Mod-Alt-ArrowLeft',
            preventDefault: true,
            run: () => {
              backRef.current();
              return true;
            },
          },
          {
            key: 'Escape',
            run: () => {
              setDefList(null);
              return false;
            },
          },
        ]),
        hoverTooltip((editorView, pos) => {
          const word = wordAt(editorView.state, pos);
          if (!word) return null;
          const defs = findDefinitions(editorView.state, word.name);
          if (!defs.length) return null;
          const tooltip: Tooltip = {
            pos: word.from,
            end: word.to,
            above: true,
            create: () => ({ dom: tooltipDom(defs[0], (def) => jumpRef.current(def)) }),
          };
          return tooltip;
        }),
        EditorView.domEventHandlers({
          mousedown(event, editorView) {
            if (!(event.ctrlKey || event.metaKey) || event.button !== 0) return false;
            const pos = editorView.posAtCoords({ x: event.clientX, y: event.clientY });
            if (pos == null) return false;
            const word = wordAt(editorView.state, pos);
            if (!word) return false;
            const defs = findDefinitions(editorView.state, word.name);
            if (!defs.length) return false;
            event.preventDefault();
            if (defs.length === 1) {
              jumpRef.current(defs[0]);
            } else {
              setDefList({ x: event.clientX, y: event.clientY, items: defs });
            }
            return true;
          },
        }),
        EditorView.updateListener.of((update) => {
          if (update.docChanged) changeRef.current(update.state.doc.toString());
          if (update.selectionSet || update.docChanged) {
            const sel = update.state.selection.main;
            const pos = sel.head;
            const line = update.state.doc.lineAt(pos);
            cursorRef.current?.(line.number, pos - line.from + 1);
            if (sel.from === sel.to) selectionRef.current?.(null);
            else
              selectionRef.current?.({
                from: sel.from,
                to: sel.to,
                text: update.state.doc.sliceString(sel.from, sel.to),
              });
          }
        }),
        EditorView.theme({
          '&': { height: '100%', fontSize: 'var(--code-font-size, 13px)' },
          '.cm-scroller': { fontFamily: "var(--code-font-family, 'Cascadia Code', Consolas, monospace)" },
        }),
      ],
    });
    const instance = new EditorView({ state, parent: host.current });
    view.current = instance;
    const onScroll = () => {
      const el = instance.scrollDOM;
      const max = Math.max(1, el.scrollHeight - el.clientHeight);
      scrollRef.current?.(el.scrollTop / max);
    };
    instance.scrollDOM.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      instance.scrollDOM.removeEventListener('scroll', onScroll);
      instance.destroy();
      view.current = null;
    };
    // Remount per tab (keyed by path) keeps undo history scoped and avoids model drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path]);

  useEffect(() => {
    setDefList(null);
    backStack.current = [];
    setBackCount(0);
  }, [tab.path]);

  useEffect(() => {
    if (!view.current) return;
    let cancelled = false;
    void loadLanguage(tab.path, { override: languageOverride, sqlDialect }).then(({ name, extension }) => {
      if (cancelled || !view.current) return;
      view.current.dispatch({ effects: languageCompartment.current.reconfigure(extension) });
      languageRef.current?.(name);
    });
    return () => {
      cancelled = true;
    };
  }, [tab.path, languageOverride, sqlDialect]);

  useEffect(() => {
    if (!view.current) return;
    view.current.dispatch({
      effects: themeCompartment.current.reconfigure(theme === 'dark' ? oneDark : []),
    });
  }, [theme]);

  useEffect(() => {
    if (!view.current) return;
    if (view.current.state.doc.toString() !== tab.content) {
      view.current.dispatch({
        changes: { from: 0, to: view.current.state.doc.length, insert: tab.content },
      });
    }
  }, [tab.content]);

  useEffect(() => {
    if (!view.current) return;
    const diags: Diagnostic[] = diagnostics
      .filter((d) => d.line >= 1 && d.line <= view.current!.state.doc.lines)
      .map((d) => {
        const doc = view.current!.state.doc;
        const line = doc.line(Math.min(d.line, doc.lines));
        const from = Math.min(line.from + Math.max(0, d.column - 1), line.to);
        const endLine = d.endLine && d.endLine !== d.line ? doc.line(Math.min(d.endLine, doc.lines)) : line;
        const to = Math.max(from + 1, Math.min(endLine.from + (d.endColumn ?? d.column + 1) - 1, endLine.to));
        return {
          from,
          to,
          severity: d.severity === 'error' ? 'error' : d.severity === 'warning' ? 'warning' : 'info',
          message: `[${d.source}${d.code ? ' ' + d.code : ''}] ${d.message}`,
        } as Diagnostic;
      });
    view.current.dispatch(setDiagnostics(view.current.state, diags));
  }, [diagnostics, tab.content]);

  useEffect(() => {
    if (!view.current || !jumpLine) return;
    const doc = view.current.state.doc;
    const line = doc.line(Math.min(Math.max(1, jumpLine.line), doc.lines));
    view.current.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
    view.current.focus();
  }, [jumpLine?.nonce, jumpLine?.line, tab.path]);

  return (
    <div className="cm-host-wrap">
      <div className="cm-host" ref={host} />
      {backCount > 0 ? (
        <button className="editor-back-btn" onClick={() => backRef.current()} title="返回上一个定义（Mod+Alt+←）">
          ← 返回
        </button>
      ) : null}
      {defList ? (
        <div
          className="code-symbol-list"
          style={{
            left: Math.min(defList.x, window.innerWidth - 360),
            top: Math.min(defList.y, window.innerHeight - 240),
          }}
        >
          <div className="code-symbol-list-head">
            <span>找到 {defList.items.length} 个定义/调用</span>
            <button className="icon-btn" onClick={() => setDefList(null)}>
              ×
            </button>
          </div>
          {defList.items.map((def) => (
            <button
              key={`${def.line}-${def.from}`}
              className="code-symbol-item"
              onClick={() => jumpRef.current(def)}
            >
              <span className="code-symbol-line">L{def.line}</span>
              <code>{def.signature}</code>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
