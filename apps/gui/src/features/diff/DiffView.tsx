import React, { useMemo, useState } from 'react';
import type { FileDiff } from '@ocg/diff';

export interface HunkAction {
  label: string;
  action: (file: FileDiff, hunkIndex: number) => void;
  variant?: 'primary' | 'danger';
}

export interface LineChange {
  kind: 'add' | 'del';
  newLine: number;
  text: string;
}

interface DiffLine {
  kind: ' ' | '+' | '-';
  text: string;
  oldNo?: number;
  newNo?: number;
}

interface SplitRow {
  left?: DiffLine;
  right?: DiffLine;
}

function splitRows(lines: FileDiff['hunks'][number]['lines'], oldStart: number, newStart: number): SplitRow[] {
  const numbered: DiffLine[] = [];
  let oldLine = oldStart;
  let newLine = newStart;
  for (const line of lines) {
    if (line.kind === '\\') continue;
    if (line.kind === '-') numbered.push({ kind: '-', text: line.text, oldNo: oldLine++, newNo: newLine });
    else if (line.kind === '+') numbered.push({ kind: '+', text: line.text, newNo: newLine++ });
    else numbered.push({ kind: ' ', text: line.text, oldNo: oldLine++, newNo: newLine++ });
  }
  const rows: SplitRow[] = [];
  let i = 0;
  while (i < numbered.length) {
    const line = numbered[i];
    if (line.kind === ' ') {
      rows.push({ left: line, right: line });
      i += 1;
      continue;
    }
    const dels: DiffLine[] = [];
    const adds: DiffLine[] = [];
    while (i < numbered.length && numbered[i].kind !== ' ') {
      if (numbered[i].kind === '-') dels.push(numbered[i]);
      else adds.push(numbered[i]);
      i += 1;
    }
    for (let k = 0; k < Math.max(dels.length, adds.length); k++) {
      rows.push({ left: dels[k], right: adds[k] });
    }
  }
  return rows;
}

export function DiffView({
  files,
  actions,
  emptyText = '没有差异',
  onOverwrite,
}: {
  files: FileDiff[];
  actions?: HunkAction[];
  emptyText?: string;
  onOverwrite?: (file: FileDiff, changes: LineChange[]) => void;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const total = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  if (files.length === 0) return <div className="empty-hint">{emptyText}</div>;

  const toggle = (key: string) => setSelected((s) => ({ ...s, [key]: !s[key] }));

  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span>{files.length} 个文件</span>
        <span className="diff-add">+{total.additions}</span>
        <span className="diff-del">-{total.deletions}</span>
        <span className="spacer" />
        <span className="muted small">左右对比 · 勾选变更行后覆盖</span>
      </div>
      {files.map((file, fi) => {
        const isCollapsed = collapsed[file.path] ?? fi > 7;
        return (
          <div className="diff-file" key={`${file.path}-${fi}`}>
            <button
              className="diff-file-head"
              onClick={() => setCollapsed((s) => ({ ...s, [file.path]: !isCollapsed }))}
            >
              <span className="diff-caret">{isCollapsed ? '▸' : '▾'}</span>
              <span className={`diff-status status-${file.status}`}>{statusLabel(file.status)}</span>
              <span className="diff-path">{file.path}</span>
              {file.oldPath && file.oldPath !== file.path ? <span className="diff-old">← {file.oldPath}</span> : null}
              <span className="spacer" />
              <span className="diff-add">+{file.additions}</span>
              <span className="diff-del">-{file.deletions}</span>
            </button>
            {!isCollapsed ? (
              <div className="diff-body">
                {file.binary ? <div className="empty-hint">二进制文件</div> : null}
                {file.hunks.map((hunk, hi) => {
                  const rows = splitRows(hunk.lines, hunk.oldStart, hunk.newStart);
                  const keys = rows.flatMap((row, ri) => [
                    row.left?.kind === '-' ? `${file.path}:${hi}:${ri}:l` : '',
                    row.right?.kind === '+' ? `${file.path}:${hi}:${ri}:r` : '',
                  ]).filter(Boolean);
                  const picked = keys.filter((k) => selected[k]);
                  const changes: LineChange[] = [];
                  rows.forEach((row, ri) => {
                    if (row.left?.kind === '-' && selected[`${file.path}:${hi}:${ri}:l`] && row.left.newNo) {
                      changes.push({ kind: 'del', newLine: row.left.newNo, text: row.left.text });
                    }
                    if (row.right?.kind === '+' && selected[`${file.path}:${hi}:${ri}:r`] && row.right.newNo) {
                      changes.push({ kind: 'add', newLine: row.right.newNo, text: row.right.text });
                    }
                  });
                  return (
                    <div className="hunk" key={`${hunk.header}-${hi}`}>
                      <div className="hunk-head">
                        <span className="hunk-range">{hunk.header.replace(/^@@ [^@]+ @@ ?/, '') || hunk.header}</span>
                        <span className="hunk-meta">
                          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
                        </span>
                        <span className="spacer" />
                        {onOverwrite ? (
                          <button
                            className="btn btn-tiny"
                            onClick={() => {
                              const allPicked = keys.every((k) => selected[k]);
                              setSelected((s) => {
                                const next = { ...s };
                                for (const k of keys) {
                                  if (allPicked) delete next[k];
                                  else next[k] = true;
                                }
                                return next;
                              });
                            }}
                          >
                            {keys.every((k) => selected[k]) ? '取消本块' : '选中本块'}
                          </button>
                        ) : null}
                        {onOverwrite ? (
                          <button
                            className="btn btn-tiny btn-primary"
                            disabled={changes.length === 0}
                            onClick={() => {
                              onOverwrite(file, changes);
                              setSelected((s) => {
                                const next = { ...s };
                                for (const k of picked) delete next[k];
                                return next;
                              });
                            }}
                          >
                            覆盖选中{picked.length ? ` (${picked.length})` : ''}
                          </button>
                        ) : null}
                        {actions?.map((a) => (
                          <button
                            key={a.label}
                            className={`btn btn-tiny ${a.variant === 'primary' ? 'btn-primary' : ''} ${
                              a.variant === 'danger' ? 'btn-danger' : ''
                            }`}
                            onClick={() => a.action(file, hi)}
                          >
                            {a.label}
                          </button>
                        ))}
                      </div>
                      <div className="diff-split">
                        <div className="diff-split-head">
                          <span>原版本</span>
                          <span>工作区 / 新版本</span>
                        </div>
                        {rows.map((row, ri) => (
                          <div className="diff-split-row" key={ri}>
                            <div className={`diff-half ${row.left?.kind === '-' ? 'diff-del' : row.left ? 'diff-ctx' : 'diff-empty'}`}>
                              {row.left?.kind === '-' ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(selected[`${file.path}:${hi}:${ri}:l`])}
                                  onChange={() => toggle(`${file.path}:${hi}:${ri}:l`)}
                                  title="选中此行并覆盖回原版本"
                                />
                              ) : (
                                <span className="pick-space" />
                              )}
                              <span className="ln">{row.left?.oldNo ?? ''}</span>
                              <span className="code">{row.left?.text ?? ''}</span>
                            </div>
                            <div className={`diff-half ${row.right?.kind === '+' ? 'diff-add' : row.right ? 'diff-ctx' : 'diff-empty'}`}>
                              {row.right?.kind === '+' ? (
                                <input
                                  type="checkbox"
                                  checked={Boolean(selected[`${file.path}:${hi}:${ri}:r`])}
                                  onChange={() => toggle(`${file.path}:${hi}:${ri}:r`)}
                                  title="选中此行并从工作区移除"
                                />
                              ) : (
                                <span className="pick-space" />
                              )}
                              <span className="ln">{row.right?.newNo ?? ''}</span>
                              <span className="code">{row.right?.text ?? ''}</span>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                {file.hunks.length === 0 && !file.binary ? <div className="empty-hint">无文本差异</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function statusLabel(status: FileDiff['status']): string {
  switch (status) {
    case 'added':
      return 'A';
    case 'deleted':
      return 'D';
    case 'renamed':
      return 'R';
    default:
      return 'M';
  }
}
