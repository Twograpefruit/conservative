import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { overwriteLines } from './git.js';
import { validateRemote } from './gitProfiles.js';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ocg-git-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('git line overwrite', () => {
  it('restores deleted lines and removes added lines', async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\nTWO\nthree\nfour\n');
    const res = await overwriteLines({ host: null as never, root }, {
      path: 'a.txt',
      changes: [
        { kind: 'del', newLine: 2, text: 'two' },
        { kind: 'add', newLine: 2, text: 'TWO' },
        { kind: 'add', newLine: 4, text: 'four' },
      ],
    });
    expect(res.changed).toBe(3);
    expect(fs.readFileSync(path.join(root, 'a.txt'), 'utf8')).toBe('one\ntwo\nthree\n');
  });

  it('rejects stale line content', async () => {
    const root = tempDir();
    fs.writeFileSync(path.join(root, 'a.txt'), 'one\ntwo\n');
    await expect(
      overwriteLines({ host: null as never, root }, {
        path: 'a.txt',
        changes: [{ kind: 'add', newLine: 2, text: 'not-there' }],
      }),
    ).rejects.toThrow(/文件已变化/);
  });

  it('rejects paths outside the workspace', async () => {
    const root = tempDir();
    await expect(
      overwriteLines({ host: null as never, root }, {
        path: '../outside.txt',
        changes: [{ kind: 'add', newLine: 1, text: 'x' }],
      }),
    ).rejects.toThrow(/escapes workspace/);
  });
});

describe('git remote validation', () => {
  it('accepts https, ssh and git@ urls', () => {
    expect(validateRemote('https://gitee.com/a/b.git')).toBe('https://gitee.com/a/b.git');
    expect(validateRemote('ssh://git@example.com/a/b.git')).toBe('ssh://git@example.com/a/b.git');
    expect(validateRemote('git@github.com:a/b.git')).toBe('git@github.com:a/b.git');
  });

  it('rejects urls with embedded credentials and unknown schemes', () => {
    expect(() => validateRemote('https://user:token@gitee.com/a/b.git')).toThrow();
    expect(() => validateRemote('ftp://example.com/a.git')).toThrow();
  });
});
