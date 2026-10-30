import React, { useMemo, useState } from 'react';
import type { FileDiff } from '@ocg/diff';

export interface HunkAction {
  label: string;
  action: (file: FileDiff, hunkIndex: number) => void;
  variant?: 'primary' | 'danger';
}

export function DiffView({
  files,
  actions,
  emptyText = '没有差异',
}: {
  files: FileDiff[];
  actions?: HunkAction[];
  emptyText?: string;
}) {
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const total = useMemo(
    () =>
      files.reduce(
        (acc, f) => ({ additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
        { additions: 0, deletions: 0 },
      ),
    [files],
  );

  if (files.length === 0) return <div className="empty-hint">{emptyText}</div>;

  return (
    <div className="diff-view">
      <div className="diff-summary">
        <span>{files.length} 个文件</span>
        <span className="diff-add">+{total.additions}</span>
        <span className="diff-del">-{total.deletions}</span>
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
                {file.hunks.map((hunk, hi) => (
                  <HunkBlock
                    key={`${hunk.header}-${hi}`}
                    hunk={hunk}
                    actions={actions?.map((a) => ({ ...a, run: () => a.action(file, hi) }))}
                  />
                ))}
                {file.hunks.length === 0 && !file.binary ? <div className="empty-hint">无文本差异</div> : null}
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}

function HunkBlock({
  hunk,
  actions,
}: {
  hunk: FileDiff['hunks'][number];
  actions?: Array<HunkAction & { run: () => void }>;
}) {
  let oldLine = hunk.oldStart;
  let newLine = hunk.newStart;
  return (
    <div className="hunk">
      <div className="hunk-head">
        <span className="hunk-range">{hunk.header.replace(/^@@ [^@]+ @@ ?/, '') || hunk.header}</span>
        <span className="hunk-meta">
          -{hunk.oldStart},{hunk.oldLines} +{hunk.newStart},{hunk.newLines}
        </span>
        <span className="spacer" />
        {actions?.map((a) => (
          <button
            key={a.label}
            className={`btn btn-tiny ${a.variant === 'primary' ? 'btn-primary' : ''} ${a.variant === 'danger' ? 'btn-danger' : ''}`}
            onClick={a.run}
          >
            {a.label}
          </button>
        ))}
      </div>
      <div className="hunk-lines">
        {hunk.lines.map((line, i) => {
          if (line.kind === '\\') {
            return (
              <div className="diff-line diff-note" key={i}>
                {line.text}
              </div>
            );
          }
          const oldNo = line.kind === '+' ? '' : String(oldLine++);
          const newNo = line.kind === '-' ? '' : String(newLine++);
          return (
            <div className={`diff-line diff-${line.kind === ' ' ? 'ctx' : line.kind === '+' ? 'add' : 'del'}`} key={i}>
              <span className="ln old">{oldNo}</span>
              <span className="ln new">{newNo}</span>
              <span className="sign">{line.kind === ' ' ? ' ' : line.kind}</span>
              <span className="code">{line.text || ' '}</span>
            </div>
          );
        })}
      </div>
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
