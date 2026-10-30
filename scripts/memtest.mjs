#!/usr/bin/env node
/**
 * Lightweight RSS sampler for the BFF (M0/M4 memory evidence).
 * Usage: node scripts/memtest.mjs [--seconds 30] [--url http://127.0.0.1:4310] [--strict]
 * Frontend/shell RSS must be sampled from Task Manager or the Tauri shell; this covers BFF only.
 */
import fs from 'node:fs';
import path from 'node:path';

const arg = (name, fallback) => {
  const i = process.argv.indexOf('--' + name);
  return i >= 0 ? process.argv[i + 1] : fallback;
};

let base = arg('url');
if (!base) {
  try {
    const runtime = JSON.parse(fs.readFileSync(path.join(process.env.LOCALAPPDATA ?? '', 'opencode-gui', 'runtime.json'), 'utf8'));
    base = runtime?.bff?.url ?? 'http://127.0.0.1:4310';
  } catch {
    base = 'http://127.0.0.1:4310';
  }
}
const seconds = Number(arg('seconds', '30')) || 30;
const strict = process.argv.includes('--strict');
const samples = [];

for (let i = 0; i < seconds; i++) {
  try {
    const res = await fetch(base + '/api/health', { signal: AbortSignal.timeout(4000) });
    const h = await res.json();
    const mb = h.bff.memory / 1024 / 1024;
    samples.push(mb);
    process.stdout.write(`\r[memtest] ${i + 1}/${seconds}s  BFF RSS ${mb.toFixed(1)} MB  (clients ${h.eventBus.clients}, events ${h.eventBus.lastSeq})`);
  } catch (err) {
    process.stdout.write(`\r[memtest] ${i + 1}/${seconds}s  error: ${err.message}`);
  }
  await new Promise((r) => setTimeout(r, 1000));
}
console.log();
if (samples.length) {
  const peak = Math.max(...samples);
  const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
  console.log(`[memtest] peak ${peak.toFixed(1)} MB, avg ${avg.toFixed(1)} MB, samples ${samples.length}`);
  console.log('[memtest] target for BFF is < 50 MB (Node baseline may exceed it; record as a deviation).');
  if (strict && peak > 50) process.exit(2);
} else {
  console.error('[memtest] no samples; is the BFF running?');
  process.exit(1);
}
