use serde_json::{json, Value};
use std::{
    collections::HashMap,
    env,
    ffi::{c_char, CStr, CString},
    path::PathBuf,
    sync::{
        atomic::{AtomicBool, AtomicU64, Ordering},
        Arc, Mutex, OnceLock,
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
const MAX_HOST_LINE_BYTES: usize = MAX_REQUEST_BYTES + 1024;

type CloudKitEventCallback = extern "C" fn(*const c_char);

unsafe extern "C" {
    fn cavalry_cloudkit_request(request: *const c_char) -> *mut c_char;
    fn cavalry_cloudkit_free_string(value: *mut c_char);
    fn cavalry_cloudkit_set_event_callback(callback: Option<CloudKitEventCallback>);
}

static CLOUDKIT_HOST_STATE: OnceLock<Arc<HostState>> = OnceLock::new();

#[derive(Default)]
struct ExitState {
    ready: AtomicBool,
    pending: AtomicBool,
    approved: AtomicBool,
}

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

fn cloudkit_request_blocking(request: Value) -> Result<Value, String> {
    let serialized = serde_json::to_string(&request).map_err(|error| error.to_string())?;
    if serialized.len() > MAX_REQUEST_BYTES {
        return Err("The CloudKit request exceeds Cavalry's size limit.".into());
    }
    let request = CString::new(serialized)
        .map_err(|_| "The CloudKit request contains an invalid string.".to_string())?;
    let response_pointer = unsafe { cavalry_cloudkit_request(request.as_ptr()) };
    if response_pointer.is_null() {
        return Err("The native CloudKit bridge did not return a response.".into());
    }
    let response_bytes = unsafe { CStr::from_ptr(response_pointer) }
        .to_bytes()
        .to_vec();
    unsafe { cavalry_cloudkit_free_string(response_pointer) };
    serde_json::from_slice(&response_bytes)
        .map_err(|_| "The native CloudKit bridge returned an invalid response.".to_string())
}

#[tauri::command]
async fn cloudkit_request(request: Value) -> Result<Value, String> {
    tauri::async_runtime::spawn_blocking(move || cloudkit_request_blocking(request))
        .await
        .map_err(|error| format!("The native CloudKit task stopped unexpectedly: {error}"))?
}

extern "C" fn handle_cloudkit_event(raw_event: *const c_char) {
    if raw_event.is_null() {
        return;
    }
    let bytes = unsafe { CStr::from_ptr(raw_event) }.to_bytes();
    let Ok(payload) = serde_json::from_slice::<Value>(bytes) else {
        return;
    };
    let Some(state) = CLOUDKIT_HOST_STATE.get() else {
        return;
    };
    let _ = state.write(&json!({
        "version": PROTOCOL_VERSION,
        "type": "native-event",
        "source": "cloudkit",
        "payload": payload
    }));
}

#[tauri::command]
fn relaunch_app(app: tauri::AppHandle) {
    // The renderer awaits its workbook save guard before invoking this command.
    app.state::<ExitState>()
        .approved
        .store(true, Ordering::Release);
    app.restart();
}

#[tauri::command]
fn enable_exit_guard(app: tauri::AppHandle, state: tauri::State<'_, ExitState>) {
    state.ready.store(true, Ordering::Release);
    // A quit requested while the WebView was reloading must reach the new listener.
    if state.pending.load(Ordering::Acquire) {
        let _ = app.emit("cavalry-before-exit", ());
    }
}

#[tauri::command]
fn complete_exit(app: tauri::AppHandle, state: tauri::State<'_, ExitState>, allow: bool) {
    if !state.pending.swap(false, Ordering::AcqRel) {
        return;
    }
    if allow {
        state.approved.store(true, Ordering::Release);
        app.exit(0);
    }
}

fn legacy_user_data_dir() -> String {
    let home = env::var("HOME").unwrap_or_else(|_| ".".into());
    format!("{home}/Library/Application Support/Cavalry for Mac")
}

fn app_display_name() -> &'static str {
    "Cavalry for Mac"
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

fn take_host_messages(buffer: &mut Vec<u8>, chunk: &[u8]) -> Result<Vec<Value>, String> {
    buffer.extend_from_slice(chunk);

    let prefix = PROTOCOL_PREFIX.as_bytes();
    let mut messages = Vec::new();
    while let Some(newline_index) = buffer.iter().position(|byte| *byte == b'\n') {
        if newline_index > MAX_HOST_LINE_BYTES {
            buffer.clear();
            return Err("The Cavalry desktop host response exceeds the size limit.".into());
        }
        let mut line: Vec<u8> = buffer.drain(..=newline_index).collect();
        line.pop();
        if line.last() == Some(&b'\r') {
            line.pop();
        }
        let Some(prefix_index) = line.windows(prefix.len()).position(|bytes| bytes == prefix)
        else {
            continue;
        };
        let payload = &line[prefix_index + prefix.len()..];
        if let Ok(value) = serde_json::from_slice::<Value>(payload) {
            messages.push(value);
        }
    }
    if buffer.len() > MAX_HOST_LINE_BYTES {
        buffer.clear();
        return Err("The Cavalry desktop host response exceeds the size limit.".into());
    }
    Ok(messages)
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
        let mut stdout_buffer = Vec::new();
        while let Some(event) = events.recv().await {
            match event {
                CommandEvent::Stdout(bytes) => {
                    match take_host_messages(&mut stdout_buffer, &bytes) {
                        Ok(messages) => {
                            for value in messages {
                                process_host_message(&app_handle, &event_state, value);
                            }
                        }
                        Err(error) => {
                            event_state.ready.store(false, Ordering::Release);
                            event_state.reject_pending(&error);
                            let _ = app_handle.emit(
                                "cavalry-host-fatal",
                                json!({
                                    "error": error
                                }),
                            );
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
    let _ = CLOUDKIT_HOST_STATE.set(host_state.clone());
    unsafe { cavalry_cloudkit_set_event_callback(Some(handle_cloudkit_event)) };

    let app = tauri::Builder::default()
        // Register first so deep-link launches reach the already-running Mac app.
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
        .manage(ExitState::default())
        .invoke_handler(tauri::generate_handler![
            cloudkit_request,
            host_invoke,
            host_native_response,
            relaunch_app,
            enable_exit_guard,
            complete_exit
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
        tauri::RunEvent::ExitRequested { api, .. } => {
            let state = app_handle.state::<ExitState>();
            if state.ready.load(Ordering::Acquire) && !state.approved.load(Ordering::Acquire) {
                api.prevent_exit();
                show_main_window(app_handle);
                if !state.pending.swap(true, Ordering::AcqRel)
                    && app_handle.emit("cavalry-before-exit", ()).is_err()
                {
                    state.pending.store(false, Ordering::Release);
                }
            }
        }
        tauri::RunEvent::Exit => {
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
    unsafe { cavalry_cloudkit_set_event_callback(None) };
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn buffers_split_host_protocol_frames() {
        let mut buffer = Vec::new();
        assert!(
            take_host_messages(&mut buffer, b"CAVALRY_IPC_V1:{\"type\":\"rea")
                .unwrap()
                .is_empty()
        );
        let messages = take_host_messages(&mut buffer, b"dy\",\"version\":1}\n").unwrap();
        assert_eq!(messages.len(), 1);
        assert_eq!(messages[0]["type"], "ready");
        assert!(buffer.is_empty());
    }

    #[test]
    fn buffers_unicode_and_extracts_multiple_frames() {
        let mut buffer = Vec::new();
        let payload = "CAVALRY_IPC_V1:{\"type\":\"event\",\"value\":\"Café\"}\n\
CAVALRY_IPC_V1:{\"type\":\"stopped\"}\n";
        let cafe_boundary = payload.find('é').unwrap() + 1;
        assert!(
            take_host_messages(&mut buffer, &payload.as_bytes()[..cafe_boundary])
                .unwrap()
                .is_empty()
        );
        let messages =
            take_host_messages(&mut buffer, &payload.as_bytes()[cafe_boundary..]).unwrap();
        assert_eq!(messages.len(), 2);
        assert_eq!(messages[0]["value"], "Café");
        assert_eq!(messages[1]["type"], "stopped");
        assert!(buffer.is_empty());
    }

    #[test]
    fn rejects_an_unbounded_partial_host_frame() {
        let mut buffer = vec![b'x'; MAX_HOST_LINE_BYTES];
        let error = take_host_messages(&mut buffer, b"x").unwrap_err();
        assert!(error.contains("size limit"));
        assert!(buffer.is_empty());
    }
}
