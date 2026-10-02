@echo off
setlocal EnableExtensions
chcp 65001 >nul 2>&1
cd /d "%~dp0"

title Research Dictionary - Publish Firestore Rules
echo ============================================================
echo   Research Dictionary - Publish Firestore Security Rules
echo ============================================================
echo.
echo [1/3] 檢查 Firebase CLI 登入狀態...

npx --yes firebase-tools@latest projects:list >nul 2>&1
if errorlevel 1 (
  echo 尚未登入 Firebase，現在開啟登入流程...
  npx --yes firebase-tools@latest login
  if errorlevel 1 goto :failed
)

echo [2/3] 使用 Firebase 專案 deer-7327a...
npx --yes firebase-tools@latest use deer-7327a
if errorlevel 1 goto :failed

echo [3/3] 發布 Firestore Security Rules...
npx --yes firebase-tools@latest deploy --only firestore:rules
if errorlevel 1 goto :failed

echo.
echo [OK] Firestore Security Rules 已發布。
echo      桌面登入、私人詞彙與共享功能現在可以使用。
pause
exit /b 0

:failed
echo.
echo [ERROR] Firestore Rules 發布失敗。
echo 請將此畫面截圖貼回 ChatGPT。
pause
exit /b 1
