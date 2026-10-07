# Poe Market Zh 隱私權政策 / Privacy Policy

最後更新:2026-10-08

## 中文

**Poe Market Zh**(以下稱「本擴充」)是 Path of Exile 官方交易站的輔助瀏覽器擴充,支援國際服(pathofexile.com)與台服(pathofexile.tw)的 PoE1(/trade)與 PoE2(/trade2):提供搜尋書籤側邊欄、詞綴篩選按鈕與 Path of Building 匯入,並可選擇把國際服交易站介面在地化為繁體中文;另可選擇把 poe.ninja 與 pobb.in 的頁面文字顯示為繁體中文。擴充介面可選中文或 English。

### 資料收集
本擴充**不會將任何使用者資料傳送給開發者或第三方**,包括但不限於:瀏覽紀錄、搜尋內容、帳號資訊、遊戲資料、裝置識別碼。本擴充不含任何分析、追蹤或廣告元件。

### 本機儲存
以下資料只存在使用者瀏覽器的本機儲存空間(瀏覽器提供給擴充的 storage 區域),不會離開使用者的裝置:

- 介面語言與交易站翻譯的偏好設定
- 翻譯資料(詞綴/物品名對照表,只在介面選中文時下載;切到 English 時會清除)
- poe.ninja / pobb.in 中文化用的名稱資料(只在開啟該功能且打開該網站時下載;切到 English 時會清除)
- Path of Building 匯入用的官方英文詞綴清單
- 篩選列詞綴階級選單用的詞綴階級表(只有官方詞綴代碼與數值;只在開著這個功能且打開交易站時下載)
- 使用者自行建立或匯入的搜尋書籤與資料夾
- 最近開啟過的搜尋紀錄(最多 20 筆)
- 側邊欄的顯示設定(位置、各站各款的聯盟、各項開關)

書籤與搜尋紀錄可以隨時在側邊欄自行清除,也可以匯出成檔案自行保管。

### 對外連線
本擴充僅為**取得公開資料**發出網路請求,對象限於:

- `pathofexile.com` / `pathofexile.tw`:Grinding Gear Games 官方公開 trade data API(取得英文與繁體中文的介面資料、Path of Building 匯入用的詞綴代碼)。介面選 English 時不連線台服 API。
- `raw.githubusercontent.com`:本擴充線上更新的翻譯資料與官方資料的公開快照(本專案自己的 dict 分支)
- `poe.ninja`:**選用功能**。僅在使用者明確授權並開啟側邊欄的「物價查詢」後,讀取其公開的通貨價格資料;未授權時完全不會對其發出任何請求。價格資料來源於畫面上另有標示。

上述請求不附帶任何使用者識別資訊,亦不使用 Cookie。

### 大量賣家自動載入(選用功能)
側邊欄「大量賣家」分頁預設關閉。使用者開啟並停在這個分頁時,本擴充會替使用者觸發交易站頁面原本的「載入下一批結果」,效果等同使用者自己往下捲動,預設最多載入到前 50 筆,使用者可改成前 100 筆或關閉。這些請求**由交易站頁面自己發出**,帶著使用者在 `pathofexile.com` / `pathofexile.tw` 的登入狀態,會用到使用者在官網的請求額度;本擴充只讀取官網回應中的請求額度資訊,用來在額度快用完時暫停。本擴充不另外發出任何請求,也不保存或傳送這些結果。

### poe.ninja / pobb.in 中文化(選用功能)
使用者在彈出視窗開啟並於授權對話框同意後,本擴充才會在 `poe.ninja` 與 `pobb.in` 的頁面上執行,**只在使用者的瀏覽器內**把頁面上的英文字替換成中文顯示。頁面文字只在本機用來比對譯名,**不會傳送到任何地方**,也不保存角色名稱與帳號名稱;唯一會記在本機的是頁面聯盟選單裡的聯盟名稱(用來讓聯盟名維持英文、不被翻譯)。關閉開關後頁面即時還原為英文。此功能所需的名稱資料來自上述 `raw.githubusercontent.com`。

### 政策變更
如本政策有變更,將於本頁面更新並調整「最後更新」日期。

### 聯絡方式
如有疑問,請透過本擴充的發布頁面或程式碼存放庫提出。

---

## English

**Poe Market Zh** ("the Extension") is a browser extension for the official Path of Exile trade site. It works on the international (pathofexile.com) and Taiwan (pathofexile.tw) trade sites for PoE1 (/trade) and PoE2 (/trade2), adding a search bookmarks sidebar, mod filter buttons and Path of Building import, and can optionally localize the international trade site into Traditional Chinese. It can also optionally show the text of poe.ninja and pobb.in pages in Traditional Chinese. The Extension's own interface is available in English or Chinese.

### Data Collection
The Extension does **not send any user data to the developer or to third parties**, including but not limited to browsing history, search queries, account information, game data, or device identifiers. It contains no analytics, tracking, or advertising components.

### Local Storage
The following data is kept only in the browser's local storage (the browser's extension storage area) and never leaves the user's device:

- Interface language and trade-site translation preferences
- Translation data (stat/item mapping tables; downloaded only when the interface is set to Chinese and removed when switching to English)
- Name data for the poe.ninja / pobb.in localization (downloaded only when that feature is on and the site is opened; removed when switching to English)
- The official English stat list used by Path of Building import
- Mod tier tables for the stat-filter tier picker (official stat IDs and numbers only; downloaded only when that feature is on and the trade site is opened)
- Search bookmarks and folders the user creates or imports
- Recently opened searches (up to 20 entries)
- Sidebar display settings (side, per-site and per-game league, toggles)

Bookmarks and search history can be cleared from the sidebar at any time, or exported to a file the user keeps.

### Network Requests
The Extension makes network requests solely to **fetch publicly available data** from:

- `pathofexile.com` / `pathofexile.tw` — official public trade data APIs by Grinding Gear Games (interface data in English and Traditional Chinese, and stat IDs for Path of Building import). The Taiwan API is not contacted when the interface is set to English.
- `raw.githubusercontent.com` — the Extension's own online translation updates and public snapshots of the official data (this project's dict branch)
- `poe.ninja` — **optional**. Requested only after the user explicitly grants permission and enables the sidebar's price lookup; with no permission granted, no request is ever made to it. The price data source is also credited in the UI.

These requests carry no user-identifying information and use no cookies.

### Bulk sellers auto-load (optional)
The sidebar's "Bulk sellers" tab is off by default. When the user turns it on and has that tab open, the Extension triggers the trade page's own "load the next batch of results", the same as the user scrolling down, up to the first 50 results by default (the user can change this to 100 or turn it off). These requests are **made by the trade page itself** with the user's signed-in session on `pathofexile.com` / `pathofexile.tw` and count toward the user's request allowance on the site; the Extension only reads the allowance information in the site's responses so it can pause before running out. The Extension makes no additional requests and does not store or send these results anywhere.

### poe.ninja / pobb.in localization (optional)
Only after the user turns it on in the popup and approves the permission prompt does the Extension run on `poe.ninja` and `pobb.in` pages, replacing English text with Chinese **inside the user's browser only**. Page text is only matched locally against the name data and is **never transmitted anywhere**; character and account names are not stored. The only thing kept locally is the list of league names from the page's league selector (so league names stay in English); turning the switch off restores the English text immediately. The name data for this feature comes from `raw.githubusercontent.com` listed above.

### Changes
Any changes to this policy will be posted on this page with an updated date.

### Contact
For questions, please reach out via the Extension's store listing or its code repository.
