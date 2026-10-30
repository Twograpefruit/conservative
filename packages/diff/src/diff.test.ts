import { describe, expect, it } from 'vitest';
import {
  applyHunk,
  applyHunks,
  buildPatch,
  buildReversePatch,
  detectEol,
  parseUnifiedDiff,
  summarize,
} from '../src/index.js';

const PATCH = `diff --git a/src/app.py b/src/app.py
index 1111111..2222222 100644
--- a/src/app.py
+++ b/src/app.py
@@ -1,2 +1,3 @@
 def main():
-    print("hi")
+    print("hello")
+    return 0
`;

const MULTI = `diff --git a/中文/文件.py b/中文/文件.py
index 1111111..2222222 100644
--- a/中文/文件.py
+++ b/中文/文件.py
@@ -2,2 +2,2 @@
 x = 1
-y = 2
+y = 3
diff --git a/new.txt b/new.txt
new file mode 100644
index 0000000..3333333
--- /dev/null
+++ b/new.txt
@@ -0,0 +1,2 @@
+hello
+world
diff --git a/gone.txt b/gone.txt
deleted file mode 100644
index 4444444..0000000
--- a/gone.txt
+++ /dev/null
@@ -1 +0,0 @@
-bye
diff --git a/img.png b/img.png
index 5555555..6666666 100644
Binary files a/img.png and b/img.png differ
`;

describe('unified diff', () => {
  it('parses files, hunk ranges and line kinds', () => {
    const files = parseUnifiedDiff(PATCH);
    expect(files).toHaveLength(1);
    expect(files[0].path).toBe('src/app.py');
    expect(files[0].status).toBe('modified');
    expect(files[0].hunks).toHaveLength(1);
    expect(files[0].hunks[0]).toMatchObject({ oldStart: 1, oldLines: 2, newStart: 1, newLines: 3 });
    expect(files[0].additions).toBe(2);
    expect(files[0].deletions).toBe(1);
    expect(summarize(files)).toEqual({ files: 1, additions: 2, deletions: 1 });
  });

  it('handles Chinese paths, adds, deletes and binaries', () => {
    const files = parseUnifiedDiff(MULTI);
    expect(files.map((f) => f.path)).toEqual(['中文/文件.py', 'new.txt', 'gone.txt', 'img.png']);
    expect(files[0].status).toBe('modified');
    expect(files[1].status).toBe('added');
    expect(files[1].oldPath).toBeUndefined();
    expect(files[2].status).toBe('deleted');
    expect(files[3].binary).toBe(true);
  });

  it('applies and reverses a hunk without changing other lines', () => {
    const file = parseUnifiedDiff(PATCH)[0];
    const before = 'def main():\n    print("hi")\n';
    const after = applyHunk(before, file.hunks[0]);
    expect(after).toBe('def main():\n    print("hello")\n    return 0\n');
    const back = applyHunk(after, file.hunks[0], { reverse: true });
    expect(back).toBe(before);
  });

  it('applies multiple hunks bottom-up', () => {
    const patch = `--- a/x.txt
+++ b/x.txt
@@ -1,2 +1,2 @@
-a
+b
 c
@@ -6,2 +6,2 @@
-e
+f
 g
`;
    const files = parseUnifiedDiff(patch);
    const before = 'a\nc\nd\n\n\ne\ng\n';
    const after = applyHunks(before, files[0].hunks);
    expect(after).toBe('b\nc\nd\n\n\nf\ng\n');
    const back = applyHunks(after, files[0].hunks, { reverse: true });
    expect(back).toBe(before);
  });

  it('preserves CRLF when applying', () => {
    const file = parseUnifiedDiff(PATCH)[0];
    const before = 'def main():\r\n    print("hi")\r\n';
    const after = applyHunk(before, file.hunks[0]);
    expect(after).toBe('def main():\r\n    print("hello")\r\n    return 0\r\n');
    expect(detectEol(after).eol).toBe('crlf');
  });

  it('throws a clear error on context mismatch', () => {
    const file = parseUnifiedDiff(PATCH)[0];
    expect(() => applyHunk('totally different\n', file.hunks[0])).toThrow(/context/);
  });

  it('rebuilds forward and reverse patches', () => {
    const file = parseUnifiedDiff(PATCH)[0];
    expect(buildPatch(file)).toContain('@@ -1,2 +1,3 @@');
    const reverse = buildReversePatch(file);
    expect(reverse).toContain('@@ -1,3 +1,2 @@');
    expect(reverse).toContain('-    print("hello")');
    expect(reverse).toContain('+    print("hi")');
  });
});
