# Desktop shell (M4 scaffold)

This directory is a **scaffold**, not a finished M4 deliverable. The browser build is the
primary target and is fully functional; the Tauri shell is provided so M4 work can start
without re-arranging the repository.

## What exists

- `src-tauri/tauri.conf.json` — WebView2 window pointed at the BFF (`127.0.0.1:4310`).
- `src-tauri/src/main.rs` — minimal `tauri::Builder`.
- `src-tauri/Cargo.toml` — Tauri v2 dependencies.

## What is deliberately not implemented yet

- Bundling the BFF/opencode lifecycle into the shell (start on launch, stop on exit).
- System tray + single-instance activation.
- Windows Job Object ownership by the shell (the BFF already attaches a Job Object watchdog
  to its managed opencode child, so killing the BFF does not leave orphans).
- Code signing / installer.
- Memory instrumentation of the WebView process (M4-003).

## How to run it

```powershell
# terminal 1: start the BFF (it starts opencode and serves the built GUI)
npm run build
npm start

# terminal 2: install Rust stable + tauri-cli, then:
cd apps/desktop
npx @tauri-apps/cli dev
```

The window loads `http://127.0.0.1:4310`. If the BFF had to fall back to another port,
edit `src-tauri/tauri.conf.json` or set `OCG_PORT`/`settings.json` accordingly.
