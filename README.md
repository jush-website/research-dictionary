# Research Dictionary

研究辭典系統，包含 Web 版與 Windows Desktop 版，兩者共用 Firebase Authentication 與 Cloud Firestore。

## 目前架構

- `web/`：Vercel 正式網站，Root Directory 為 `web`
- `desktop/`：Tauri 2 Windows 桌面程式
- `install/`：Windows 一鍵安裝與 Portable 啟動腳本
- `.github/workflows/desktop-release.yml`：Windows 自動建置與 GitHub Release
- `web/firestore.rules`：Firestore Security Rules
- `Publish-Firestore-Rules.cmd`：管理者一鍵發布 Firestore Rules

正式網站：
https://research-dictionary.vercel.app/

## Desktop v0.5.1

桌面版提供：

- 全域快捷鍵查詢反白文字
- 手動全文搜尋
- 完整正式定義、白話解釋、例子、研究關係、來源類型與來源位置
- 分類由 Firestore 動態產生，不限制 RAG / CoT / LLM
- Google 登入
- 登入後新增、修改、刪除自己的詞彙
- 每筆詞彙可選「私人」或「共享」
- Light / Dark
- 90%～150% 字體大小調整
- 可自訂全域快捷鍵
- 系統匣背景執行
- Windows 開機啟動
- GitHub Release 自動偵測更新
- 更新下載後驗證 SHA-256，再以背景模式安裝

### 資料可見性

`research_dictionary`
：共享詞彙。未登入使用者也可以讀取。

`user_research_dictionary/{uid}/terms/{termId}`
：每位使用者的私人詞彙。只有該 Firebase Authentication UID 可以讀寫。

使用者勾選「共享給其他使用者」時，系統會同步一份至 `research_dictionary`；取消共享時會移除公開副本，但保留私人副本。

## 第一次啟用私人 / 共享與 Desktop 登入

管理者只需要做一次。

在 Repository 根目錄執行：

```bat
Publish-Firestore-Rules.cmd
```

腳本會使用 Firebase CLI，必要時先要求登入，然後發布：

```text
web/firestore.rules
```

到 Firebase 專案：

```text
deer-7327a
```

## Windows 安裝

一般使用者建議從 GitHub Releases 下載：

```text
Research.Dictionary_<version>_x64-setup.exe
```

或執行：

```text
Install-Research-Dictionary.cmd
```

一鍵腳本會：

1. 查詢 GitHub 最新 Release
2. 下載 NSIS 安裝檔
3. 下載 `SHA256SUMS.txt`
4. 驗證 SHA-256
5. 靜默安裝
6. 啟動 Research Dictionary
7. CMD 結束後程式仍在系統匣背景執行

## 自動更新

v0.5.0 之後的 Desktop 版本內建更新偵測。

程式啟動後會自動檢查，之後約每 4 小時再檢查一次；也可以從程式內手動按「檢查更新」。

發現新版後可直接更新，不需要自行重新下載安裝檔。

> v0.4.x 舊版沒有內建更新器，因此第一次升到 v0.5.1 仍需手動安裝一次。之後即可由程式自動更新。

## 發佈流程

網站：

```text
GitHub main
  → web/
  → Vercel
  → research-dictionary.vercel.app
```

桌面版：

```text
更新 desktop/package.json version
  → GitHub Actions Windows Runner
  → Tauri build
  → NSIS / MSI / Portable EXE
  → SHA256SUMS.txt
  → GitHub Release
```

Firebase Web Config 可以存在前端；請勿把 Firebase Admin SDK Service Account 私鑰放入 Web 或 Desktop 原始碼。
