#[cfg(target_os = "windows")]
pub fn capture_selected_text() -> Result<String, String> {
    use enigo::{
        Direction::{Click, Press, Release},
        Enigo, Key, Keyboard, Settings,
    };
    use std::{
        thread,
        time::{Duration, Instant},
    };
    use windows_sys::Win32::{
        System::DataExchange::GetClipboardSequenceNumber,
        UI::Input::KeyboardAndMouse::GetAsyncKeyState,
    };

    // Releasing D does not mean Ctrl/Shift/Alt have been released. Ctrl+Shift+C
    // invokes a different command in many PDF viewers and browsers.
    let started = Instant::now();
    while [0x10, 0x11, 0x12, 0x5B, 0x5C]
        .iter()
        .any(|key| unsafe { GetAsyncKeyState(*key) < 0 })
    {
        if started.elapsed() > Duration::from_secs(2) {
            return Err("請放開快捷鍵後再試一次。".into());
        }
        thread::sleep(Duration::from_millis(15));
    }

    let mut clipboard = arboard::Clipboard::new().map_err(|e| format!("無法存取剪貼簿：{e}"))?;
    let previous_text = clipboard.get_text().ok();
    let sequence = unsafe { GetClipboardSequenceNumber() };
    let mut enigo =
        Enigo::new(&Settings::default()).map_err(|e| format!("無法建立鍵盤模擬器：{e}"))?;
    enigo.key(Key::Control, Press).map_err(|e| e.to_string())?;
    // Use the physical C key independent of the current input language.
    let copy = enigo.key(Key::Other(0x43), Click);
    let release = enigo.key(Key::Control, Release);
    copy.map_err(|e| e.to_string())?;
    release.map_err(|e| e.to_string())?;

    let started = Instant::now();
    while started.elapsed() < Duration::from_millis(1200) {
        if unsafe { GetClipboardSequenceNumber() } != sequence {
            if let Ok(text) = clipboard.get_text() {
                if let Some(previous) = previous_text {
                    let _ = clipboard.set_text(previous);
                }
                return Ok(text.trim().to_string());
            }
        }
        thread::sleep(Duration::from_millis(25));
    }
    // No selection: leave the existing clipboard untouched.
    Ok(String::new())
}

#[cfg(not(target_os = "windows"))]
pub fn capture_selected_text() -> Result<String, String> {
    Err("目前選取文字快速查詢僅支援 Windows。".into())
}
