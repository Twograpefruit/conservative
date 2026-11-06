#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::fs::OpenOptions;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

use tauri::{Manager, RunEvent, Url};

const BFF_PORT: u16 = 4310;
const ERROR_PAGE: &str =
    "data:text/html,<h1>Conser%20BFF%20failed%20to%20start</h1><p>See%20%25LOCALAPPDATA%25%5Copencode-gui%5Clogs%5Cdesktop-bff.log</p>";

struct BffProcess(Mutex<Option<Child>>);

fn runtime_url() -> Option<String> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let file = Path::new(&base).join("opencode-gui").join("runtime.json");
    let text = std::fs::read_to_string(file).ok()?;
    let json: serde_json::Value = serde_json::from_str(&text).ok()?;
    json.get("bff")?.get("url")?.as_str().map(|value| value.to_string())
}

fn url_socket(url: &str) -> Option<SocketAddr> {
    let without_scheme = url.split("://").nth(1).unwrap_or(url);
    let authority = without_scheme.split('/').next()?;
    authority.parse().ok()
}

fn health_ok(url: &str) -> bool {
    let Some(addr) = url_socket(url) else {
        return false;
    };
    let Ok(mut stream) = TcpStream::connect_timeout(&addr, Duration::from_millis(500)) else {
        return false;
    };
    let _ = stream.set_read_timeout(Some(Duration::from_millis(800)));
    let request = "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: close\r\n\r\n";
    if stream.write_all(request.as_bytes()).is_err() {
        return false;
    }
    let mut response = String::new();
    let _ = stream.read_to_string(&mut response);
    response.starts_with("HTTP/1.1 200") && response.contains("\"bff\"")
}

fn bff_running() -> bool {
    runtime_url().map(|url| health_ok(&url)).unwrap_or(false)
}

fn clean_path(path: PathBuf) -> PathBuf {
    let text = path.to_string_lossy();
    if let Some(rest) = text.strip_prefix(r"\\?\UNC\") {
        return PathBuf::from(format!(r"\\{rest}"));
    }
    if let Some(rest) = text.strip_prefix(r"\\?\") {
        return PathBuf::from(rest);
    }
    path
}

fn resource_dir(app: &tauri::AppHandle) -> Option<PathBuf> {
    if let Ok(dir) = app.path().resource_dir() {
        let dir = clean_path(dir);
        if dir.exists() {
            return Some(dir);
        }
    }
    std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(clean_path)
}

fn find_node(resources: &Path) -> Option<PathBuf> {
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|exe| exe.parent().map(Path::to_path_buf))
        .map(clean_path);
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Some(dir) = exe_dir {
        candidates.push(dir.join("node.exe"));
        candidates.push(dir.join("node-x86_64-pc-windows-msvc.exe"));
    }
    candidates.push(resources.join("node.exe"));
    candidates.push(resources.join("binaries").join("node.exe"));
    candidates
        .into_iter()
        .find(|path| path.exists())
        .or_else(which_node)
}

fn which_node() -> Option<PathBuf> {
    if let Ok(path) = std::env::var("PATH") {
        for dir in path.split(';') {
            if dir.trim().is_empty() {
                continue;
            }
            let candidate = Path::new(dir).join("node.exe");
            if candidate.exists() {
                return Some(candidate);
            }
        }
    }
    None
}

fn log_line(message: &str) {
    if let Some(mut file) = log_target() {
        let _ = writeln!(file, "{message}");
    }
}

fn log_target() -> Option<std::fs::File> {
    let base = std::env::var("LOCALAPPDATA").ok()?;
    let dir = Path::new(&base).join("opencode-gui").join("logs");
    std::fs::create_dir_all(&dir).ok()?;
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(dir.join("desktop-bff.log"))
        .ok()
}

fn spawn_bff(app: &tauri::AppHandle) -> Option<Child> {
    // An already-running Conser BFF (for example `npm start`) is reused.
    if bff_running() {
        return None;
    }

    let resources = resource_dir(app)?;
    let server = resources.join("server").join("index.js");
    if !server.exists() {
        eprintln!("[desktop] BFF entry not found at {}", server.display());
        return None;
    }
    let gui_dir = resources.join("gui");
    let node = find_node(&resources)?;
    let cwd = std::env::var("USERPROFILE").unwrap_or_else(|_| resources.display().to_string());
    log_line(&format!(
        "spawn node={} server={} cwd={} resources={}",
        node.display(),
        server.display(),
        cwd,
        resources.display()
    ));

    let mut command = Command::new(&node);
    command
        .arg(&server)
        .current_dir(&cwd)
        .env("OCG_GUI_DIR", &gui_dir)
        .env("OCG_PORT", BFF_PORT.to_string())
        .env("OCG_VERSION", env!("CARGO_PKG_VERSION"))
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());

    let bundled_opencode = resources
        .join("server")
        .join("opencode")
        .join("opencode.exe");
    if bundled_opencode.exists() {
        command.env("OCG_OPENCODE_BIN", &bundled_opencode);
    }

    if let Some(log) = log_target() {
        if let Ok(clone) = log.try_clone() {
            command.stdout(Stdio::from(clone));
        }
        command.stderr(Stdio::from(log));
    }

    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x08000000;
        command.creation_flags(CREATE_NO_WINDOW);
    }

    match command.spawn() {
        Ok(child) => {
            log_line(&format!("started BFF pid={}", child.id()));
            println!(
                "[desktop] started BFF with {} ({})",
                node.display(),
                server.display()
            );
            Some(child)
        }
        Err(err) => {
            eprintln!("[desktop] failed to start BFF: {err}");
            None
        }
    }
}

fn reveal_window(app: &tauri::AppHandle) {
    let handle = app.clone();
    std::thread::spawn(move || {
        let deadline = Instant::now() + Duration::from_secs(45);
        let mut target: Option<String> = None;
        while Instant::now() < deadline {
            if let Some(url) = runtime_url() {
                if health_ok(&url) {
                    target = Some(url);
                    break;
                }
            }
            std::thread::sleep(Duration::from_millis(250));
        }
        let target = target.unwrap_or_else(|| ERROR_PAGE.to_string());
        if let Some(window) = handle.get_webview_window("main") {
            if let Ok(url) = Url::parse(&target) {
                let _ = window.navigate(url);
            }
            let _ = window.show();
            let _ = window.set_focus();
        }
    });
}

fn main() {
    tauri::Builder::default()
        .setup(|app| {
            let child = spawn_bff(app.handle());
            app.manage(BffProcess(Mutex::new(child)));
            reveal_window(app.handle());
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building Conser desktop shell")
        .run(|app, event| {
            if let RunEvent::Exit = event {
                if let Some(state) = app.try_state::<BffProcess>() {
                    if let Ok(mut guard) = state.0.lock() {
                        if let Some(mut child) = guard.take() {
                            let _ = child.kill();
                            let _ = child.wait();
                        }
                    }
                }
            }
        });
}
