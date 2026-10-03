use serde::{Deserialize, Serialize};
use std::{
    sync::atomic::{AtomicBool, Ordering},
    thread,
};
use tauri::{Emitter, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut, ShortcutState};

static LOOKUP_BUSY: AtomicBool = AtomicBool::new(false);

#[derive(Deserialize)]
pub struct ShortcutConfig {
    lookup: String,
    search: String,
}

#[derive(Clone, Serialize)]
struct LookupResult {
    text: String,
    error: String,
}

pub fn show_main_window(app: &tauri::AppHandle) -> Result<(), String> {
    let window = app.get_webview_window("main").ok_or("找不到搜尋視窗")?;
    window.unminimize().map_err(|e| e.to_string())?;
    window.show().map_err(|e| e.to_string())?;
    window.set_focus().map_err(|e| e.to_string())
}

#[tauri::command]
pub fn configure_shortcuts(app: tauri::AppHandle, config: ShortcutConfig) -> Result<(), String> {
    let lookup: Shortcut = config
        .lookup
        .parse()
        .map_err(|e| format!("反白查詢快捷鍵無效：{e}"))?;
    let search: Shortcut = config
        .search
        .parse()
        .map_err(|e| format!("搜尋快捷鍵無效：{e}"))?;
    if lookup == search {
        return Err("兩個功能不能使用相同快捷鍵".into());
    }
    app.global_shortcut()
        .unregister_all()
        .map_err(|e| e.to_string())?;
    app.global_shortcut()
        .on_shortcut(lookup, |app, _, event| {
            if event.state != ShortcutState::Pressed || LOOKUP_BUSY.swap(true, Ordering::SeqCst) {
                return;
            }
            let app = app.clone();
            thread::spawn(move || {
                // Copy from the original foreground app before raising our own window.
                let result = super::capture_selected_text();
                let payload = match result {
                    Ok(text) => LookupResult {
                        text,
                        error: String::new(),
                    },
                    Err(error) => LookupResult {
                        text: String::new(),
                        error,
                    },
                };
                let handle = app.clone();
                let dispatched = app.run_on_main_thread(move || {
                    if let Err(error) = show_main_window(&handle) {
                        eprintln!("{error}");
                    }
                    let _ = handle.emit("lookup-selected-text", payload);
                    LOOKUP_BUSY.store(false, Ordering::SeqCst);
                });
                if dispatched.is_err() {
                    LOOKUP_BUSY.store(false, Ordering::SeqCst);
                }
            });
        })
        .map_err(|e| e.to_string())?;
    if let Err(error) = app.global_shortcut().on_shortcut(search, |app, _, event| {
        if event.state != ShortcutState::Pressed {
            return;
        }
        let app = app.clone();
        let handle = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Err(error) = show_main_window(&handle) {
                eprintln!("{error}");
            }
            let _ = handle.emit("open-search", ());
        });
    }) {
        let _ = app.global_shortcut().unregister_all();
        return Err(error.to_string());
    }
    Ok(())
}
