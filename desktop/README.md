# Research Dictionary Desktop v1.3

Windows 桌面版研究辭典，與既有 Firebase `research_dictionary` 共用資料。

## v1.3 修正

- 修正無框視窗無法拖曳：可直接拖曳上方標題列。
- 修正最小化按鈕：現在會正常最小化到 Windows 工作列。
- 修正關閉按鈕：會隱藏視窗並保留在系統匣，可從系統匣再次叫回。
- 修正「開啟網站」：改由 Tauri / 系統預設瀏覽器開啟研究辭典網站。
- 改善全域快捷鍵註冊狀態：介面會顯示是否註冊成功。
- 新增快捷鍵自訂：右上角齒輪可分別設定「查詢反白文字」與「開啟手動搜尋」。
- 自訂快捷鍵會保存在本機，下次啟動自動沿用。
- 若新快捷鍵無法註冊，會保留原本可用的設定並顯示錯誤提示。

## 預設快捷鍵

- `Ctrl + Shift + D`：查詢目前反白文字。
- `Ctrl + Alt + D`：開啟手動搜尋。

可從右上角齒輪自行修改。

## 開發版啟動

確認電腦已安裝：

- Node.js / npm
- Rust / Cargo
- Visual Studio Build Tools 的「使用 C++ 的桌面開發」
- Microsoft Edge WebView2 Runtime

然後執行：

```bat
02_RUN_DEV.cmd
```

或在 CMD：

```bat
npm install
npm run tauri:dev
```

## 建立 Windows 安裝檔

```bat
03_BUILD_INSTALLER.cmd
```

完成後通常位於：

```text
src-tauri\target\release\bundle\
```

## 使用方式

### 查詢 PDF / 網頁選取文字

1. 在 Edge、Chrome、Adobe Acrobat、Word 等程式反白一個研究詞彙。
2. 按「查詢反白文字」快捷鍵。
3. Research Dictionary 會取得選取文字並搜尋 Firestore。

目前是透過暫時模擬 `Ctrl+C` 取得選取文字，因此圖片型 PDF 或禁止複製的內容可能無法取得。

### 系統匣

按視窗右上角 `×` 只會隱藏視窗，不會退出程式。
要完全退出，請在 Windows 系統匣的 Research Dictionary 圖示選擇「退出」。

## Firebase

桌面版沿用現有 Firebase Web Config 與 `research_dictionary` collection，只進行公開讀取，不包含 Firebase Admin SDK 或 Service Account 私鑰。


## v1.4
- 修正 Tauri tray API：`show_menu_on_left_click(false)`。
- 新增 Light / Dark 模式並記住偏好。
- 新增視窗、詞彙卡片、詳細內容、設定面板與主題切換動畫。
- 支援 `prefers-reduced-motion`。

## Release / 背景執行

正式 Release 已設定為 Windows GUI subsystem，因此 `ResearchDictionary.exe` 本身不需要 CMD 視窗即可執行。程式關閉主視窗時會隱藏到系統匣，而不是終止程序。

GitHub Release 由 repository 根目錄的 `.github/workflows/desktop-release.yml` 建置。
