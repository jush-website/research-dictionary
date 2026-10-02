@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Research Dictionary Desktop - Build Installer

echo ============================================================
echo Research Dictionary Desktop - Build Installer

echo ============================================================

where node >nul 2>&1 || goto :missing_node
where npm >nul 2>&1 || goto :missing_node
where cargo >nul 2>&1 || goto :missing_rust

if not exist node_modules (
  echo [1/2] Installing npm packages...
  call npm install
  if errorlevel 1 goto :failed
) else (
  echo [1/2] npm packages already installed.
)

echo.
echo [2/2] Building Windows installer...
call npm run tauri:build
if errorlevel 1 goto :failed

echo.
echo [OK] Build finished.
echo Installer output is normally under:
echo src-tauri\target\release\bundle\
goto :hold

:missing_node
echo [ERROR] Node.js or npm was not found in PATH.
goto :hold

:missing_rust
echo [ERROR] Rust Cargo was not found in PATH.
goto :hold

:failed
echo.
echo [ERROR] Build failed.
echo Copy or screenshot the error above and send it to ChatGPT.

:hold
echo.
set /p RD_DUMMY=Press Enter to close this window...
exit /b
