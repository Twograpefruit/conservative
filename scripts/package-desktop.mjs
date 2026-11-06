#!/usr/bin/env node
/**
 * Package Conser as a native Windows app.
 *
 *   node scripts/package-desktop.mjs prepare  # stage BFF resources + node sidecar
 *   node scripts/package-desktop.mjs build    # npm run build + prepare + tauri build
 *   node scripts/package-desktop.mjs dev      # prepare + tauri dev
 *
 * The generated installer is:
 *   apps/desktop/src-tauri/target/release/bundle/nsis/Conser_<version>_x64-setup.exe
 *
 * By default the local opencode installation is NOT bundled (it is large).
 * Set OCG_BUNDLE_OPENCODE=1 to copy opencode.exe into the app resources.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const desktop = path.join(root, 'apps', 'desktop');
const srcTauri = path.join(desktop, 'src-tauri');
const serverSrc = path.join(root, 'apps', 'server', 'dist', 'index.js');
const guiSrc = path.join(root, 'apps', 'gui', 'dist');
const serverStage = path.join(srcTauri, 'server');
const guiStage = path.join(srcTauri, 'gui');
const binaries = path.join(srcTauri, 'binaries');
const nodeTarget = path.join(binaries, 'node-x86_64-pc-windows-msvc.exe');

const SERVER_RUNTIME_DEPS = [
  '@fastify/static',
  '@fastify/websocket',
  '@vscode/ripgrep',
  'diff',
  'fastify',
  'iconv-lite',
  'ioredis',
  'mysql2',
  'sql-formatter',
  'ws',
  'zod',
];

function log(message) {
  console.log(`[desktop] ${message}`);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: options.cwd ?? root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    env: process.env,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed with exit code ${result.status}`);
  }
}

function copyDir(from, to) {
  fs.rmSync(to, { recursive: true, force: true });
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.cpSync(from, to, { recursive: true, dereference: true });
}

function findOpencode() {
  const candidates = [
    path.join(process.env.APPDATA ?? '', 'npm', 'node_modules', '@opencode', 'cli', 'bin', 'opencode.exe'),
    path.join(process.env.LOCALAPPDATA ?? '', 'opencode', 'opencode.exe'),
  ];
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function prepare() {
  if (!fs.existsSync(serverSrc)) {
    throw new Error('apps/server/dist/index.js is missing. Run `npm run build` first.');
  }
  if (!fs.existsSync(path.join(guiSrc, 'index.html'))) {
    throw new Error('apps/gui/dist/index.html is missing. Run `npm run build` first.');
  }

  log('staging GUI');
  copyDir(guiSrc, guiStage);

  log('staging BFF entry');
  fs.rmSync(serverStage, { recursive: true, force: true });
  fs.mkdirSync(serverStage, { recursive: true });
  fs.copyFileSync(serverSrc, path.join(serverStage, 'index.js'));

  log('installing production BFF dependencies');
  const dependencies = Object.fromEntries(
    SERVER_RUNTIME_DEPS.map((name) => {
      const packageFile = path.join(root, 'node_modules', name, 'package.json');
      const version = fs.existsSync(packageFile)
        ? JSON.parse(fs.readFileSync(packageFile, 'utf8')).version
        : 'latest';
      return [name, `^${version}`];
    }),
  );
  fs.writeFileSync(
    path.join(serverStage, 'package.json'),
    JSON.stringify(
      {
        name: 'conser-bff-runtime',
        private: true,
        type: 'module',
        dependencies,
      },
      null,
      2,
    ),
  );
  run(
    'npm',
    [
      'install',
      '--omit=dev',
      '--ignore-scripts',
      '--no-audit',
      '--no-fund',
      '--include=optional',
    ],
    { cwd: serverStage },
  );

  log('copying Node sidecar');
  fs.mkdirSync(binaries, { recursive: true });
  fs.copyFileSync(process.execPath, nodeTarget);

  if (process.env.OCG_BUNDLE_OPENCODE === '1') {
    const opencode = findOpencode();
    if (!opencode) {
      log('OCG_BUNDLE_OPENCODE=1 but opencode.exe was not found; skipping');
    } else {
      const target = path.join(serverStage, 'opencode', 'opencode.exe');
      fs.mkdirSync(path.dirname(target), { recursive: true });
      log(`bundling opencode (${(fs.statSync(opencode).size / 1024 / 1024).toFixed(0)} MB)`);
      fs.copyFileSync(opencode, target);
    }
  }

  if (!fs.existsSync(path.join(srcTauri, 'icons', 'icon.ico'))) {
    log('generating Tauri icons');
    run('npx', ['--yes', '@tauri-apps/cli@2', 'icon', path.join(srcTauri, 'icon-source.png')], {
      cwd: srcTauri,
    });
  }

  log('desktop resources ready');
}

function tauri(args) {
  run('npx', ['--yes', '@tauri-apps/cli@2', ...args], { cwd: srcTauri });
}

const action = process.argv[2] ?? 'build';

try {
  if (action === 'prepare') {
    prepare();
  } else if (action === 'build') {
    log('building GUI and BFF');
    run('npm', ['run', 'build']);
    prepare();
    tauri(['build']);
    const bundle = path.join(srcTauri, 'target', 'release', 'bundle', 'nsis');
    if (fs.existsSync(bundle)) {
      for (const file of fs.readdirSync(bundle)) log(`installer: ${path.join(bundle, file)}`);
    }
  } else if (action === 'dev') {
    prepare();
    tauri(['dev']);
  } else {
    console.error(`Unknown action: ${action}. Use prepare | build | dev.`);
    process.exit(1);
  }
} catch (err) {
  console.error(`[desktop] ${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
}
