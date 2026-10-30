import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import iconv from 'iconv-lite';
import { afterEach, describe, expect, it } from 'vitest';
import { readTextFile, writeTextFileAtomic } from './fsutil.js';

const dirs: string[] = [];

function tempFile(name: string, content: Buffer): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocg-fs-'));
  dirs.push(dir);
  const file = path.join(dir, name);
  fs.writeFileSync(file, content);
  return file;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('file encoding conversion', () => {
  it('reads GB18030 as editable and converts to UTF-8', async () => {
    const file = tempFile('gb.txt', iconv.encode('中文编码测试\n', 'gb18030'));
    const info = await readTextFile(file, { maxBytes: 1024 * 1024 });
    expect(info.encoding).toBe('gb18030');
    expect(info.readonly).toBe(false);
    expect(info.content).toContain('中文编码测试');
    const res = await writeTextFileAtomic(file, info.content, {
      baseHash: info.hash,
      expectedMtime: info.mtime,
      encoding: 'utf-8',
    });
    expect(res.encoding).toBe('utf-8');
    expect(fs.readFileSync(file, 'utf8')).toBe('中文编码测试\n');
  });

  it('writes GB18030 when requested', async () => {
    const file = tempFile('utf8.txt', Buffer.from('中文\n', 'utf8'));
    await writeTextFileAtomic(file, '转换后\n', { encoding: 'gb18030' });
    expect(iconv.decode(fs.readFileSync(file), 'gb18030')).toBe('转换后\n');
  });
});
