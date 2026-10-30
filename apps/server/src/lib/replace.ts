import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { paths } from '@ocg/config';
import type { ReplaceApplyResult, ReplaceOptions, ReplacePreview, ReplacePreviewFile } from '@ocg/protocol';
import { HttpError, badRequest, conflict } from './http.js';
import { collectSearch, buildMatcher, type SearchContext } from './search.js';
import { decodeText, encodeText, hashBuffer, isProbablyBinary, normalizeEol, applyEol, resolveInWorkspace } from './fsutil.js';
import type { RuntimeHost } from '@ocg/host';

interface PlannedFile {
  abs: string;
  rel: string;
  before: string;
  after: string;
  eol: 'lf' | 'crlf' | 'mixed';
  eolTarget: 'lf' | 'crlf';
  bom: boolean;
  raw: Buffer;
  hash: string;
  mtime: number;
  matches: number;
}

interface ReplacePlan {
  id: string;
  ws: string;
  root: string;
  createdAt: number;
  options: ReplaceOptions;
  files: PlannedFile[];
  skipped: Array<{ path: string; reason: string }>;
  preview: ReplacePreview;
}

const MAX_PLAN_AGE = 30 * 60 * 1000;

export class ReplaceService {
  private plans = new Map<string, ReplacePlan>();
  private undos = new Map<string, { id: string; planId: string; dir: string; root: string; files: Array<{ rel: string; hash: string }> }>();

  constructor(
    private readonly host: RuntimeHost,
    private readonly searchCtx: SearchContext,
  ) {}

  private gc(): void {
    const now = Date.now();
    for (const [id, plan] of this.plans) if (now - plan.createdAt > MAX_PLAN_AGE) this.plans.delete(id);
  }

  async preview(root: string, options: ReplaceOptions): Promise<ReplacePreview> {
    this.gc();
    if (!options.query) badRequest('query is required');
    const { files: hits, truncated: hitsTruncated } = await collectSearch(this.searchCtx, root, {
      ws: options.ws,
      query: options.query,
      regex: options.regex,
      caseSensitive: options.caseSensitive,
      wholeWord: options.wholeWord,
      glob: options.glob,
      maxResults: 5000,
    });
    const re = buildMatcher(options);
    const files: PlannedFile[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    const previewFiles: ReplacePreviewFile[] = [];
    let totalMatches = 0;
    let totalBytes = 0;
    let planTruncated = hitsTruncated;

    for (const hit of hits) {
      if (files.length >= 500 || totalBytes > 32 * 1024 * 1024) {
        planTruncated = true;
        break;
      }
      let abs: string;
      try {
        abs = resolveInWorkspace(root, hit.path);
      } catch {
        skipped.push({ path: hit.path, reason: 'path escapes workspace' });
        continue;
      }
      let buf: Buffer;
      try {
        const stat = await fs.promises.stat(abs);
        if (!stat.isFile()) continue;
        if (stat.size > 2 * 1024 * 1024) {
          skipped.push({ path: hit.path, reason: 'file is larger than 2 MB' });
          continue;
        }
        buf = await fs.promises.readFile(abs);
      } catch {
        skipped.push({ path: hit.path, reason: 'unreadable' });
        continue;
      }
      if (isProbablyBinary(buf)) {
        skipped.push({ path: hit.path, reason: 'binary file' });
        continue;
      }
      const decoded = decodeText(buf);
      if (decoded.encoding !== 'utf-8') {
        skipped.push({ path: hit.path, reason: 'non UTF-8 encoding' });
        continue;
      }
      const before = normalizeEol(decoded.text);
      const count = countMatches(before, re);
      if (count === 0) continue;
      const after = replaceAll(before, re, options.replacement, options.preserveCase ?? false);
      const eol: PlannedFile['eol'] = decoded.text.includes('\r\n')
        ? /(^|[^\r])\n/.test(decoded.text)
          ? 'mixed'
          : 'crlf'
        : 'lf';
      const beforeLines = before.split('\n');
      const afterLines = after.split('\n');
      const sample: ReplacePreviewFile['sample'] = [];
      for (let i = 0; i < beforeLines.length && sample.length < 3; i++) {
        if (beforeLines[i] !== afterLines[i]) {
          sample.push({ line: i + 1, before: beforeLines[i].slice(0, 400), after: (afterLines[i] ?? '').slice(0, 400) });
        }
      }
      files.push({
        abs,
        rel: hit.path,
        before,
        after,
        eol,
        eolTarget: eol === 'crlf' ? 'crlf' : 'lf',
        bom: decoded.bom,
        raw: buf,
        hash: hashBuffer(buf),
        mtime: (await fs.promises.stat(abs)).mtimeMs,
        matches: count,
      });
      totalMatches += count;
      totalBytes += buf.length;
      previewFiles.push({ path: hit.path, matches: count, sample });
    }

    const id = randomUUID();
    const preview: ReplacePreview = {
      id,
      files: previewFiles,
      totalMatches,
      totalFiles: files.length,
      skippedFiles: skipped.length,
      truncated: planTruncated || previewFiles.length >= 4999,
    };
    this.plans.set(id, {
      id,
      ws: options.ws,
      root,
      createdAt: Date.now(),
      options,
      files,
      skipped,
      preview,
    });
    return preview;
  }

  async apply(planId: string): Promise<ReplaceApplyResult> {
    this.gc();
    const plan = this.plans.get(planId);
    if (!plan) throw new HttpError(410, 'replace preview expired; run preview again', 'preview_expired');

    const conflicts: Array<{ path: string; reason: string }> = [];
    for (const file of plan.files) {
      try {
        const buf = await fs.promises.readFile(file.abs);
        if (hashBuffer(buf) !== file.hash) conflicts.push({ path: file.rel, reason: 'changed since preview' });
      } catch {
        conflicts.push({ path: file.rel, reason: 'missing since preview' });
      }
    }
    if (conflicts.length) {
      throw new HttpError(409, 'files changed since preview; refresh and retry', 'conflict', { conflicts });
    }

    const dir = path.join(paths.backups(), plan.id);
    await fs.promises.mkdir(dir, { recursive: true });
    const written: PlannedFile[] = [];
    const applied = new Map<string, { raw: Buffer; hash: string }>();
    try {
      for (const file of plan.files) {
        const backupPath = path.join(dir, file.rel.replace(/[\\/]/g, '__'));
        await fs.promises.writeFile(backupPath, file.raw);
        const next = encodeText(applyEol(file.after, file.eolTarget), 'utf-8', file.bom);
        await writeAtomicRaw(file.abs, next);
        applied.set(file.rel, { raw: next, hash: hashBuffer(next) });
        written.push(file);
      }
    } catch (err) {
      // Whole-transaction rollback.
      for (const file of written) {
        try {
          await writeAtomicRaw(file.abs, file.raw);
        } catch {
          /* best effort */
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      throw new HttpError(500, `replace failed and was rolled back: ${message}`, 'replace_failed', {
        appliedFiles: written.length,
      });
    }

    const undo = {
      id: randomUUID(),
      planId: plan.id,
      dir,
      root: plan.root,
      files: plan.files.map((f) => ({ rel: f.rel, hash: applied.get(f.rel)?.hash ?? '' })),
    };
    this.undos.set(undo.id, undo);
    await fs.promises.writeFile(path.join(dir, 'undo.json'), JSON.stringify({ ...undo, createdAt: Date.now() }, null, 2), 'utf8');
    this.plans.delete(plan.id);

    return {
      id: plan.id,
      undoId: undo.id,
      appliedFiles: plan.files.length,
      appliedMatches: plan.files.reduce((n, f) => n + f.matches, 0),
      skipped: plan.skipped,
      backupDir: dir,
    };
  }

  async undo(undoId: string): Promise<{ restored: number; skipped: Array<{ path: string; reason: string }> }> {
    let undo = this.undos.get(undoId);
    if (!undo) {
      // Try to recover from disk after a BFF restart.
      const dirs = await fs.promises.readdir(paths.backups(), { withFileTypes: true }).catch(() => []);
      for (const d of dirs) {
        if (!d.isDirectory()) continue;
        const file = path.join(paths.backups(), d.name, 'undo.json');
        try {
          const json = JSON.parse(await fs.promises.readFile(file, 'utf8'));
          if (json.id === undoId) {
            undo = json;
            break;
          }
        } catch {
          /* noop */
        }
      }
    }
    if (!undo) throw new HttpError(404, 'undo entry not found', 'undo_not_found');
    const skipped: Array<{ path: string; reason: string }> = [];
    let restored = 0;
    for (const file of undo.files) {
      const backupPath = path.join(undo.dir, file.rel.replace(/[\\/]/g, '__'));
      try {
        const original = await fs.promises.readFile(backupPath);
        const abs = path.join(undo.root ?? '', file.rel);
        if (!undo.root) {
          skipped.push({ path: file.rel, reason: 'workspace root not recorded' });
          continue;
        }
        if (fs.existsSync(abs)) {
          const current = await fs.promises.readFile(abs);
          if (hashBuffer(current) !== file.hash) {
            skipped.push({ path: file.rel, reason: 'file changed after apply' });
            continue;
          }
        }
        await fs.promises.writeFile(abs, original);
        restored++;
      } catch {
        skipped.push({ path: file.rel, reason: 'restore failed' });
      }
    }
    return { restored, skipped };
  }
}

async function writeAtomicRaw(abs: string, data: Buffer): Promise<void> {
  const tmp = path.join(path.dirname(abs), `.ocg-${process.pid}-${Math.random().toString(16).slice(2)}.tmp`);
  await fs.promises.writeFile(tmp, data);
  try {
    await fs.promises.rename(tmp, abs);
  } catch {
    await fs.promises.copyFile(tmp, abs);
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
}

function countMatches(text: string, re: RegExp): number {  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let count = 0;
  let m: RegExpExecArray | null;
  while ((m = r.exec(text)) !== null) {
    count++;
    if (m[0].length === 0) r.lastIndex++;
  }
  return count;
}

function preserveCase(replacement: string, matched: string): string {
  if (matched === matched.toUpperCase()) return replacement.toUpperCase();
  if (matched === matched.toLowerCase()) return replacement.toLowerCase();
  if (matched[0] === matched[0]?.toUpperCase()) {
    return replacement[0]?.toUpperCase() + replacement.slice(1);
  }
  return replacement;
}

export function replaceAll(text: string, re: RegExp, replacement: string, preserve: boolean): string {
  const r = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  return text.replace(r, (...args: unknown[]) => {
    const matched = args[0] as string;
    // Expand $1..$9 for regex replacements.
    const expanded = replacement.replace(/\$(\d+)/g, (_m, n: string) => String(args[Number(n)] ?? ''));
    return preserve ? preserveCase(expanded, matched) : expanded;
  });
}
