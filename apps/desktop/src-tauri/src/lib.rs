use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex,
    },
    time::Duration,
};
use tauri::{
    menu::{MenuBuilder, SubmenuBuilder},
    Emitter, Manager, Runtime, WebviewWindow,
};
use tauri_plugin_shell::{
    process::{CommandChild, CommandEvent},
    ShellExt,
};
use tokio::sync::oneshot;

const PROTOCOL_PREFIX: &str = "CAVALRY_IPC_V1:";
const PROTOCOL_VERSION: u64 = 1;
const HOST_READY_TIMEOUT: Duration = Duration::from_secs(30);
const HOST_REQUEST_TIMEOUT: Duration = Duration::from_secs(330);
const MAX_REQUEST_BYTES: usize = 32 * 1024 * 1024;

#[derive(Default)]
struct HostState {
    child: Mutex<Option<CommandChild>>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    ready: AtomicBool,
    sequence: AtomicU64,
}

impl HostState {
    fn next_id(&self) -> String {
        format!("rust-{}", self.sequence.fetch_add(1, Ordering::Relaxed) + 1)
    }

    fn write(&self, message: &Value) -> Result<(), String> {
        let serialized = serde_json::to_string(message).map_err(|error| error.to_string())?;
        if serialized.len() > MAX_REQUEST_BYTES {
            return Err("The desktop host request exceeds Cavalry's size limit.".into());
        }
        let line = format!("{PROTOCOL_PREFIX}{serialized}\n");
        let mut child = self
            .child
            .lock()
            .map_err(|_| "Desktop host lock poisoned.")?;
        let process = child
            .as_mut()
            .ok_or_else(|| "The Cavalry desktop host is not running.".to_string())?;
        process
            .write(line.as_bytes())
            .map_err(|error| error.to_string())
    }

    fn reject_pending(&self, message: &str) {
        let reply = json!({
            "version": PROTOCOL_VERSION,
            "type": "response",
            "ok": false,
            "error": { "code": "host_stopped", "message": message }
        });
        if let Ok(mut pending) = self.pending.lock() {
            for (_, sender) in pending.drain() {
                let _ = sender.send(reply.clone());
            }
        }
    }
}

fn allowed_host_channel(channel: &str) -> bool {
    [
        "cavalry-files:",
        "cavalry-companion:",
        "cavalry-advisor:",
        "cavalry-cloud:",
        "cavalry-host:",
    ]
    .iter()
    .any(|prefix| channel.starts_with(prefix))
}

#[tauri::command]
async fn host_invoke(
    state: tauri::State<'_, Arc<HostState>>,
    channel: String,
    payload: Value,
) -> Result<Value, String> {
    if !allowed_host_channel(&channel) {
        return Err("The requested desktop host channel is not allowed.".into());
    }

    let ready_started = std::time::Instant::now();
    while !state.ready.load(Ordering::Acquire) {
        if ready_started.elapsed() >= HOST_READY_TIMEOUT {
            return Err("The Cavalry desktop host did not become ready.".into());
        }
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    let id = state.next_id();
    let (sender, receiver) = oneshot::channel();
    state
        .pending
        .lock()
        .map_err(|_| "Desktop host request lock poisoned.".to_string())?
        .insert(id.clone(), sender);

    let request = json!({
        "version": PROTOCOL_VERSION,
        "type": "request",
        "id": id.clone(),
        "channel": channel,
        "payload": payload
    });
    if let Err(error) = state.write(&request) {
        if let Ok(mut pending) = state.pending.lock() {
            pending.remove(&id);
        }
        return Err(error);
    }

    let reply = match tokio::time::timeout(HOST_REQUEST_TIMEOUT, receiver).await {
        Ok(Ok(reply)) => reply,
        Ok(Err(_)) => return Err("The Cavalry desktop host stopped before replying.".into()),
        Err(_) => {
            if let Ok(mut pending) = state.pending.lock() {
                pending.remove(&id);
            }
            return Err("The Cavalry desktop host request timed out.".into());
        }
    };

    if reply.get("ok").and_then(Value::as_bool) == Some(true) {
        Ok(reply.get("result").cloned().unwrap_or(Value::Null))
    } else {
        Err(reply
            .pointer("/error/message")
            .and_then(Value::as_str)
            .unwrap_or("The Cavalry desktop host request failed.")
            .to_string())
    }
}

#[tauri::command]
fn host_native_response(
    state: tauri::State<'_, Arc<HostState>>,
    response: Value,
) -> Result<(), String> {
    state.write(&json!({
        "version": PROTOCOL_VERSION,
        "type": "native-response",
        "response": response
    }))
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    app.restart();
}

fn legacy_user_data_dir() -> String {
    #[cfg(target_os = "macos")]
    {
        let home = env::var("HOME").unwrap_or_else(|_| ".".into());
        format!("{home}/Library/Application Support/Cavalry for Mac")
    }
    #[cfg(target_os = "windows")]
    {
        let base = env::var("APPDATA")
            .or_else(|_| env::var("USERPROFILE"))
            .unwrap_or_else(|_| ".".into());
        format!("{base}\\Cavalry")
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let base = env::var("XDG_CONFIG_HOME").unwrap_or_else(|_| {
            format!(
                "{}/.config",
                env::var("HOME").unwrap_or_else(|_| ".".into())
            )
        });
        format!("{base}/Cavalry")
    }
}

fn app_display_name() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "Cavalry for Mac"
    }
    #[cfg(target_os = "windows")]
    {
        "Cavalry for Windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "Cavalry"
    }
}

fn process_host_message<R: Runtime>(
    app: &tauri::AppHandle<R>,
    state: &Arc<HostState>,
    value: Value,
) {
    match value
        .get("type")
        .and_then(Value::as_str)
        .unwrap_or_default()
    {
        "ready" => {
            state.ready.store(true, Ordering::Release);
            let _ = app.emit("cavalry-host-ready", value);
        }
        "response" => {
            let id = value.get("id").and_then(Value::as_str).unwrap_or_default();
            if let Ok(mut pending) = state.pending.lock() {
                if let Some(sender) = pending.remove(id) {
                    let _ = sender.send(value);
                }
            }
        }
        "event" => {
            let payload = json!({
                "channel": value.get("channel").cloned().unwrap_or(Value::Null),
                "payload": value.get("payload").cloned().unwrap_or(Value::Null)
            });
            let _ = app.emit("cavalry-host-event", payload);
        }
        "native-request" => {
            let _ = app.emit("cavalry-native-request", value);
        }
        "fatal" => {
            state.ready.store(false, Ordering::Release);
            state.reject_pending("The Cavalry desktop host encountered a fatal error.");
            let _ = app.emit("cavalry-host-fatal", value);
        }
        "stopped" => {
            state.ready.store(false, Ordering::Release);
            state.reject_pending("The Cavalry desktop host stopped.");
        }
        _ => {}
    }
}

fn spawn_host<R: Runtime>(
    app: &tauri::App<R>,
    state: Arc<HostState>,
) -> Result<(), Box<dyn std::error::Error>> {
    let package = app.package_info();
    let command = if cfg!(debug_assertions) {
        let host_path = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../dist/host/index.cjs");
        if !host_path.is_file() {
            return Err(format!(
                "The development host bundle is missing at {}. Run npm run build:host first.",
                host_path.display()
            )
            .into());
        }
        app.shell().command("node").arg(host_path)
    } else {
        app.shell().sidecar("cavalry-host")?
    }
    .env("CAVALRY_APP_NAME", app_display_name())
    .env("CAVALRY_APP_VERSION", package.version.to_string())
    .env(
        "CAVALRY_IS_PACKAGED",
        if cfg!(debug_assertions) { "0" } else { "1" },
    )
    .env("CAVALRY_USER_DATA_DIR", legacy_user_data_dir());
    let (mut events, child) = command.spawn()?;
    *state
        .child
        .lock()
        .map_err(|_| "Desktop host lock poisoned.")? = Some(child);

    let app_handle = app.handle().clone();
    let event_state = state.clone();
    tauri::async_runtime::spawn(async move {
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    let output = String::from_utf8_lossy(&bytes);
                    for line in output.lines() {
                        let Some(index) = line.find(PROTOCOL_PREFIX) else {
                            continue;
                        };
                        let payload = &line[index + PROTOCOL_PREFIX.len()..];
                        if let Ok(value) = serde_json::from_str::<Value>(payload) {
                            process_host_message(&app_handle, &event_state, value);
                        }
                    }
                }
                CommandEvent::Stderr(bytes) => {
                    eprintln!("[cavalry-host] {}", String::from_utf8_lossy(&bytes));
                }
                CommandEvent::Error(error) => {
                    event_state.ready.store(false, Ordering::Release);
                    event_state.reject_pending("The Cavalry desktop host could not continue.");
                    let _ = app_handle.emit("cavalry-host-fatal", json!({ "error": error }));
                }
                CommandEvent::Terminated(payload) => {
                    event_state.ready.store(false, Ordering::Release);
                    event_state.reject_pending("The Cavalry desktop host terminated.");
                    let _ = app_handle.emit(
                        "cavalry-host-stopped",
                        json!({
                            "code": payload.code,
                            "signal": payload.signal
                        }),
                    );
                }
                _ => {}
            }
        }
    });
    Ok(())
}

fn install_menu<R: Runtime>(app: &tauri::App<R>) -> tauri::Result<()> {
    let file = SubmenuBuilder::new(app, "File")
        .text("new-transaction", "New Transaction")
        .separator()
        .text("open-workbook", "Open Workbook…")
        .text("save-workbook", "Save Workbook")
        .text("save-workbook-as", "Save Workbook As…")
        .separator()
        .text("open-settings", "Settings…")
        .separator()
        .quit()
        .build()?;
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    let view = SubmenuBuilder::new(app, "View")
        .text("reload-window", "Reload")
        .text("toggle-fullscreen", "Toggle Full Screen")
        .build()?;
    let help = SubmenuBuilder::new(app, "Help")
        .text("check-for-updates", "Check for Updates…")
        .build()?;
    let menu = MenuBuilder::new(app)
        .items(&[&file, &edit, &view, &help])
        .build()?;
    app.set_menu(menu)?;
    Ok(())
}

fn show_main_window<R: Runtime>(app: &tauri::AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

fn handle_menu<R: Runtime>(app: &tauri::AppHandle<R>, id: &str) {
    let Some(window): Option<WebviewWindow<R>> = app.get_webview_window("main") else {
        return;
    };
    match id {
        "reload-window" => {
            let _ = window.eval("window.location.reload()");
        }
        "toggle-fullscreen" => {
            let fullscreen = window.is_fullscreen().unwrap_or(false);
            let _ = window.set_fullscreen(!fullscreen);
        }
        command => {
            let _ = app.emit("cavalry-command", command);
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let host_state = Arc::new(HostState::default());
    let managed_state = host_state.clone();

    let app = tauri::Builder::default()
        // This plugin must be registered first so Windows/Linux deep-link launches
        // are forwarded to the already-running process.
        .plugin(tauri_plugin_single_instance::init(|app, args, _cwd| {
            show_main_window(app);
            let urls: Vec<String> = args
                .into_iter()
                .filter(|arg| arg.to_ascii_lowercase().starts_with("cavalry://"))
                .collect();
            if !urls.is_empty() {
                let _ = app.emit("cavalry-deep-link", urls);
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .manage(managed_state)
        .invoke_handler(tauri::generate_handler![
            host_invoke,
            host_native_response,
            relaunch_app
        ])
        .setup(move |app| {
            install_menu(app)?;
            app.on_menu_event(|app_handle, event| {
                handle_menu(app_handle, event.id().as_ref());
            });
            spawn_host(app, host_state.clone())?;
            Ok(())
        })
        .on_window_event(|window, event| {
            #[cfg(target_os = "macos")]
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let _ = window.hide();
            }
        })
        .build(tauri::generate_context!())
        .expect("error while building Cavalry");

    app.run(|app_handle, event| match event {
        #[cfg(target_os = "macos")]
        tauri::RunEvent::Reopen { .. } => show_main_window(app_handle),
        tauri::RunEvent::ExitRequested { .. } | tauri::RunEvent::Exit => {
            if let Some(state) = app_handle.try_state::<Arc<HostState>>() {
                let _ = state.write(&json!({
                    "version": PROTOCOL_VERSION,
                    "type": "lifecycle",
                    "action": "shutdown"
                }));
            }
        }
        _ => {}
    });
}
