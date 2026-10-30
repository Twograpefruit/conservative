# OpenCode GUI

A lightweight peer GUI for the **opencode v2 service**, plus a local BFF that fills the gaps
opencode does not cover: file editing, search & bulk replace, Git, structured diffs, a shadow
snapshot repository, lint diagnostics and a terminal. Browser-first (`127.0.0.1`), with a Tauri
shell scaffold for later desktop packaging.

```
Browser / Tauri (WebView2)
        |  same-origin http://127.0.0.1:<BFF>
        v
BFF (Node 20+, Fastify, single process)
        +- managed opencode serve child (Job Object watchdog)
        +- /api/oc/*      same-origin reverse proxy (Basic Auth injected)
        +- /api/events    aggregated SSE + replay ring
        +- /api/fs|search|replace|git|snapshots|pty|lint
        v
opencode serve v2 (127.0.0.1 only, password held by BFF)
```

## Status

| Milestone | Scope | Status |
| --- | --- | --- |
| M0 | Host abstraction, single-instance lock, port fallback, runtime file, proxy, SSE bus, probe, codegen, bootstrap | Done |
| M1 | v2 event reducer, replay, streaming chat, tool timeline, permission queues, model/agent switching | Done |
| M2 | File tree, CodeMirror tabs, optimistic locking, EOL/encoding fidelity, lint, streaming search, transactional replace + undo | Done |
| M3 | Git status/log/diff, hunk stage/unstage/discard, commit (auto-stage option), push, four diff sources normalized, shadow snapshots | Done |
| M3.5 | One-time PTY tickets, ConPTY bridge, tabs, resize, find, scrollback | Done (upstream PTY fallback) |
| M4 | Tauri/WebView2 packaging, tray, memory soak | Scaffold only |
| M5 | Language registry with lazy loading, Markdown source/preview, SQL dialect highlighting + format preview/apply/undo | Done (core; selection format partial) |
| M6 | SQLite + MySQL + Redis connections, DPAPI credentials, read-only SQL guard, query/export, SCAN key browser, read-only command console, pub/sub | Done (SQLite/MySQL/Redis; PostgreSQL not enabled) |
| M7 | Command registry + palette, keybinding overrides/conflict detection, dark/light/system themes, Git command catalog with argv preview, safety confirm, output/hints/history | Done (core; reserved-key warnings pending) |
| M8 | In-app notification center, focused/blurred routing, native Notification API, title flashing, 3s dedupe, quiet hours, privacy mode, mute by source/session, deep links | Done (core; Tauri native + workspace mute partial) |

### UI & conversation additions (2026-10-30)

- **Original dark theme**: restored the pre-Neumorphism dark palette; CodeMirror uses One Dark,
  xterm uses the dark terminal theme.
- **Text size**: top-bar `A- / A+`, direct percentage input and Settings slider/number input,
  60%–300%, persisted locally; only text (chat, editor, terminal, tables) scales.
- **UI size**: separate top-bar `UI- / UI+`, direct percentage input and Settings controls,
  50%–250%; the layout re-measures `ResizeObserver` viewport dimensions and uses a compensated
  transform, so it keeps filling the window after every resize (no dead right/bottom area).
- **Fonts**: Settings can pick a UI/body font, load installed fonts via the Local Font Access API,
  and reset UI/text/font to defaults from one button.
- **Right-click menus**: file tree (open/rename/delete), session list (archive/rename/delete/mute)
  and editor tabs (close/close others/close all/copy path/reload).
- **Session archive**: archive/unarchive from the always-visible archive icon or the session
  context menu. Archiving asks for an existing archive name or a new one; archived sessions are
  grouped by name. Backed by opencode's `PATCH /api/session/{id} {archived}` plus local grouping.
- **In-conversation navigation**: `↑`/`↓` (also `Alt+↑/↓`) jump between messages, `⇣` returns to
  the latest, and `Ctrl+F` opens in-conversation keyword search with snippets and jump targets.
  The query/results survive jumping and switching views (sessionStorage), and entering a session
  always scrolls to the newest message.
- **Conversation tools**: every user/assistant message has copy, quote and branch actions, with a
  timestamp. Quote inserts a block-quote reference into the composer; branch calls opencode's
  `POST /api/session/{id}/fork {before}` and opens the new independent session.
- **Images**: send images from the file picker or paste clipboard images; files are stored under
  `%APPDATA%\opencode-gui\attachments` and attached as `PromptInput.FileAttachment` URIs.
- **Continuous `@` mentions**: typing `@` (at start or after whitespace, repeatedly) opens a
  searchable file picker backed by `GET /api/fs/find`; multiple files can be referenced in one
  message and are sent as `PromptInput.FileAttachment` entries with `file:///` URIs and
  `mention` offsets. Verified against opencode: the model received the attached file content.
- **M5 editor**: language registry with dynamic imports (py/js/ts/go/rust/java/cpp/php/
  sql/yaml/xml/html/css/md/nginx/toml/ini/shell/docker), Markdown source/split/preview with
  DOMPurify + task-list writeback, and SQL dialect highlighting plus `sql-formatter` preview →
  apply → undo (full file) and selection formatting.
- **M6 data**: SQLite (built-in `node:sqlite`, worker-isolated with timeout/row-limit), MySQL
  (`mysql2`, information_schema metadata, session timeouts, read-only guard, virtualized 10k-row
  result grid, true streaming CSV/JSON export) and Redis (ioredis, SCAN-only key browser,
  read-only command whitelist, pub/sub). Passwords go to Windows DPAPI; `connections.json`
  contains only an `authRef`. Read-only profiles reject writes and multi-statement SQL. Ctrl+Enter
  in a `.sql` file sends the selection/file to the Data panel.
- **CI assertions**: `M6-011` (no `KEYS`) and `M6-016` (no credential leakage) now run against
  the real endpoints; both pass locally.
- **M7 interaction**: command registry + `Ctrl+Shift+P` palette, user keybinding overrides with
  conflict detection, dark/light/system themes (CodeMirror One Dark ↔ light), and a Git command
  catalog with argv preview, danger confirmation + pre-command shadow snapshot, redacted
  stdout/stderr, actionable error hints and persistent history.
- **Git remotes / Gitee**: the Git panel has a “远端” tab for custom Gitee/GitHub/generic Git
  profiles (remote URL, username, token). Tokens live in DPAPI; “设为 origin” updates the remote,
  “测试” uses a temporary askpass helper and never writes the token into `.git/config`.
- **PyCharm-style diff**: side-by-side old/new view with per-line checkboxes. Selected added lines
  are removed and selected deleted lines are restored directly in the working file
  (`POST /api/git/overwrite-lines`), independent of hunk-level stage/unstage/discard.
- **M8 notifications**: notification center in the top bar (unread badge, mark all read, clear),
  source-aware app toasts, native `Notification` when the window is blurred (permission-based),
  flashing document title with the unread count, 3-second dedupe/aggregation, source and
  per-session mute, quiet hours, privacy mode, and click-through deep links to the session/view.
  Chat completion/failure/permission, Git command results, DB queries and terminal exits are wired in.

See [`docs/api-contract.md`](docs/api-contract.md) for the acceptance checklist and
[`docs/acceptance.md`](docs/acceptance.md) for the probed opencode 2.2.1 contract.

## Quick start (Windows)

```powershell
# 1) prerequisites (Node 20+, git, opencode 2.x, pyright; rg is bundled)
npm run bootstrap

# 2) dependencies
npm install

# 3a) development: BFF + Vite (two processes)
npm run dev
#     open http://127.0.0.1:5173

# 3b) production-style: build the SPA, then let the BFF serve it
npm run build
npm start
#     open http://127.0.0.1:4311 (or the port printed in the console)

# 3c) open the running GUI in your default browser
npm run gui
```

`npm start` prints the actual BFF port. If the preferred port (`4310`) is busy the BFF picks the
next free one, writes it to `%LOCALAPPDATA%\opencode-gui\runtime.json`, and the Vite dev proxy
resolves that file per request.

### Tests & checks

```powershell
npm run typecheck        # all workspaces
npm test                 # reducer + diff pure-function tests
node scripts/probe.mjs   # refresh docs/upstream/probe.json
node scripts/codegen.mjs # regenerate protocol types from the live spec
node scripts/memtest.mjs --seconds 30
```

## Configuration

Settings live in `%APPDATA%\opencode-gui\settings.json`; workspaces in `workspaces.json`.

### Local Redis / MySQL defaults

`config/local.example.json` is committed and documents the shape. Copy it to
`config/local.json` (gitignored) and put real credentials there:

```json
{
  "redis": { "url": "redis://localhost:6379/0" },
  "mysql": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "root", "database": "" }
}
```

On startup the BFF seeds/updates two read-only profiles, **Local Redis** and **Local MySQL**, from
this file. Host/port/database are stored in `connections.json`; passwords are moved into Windows
DPAPI immediately and never written to `connections.json` or git. Override the file location with
`OCG_LOCAL_CONFIG`.

Environment overrides:

| Variable | Purpose |
| --- | --- |
| `OCG_WORKSPACE` | Default workspace root (defaults to `INIT_CWD` / cwd) |
| `OCG_PORT` | Preferred BFF port (default 4310) |
| `OCG_OC_MODE` | `managed` (spawn `opencode serve`) or `attach` (use a running service) |
| `OCG_OC_URL` | Attach URL, e.g. `http://127.0.0.1:28894` (implies attach mode) |
| `OCG_OC_PASSWORD` | Attach password (otherwise read from `~/.config/opencode/service.json`) |
| `OCG_OPENCODE_BIN` | Explicit path to `opencode.exe` |
| `OCG_GUI_DIR` | Directory containing the built SPA (`apps/gui/dist` by default) |
| `OCG_BFF` | Vite dev proxy target override |

Runtime data (never inside the repo):

- `%APPDATA%\opencode-gui\` - settings, workspaces
- `%LOCALAPPDATA%\opencode-gui\` - `runtime.json`, `instance.lock`, logs, `cache/probe.json`,
  `snapshots\<projectHash>\` (bare shadow repos), `backups\` (replace/restore backups)

## BFF API (frontend depends only on this)

| Group | Endpoints |
| --- | --- |
| System | `GET /api/health`, `GET /api/probe`, `GET /api/settings`, `GET/POST/PATCH/DELETE /api/workspaces` |
| Contract | `GET /api/oc/spec` |
| Proxy | `ALL /api/oc/*` to upstream, Basic Auth injected, SSE unbuffered |
| Events | `GET /api/events?since=<seq>` (SSE, `id:` = BFF seq, 5000-event ring) |
| Files | `GET /api/fs/tree`, `GET /api/fs/find`, `GET /api/fs/file`, `GET /api/fs/raw`, `PUT /api/fs/file`, `POST /api/fs/{rename,delete,mkdir}` |
| Format | `POST /api/format/preview`, `POST /api/format/apply`, `POST /api/format/undo`, `POST /api/format/text` |
| Data | `GET/POST/PUT/DELETE /api/connections`, `POST /api/connections/test`, `POST /api/db/query`, `GET /api/db/metadata`, `POST /api/db/export`, `POST /api/redis/{scan,command}`, `GET /api/redis/value`, `GET /api/redis/subscribe` |
| Search | `POST /api/search` (NDJSON stream + cursor) |
| Replace | `POST /api/replace/preview`, `POST /api/replace/apply`, `POST /api/replace/undo` |
| Git | `GET /api/git/{info,status,log,diff,catalog,history}`, `POST /api/git/{exec,commit,push,run,apply-hunk}` |
| Diff | `GET /api/diff/session`, `GET /api/diff/snapshot` |
| Snapshots | `GET/POST /api/snapshots`, `GET /api/snapshots/diff`, `POST /api/snapshots/restore` |
| Lint | `POST /api/lint` (pyright + optional ruff) |
| Terminal | `POST /api/pty/token` then `WS /api/pty?ticket=...`; `GET /api/pty/list`, `POST /api/pty/resize`, `DELETE /api/pty/:id` |

## Design notes

- **Only the BFF talks to opencode.** Credentials never reach the browser; CORS is unnecessary.
- **v2 event model.** opencode 2.x streams turn-level events (`session.text.started/delta/ended`,
  `session.tool.*`, `session.step.*`, `session.execution.*`), not v1 `message.part.updated`.
  `packages/protocol` implements the v2 reducer with v1 fallbacks and tests for duplicates,
  out-of-order deltas, final-text override, permission bucketing and session deletion.
- **Event replay.** The BFF assigns a monotonic `seq`, keeps a ring buffer and serves
  `GET /api/events?since=`; if the gap is older than the ring it emits `bff.resync` so the GUI
  refetches sessions/messages instead of silently losing state.
- **Platform differences live in `packages/host`.** Business code never branches on drive letters,
  `wsl.exe` or shell names. `WindowsLocalHost` owns exec/spawn/PTY/watch/kill-tree/Job-Object.
- **No orphan opencode.** In managed mode the BFF starts `opencode serve` and attaches a Windows
  Job Object with `KILL_ON_JOB_CLOSE` via a watchdog. Force-killing the BFF kills the upstream
  child (verified).
- **Diffs & snapshots are pure/structural.** `packages/diff` parses unified diffs, applies and
  reverses hunks, preserves CRLF, and rebuilds `git apply` patches. Snapshots use a bare shadow
  repo per project under `%LOCALAPPDATA%`, so the user's repo is never polluted.
- **Edits preserve bytes.** Files are decoded strictly as UTF-8 (GB18030 is detected for
  read-only display); writes keep BOM/EOL, are hash-checked first (409 on conflict) and are
  written atomically. Files >2 MB are read-only/truncated; replace skips non-UTF-8 files.
- **Git commit and push are separate, visible steps.** The commit box has a default-on
  "stage all changes" option and a push button; the header shows `未推送 N` / `落后 N` from
  `@{u}...HEAD`. Push never uses force flags, and the first push sets upstream automatically.
- **Replace is selective.** Preview renders a checkbox per file; apply sends only the checked
  paths. Undo restores only the files that were actually written in that transaction.
- **Search hits jump to the exact line.** Result clicks carry path + line and the editor uses a
  nonce so repeated clicks on the same line still scroll/focus.

## CI assertions (M6-011 / M6-016)

`scripts/ci-assert.sh` is the executable skeleton for "Redis browsing must never send KEYS" and
"credentials never leak". Exit codes are 0 pass / 1 assert fail / 2 blocked / 3 usage. See
[`docs/ci-assertions.md`](docs/ci-assertions.md). M6 endpoints are not implemented yet, so the
real assertions currently report **BLOCKED**; `--self-test` validates the detection logic.

## Known limitations

- **BFF RSS ~79 MB**, above the 50 MB budget (Node/Fastify baseline). Recorded as a deviation in
  `docs/acceptance.md`; the GUI bundle itself is ~1.2 MB JS (~380 KB gzip).
- **Terminal uses the upstream ConPTY**, not a local `node-pty` instance. npm 11 blocks install
  scripts and this machine has no VS Build Tools; `RuntimeHost.createPty` remains the extension
  point for a local backend.
- **Session list is filtered by workspace directory** because opencode sessions belong to a
  location; new sessions are created with an explicit `location` for the active workspace.
- **M4 is a scaffold.** Tray, installer, shell-owned lifecycle and WebView memory instrumentation
  are not implemented. `apps/desktop/README.md` lists the remaining work.
- **M6 is SQLite/MySQL/Redis.** SQLite uses Node's built-in `node:sqlite` (Node 22.5+/24); on
  Node 20 the SQLite feature is unavailable. PostgreSQL is intentionally not enabled (no local
  test instance) and those profiles return `driver_not_available`. MySQL results are virtualized
  in the UI up to `rowLimit` (default 500, max 10k) and MySQL CSV/JSON export streams row by row.
  SQLite export still buffers, and the 100k-key Redis stress test is intentionally skipped.
- **Redis command console is read-only.** `KEYS`, `FLUSHALL`, `CONFIG`, `SHUTDOWN`, `EVAL`, etc.
  are hard-blocked; key navigation always uses `SCAN` cursors.
- **M7 reserved-key warnings** are not implemented yet; binding `Ctrl+W/F5` etc. may still be
  intercepted by the browser/WebView2.
- No login/multi-user/remote/TLS by design; the BFF binds `127.0.0.1` only.
- Long Windows paths are not enabled on this machine (`LongPathsEnabled=0`); the host normalises
  paths but very deep trees may still hit OS limits.
- `ruff` is optional and not installed here; pyright diagnostics are the primary source.

## Repository layout

```
apps/gui/         React + Vite + CodeMirror 6 + xterm.js + zustand
apps/server/      Fastify BFF (proxy, SSE, fs/search/replace/git/snapshots/pty/lint)
apps/desktop/     Tauri scaffold (M4, not packaged)
packages/host/    RuntimeHost + WindowsLocalHost
packages/protocol/BFF/upstream types + pure event reducer
packages/diff/    Unified-diff parser, hunk apply/reverse, patch rebuild
packages/config/  Defaults, paths, ignore lists, workspace types
scripts/          bootstrap.ps1, dev.mjs, codegen.mjs, probe.mjs, memtest.mjs
docs/             design SSOT, probed contract, milestone acceptance, upstream evidence
```
