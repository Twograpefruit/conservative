# Conser

Conser is a lightweight browser GUI and local BFF for **opencode v2**. It adds a desktop-style
workspace around the opencode service: conversations and branches, a code editor, search/replace,
Git, a terminal, SQLite/MySQL/Redis tools, notifications, and a configurable local runtime.

The BFF binds to `127.0.0.1` only. It proxies opencode's HTTP API, multiplexes its SSE stream, and
fills in capabilities the upstream service does not expose directly.

```
Browser (Conser UI)
        │  same-origin http://127.0.0.1:<BFF>
        ▼
BFF (Node 20+, Fastify, single process)
        ├── opencode v2 HTTP API + SSE
        ├── file system / search / replace / lint
        ├── Git / snapshots / PTY
        └── SQLite / MySQL / Redis
```

## Feature overview

### Conversations

- Streaming assistant messages with rich Markdown (headings, lists, tables, task lists, links,
  highlighted code blocks).
- Copy, quote and branch actions on every message; branch uses opencode's native session fork
  (`POST /api/session/{id}/fork`).
- Image attachments from the file picker or clipboard, plus an Emoji picker.
- **Conversations**: streaming assistant messages with rich Markdown; the message list stays
  pinned to the newest reply unless you deliberately scroll up.
- Per-session draft persistence (text, images, `@` file references) across session switches,
  view changes, crashes and page reloads.
- In-conversation search with snippets, jump targets, result retention and search history.
- Session archive with user-defined archive names/groups, mute notifications per session, and
  automatic scroll-to-bottom when entering a session.

### Editor

- CodeMirror 6 with lazy language loading, One Dark / light themes, diagnostics and format preview.
- **Symbol navigation**: Ctrl/Cmd-click an identifier to jump to its definition; multiple matches
  open a clickable list; a floating “← 返回” button and `Mod+Alt+←` jump back. Hovering an
  identifier shows its signature and a collapsed doc-comment panel.
- **Dedicated code typography**: code font family and size (10–24 px) are configured separately
  from the UI/text scale and apply to the editor and rendered code blocks.
- File tree with large folder icons and context menus (open, rename, delete, refresh).
- Right-click a folder to search inside it, right-click a file to search only that file, or select
  two files (A/B) to open a side-by-side comparison.
- **Collapsible navigation**: the app sidebar collapses to a logo rail; icon tooltips show the
  destination name on hover. The collapsed state is persisted.
- UTF-8 ↔ GB18030 encoding conversion directly from the editor toolbar.
- Markdown source/split/preview and SQL dialect highlighting + `sql-formatter`.

### Search

- Streaming workspace search with regex, case, whole-word and glob filters.
- Search results survive jumping to the editor; recent-query history is stored locally.
- Replace preview with per-file confirmation, snapshot + undo.

### Git

- Status, log, structured diffs and shadow snapshots.
- PyCharm-style side-by-side diff with per-line/block checkboxes and “overwrite selected” from the
  original version (`POST /api/git/overwrite-lines`).
- Custom Gitee/GitHub/generic Git remote profiles; tokens stay in Windows DPAPI and are never
  written into `.git/config`.
- Git command catalog with argv preview, danger confirmation, output redaction, hints and history.

### Data

- SQLite (`node:sqlite`) with worker isolation, timeout and row limits.
- MySQL (`mysql2`) metadata, queries, virtualized result grid and true streaming CSV/JSON export.
- Redis key browsing via `SCAN` only, typed value viewer, read-only command whitelist and pub/sub.
- Local defaults from `config/local.json`; passwords are sealed with Windows DPAPI.

### Notifications

- In-app notification center with unread badge, mark-all-read and clear.
- Focused: toast. Blurred: native Notification when permitted.
- 3-second dedupe/aggregation, source/session mute, quiet hours, privacy mode, deep links, and
  flashing document title.
- Event sources: chat completion/failure/permission, Git commands, DB queries, terminal exits.

### Settings

- “外观与字体”: independent UI scale (50–250%) and text scale (60–300%), direct numeric inputs,
  local/system/custom font loading, reset, and theme (dark/light/system).
- Adaptive layout above 150% text size: controls grow and wrap instead of clipping borders.
- Workspace configuration lives in the top-bar workspace menu (switch, add via native folder
  picker, remove).
- Capability probe with one-click install (`node-pty`, `pyright`, Git) and live progress.
- OpenCode v2 configuration editor: reads/writes the real `opencode.json`, lists plugins, checks
  and applies plugin updates, and exposes providers/other APIs/MCP/agents as JSON.
- Keybinding editor with per-command clearing, conflict detection and reset.

## Quick start (Windows)

Requirements: Node.js 20+, opencode v2 installed, Git (optional but recommended).

```powershell
npm install

# development: BFF + Vite
npm run dev
# open http://127.0.0.1:5173

# production-style: build the SPA and serve it from the BFF
npm run build
npm start
# open the printed URL, usually http://127.0.0.1:4310

# open the running GUI in the default browser
npm run gui
```

The BFF chooses the configured port or the next free one, then writes it to
`%LOCALAPPDATA%\opencode-gui\runtime.json`. `npm run gui` reads that file.

## Configuration

- Settings: `%APPDATA%\opencode-gui\settings.json`
- Workspaces: `%APPDATA%\opencode-gui\workspaces.json`
- Runtime/lock/cache/logs: `%LOCALAPPDATA%\opencode-gui\`
- Attachment uploads: `%APPDATA%\opencode-gui\attachments\`
- Git remote profiles: `%APPDATA%\opencode-gui\git-profiles.json` (tokens in DPAPI)
- Database connections: `%APPDATA%\opencode-gui\connections.json` (only `authRef`, no passwords)

### Local Redis / MySQL defaults

`config/local.example.json` documents the shape. Copy it to `config/local.json` (gitignored):

```json
{
  "redis": { "url": "redis://localhost:6379/0" },
  "mysql": { "host": "127.0.0.1", "port": 3306, "user": "root", "password": "root", "database": "" }
}
```

On startup the BFF creates/updates read-only `Local Redis` and `Local MySQL` profiles from this
file. Passwords go directly into Windows DPAPI. Override the path with `OCG_LOCAL_CONFIG`.

### Environment variables

| Variable | Meaning |
| --- | --- |
| `OCG_HOST` / `OCG_PORT` | BFF bind host/port |
| `OCG_WORKSPACE` | Initial workspace |
| `OCG_OC_URL` | Attach to an existing opencode URL (implies attach mode) |
| `OCG_OC_BIN` | opencode executable |
| `OCG_GUI_DIR` | Built SPA directory |
| `OCG_LOCAL_CONFIG` | Alternative `config/local.json` |

## Scripts

```powershell
npm run typecheck        # all workspaces
npm test                 # unit tests
npm run build            # GUI + server
npm start                # production BFF
npm run gui              # open the running BFF in the browser
node scripts/probe.mjs   # refresh docs/upstream/probe.json
```

## API summary

| Area | Endpoints |
| --- | --- |
| System | `GET /api/health`, `GET /api/probe`, `GET/PUT /api/settings` |
| Workspaces | `GET/POST /api/workspaces`, `PATCH/DELETE /api/workspaces/:id` |
| Files | `GET /api/fs/tree|find|file|raw`, `PUT /api/fs/file`, rename/delete/mkdir |
| Chat attachments | `POST/GET /api/chat/attachment` |
| Search | `POST /api/search`, replace preview/apply/undo |
| Git | status/log/diff/exec/commit/push/apply-hunk/overwrite-lines, command catalog/history |
| Git profiles | `GET/POST /api/git/profiles`, `PUT/DELETE /api/git/profiles/:id`, apply/test |
| Data | connections, `POST /api/db/query`, metadata, export, Redis SCAN/value/command/subscribe |
| OpenCode | `ANY /api/oc/*` proxy; `GET/PUT /api/opencode/config` |
| Install | `POST /api/system/install`, `GET /api/system/install/:id`, `POST /api/system/pick-folder` |
| Events | `GET /api/events` (SSE multiplex) |

See [`docs/api-contract.md`](docs/api-contract.md) and [`docs/acceptance.md`](docs/acceptance.md)
for the detailed contract and verification records.

## Security and privacy

- BFF listens on `127.0.0.1` only; no login/multi-user/remote/TLS by design.
- Database and Git secrets are stored via Windows DPAPI. API responses and logs never contain
  plaintext secrets; `connections.json`/`git-profiles.json` hold only opaque references.
- SQLite/MySQL read-only profiles reject writes and multi-statement SQL.
- Redis key browsing never sends `KEYS`; the command console uses a read-only whitelist.
- Markdown is rendered with `html: false` and sanitized by DOMPurify before insertion.
- Config writes from the OpenCode editor are backed up next to `opencode.json` first.

## Known limitations

- PostgreSQL is intentionally not enabled (no local test environment); profiles return
  `driver_not_available`.
- SQLite export still buffers; MySQL export streams row by row.
- Redis 100k-key stress testing is intentionally skipped.
- Tauri packaging is a scaffold; the browser build is the supported runtime. Native notifications
  use the Web Notification API.
- Git line overwrite applies to the working tree only; staged/commit review remains read-only.
- Code symbol navigation is a lightweight current-document index, not a full LSP; definitions in
  other files are not followed automatically.
- Reserved browser shortcuts (`Ctrl+W`, `F5`) cannot be fully intercepted.

## Repository layout

```
apps/gui/         React + Vite + CodeMirror 6 + xterm.js + zustand
apps/server/      Fastify BFF (proxy, SSE, fs/search/replace/git/snapshots/pty/lint/data)
apps/desktop/     Tauri scaffold
packages/host/    RuntimeHost + WindowsLocalHost
packages/protocol/ BFF/upstream types + event reducer
packages/diff/    Unified-diff parser, hunk apply/reverse, patch rebuild
packages/db/      SQL classification and read-only guards
packages/redis/   Redis command whitelist
docs/             API contract, acceptance, upstream probe, design references
```

## Design references and attribution

The shell follows Apple's Human Interface Guidelines for a macOS-inspired desktop app: a leading
navigation sidebar, a compact toolbar for the current view, generous hit targets, light/dark
appearance, clear focus states, and restrained motion.

- **Apple Design Skill** by [dickwu](https://github.com/dickwu/apple-design-skill), a review skill
  built on 123 Apple HIG pages. The reference copy lives under
  `docs/apple-design-skill-main/`. Consulted pages include `references/hig/layout.md`,
  `sidebars.md`, `toolbars.md`, `typography.md`, `color.md`, `accessibility.md`, `motion.md`,
  and `designing-for-macos.md`.
  The guideline text belongs to **Apple Inc.**, is reproduced from Apple's public Human Interface
  Guidelines, and this project is not affiliated with or endorsed by Apple.

These references are kept for design guidance only; no skill code is executed at runtime.

## License

Application code in this repository is provided for the project owner. Third-party dependencies retain
their respective licenses. The Apple HIG text under `docs/apple-design-skill-main/` belongs to
Apple Inc. and is included for design reference only.
