use std::{
    fs,
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

use serde::Deserialize;
use sha2::{Digest, Sha256};

use tauri::{
    menu::{Menu, MenuItem},
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    Manager, WindowEvent,
};
use tauri_plugin_opener::OpenerExt;

const RELEASE_API: &str =
    "https://api.github.com/repos/jush-website/research-dictionary/releases/latest";
const RELEASE_DOWNLOAD_PREFIX: &str =
    "https://github.com/jush-website/research-dictionary/releases/download/";

#[tauri::command]
fn capture_selected_text() -> Result<String, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("目前選取文字快速查詢僅支援 Windows。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use enigo::{
            Direction::{Click, Press, Release},
            Enigo, Key, Keyboard, Settings,
        };

        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("無法存取剪貼簿：{e}"))?;
        let previous_text = clipboard.get_text().ok();
        let marker = format!(
            "__RD_CAPTURE_{}__",
            SystemTime::now()
                .duration_since(UNIX_EPOCH)
                .unwrap_or_default()
                .as_nanos()
        );
        clipboard
            .set_text(marker.clone())
            .map_err(|e| format!("無法準備剪貼簿：{e}"))?;
        drop(clipboard);

        thread::sleep(Duration::from_millis(100));

        let mut enigo =
            Enigo::new(&Settings::default()).map_err(|e| format!("無法建立鍵盤模擬器：{e}"))?;
        enigo
            .key(Key::Control, Press)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Unicode('c'), Click)
            .map_err(|e| e.to_string())?;
        enigo
            .key(Key::Control, Release)
            .map_err(|e| e.to_string())?;

        thread::sleep(Duration::from_millis(200));
        let mut clipboard =
            arboard::Clipboard::new().map_err(|e| format!("無法讀取剪貼簿：{e}"))?;
        let captured = clipboard.get_text().unwrap_or_default();

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

#[tauri::command]
fn open_desktop_login_url(app: tauri::AppHandle, session_id: String) -> Result<(), String> {
    let valid = (32..=128).contains(&session_id.len())
        && session_id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_');

    if !valid {
        return Err("登入工作階段識別碼格式不正確。".to_string());
    }

    let url = format!(
        "https://research-dictionary.vercel.app/?desktop_login={}",
        session_id
    );

    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|e| format!("無法開啟桌面登入頁面：{e}"))
}

fn parse_version(value: &str) -> [u64; 3] {
    let clean = value
        .trim()
        .trim_start_matches("desktop-v")
        .trim_start_matches('v');
    let mut output = [0_u64; 3];

    for (index, part) in clean.split('.').take(3).enumerate() {
        output[index] = part
            .chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse()
            .unwrap_or(0);
    }

    output
}

fn is_newer_version(latest: &str, current: &str) -> bool {
    parse_version(latest) > parse_version(current)
}

#[derive(Debug, Deserialize)]
struct ReleaseAsset {
    name: String,
    browser_download_url: String,
}

#[derive(Debug, Deserialize)]
struct ReleaseInfo {
    tag_name: String,
    assets: Vec<ReleaseAsset>,
}

fn update_client() -> Result<reqwest::blocking::Client, String> {
    let mut builder = reqwest::blocking::Client::builder()
        .user_agent("ResearchDictionaryDesktop")
        .timeout(Duration::from_secs(45));

    // GitHub-hosted CI runners share public API rate limits. During CI only,
    // GITHUB_TOKEN is supplied so the same release-discovery code can be tested
    // without failing because another runner exhausted the anonymous quota.
    if let Ok(token) = std::env::var("GITHUB_TOKEN") {
        let token = token.trim();
        if !token.is_empty() {
            let mut headers = reqwest::header::HeaderMap::new();
            let value = reqwest::header::HeaderValue::from_str(&format!("Bearer {token}"))
                .map_err(|e| format!("無法建立 GitHub 授權標頭：{e}"))?;
            headers.insert(reqwest::header::AUTHORIZATION, value);
            builder = builder.default_headers(headers);
        }
    }

    builder
        .build()
        .map_err(|e| format!("無法建立更新連線：{e}"))
}


#[tauri::command]
fn check_for_update(current_version: String) -> Result<Option<Vec<String>>, String> {
    let client = update_client()?;

    let release = client
        .get(RELEASE_API)
        .send()
        .map_err(|e| format!("無法連線 GitHub Release：{e}"))?
        .error_for_status()
        .map_err(|e| format!("GitHub Release 回應錯誤：{e}"))?
        .json::<ReleaseInfo>()
        .map_err(|e| format!("無法解析 GitHub Release：{e}"))?;

    let latest = release
        .tag_name
        .trim()
        .trim_start_matches("desktop-v")
        .trim_start_matches('v')
        .to_string();

    if !is_newer_version(&latest, &current_version) {
        return Ok(None);
    }

    let setup = release
        .assets
        .iter()
        .find(|asset| asset.name.to_ascii_lowercase().ends_with("_x64-setup.exe"))
        .ok_or_else(|| "找不到 Windows x64 NSIS 安裝檔。".to_string())?;

    if !setup
        .browser_download_url
        .starts_with(RELEASE_DOWNLOAD_PREFIX)
    {
        return Err("更新下載網址不是允許的 GitHub Release 網址。".to_string());
    }

    let checksum_asset = release
        .assets
        .iter()
        .find(|asset| asset.name == "SHA256SUMS.txt")
        .ok_or_else(|| "找不到 SHA256SUMS.txt。".to_string())?;

    let checksum_text = client
        .get(&checksum_asset.browser_download_url)
        .send()
        .map_err(|e| format!("無法下載 SHA-256 校驗碼：{e}"))?
        .error_for_status()
        .map_err(|e| format!("SHA-256 校驗碼下載失敗：{e}"))?
        .text()
        .map_err(|e| format!("無法讀取 SHA-256 校驗碼：{e}"))?;

    let digest = checksum_text
        .lines()
        .find_map(|line| {
            let line = line.trim();
            let mut parts = line.split_whitespace();
            let hash = parts.next()?;
            let name = parts.collect::<Vec<_>>().join(" ");
            if name == setup.name {
                Some(hash.to_ascii_lowercase())
            } else {
                None
            }
        })
        .ok_or_else(|| format!("SHA256SUMS.txt 找不到 {} 的校驗碼。", setup.name))?;

    if digest.len() != 64 || !digest.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("SHA-256 校驗碼格式不正確。".to_string());
    }

    Ok(Some(vec![
        latest,
        setup.browser_download_url.clone(),
        digest,
    ]))
}

#[tauri::command]
fn install_update(
    app: tauri::AppHandle,
    download_url: String,
    digest: String,
) -> Result<(), String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = (app, download_url, digest);
        return Err("自動更新目前僅支援 Windows。".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;

        const CREATE_NO_WINDOW: u32 = 0x08000000;

        if !download_url.starts_with(RELEASE_DOWNLOAD_PREFIX)
            || !download_url.to_ascii_lowercase().ends_with(".exe")
        {
            return Err("更新下載網址不合法。".to_string());
        }

        let expected = digest.trim().to_ascii_lowercase();
        if expected.len() != 64 || !expected.chars().all(|c| c.is_ascii_hexdigit()) {
            return Err("更新檔 SHA-256 格式不正確。".to_string());
        }

        // Download and verify entirely inside Rust. No PowerShell or script host is used.
        let client = update_client()?;
        let response = client
            .get(&download_url)
            .send()
            .map_err(|e| format!("無法下載更新檔：{e}"))?
            .error_for_status()
            .map_err(|e| format!("更新檔下載失敗：{e}"))?;

        let bytes = response
            .bytes()
            .map_err(|e| format!("無法讀取更新檔：{e}"))?;

        let actual = format!("{:x}", Sha256::digest(&bytes));
        if actual != expected {
            return Err(format!(
                "更新檔 SHA-256 驗證失敗。預期 {expected}，實際 {actual}"
            ));
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let temp_dir = std::env::temp_dir().join(format!("ResearchDictionaryUpdate-{stamp}"));
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("無法建立更新暫存資料夾：{e}"))?;

        let installer = temp_dir.join("ResearchDictionary-Setup.exe");
        let helper = temp_dir.join("ResearchDictionaryUpdater.exe");

        fs::write(&installer, &bytes)
            .map_err(|e| format!("無法寫入更新檔：{e}"))?;

        let current_exe = std::env::current_exe()
            .map_err(|e| format!("無法取得目前程式路徑：{e}"))?;

        fs::copy(&current_exe, &helper)
            .map_err(|e| format!("無法建立原生更新助手：{e}"))?;

        // The helper is a copy of this signed/built GUI executable in TEMP.
        // It waits for the original process to exit, runs the NSIS installer
        // directly, and then relaunches the installed app. No shell is involved.
        Command::new(&helper)
            .creation_flags(CREATE_NO_WINDOW)
            .arg("--apply-update")
            .arg(&installer)
            .arg(&current_exe)
            .spawn()
            .map_err(|e| format!("無法啟動原生更新助手：{e}"))?;

        app.exit(0);
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn version_comparison_works() {
        assert!(is_newer_version("0.5.4", "0.5.1"));
        assert!(!is_newer_version("0.5.1", "0.5.1"));
        assert!(!is_newer_version("0.5.0", "0.5.1"));
    }

    #[test]
    fn live_github_release_and_checksum_are_parseable() {
        let result = check_for_update("0.0.0".to_string())
            .expect("GitHub release discovery should succeed")
            .expect("A published release should be newer than 0.0.0");

        assert_eq!(result.len(), 3);
        assert!(!result[0].is_empty());
        assert!(result[1].starts_with(RELEASE_DOWNLOAD_PREFIX));
        assert_eq!(result[2].len(), 64);
        assert!(result[2].chars().all(|c| c.is_ascii_hexdigit()));
    }
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
        .invoke_handler(tauri::generate_handler![
            capture_selected_text,
            open_research_website,
            open_desktop_login_url,
            check_for_update,
            install_update
        ])
        .setup(|app| {
            let show_item =
                MenuItem::with_id(app, "show", "開啟研究辭典", true, None::<&str>)?;
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
