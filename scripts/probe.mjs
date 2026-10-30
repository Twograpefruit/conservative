#!/usr/bin/env node
/**
 * M0 probe: fetch the BFF's aggregated probe result and persist it.
 * Usage: node scripts/probe.mjs [--url http://127.0.0.1:4310]
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const argIdx = process.argv.indexOf('--url');
let base = argIdx >= 0 ? process.argv[argIdx + 1] : null;
if (!base) {
  try {
    const runtime = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'opencode-gui', 'runtime.json'), 'utf8'));
    base = runtime?.bff?.url ?? 'http://127.0.0.1:4310';
  } catch {
    base = 'http://127.0.0.1:4310';
  }
}

try {
  const res = await fetch(base + '/api/probe?refresh=1', { signal: AbortSignal.timeout(60_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const result = await res.json();
  const outDir = path.join(root, 'docs', 'upstream');
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'probe.json'), JSON.stringify(result, null, 2), 'utf8');
  console.log(`[probe] upstream ${result.upstream.url} version ${result.upstream.version}`);
  console.log(`[probe] spec: ${result.spec.ok ? 'ok' : 'MISSING'}  events: ${result.events.ok ? 'ok' : 'MISSING'}`);
  console.log('[probe] capabilities:', result.capabilities);
  if (result.hints?.length) console.log('[probe] hints:', result.hints.join(' | '));
  console.log(`[probe] wrote ${path.relative(root, path.join(outDir, 'probe.json'))}`);
  if (!result.spec.ok || !result.events.ok) process.exit(1);
} catch (err) {
  console.error('[probe] failed:', err.message);
  console.error('[probe] start the BFF first: npm run dev   (or npm start after build)');
  process.exit(1);
}
