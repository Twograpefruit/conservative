import { createHash, randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import iconv from 'iconv-lite';
import { BINARY_EXTENSIONS, IGNORED_DIRS, IGNORED_FILES } from '@ocg/config';
import type { FileContent, FileEntry } from '@ocg/protocol';
import { HttpError, badRequest, notFound } from './http.js';

export function hashBuffer(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

export async function hashFile(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

export function isInside(root: string, target: string): boolean {
  const rel = path.relative(root, target);
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

export function resolveInWorkspace(root: string, rel: string): string {
  if (typeof rel !== 'string' || rel.includes('\0')) badRequest('invalid path');
  const abs = path.isAbsolute(rel) ? path.resolve(rel) : path.resolve(root, rel);
  if (!isInside(root, abs)) throw new HttpError(403, 'path escapes the workspace', 'forbidden_path');
  return abs;
}

export function relativePath(root: string, abs: string): string {
  return path.relative(root, abs).replace(/\\/g, '/');
}

export function isProbablyBinary(buf: Buffer): boolean {
  const len = Math.min(buf.length, 8192);
  for (let i = 0; i < len; i++) if (buf[i] === 0) return true;
  return false;
}

export interface DecodedText {
  text: string;
  encoding: 'utf-8' | 'gb18030';
  bom: boolean;
}

export function decodeText(buf: Buffer): DecodedText {
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString('utf8'), encoding: 'utf-8', bom: true };
  }
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8', bom: false };
  } catch {
    return { text: iconv.decode(buf, 'gb18030'), encoding: 'gb18030', bom: false };
  }
}

export function encodeText(text: string, encoding: 'utf-8' | 'gb18030', bom: boolean): Buffer {
  if (encoding === 'gb18030') return iconv.encode(text, 'gb18030');
  const body = Buffer.from(text, 'utf8');
  return bom ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), body]) : body;
}

function eolStats(text: string): { eol: 'lf' | 'crlf' | 'mixed'; lf: number; crlf: number } {
  const crlf = (text.match(/\r\n/g) ?? []).length;
  const lf = (text.match(/(?<!\r)\n/g) ?? []).length;
  if (crlf === 0 && lf === 0) return { eol: 'lf', lf: 0, crlf: 0 };
  if (crlf === 0) return { eol: 'lf', lf, crlf };
  if (lf === 0) return { eol: 'crlf', lf, crlf };
  return { eol: 'mixed', lf, crlf };
}

export interface ReadOptions {
  maxBytes: number;
}

export async function readTextFile(abs: string, opts: ReadOptions): Promise<FileContent> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(abs);
  } catch {
    notFound('file not found', 'file_not_found');
  }
  if (stat.isDirectory()) badRequest('path is a directory', 'is_directory');
  const ext = path.extname(abs).toLowerCase();
  const limit = Math.min(stat.size, opts.maxBytes);
  const fh = await fs.promises.open(abs, 'r');
  let buf: Buffer;
  try {
    buf = Buffer.alloc(limit);
    await fh.read(buf, 0, limit, 0);
  } finally {
    await fh.close();
  }
  const binary = BINARY_EXTENSIONS.has(ext) || isProbablyBinary(buf);
  const hash = stat.size <= opts.maxBytes ? hashBuffer(buf) : await hashFile(abs);
  if (binary) {
    return {
      path: abs,
      content: '',
      encoding: 'binary',
      eol: 'lf',
      eolSummary: { lf: 0, crlf: 0 },
      hash,
      size: stat.size,
      mtime: stat.mtimeMs,
      binary: true,
      readonly: true,
      truncated: stat.size > opts.maxBytes,
      bom: false,
    };
  }
  const decoded = decodeText(buf);
  const stats = eolStats(decoded.text);
  return {
    path: abs,
    content: decoded.text,
    encoding: decoded.encoding,
    eol: stats.eol,
    eolSummary: { lf: stats.lf, crlf: stats.crlf },
    hash,
    size: stat.size,
    mtime: stat.mtimeMs,
    binary: false,
    readonly: stat.size > opts.maxBytes || decoded.encoding !== 'utf-8',
    truncated: stat.size > opts.maxBytes,
    bom: decoded.bom,
  };
}

export function normalizeEol(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

export function applyEol(text: string, eol: 'lf' | 'crlf'): string {
  const normalized = normalizeEol(text);
  return eol === 'crlf' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

export interface WriteOptions {
  baseHash?: string;
  expectedMtime?: number;
  eol?: 'auto' | 'lf' | 'crlf';
  createDirs?: boolean;
}

export interface WriteResult {
  hash: string;
  size: number;
  mtime: number;
  eol: 'lf' | 'crlf' | 'mixed';
}

export async function writeTextFileAtomic(abs: string, content: string, opts: WriteOptions = {}): Promise<WriteResult> {
  let previous: Buffer | null = null;
  let previousEncoding: 'utf-8' | 'gb18030' = 'utf-8';
  let previousBom = false;
  let previousEol: 'lf' | 'crlf' | 'mixed' = 'lf';
  let stat: fs.Stats | null = null;
  try {
    stat = await fs.promises.stat(abs);
    previous = await fs.promises.readFile(abs);
    if (isProbablyBinary(previous)) throw new HttpError(415, 'refusing to overwrite a binary file', 'binary_file');
    const decoded = decodeText(previous);
    previousEncoding = decoded.encoding;
    previousBom = decoded.bom;
    previousEol = eolStats(decoded.text).eol;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
  }

  if (opts.baseHash && previous) {
    const currentHash = hashBuffer(previous);
    if (currentHash !== opts.baseHash) {
      throw new HttpError(409, 'file changed on disk since it was opened', 'conflict', {
        currentHash,
        currentMtime: stat?.mtimeMs ?? 0,
      });
    }
  }
  if (opts.expectedMtime && stat && Math.abs(stat.mtimeMs - opts.expectedMtime) > 2) {
    const currentHash = previous ? hashBuffer(previous) : '';
    if (currentHash !== opts.baseHash) {
      throw new HttpError(409, 'file changed on disk since it was opened', 'conflict', {
        currentHash,
        currentMtime: stat.mtimeMs,
      });
    }
  }
  if (previous && previousEncoding !== 'utf-8') {
    throw new HttpError(415, `refusing to write ${previousEncoding} file; convert it to UTF-8 first`, 'non_utf8');
  }

  const targetEol: 'lf' | 'crlf' =
    opts.eol === 'lf' || opts.eol === 'crlf'
      ? opts.eol
      : previousEol === 'crlf'
        ? 'crlf'
        : previousEol === 'mixed'
          ? 'lf'
          : 'lf';
  const body = encodeText(applyEol(content, targetEol), 'utf-8', previousBom);

  if (opts.createDirs !== false) await fs.promises.mkdir(path.dirname(abs), { recursive: true });
  const tmp = path.join(path.dirname(abs), `.ocg-${process.pid}-${randomBytes(4).toString('hex')}.tmp`);
  await fs.promises.writeFile(tmp, body);
  try {
    await fs.promises.rename(tmp, abs);
  } catch {
    await fs.promises.copyFile(tmp, abs);
    await fs.promises.unlink(tmp).catch(() => undefined);
  }
  const newStat = await fs.promises.stat(abs);
  return {
    hash: hashBuffer(body),
    size: newStat.size,
    mtime: newStat.mtimeMs,
    eol: targetEol,
  };
}

export async function listDirectory(root: string, rel: string, opts: { maxEntries?: number } = {}): Promise<FileEntry[]> {
  const abs = resolveInWorkspace(root, rel || '.');
  const stat = await fs.promises.stat(abs).catch(() => null);
  if (!stat) notFound('directory not found', 'dir_not_found');
  if (!stat.isDirectory()) badRequest('path is not a directory', 'not_directory');
  const entries = await fs.promises.readdir(abs, { withFileTypes: true });
  const out: FileEntry[] = [];
  for (const entry of entries) {
    const isDir = entry.isDirectory();
    if (isDir ? IGNORED_DIRS.has(entry.name) : IGNORED_FILES.has(entry.name)) continue;
    const childAbs = path.join(abs, entry.name);
    const childRel = relativePath(root, childAbs);
    if (entry.isSymbolicLink()) {
      out.push({ name: entry.name, path: childRel, type: 'file' });
      continue;
    }
    if (isDir) {
      out.push({ name: entry.name, path: childRel, type: 'dir', hasChildren: true });
    } else if (entry.isFile()) {
      let size: number | undefined;
      let mtime: number | undefined;
      try {
        const s = await fs.promises.stat(childAbs);
        size = s.size;
        mtime = s.mtimeMs;
      } catch {
        /* race */
      }
      out.push({ name: entry.name, path: childRel, type: 'file', size, mtime });
    }
    if (out.length >= (opts.maxEntries ?? 5000)) break;
  }
  out.sort((a, b) => (a.type === b.type ? a.name.localeCompare(b.name) : a.type === 'dir' ? -1 : 1));
  return out;
}

export async function pathExists(abs: string): Promise<boolean> {
  try {
    await fs.promises.access(abs);
    return true;
  } catch {
    return false;
  }
}
