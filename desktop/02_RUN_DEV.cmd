@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Research Dictionary Desktop - Development

echo ============================================================
echo Research Dictionary Desktop - Development

echo ============================================================

where node >nul 2>&1 || goto :missing_node
where npm >nul 2>&1 || goto :missing_node
where cargo >nul 2>&1 || goto :missing_rust

echo [OK] Node.js
node -v
echo [OK] npm
call npm -v
echo [OK] Cargo
cargo -V
echo.

if not exist node_modules (
  echo [1/2] Installing npm packages...
  call npm install
  if errorlevel 1 goto :failed
) else (
  echo [1/2] npm packages already installed.
)

echo.
echo [2/2] Starting Tauri development app...
call npm run tauri:dev
if errorlevel 1 goto :failed

goto :done

:missing_node
echo.
echo [ERROR] Node.js or npm was not found in PATH.
echo Install Node.js LTS, reopen this folder, and run this file again.
goto :hold

:missing_rust
echo.
echo [ERROR] Rust Cargo was not found in PATH.
echo Install Rust using rustup, reopen this folder, and run this file again.
goto :hold

:failed
echo.
echo [ERROR] The development app stopped with an error.
echo Copy or screenshot the error above and send it to ChatGPT.
goto :hold

:done
echo.
echo Development app exited normally.

:hold
echo.
set /p RD_DUMMY=Press Enter to close this window...
exit /b
