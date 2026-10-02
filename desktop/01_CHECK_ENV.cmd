@echo off
setlocal EnableExtensions EnableDelayedExpansion
cd /d "%~dp0"
title Research Dictionary Desktop - Environment Check

echo ============================================================
echo Research Dictionary Desktop - Environment Check
echo ============================================================
echo Project folder: %CD%
echo.

call :check node "node -v" "Node.js"
call :check npm "npm -v" "npm"
call :check cargo "cargo -V" "Rust Cargo"
call :check rustc "rustc -V" "Rust compiler"
call :check rustup "rustup -V" "Rustup"

echo ============================================================
echo Visual Studio C++ Build Tools
echo ============================================================
set "VSWHERE=%ProgramFiles(x86)%\Microsoft Visual Studio\Installer\vswhere.exe"
if exist "%VSWHERE%" (
  "%VSWHERE%" -latest -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath > "%TEMP%\rd_vs.txt" 2>nul
  set /p VSPATH=<"%TEMP%\rd_vs.txt"
  del "%TEMP%\rd_vs.txt" >nul 2>&1
  if defined VSPATH (
    echo [OK] C++ Build Tools found
    echo      !VSPATH!
  ) else (
    echo [MISSING] Visual Studio C++ Build Tools were not detected.
  )
) else (
  echo [UNKNOWN] Visual Studio Installer / vswhere was not found.
)
echo.

echo ============================================================
echo Check finished.
echo ============================================================
echo If you see MISSING or NOT FOUND, take a screenshot and send it to ChatGPT.
echo.
set /p RD_DUMMY=Press Enter to close this window...
exit /b

:check
where %~1 >nul 2>&1
if errorlevel 1 (
  echo [MISSING] %~3
) else (
  echo [OK] %~3
  call %~2
)
echo.
exit /b
