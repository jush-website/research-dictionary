@echo off
setlocal EnableExtensions EnableDelayedExpansion
chcp 65001 >nul 2>&1

title Research Dictionary - One Click Installer
set "REPO=jush-website/research-dictionary"
set "TMPDIR=%TEMP%\ResearchDictionaryInstaller"
set "SETUP=%TMPDIR%\ResearchDictionary-Setup.exe"

if not exist "%TMPDIR%" mkdir "%TMPDIR%" >nul 2>&1

echo ============================================================
echo   Research Dictionary - One Click Installer
echo ============================================================
echo.
echo [1/3] 正在取得最新版安裝檔...

powershell.exe -NoProfile -ExecutionPolicy Bypass -Command ^
  "$ErrorActionPreference='Stop';" ^
  "$headers=@{'User-Agent'='ResearchDictionaryInstaller'};" ^
  "$r=Invoke-RestMethod -Uri 'https://api.github.com/repos/%REPO%/releases/latest' -Headers $headers;" ^
  "$a=$r.assets ^| Where-Object { $_.name -match '(?i)(setup|installer).*\.exe$' } ^| Select-Object -First 1;" ^
  "if(-not $a){ throw '找不到 Windows NSIS 安裝檔。' };" ^
  "Invoke-WebRequest -Uri $a.browser_download_url -OutFile '%SETUP%' -Headers $headers"
if errorlevel 1 goto :download_failed

if not exist "%SETUP%" goto :download_failed

echo [2/3] 正在安裝...
start /wait "" "%SETUP%" /S
if errorlevel 1 goto :install_failed

echo [3/3] 正在啟動 Research Dictionary...
set "APP_EXE=%LOCALAPPDATA%\Research Dictionary\ResearchDictionary.exe"
if not exist "%APP_EXE%" set "APP_EXE=%LOCALAPPDATA%\Programs\Research Dictionary\ResearchDictionary.exe"

if not exist "%APP_EXE%" (
  for /f "delims=" %%F in ('where /r "%LOCALAPPDATA%" ResearchDictionary.exe 2^>nul') do if not defined FOUND_EXE set "FOUND_EXE=%%F"
  if defined FOUND_EXE set "APP_EXE=!FOUND_EXE!"
)

if exist "%APP_EXE%" (
  start "" /b "%APP_EXE%" >nul 2>&1
  timeout /t 1 /nobreak >nul
  echo.
  echo [OK] 安裝完成，Research Dictionary 已在背景執行。
  echo      關閉此視窗不會關閉 Research Dictionary。
) else (
  echo.
  echo [OK] 安裝完成。
  echo [INFO] 沒有自動找到執行檔，請從開始功能表啟動 Research Dictionary。
)

del /q "%SETUP%" >nul 2>&1
rmdir "%TMPDIR%" >nul 2>&1
exit /b 0

:download_failed
echo.
echo [ERROR] 無法下載最新版安裝檔。
echo 請確認網路連線以及 GitHub Releases 已有桌面版發佈。
pause
exit /b 1

:install_failed
echo.
echo [ERROR] 安裝失敗。
pause
exit /b 1
