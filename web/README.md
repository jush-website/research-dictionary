# Research Dictionary｜研究辭典 v3

公開研究名詞辭典，使用 Vercel + Firebase Authentication + Cloud Firestore。

## v3 功能

- 公開瀏覽與搜尋
- Google 登入後可新增詞條
- 建立者可修改／刪除自己的詞條
- 管理員可修改／刪除所有詞條
- 一般新增時自動檢查「完全重複」與「疑似相同」詞彙
- 登入使用者都可「批次匯入」（.json 檔或貼上），詞彙歸屬於匯入者；預設私人，`"is_shared": true` 或勾「全部設為共享」才同步公開副本（Desktop 也有「匯入」）
- 批次匯入會分成：可新增、已存在、疑似重複、格式問題
- 疑似重複預設不匯入，需手動勾選「仍要匯入」
- 支援狀態：已確認、待確認、候選概念、一般詞彙

## 批次匯入 JSON 格式

可參考 `sample-import.json`。至少需要：

- `term_en`
- `term_zh`
- `definition`
- `simple_explanation`

其餘欄位：`category`、`example`、`research_note`、`source`、`sourceType`、`sourceDetail`（沒有頁碼請留空）、`status`（verified／pending／candidate）、`is_core`、`is_shared`（預設 false）。

## 更新 Vercel

在專案資料夾執行：

```powershell
vercel --prod
```

## Firestore Rules

請將 `firestore.rules` 的內容貼到 Firebase Console → Firestore Database → Rules → Publish。
管理員 UID 已設定為：`KMKNZedIqZZ4kx4l3dDCSqMxYCZ2`。


## v6 UI
- 新增 Light / Dark 主題切換並記住使用者偏好。
- 新增詞彙卡片、Modal 與主題切換動畫。
- 支援 `prefers-reduced-motion`。
