use std::{thread, time::{Duration, SystemTime, UNIX_EPOCH}};
use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

#[tauri::command]
fn capture_selected_text() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("目前選取文字快速查詢僅支援 Windows。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use enigo::{Direction::{Click, Press, Release}, Enigo, Key, Keyboard, Settings};

        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| format!("無法存取剪貼簿：{e}"))?;
        let previous_text = clipboard.get_text().ok();
        let marker = format!(
            "__RD_CAPTURE_{}__",
            SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_nanos()
        );
        clipboard.set_text(marker.clone())
            .map_err(|e| format!("無法準備剪貼簿：{e}"))?;
        drop(clipboard);

        // 等待全域快捷鍵按鍵完全放開，避免 Ctrl/Shift 殘留影響模擬 Ctrl+C。
        thread::sleep(Duration::from_millis(100));

        let mut enigo = Enigo::new(&Settings::default())
            .map_err(|e| format!("無法建立鍵盤模擬器：{e}"))?;
        enigo.key(Key::Control, Press).map_err(|e| e.to_string())?;
        enigo.key(Key::Unicode('c'), Click).map_err(|e| e.to_string())?;
        enigo.key(Key::Control, Release).map_err(|e| e.to_string())?;

        thread::sleep(Duration::from_millis(200));
        let mut clipboard = arboard::Clipboard::new()
            .map_err(|e| format!("無法讀取剪貼簿：{e}"))?;
        let captured = clipboard.get_text().unwrap_or_default();

        // v1 優先還原文字型剪貼簿。若原本不是文字內容，會清成空字串。
        if let Some(old) = previous_text {
            let _ = clipboard.set_text(old);
        } else {
            let _ = clipboard.set_text(String::new());
        }

        if captured == marker {
            Ok(String::new())
        } else {
            Ok(captured.trim().to_string())
        }
    }
}

#[tauri::command]
fn open_research_website(app: tauri::AppHandle) -> Result<(), String> {
    app.opener()
        .open_url("https://research-dictionary.vercel.app/", None::<&str>)
        .map_err(|e| format!("無法開啟研究辭典網站：{e}"))
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .plugin(tauri_plugin_autostart::init(
            tauri_plugin_autostart::MacosLauncher::LaunchAgent,
            None,
        ))
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![capture_selected_text, open_research_website])
        .setup(|app| {
            let show_item = MenuItem::with_id(app, "show", "開啟研究辭典", true, None::<&str>)?;
            let quit_item = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&show_item, &quit_item])?;

            let mut tray_builder = TrayIconBuilder::with_id("research-dictionary-tray")
                .tooltip("Research Dictionary")
                .menu(&menu)
                .show_menu_on_left_click(false);

            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }

            tray_builder
                .on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                })
                .on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::Click {
                        button: MouseButton::Left,
                        button_state: MouseButtonState::Up,
                        ..
                    } = event
                    {
                        let app = tray.app_handle();
                        if let Some(window) = app.get_webview_window("main") {
                            let _ = window.unminimize();
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                })
                .build(app)?;

            Ok(())
        })
        .on_window_event(|window, event| {
            if window.label() == "main" {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Research Dictionary Desktop");
}
