@echo off
setlocal EnableExtensions
cd /d "%~dp0"
if not exist "ResearchDictionary.exe" (
  echo [ERROR] 找不到 ResearchDictionary.exe
  pause
  exit /b 1
)
start "" /b "%~dp0ResearchDictionary.exe" >nul 2>&1
exit /b 0
