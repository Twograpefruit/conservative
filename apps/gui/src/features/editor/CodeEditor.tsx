import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { LintDiagnostic } from '@ocg/protocol';
import type { EditorTab } from '../../store/editorStore.js';
import { loadLanguage, type SqlDialect } from './languages.js';

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
        ]),
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
          '&': { height: '100%', fontSize: '13px' },
          '.cm-scroller': { fontFamily: "'Cascadia Code', Consolas, monospace" },
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

  return <div className="cm-host" ref={host} />;
}
