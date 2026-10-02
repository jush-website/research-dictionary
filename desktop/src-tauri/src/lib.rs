use std::{
    fs,
    process::Command,
    thread,
    time::{Duration, SystemTime, UNIX_EPOCH},
};

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

fn ps_quote(value: &str) -> String {
    value.replace('\'', "''")
}

#[tauri::command]
fn check_for_update(current_version: String) -> Result<Option<Vec<String>>, String> {
    #[cfg(not(target_os = "windows"))]
    {
        let _ = current_version;
        return Ok(None);
    }

    #[cfg(target_os = "windows")]
    {
        let script = format!(
            r#"$ErrorActionPreference='Stop';
$headers=@{{'User-Agent'='ResearchDictionaryDesktop'}};
$r=Invoke-RestMethod -Uri '{api}' -Headers $headers;
$version=($r.tag_name -replace '^desktop-v','');
$asset=$r.assets | Where-Object {{ $_.name -match '(?i)_x64-setup\.exe$' }} | Select-Object -First 1;
if(-not $asset) {{ throw '找不到 Windows x64 NSIS 安裝檔。' }}
$digest='';
$checksum=$r.assets | Where-Object {{ $_.name -eq 'SHA256SUMS.txt' }} | Select-Object -First 1;
if($checksum) {{
  $text=(Invoke-WebRequest -Uri $checksum.browser_download_url -Headers $headers).Content;
  $line=$text -split '\r?\n' | Where-Object {{ $_ -match [regex]::Escape($asset.name) }} | Select-Object -First 1;
  if($line) {{ $digest=($line.Trim() -split '\s+')[0].ToLowerInvariant(); }}
}}
Write-Output $version;
Write-Output $asset.browser_download_url;
Write-Output $digest;"#,
            api = RELEASE_API
        );

        let output = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &script,
            ])
            .output()
            .map_err(|e| format!("無法啟動更新檢查：{e}"))?;

        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr);
            return Err(format!("GitHub Release 檢查失敗：{}", stderr.trim()));
        }

        let stdout = String::from_utf8_lossy(&output.stdout);
        let mut lines = stdout.lines().map(str::trim);
        let latest = lines.next().unwrap_or("").to_string();
        let download_url = lines.next().unwrap_or("").to_string();
        let digest = lines.next().unwrap_or("").to_string();

        if latest.is_empty() || download_url.is_empty() {
            return Err("GitHub Release 回傳內容不完整。".to_string());
        }

        if !download_url.starts_with(RELEASE_DOWNLOAD_PREFIX) {
            return Err("更新下載網址不是允許的 GitHub Release 網址。".to_string());
        }

        if !is_newer_version(&latest, &current_version) {
            return Ok(None);
        }

        Ok(Some(vec![latest, download_url, digest]))
    }
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
        if !download_url.starts_with(RELEASE_DOWNLOAD_PREFIX)
            || !download_url.to_ascii_lowercase().ends_with(".exe")
        {
            return Err("更新下載網址不合法。".to_string());
        }

        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let temp_dir = std::env::temp_dir().join(format!("ResearchDictionaryUpdate-{stamp}"));
        fs::create_dir_all(&temp_dir)
            .map_err(|e| format!("無法建立更新暫存資料夾：{e}"))?;

        let installer = temp_dir.join("ResearchDictionary-Setup.exe");
        let updater_script = temp_dir.join("install-update.ps1");

        let download_script = format!(
            "$ErrorActionPreference='Stop';$headers=@{{'User-Agent'='ResearchDictionaryDesktop'}};Invoke-WebRequest -Uri '{}' -Headers $headers -OutFile '{}';",
            ps_quote(&download_url),
            ps_quote(&installer.to_string_lossy())
        );

        let download = Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-NonInteractive",
                "-ExecutionPolicy",
                "Bypass",
                "-Command",
                &download_script,
            ])
            .output()
            .map_err(|e| format!("無法下載更新：{e}"))?;

        if !download.status.success() || !installer.exists() {
            let stderr = String::from_utf8_lossy(&download.stderr);
            return Err(format!("更新檔下載失敗：{}", stderr.trim()));
        }

        let expected = digest.trim().to_ascii_lowercase();
        if !expected.is_empty() {
            let hash_script = format!(
                "(Get-FileHash -Algorithm SHA256 -LiteralPath '{}').Hash.ToLowerInvariant()",
                ps_quote(&installer.to_string_lossy())
            );
            let hash_output = Command::new("powershell.exe")
                .args([
                    "-NoProfile",
                    "-NonInteractive",
                    "-ExecutionPolicy",
                    "Bypass",
                    "-Command",
                    &hash_script,
                ])
                .output()
                .map_err(|e| format!("無法驗證更新檔：{e}"))?;

            if !hash_output.status.success() {
                return Err("無法計算更新檔 SHA-256。".to_string());
            }

            let actual = String::from_utf8_lossy(&hash_output.stdout)
                .trim()
                .to_ascii_lowercase();

            if actual != expected {
                let _ = fs::remove_file(&installer);
                return Err("更新檔 SHA-256 驗證失敗，已取消安裝。".to_string());
            }
        }

        let script = format!(
            r#"$ErrorActionPreference='Stop'
Start-Sleep -Seconds 2
$installer='{installer}'
$p=Start-Process -FilePath $installer -ArgumentList '/S' -Wait -PassThru
if($p.ExitCode -ne 0) {{ exit $p.ExitCode }}

$candidates=@(
  "$env:LOCALAPPDATA\Research Dictionary\ResearchDictionary.exe",
  "$env:LOCALAPPDATA\Programs\Research Dictionary\ResearchDictionary.exe"
)
$app=$candidates | Where-Object {{ Test-Path $_ }} | Select-Object -First 1
if(-not $app) {{
  $found=Get-ChildItem -Path $env:LOCALAPPDATA -Filter 'ResearchDictionary.exe' -File -Recurse -ErrorAction SilentlyContinue | Select-Object -First 1
  if($found) {{ $app=$found.FullName }}
}}
if($app) {{ Start-Process -FilePath $app }}
Remove-Item -LiteralPath $installer -Force -ErrorAction SilentlyContinue
$folder=Split-Path -Parent $MyInvocation.MyCommand.Path
$me=$MyInvocation.MyCommand.Path
Start-Sleep -Milliseconds 500
Remove-Item -LiteralPath $me -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $folder -Force -Recurse -ErrorAction SilentlyContinue
"#,
            installer = ps_quote(&installer.to_string_lossy())
        );

        fs::write(&updater_script, script)
            .map_err(|e| format!("無法建立更新安裝腳本：{e}"))?;

        Command::new("powershell.exe")
            .args([
                "-NoProfile",
                "-ExecutionPolicy",
                "Bypass",
                "-WindowStyle",
                "Hidden",
                "-File",
                &updater_script.to_string_lossy(),
            ])
            .spawn()
            .map_err(|e| format!("無法啟動背景更新安裝：{e}"))?;

        app.exit(0);
        Ok(())
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
