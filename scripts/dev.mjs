#!/usr/bin/env node
/** Start the BFF and Vite together (development). */
import { spawn } from 'node:child_process';

const npm = process.platform === 'win32' ? 'npm.cmd' : 'npm';
const children = [];
let stopping = false;

function run(args) {
  const child =
    process.platform === 'win32'
      ? spawn(process.env.ComSpec ?? 'cmd.exe', ['/d', '/s', '/c', ['npm', ...args].join(' ')], {
          stdio: 'inherit',
          env: process.env,
        })
      : spawn(npm, args, { stdio: 'inherit', env: process.env });
  children.push(child);
  child.on('exit', (code) => {
    if (!stopping) {
      stopping = true;
      for (const c of children) {
        if (c !== child) c.kill();
      }
      process.exit(code ?? 0);
    }
  });
  return child;
}

run(['run', 'dev', '-w', '@ocg/server']);
run(['run', 'dev', '-w', '@ocg/gui']);

const stop = () => {
  if (stopping) return;
  stopping = true;
  for (const c of children) {
    try {
      c.kill();
    } catch {
      /* noop */
    }
  }
  setTimeout(() => process.exit(0), 300);
};
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
