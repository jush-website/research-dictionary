#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    path::PathBuf,
    process::Command,
    thread,
    time::Duration,
};

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

fn run_update_helper() -> bool {
    let args: Vec<String> = env::args().collect();
    let Some(index) = args.iter().position(|arg| arg == "--apply-update") else {
        return false;
    };

    let Some(installer_arg) = args.get(index + 1) else {
        return true;
    };
    let Some(app_arg) = args.get(index + 2) else {
        return true;
    };

    let installer = PathBuf::from(installer_arg);
    let app_exe = PathBuf::from(app_arg);

    // Give the original GUI process enough time to fully exit and release its executable.
    thread::sleep(Duration::from_millis(1800));

    #[cfg(target_os = "windows")]
    let status = Command::new(&installer)
        .arg("/S")
        .creation_flags(0x08000000)
        .status();

    #[cfg(not(target_os = "windows"))]
    let status = Command::new(&installer).arg("/S").status();

    if matches!(status, Ok(result) if result.success()) && app_exe.exists() {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new(&app_exe)
                .creation_flags(0x08000000)
                .spawn();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new(&app_exe).spawn();
        }
    }

    let _ = fs::remove_file(&installer);
    true
}

fn main() {
    if run_update_helper() {
        return;
    }

    research_dictionary_desktop_lib::run();
}
