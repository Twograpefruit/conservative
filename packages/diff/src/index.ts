/**
 * Unified-diff parsing, normalisation and pure hunk operations.
 * Used by the BFF (git/snapshots) and the GUI diff renderer.
 */

export type DiffLineKind = ' ' | '+' | '-' | '\\';

export interface DiffLine {
  kind: DiffLineKind;
  text: string;
}

export interface Hunk {
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  header: string;
  section: string;
  lines: DiffLine[];
}

export type FileStatus = 'added' | 'deleted' | 'modified' | 'renamed';

export interface FileDiff {
  path: string;
  oldPath?: string;
  status: FileStatus;
  binary: boolean;
  hunks: Hunk[];
  additions: number;
  deletions: number;
  /** Original per-file header lines (diff --git, index, mode...), useful to rebuild patches. */
  header: string[];
  patch: string;
  patchStart?: number;
  patchEnd?: number;
}

const HUNK_RE = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

function decodeGitPath(raw: string): string {
  let s = raw.trim();
  if (s.startsWith('"') && s.endsWith('"')) {
    s = s.slice(1, -1);
    s = s.replace(/\\(.)/g, (_m, ch: string) => {
      switch (ch) {
        case 'n':
          return '\n';
        case 't':
          return '\t';
        case 'r':
          return '\r';
        case '\\':
          return '\\';
        case '"':
          return '"';
        default:
          return ch;
      }
    });
  }
  return s;
}

function stripPrefix(p: string): string {
  if (p === '/dev/null') return p;
  const cleaned = decodeGitPath(p);
  return cleaned.replace(/^[ab]\//, '');
}

function parseFileHeader(line: string): { oldPath?: string; path?: string } | null {
  if (!line.startsWith('diff --git ')) return null;
  const rest = line.slice('diff --git '.length).trim();
  // Handles quoted paths and spaces; prefer the two last tokens when unquoted.
  const quoted = rest.match(/^("(?:[^"\\]|\\.)*"|\S+) +("(?:[^"\\]|\\.)*"|\S+)$/);
  if (!quoted) return { path: rest };
  return { oldPath: stripPrefix(quoted[1]), path: stripPrefix(quoted[2]) };
}

export function parseUnifiedDiff(input: string): FileDiff[] {
  if (!input.trim()) return [];
  const lines = input.replace(/\r\n/g, '\n').split('\n');
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let hunk: Hunk | null = null;
  let inBinary = false;

  const finishHunk = () => {
    if (current && hunk) current.hunks.push(hunk);
    hunk = null;
  };

  const finishFile = () => {
    finishHunk();
    if (current) {
      current.patch = buildPatch(current);
      delete current.patchStart;
      delete current.patchEnd;
      files.push(current);
    }
    current = null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.startsWith('diff --git ')) {
      finishFile();
      const header = parseFileHeader(line);
      current = {
        path: header?.path ?? '',
        oldPath: header?.oldPath,
        status: 'modified',
        binary: false,
        hunks: [],
        additions: 0,
        deletions: 0,
        header: [line],
        patch: '',
      };
      (current as { patchStart?: number }).patchStart = i;
      inBinary = false;
      continue;
    }
    if (!current) {
      if (line.startsWith('--- ')) {
        current = {
          path: '',
          status: 'modified',
          binary: false,
          hunks: [],
          additions: 0,
          deletions: 0,
          header: [],
          patch: '',
        };
        (current as { patchStart?: number }).patchStart = i;
      } else {
        continue;
      }
    }

    if (hunk) {
      if (line.startsWith('@@ ')) {
        finishHunk();
        hunk = parseHunkHeader(line);
        continue;
      }
      if (line.startsWith('\\')) {
        hunk.lines.push({ kind: '\\', text: line });
        continue;
      }
      if (line === '' && i === lines.length - 1) {
        continue;
      }
      const kind = line[0];
      if (kind === '+' || kind === '-' || kind === ' ') {
        hunk.lines.push({ kind, text: line.slice(1) });
        if (kind === '+') current.additions++;
        if (kind === '-') current.deletions++;
        continue;
      }
      // Anything else terminates the hunk (e.g. next file's metadata without diff --git).
      finishHunk();
      continue;
    }

    if (line.startsWith('@@ ')) {
      hunk = parseHunkHeader(line);
      continue;
    }

    current.header.push(line);

    if (line.startsWith('new file mode')) {
      current.status = 'added';
      current.oldPath = undefined;
    } else if (line.startsWith('deleted file mode')) {
      current.status = 'deleted';
    } else if (line.startsWith('rename from ')) {
      current.oldPath = decodeGitPath(line.slice('rename from '.length));
      current.status = 'renamed';
    } else if (line.startsWith('rename to ')) {
      current.path = decodeGitPath(line.slice('rename to '.length));
      current.status = 'renamed';
    } else if (line.startsWith('--- ')) {
      const p = stripPrefix(line.slice(4).split('\t')[0]);
      if (p === '/dev/null') current.status = 'added';
      else current.oldPath = p;
    } else if (line.startsWith('+++ ')) {
      const p = stripPrefix(line.slice(4).split('\t')[0]);
      if (p === '/dev/null') current.status = 'deleted';
      else current.path = p;
    } else if (line.startsWith('Binary files ') || line === 'GIT binary patch') {
      current.binary = true;
      inBinary = true;
    }
  }
  finishFile();

  for (const f of files) {
    if (f.status === 'added') f.oldPath = undefined;
    if (f.status === 'deleted') f.oldPath = f.oldPath ?? f.path;
    if (!f.path && f.oldPath) f.path = f.oldPath;
  }
  return files;
}

function parseHunkHeader(line: string): Hunk {
  const m = line.match(HUNK_RE);
  if (!m) {
    return { oldStart: 0, oldLines: 0, newStart: 0, newLines: 0, header: line, section: '', lines: [] };
  }
  return {
    oldStart: Number(m[1]),
    oldLines: m[2] === undefined ? 1 : Number(m[2]),
    newStart: Number(m[3]),
    newLines: m[4] === undefined ? 1 : Number(m[4]),
    header: line,
    section: m[5] ?? '',
    lines: [],
  };
}

export function countChanges(diff: Pick<FileDiff, 'hunks'>): { additions: number; deletions: number } {
  let additions = 0;
  let deletions = 0;
  for (const h of diff.hunks) {
    for (const l of h.lines) {
      if (l.kind === '+') additions++;
      else if (l.kind === '-') deletions++;
    }
  }
  return { additions, deletions };
}

export interface ApplyHunkOptions {
  reverse?: boolean;
  /** Allow the hunk to land at a different line by searching nearby. */
  offsetSearch?: number;
}

export class HunkApplyError extends Error {
  constructor(
    message: string,
    public readonly reason: 'context' | 'range',
  ) {
    super(message);
  }
}

export function detectEol(text: string): { eol: 'lf' | 'crlf' | 'mixed'; lf: number; crlf: number } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf === 0 && lf === 0) return { eol: 'lf', lf: 0, crlf: 0 };
  if (crlf === 0) return { eol: 'lf', lf, crlf };
  if (lf === 0) return { eol: 'crlf', lf, crlf };
  return { eol: 'mixed', lf, crlf };
}

function splitKeepingEol(text: string): { lines: string[]; eols: string[] } {
  const lines: string[] = [];
  const eols: string[] = [];
  const re = /([^\r\n]*)(\r\n|\n|\r|$)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    if (m[0] === '') break;
    lines.push(m[1]);
    eols.push(m[2]);
    if (m[2] === '') break;
  }
  return { lines, eols };
}

/**
 * Apply one hunk to file content. Strict context by default (matches `git apply`).
 * Line endings of untouched lines and the file's dominant EOL are preserved.
 */
export function applyHunk(content: string, hunk: Hunk, options: ApplyHunkOptions = {}): string {
  const reverse = options.reverse ?? false;
  const { lines, eols } = splitKeepingEol(content);
  const eol = eols.find((e) => e === '\r\n' || e === '\n') ?? '\n';
  const oldStart = reverse ? hunk.newStart : hunk.oldStart;
  const source = reverse
    ? hunk.lines
        .map((l) => (l.kind === '+' ? { ...l, kind: '-' as const } : l.kind === '-' ? { ...l, kind: '+' as const } : l))
        .filter((l) => l.kind !== '\\')
    : hunk.lines.filter((l) => l.kind !== '\\');

  const oldSeq = source.filter((l) => l.kind === ' ' || l.kind === '-').map((l) => l.text);
  const newSeq = source.filter((l) => l.kind === ' ' || l.kind === '+').map((l) => l.text);

  const tryAt = (start: number): boolean => {
    const idx = Math.max(0, start - 1);
    if (idx + oldSeq.length > lines.length) return false;
    for (let i = 0; i < oldSeq.length; i++) {
      if (lines[idx + i] !== oldSeq[i]) return false;
    }
    return true;
  };

  let idx = Math.max(0, oldStart - 1);
  if (!tryAt(oldStart)) {
    const search = options.offsetSearch ?? 0;
    let found = -1;
    for (let delta = 1; delta <= search; delta++) {
      if (oldStart - 1 - delta >= 0 && tryAt(oldStart - delta)) {
        found = oldStart - delta;
        break;
      }
      if (tryAt(oldStart + delta)) {
        found = oldStart + delta;
        break;
      }
    }
    if (found < 0) {
      throw new HunkApplyError(`hunk context does not match at line ${oldStart}`, 'context');
    }
    idx = found - 1;
  }

  if (idx < 0 || idx > lines.length) {
    throw new HunkApplyError(`hunk line ${oldStart} is outside the file`, 'range');
  }

  const endsWithEol = content.endsWith('\n') || content.endsWith('\r');
  const out: string[] = [];
  for (let i = 0; i < idx; i++) out.push(lines[i] + (eols[i] || eol));
  for (let i = 0; i < newSeq.length; i++) {
    const isLast = idx + i === lines.length - 1;
    out.push(newSeq[i] + (isLast && !endsWithEol ? '' : eol));
  }
  for (let i = idx + oldSeq.length; i < lines.length; i++) {
    out.push(lines[i] + (eols[i] || eol));
  }
  let result = out.join('');
  if (!endsWithEol) result = result.replace(/(\r\n|\n|\r)$/, '');
  return result;
}

export function applyHunks(content: string, hunks: Hunk[], options: ApplyHunkOptions = {}): string {
  let out = content;
  // Applying bottom-up keeps earlier hunk line numbers valid.
  const ordered = [...hunks].sort((a, b) => b.oldStart - a.oldStart);
  for (const h of ordered) out = applyHunk(out, h, options);
  return out;
}

/** Rebuild a valid `git apply` patch for one file (all hunks) or one hunk. */
export function buildPatch(file: FileDiff, hunkIndex?: number): string {
  const hunks = hunkIndex == null ? file.hunks : file.hunks[hunkIndex] ? [file.hunks[hunkIndex]] : [];
  const header = file.header.filter(
    (l) =>
      l.startsWith('diff --git') ||
      l.startsWith('index ') ||
      l.startsWith('new file mode') ||
      l.startsWith('deleted file mode') ||
      l.startsWith('old mode') ||
      l.startsWith('new mode') ||
      l.startsWith('similarity index') ||
      l.startsWith('rename from') ||
      l.startsWith('rename to'),
  );
  const aPath = file.status === 'added' ? '/dev/null' : `a/${file.oldPath ?? file.path}`;
  const bPath = file.status === 'deleted' ? '/dev/null' : `b/${file.path}`;
  const lines = [
    `diff --git a/${file.oldPath ?? file.path} b/${file.path}`,
    ...header.filter((l) => !l.startsWith('diff --git')),
    `--- ${aPath}`,
    `+++ ${bPath}`,
    ...hunks.flatMap((h) => [
      `@@ -${h.oldStart},${h.oldLines} +${h.newStart},${h.newLines} @@${h.section ? ' ' + h.section : ''}`,
      ...h.lines.map((l) => (l.kind === '\\' ? l.text : l.kind + l.text)),
    ]),
    '',
  ];
  return lines.join('\n');
}

export function reverseHunk(hunk: Hunk): Hunk {
  return {
    ...hunk,
    oldStart: hunk.newStart,
    oldLines: hunk.newLines,
    newStart: hunk.oldStart,
    newLines: hunk.oldLines,
    lines: hunk.lines.map((l) =>
      l.kind === '+' ? { kind: '-' as const, text: l.text } : l.kind === '-' ? { kind: '+' as const, text: l.text } : l,
    ),
  };
}

export function reverseFileDiff(file: FileDiff): FileDiff {
  return {
    ...file,
    path: file.oldPath ?? file.path,
    oldPath: file.path,
    status: file.status === 'added' ? 'deleted' : file.status === 'deleted' ? 'added' : file.status,
    hunks: file.hunks.map(reverseHunk),
    additions: file.deletions,
    deletions: file.additions,
  };
}

/** Rebuild a reverse `git apply -R` patch (headers and ranges swapped). */
export function buildReversePatch(file: FileDiff, hunkIndex?: number): string {
  const reversed = reverseFileDiff(file);
  if (hunkIndex != null && reversed.hunks[hunkIndex]) {
    reversed.hunks = [reversed.hunks[hunkIndex]];
  }
  return buildPatch(reversed);
}

export function summarize(files: FileDiff[]): { files: number; additions: number; deletions: number } {
  return files.reduce(
    (acc, f) => ({ files: acc.files + 1, additions: acc.additions + f.additions, deletions: acc.deletions + f.deletions }),
    { files: 0, additions: 0, deletions: 0 },
  );
}
