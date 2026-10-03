#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::{
    env,
    fs,
    path::{Path, PathBuf},
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

    wait_until_released(&app_exe);

    #[cfg(target_os = "windows")]
    let status = Command::new(&installer)
        .arg("/S")
        .creation_flags(0x08000000)
        .status();

    #[cfg(not(target_os = "windows"))]
    let status = Command::new(&installer).arg("/S").status();

    let relaunch = relaunch_target(&app_exe);
    if matches!(status, Ok(result) if result.success()) && relaunch.exists() {
        #[cfg(target_os = "windows")]
        {
            let _ = Command::new(&relaunch)
                .creation_flags(0x08000000)
                .spawn();
        }

        #[cfg(not(target_os = "windows"))]
        {
            let _ = Command::new(&relaunch).spawn();
        }
    }

    let _ = fs::remove_file(&installer);
    true
}

// Windows refuses write access to a running EXE, so this returns once the
// original app has exited. ponytail: 60 s cap, then install anyway.
fn wait_until_released(app_exe: &Path) {
    thread::sleep(Duration::from_millis(300));
    if !app_exe.exists() {
        return;
    }
    for _ in 0..120 {
        if fs::OpenOptions::new().write(true).open(app_exe).is_ok() {
            return;
        }
        thread::sleep(Duration::from_millis(500));
    }
}

// An installed copy sits next to the NSIS uninstaller and is updated in place.
// A portable copy is not, so relaunch the freshly installed app instead.
fn relaunch_target(app_exe: &Path) -> PathBuf {
    let installed_in_place = app_exe
        .parent()
        .map(|dir| dir.join("uninstall.exe").exists())
        .unwrap_or(false);
    if !installed_in_place {
        if let Some(local) = env::var_os("LOCALAPPDATA") {
            let installed = PathBuf::from(local)
                .join("Research Dictionary")
                .join("ResearchDictionary.exe");
            if installed.exists() {
                return installed;
            }
        }
    }
    app_exe.to_path_buf()
}

fn main() {
    if run_update_helper() {
        return;
    }

    research_dictionary_desktop_lib::run();
}
