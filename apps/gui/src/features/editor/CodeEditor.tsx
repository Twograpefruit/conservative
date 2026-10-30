import React, { useEffect, useRef } from 'react';
import { basicSetup } from 'codemirror';
import { EditorState, Compartment, type Extension } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap, historyKeymap } from '@codemirror/commands';
import { python } from '@codemirror/lang-python';
import { javascript } from '@codemirror/lang-javascript';
import { json } from '@codemirror/lang-json';
import { markdown } from '@codemirror/lang-markdown';
import { oneDark } from '@codemirror/theme-one-dark';
import { lintGutter, setDiagnostics, type Diagnostic } from '@codemirror/lint';
import type { LintDiagnostic } from '@ocg/protocol';
import type { EditorTab } from '../../store/editorStore.js';

function languageFor(path: string): Extension {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'py':
    case 'pyi':
      return python();
    case 'js':
    case 'jsx':
      return javascript({ jsx: true });
    case 'ts':
    case 'tsx':
      return javascript({ jsx: true, typescript: true });
    case 'json':
      return json();
    case 'md':
      return markdown();
    default:
      return [];
  }
}

export function CodeEditor({
  tab,
  diagnostics,
  onChange,
  onSave,
  onCursor,
  jumpLine,
}: {
  tab: EditorTab;
  diagnostics: LintDiagnostic[];
  onChange: (content: string) => void;
  onSave: () => void;
  onCursor?: (line: number, column: number) => void;
  jumpLine?: number | null;
}) {
  const host = useRef<HTMLDivElement>(null);
  const view = useRef<EditorView | null>(null);
  const saveRef = useRef(onSave);
  const changeRef = useRef(onChange);
  const cursorRef = useRef(onCursor);
  saveRef.current = onSave;
  changeRef.current = onChange;
  cursorRef.current = onCursor;

  useEffect(() => {
    if (!host.current) return;
    const state = EditorState.create({
      doc: tab.content,
      extensions: [
        basicSetup,
        oneDark,
        lintGutter(),
        EditorState.readOnly.of(tab.readonly),
        languageFor(tab.path),
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
            const pos = update.state.selection.main.head;
            const line = update.state.doc.lineAt(pos);
            cursorRef.current?.(line.number, pos - line.from + 1);
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
    return () => {
      instance.destroy();
      view.current = null;
    };
    // Remount per tab (keyed by path) keeps undo history scoped and avoids model drift.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab.path]);

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
    const line = doc.line(Math.min(Math.max(1, jumpLine), doc.lines));
    view.current.dispatch({
      selection: { anchor: line.from },
      effects: EditorView.scrollIntoView(line.from, { y: 'center' }),
    });
  }, [jumpLine, tab.path]);

  return <div className="cm-host" ref={host} />;
}
