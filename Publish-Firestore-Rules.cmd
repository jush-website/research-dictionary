@echo off
setlocal EnableExtensions
cd /d "%~dp0"
title Research Dictionary - Publish Firestore Rules

where powershell.exe >nul 2>&1
if errorlevel 1 (
  echo [ERROR] powershell.exe was not found.
  echo.
  pause
  exit /b 1
)

powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -NoExit -File "%~dp0Publish-Firestore-Rules.ps1"
exit /b
