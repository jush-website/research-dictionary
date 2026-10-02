# Research Dictionary

研究專有名詞辭典，包含公開網站與 Windows 快速查詢工具，共用 Firebase Cloud Firestore `research_dictionary`。

## 專案結構

- `web/`：Vercel 公開研究辭典網站
- `desktop/`：Tauri 2 Windows 桌面工具
- `install/`：Windows 一鍵安裝與 Portable 啟動腳本
- `.github/workflows/desktop-release.yml`：GitHub Actions 自動建置 Windows 安裝檔與 Release

## 網站部署

Vercel Project：`research-dictionary`

GitHub Repository 連接完成後，在 Vercel Project Settings 將 Root Directory 設為：

`web`

之後 `main` branch 的網站變更可由 Vercel Git Integration 自動部署。

## Windows 桌面版

桌面工具使用 Tauri 2，會直接讀取既有 Firestore 詞彙。

主要功能：

- 全域快捷鍵查詢反白文字
- 手動搜尋
- Light / Dark 模式
- 可自訂快捷鍵
- 系統匣背景執行
- 關閉主視窗後仍可由快捷鍵喚醒
- Windows 開機啟動選項

Release 版在 `main.rs` 使用 Windows GUI subsystem，因此啟動正式 EXE 時不會額外出現 CMD 視窗。

## 自動建立 Windows Release

建立或推送 `desktop-v*` Tag 後，GitHub Actions 會在 `windows-latest` 編譯並上傳：

- NSIS `.exe` 安裝檔
- `.msi` 安裝檔
- `ResearchDictionary.exe` Portable 版
- `Install-Research-Dictionary.cmd` 一鍵安裝腳本
- `Run-Portable.cmd` 背景啟動腳本

目前桌面版版本：`0.4.0`
