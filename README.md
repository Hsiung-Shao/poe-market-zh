# Poe Market Zh

Path of Exile 國際服交易站中文化擴充,**PoE1(`pathofexile.com/trade`)與 PoE2(`pathofexile.com/trade2`)都支援**,依網址自動判斷;另附書籤、歷史與物價。與 poe-trade-mate(內部完整版)擴充 id 不同,可同時載入 Chrome(建議只啟用其中一個,避免互搶官網 lscache 快取;兩者的 CSS class 與設定鍵已分別使用 `pmz-` / `ptm-` 前綴,不會互相覆寫)。

- **PoE1 / PoE2 雙站**:同一支擴充依網址判斷(`/trade2/…` 或 `/trade/<聯盟>/poe2/…` 就是 PoE2),
  兩款的翻譯資料、官網 lscache 鍵與聯盟設定**各自獨立**(PoE1 既有的鍵一個都沒動);
  書籤與歷史最上方有 PoE1 / PoE2 分頁,開哪一款就自動切到哪一邊。
  PoE2 目前**不含** PoB code 匯入(沒有現成的詞綴對照表)與物價(poe.ninja 端點是 PoE1 專用)
- **中文化**:介面、詞綴、篩選器、下拉選單中文化 + 搜尋結果列即時翻譯
- **書籤**:側邊欄以**兩層資料夾**收藏常用搜尋,**整塊點下去就是搜尋、按住 0.35 秒才是拖曳**(拖到別的資料夾上變成它的子、拖到上下緣則是同層排序);標題列內聯改名、釘選;可從 **PoE Trade Extension 的匯出碼**與 **Path of Building code** 匯入;書籤存的是與聯盟無關的搜尋編號,**換季後照樣打得開**;設定分頁可**一鍵清除所有書籤**(會先確認,搜尋紀錄與設定不受影響)
- **PoB 匯入**:貼一份 PoB code,自動照部位建資料夾(武器/防具/飾品/珠寶/藥水),每件裝備一個交易搜尋 —— 傳奇用「傳奇名 + 基底」、稀有用「基底 + 全部詞綴」,等於把 poe.ninja 上看到的流派整套存成書籤
- **歷史**:開過的搜尋自動記在「歷史」分頁(**只記搜尋框有填東西的**,同一個搜尋重複進去只更新時間,上限 20 筆),可一鍵加進任一資料夾
- **物價**:側邊欄「物價」分頁快查 poe.ninja 經濟 API,分類抽屜呈現、中英即打即搜、15 分鐘快取(**選用功能**,需自行開啟,見下)
- **偽屬性高亮**:結果列的「合計」詞綴(`.item-mod--pseudo`)加底色與左側金線,和一般詞綴分得開,可在設定關掉
- **廣義搜尋**(`page/stat-search.js`):在官網原生結果**後面**補兩層比對,原生命中的
  順序完全不變 —— **多關鍵字**(輸入含空白時 token AND,中英可混搜,如「phy gem」
  「物理 gems」)與**模糊比對**(中文簡稱與英文縮寫,如「移速」「火抗」`mvspd`,
  補充項另立「模糊比對」群組)。實作為 MAIN world 對 multiselect Vue 實例的
  filteredOptions watcher patch,官網結構不符時靜默停用、例外時退回原生過濾
- **顯示規則**(與完整版不同處):
  - 介面字串(標題、欄位名、按鈕、placeholder):**純中文直接替換**,不做雙語對照
  - 下拉選單選項(物品分類、詞綴清單等):「中文 (English)」對照,中英皆可搜尋
  - 動態下拉(傳奇獎勵/需求物品/完成地圖獎勵等,官網以 API 查詢值 entry.name 渲染):
    **維持純英文** —— 其過濾只吃英文,顯示中文會誤導;此為刻意設計,勿加顯示層翻譯
  - 搜尋結果列詞綴:直接替換為中文,英文原文放 hover title 供查對;popup 可開啟
    「詞綴雙語顯示」改為中文下方常駐英文原文小字(僅裝備詞綴,物品名/天賦卡不受影響)
- **popup**:PoE 暗金風單頁,只留最常用的 —— 目前語系 + 繁體中文化 / 還原回英文 /
  詞綴雙語顯示 / **側邊欄開關** / 清除快取。書籤匯出匯入與物價聯盟都在側邊欄的 ⚙ 裡;
  poe.ninja 的授權按鈕平常隱藏,只有 `popup.html?ask=ninja` 那一頁才露出
  (`chrome.permissions.request` 只能從擴充頁面呼叫,所以按鈕得留在這裡)

### 物價是選用功能

物價要讀 `poe.ninja` 的公開匯率,而**新增 `host_permissions` 會讓 Chrome 在擴充更新後
停用它、等使用者手動重新授權** —— 不能為了一個附加功能打斷所有現有使用者。所以
poe.ninja 放在 `optional_host_permissions`,安裝或更新後會自動開一次授權頁詢問
(只問一次,`ninjaAsked` 記在 storage),之後可在 popup 或側邊欄 ⚙ 的「物價查詢」開關
自行開關。⚠ `chrome.permissions.request` **只能從擴充頁面呼叫**(需要使用者手勢),
content script 沒有這個 API,所以側邊欄的開關是請 background 開授權頁,收回權限則由
background 直接做。未授權時物價分頁只顯示指引,不會發出任何請求。

### 資料夾圖示

只留兩區共 23 個:**職業(昇華)19 個** + **常用 4 個**(混沌石、神聖石、Nightmare Map、
Map (Tier 16))。由 `node tools/gen-icons-subset.mjs` 從 `tools/icons-full.json`(完整版
196 個)產生,指定的圖示找不到就直接失敗,不會靜靜少一個。

### 從 PoE Trade Extension 匯入書籤

在該擴充按「匯出設定」(匯出碼會複製到剪貼簿),貼進側邊欄 ⚙ → 書籤資料 →
「從 PoE Trade Extension 匯入…」。**只讀取它的 `folders`**,另外 43 個設定欄位不讀、
不寫,也**不提供反向匯出** —— 它的匯入是整包覆蓋設定,回送會清掉使用者在那邊的偏好。

匯入行為(依實際匯出碼實測而定,細節見 `tools/verify-bookmarks.mjs`):

| 對方的資料 | 這裡怎麼處理 |
|---|---|
| `parentId` 建的兩層資料夾 | 原樣保留;第三層以下收到第二層 |
| `childIds`(實測**恆為空陣列**) | 不讀,樹只靠 `parentId` 建 |
| `index` / `idx`(實測**有重複也有跳號**) | 不讀,順序一律以陣列順序為準 |
| `league: "Auto"` | 存成「自動」,開啟時才用當下聯盟 |
| `search` / `exchange`、PoE1 / PoE2 | 保留,組網址時分流 |
| `icon`(列舉字串,如 `Assassin`、`Chaos1`) | 以**英文名**對到內建圖示;對不到落預設符號並在匯入結果列出 |
| 壞掉的 `endpoint` | 丟棄並回報筆數,不靜默略過 |

### 匯出的是完整備份

「匯出備份」把**設定、全部書籤、歷史紀錄**存成一個 JSON(`kind: "backup"`),換一台
電腦一個檔就還原得回來;還原會**取代**目前的內容(有確認對話框)。只有書籤的舊檔
(或 PoE Trade Mate 的匯出檔)匯入則是**附加**,不會蓋掉現有的。匯入的設定只收
`DEFAULT_SETTINGS` 有的鍵而且型別要相符,手改過的備份檔不會把奇怪的值塞進來。

### 帶條件的書籤為什麼第一次比較慢

PoB 匯入產生的書籤存的是**查詢條件**而不是搜尋編號,官網每次都得先幫你建立一次搜尋
(那一趟往返就是「點下去有點慢」的來源)。所以第一次開完之後,擴充會把官網換上的
官方編號記回書籤(`cachedSearchId`),**下次點就直接開那個編號**,跟一般書籤一樣快。
換聯盟時自動退回 `?q=` 重建,不會開到上一季的舊搜尋。

技術:Manifest V3 + Vanilla JS,**零建置** —— `chrome://extensions` 開「開發人員模式」→「載入未封裝項目」選本資料夾即可。

## 版號規則(雙賽季編碼)

自 `329.5.0`(2026-08-26,合併 PoE2 支援)起,版號是**兩款遊戲的賽季碼 + 一個序號**:

```
329 . 5 . 0
 │    │   └── 這組賽季下的第幾次發版(從 0 起算)
 │    └────── PoE2 賽季(0.5 → 5)
 └─────────── PoE1 賽季(3.29 → 329)
```

**每一段賽季碼是「主版號 × 100 + 次版號」,不是把小數點刪掉。**
PoE1 `3.29`→329、`3.30`→330、`4.0`→400;PoE2 仍在搶先體驗,取玩家看到的 `0.x`:
`0.5`→5、`0.10`→10、`1.0`→100。任一段賽季碼變動時,第三段歸零。

- **不用「刪掉小數點」的寫法**:`4.10`→410 之後 `5.0`→50 就是倒退,而 Chrome
  Web Store 只接受嚴格遞增的版號。PoE 的次版號會進位到兩位數(3.9 → 3.10,不是 4.0),
  這不是假想情境。`×100` 永遠遞增,而且 PoE1 那一段的讀法與舊版號一樣(3.29 仍是 329),
  接得上 `3.29.10` 以前的歷史。
- **PoE2 取玩家端的 `0.x`,不是遊戲檔裡的 `4.5.4.10.2`** —— 後者是 GGG 內部把 PoE2
  當 4.x 的客戶端建置版本。PoE1 兩者剛好一致(3.29.0.1 / 3.29),所以特別容易誤用。
- **不得有前導零**(CWS 規定非零整數不得以 0 開頭),所以是 `329.5.0` 不是 `329.05.0`。
- **翻譯資料的新舊不再由版號表達**:譯名修正走遠端 `dict` 分支的 `dict-index.json`
  (自帶 `version: N`),使用者不必更新擴充就會拿到。舊制第三段的「當季資料修訂」語意
  自 `329.5.0` 起退休。

## 與完整版的關係

翻譯核心(`bg/translation.js`、`content/bootstrap.js`、`content/results.js`、`page/ui-strings.js`)與資料檔(`data/`)自完整版複製而來;**翻譯相關 bug 修復需兩邊同步**。書籤與物價也是自完整版移植,但已經長成不同的東西:資料格式加了第二層資料夾與拖放規則、可從 PoE Trade Extension 與 PoB code 匯入、偽屬性高亮;**不移植**「結果頁價格等值附註」與「詞綴輸入自動補 `~`」,**快捷篩選(＋/− 與預設面板)移植後又依使用者要求整組移除**(`tools/verify-sidebar.mjs` 有「不得回來」的回歸鎖)。

## 架構

```
manifest.json
background.js            SW 入口:translation / ninja / perm 訊息路由、每日重建 alarm(無狀態)
bg/translation.js        抓官方雙服 API → 依 id 對接 → 產出中文化資料 + statMap/itemMap
bg/ninja.js              poe.ninja 匯率代理(storage.session TTL 15min)
content/  (isolated world)
  bootstrap.js           document_start:翻譯資料覆寫官網 lscache-*、同步 UI 模式
  results.js             結果頁 MutationObserver 即時翻譯(詞綴/物品名/天賦卡)
  bookmarks-model.js     書籤資料格式 v3、匯入解析、拖放規則、聯盟解析與網址組法(純邏輯)
  pob-import.js          PoB code 解壓與解析、裝備 → 交易查詢 JSON(純邏輯)
  sidebar.js             側邊欄(書籤/歷史/物價/設定)、SPA 網址偵測、開頁自動即刻購買
page/  (MAIN world)
  ui-strings.js          document_start:全域 __ UI 字典(純中文直接替換/純英)
  stat-search.js         下拉多關鍵字 + 模糊比對
popup/                   語言切換、側邊欄開關、清除快取、物價授權(?ask=ninja)
data/                    內建字典(見下)+ s2t.json 簡→繁字表 + icons.json 書籤圖示
tools/                   開發用:gen-ggpk-data(ggpk 離線層)、verify-*(驗證腳本)
icons/                   16/32/48/128
```

語言狀態只有兩種:`zh_tw`(中文化)與 `us`(全英文)。isolated↔background 走 `chrome.runtime.sendMessage`;MAIN world 不碰 chrome API,UI 模式與遞補字典經 `localStorage`(`ptm-` 前綴)同步,側邊欄設定則走 `pmz-settings`。

⚠ **同一個 world 的 content script 共享頂層 lexical scope**(跨 `content_scripts` 條目也共享):兩個檔案各自宣告頂層 `const dbg` 會得到 `Identifier 'dbg' has already been declared`,後載入的那支**整個不執行**,而 manifest 檢查與 `node --check` 都看不出來。除 `bootstrap.js` 外,其餘 content script 的 `dbg` 一律放在 IIFE 裡面(`tools/verify-sidebar.mjs` 有這條的回歸鎖)。

## 官網耦合點(改版時優先檢查)

| 位置 | 依賴 | 用途 |
|---|---|---|
| `results.js` `SELECTORS` | `.results` `.row` `.item-mod` `.lc.s[data-field]` `.itemName .lc` | 結果頁翻譯 |
| `bootstrap.js` | `lscache-trade*` 快取鍵 | 資料層中文化 |
| `ui-strings.js` | 官網讀全域 `__` 字典的 i18n 掛勾(**僅舊版 i18n**,結果列物品卡不走這套) | UI 字串 |
| `stat-search.js` | multiselect Vue 實例的 `filteredOptions` | 下拉模糊搜尋 |
| `sidebar.js` `NAME_SOURCES` | `.search-select .multiselect__single` / `input.multiselect__input` | 書籤預設名稱、歷史紀錄的名稱 |
| `sidebar.js` `MULTISELECT_OPTION` | `.multiselect__option` 的文字(Instant Buyout / 即刻購買) | 開頁自動即刻購買 |
| `sidebar.css` 偽屬性高亮 | `.item-mod--pseudo` | 合計詞綴高亮 |

⚠ `NAME_SOURCES` **不要用 `.search-bar .multiselect__single`**:2026-08-14 實測那是 realm 選單,每個書籤都會被命名成「PoE 1 PC」。抓不到名稱時退回搜尋編號。

所有耦合點失效時皆靜默降級(`console.warn` 一次),單一功能損壞不影響翻譯。

## 資料來源與智財

翻譯建置分兩階段(安裝/套用中文化時觸發,之後每 24 小時自動重建;開交易頁時若快照逾 6 小時亦背景重建 — 賽季開版官方新增物品時,舊快照會讓新物品從官網下拉消失,連英文都搜不到),與完整版一致:

- **第一階段:內建字典(不需網路、必定成功)** —— `data/` 內 translate.json(物品名)、translate.zh_TW.json(UI 字串)、clusterJewel.json / passivesNotable.json(天賦卡),源自 POE Trade zh;另有 ggpk.json 離線層(解析本機 `Content.ggpk` 的官方繁中,由 `tools/gen-ggpk-data.mjs` 產生,檔案不存在時自動略過)。
- **第二階段:官方 API + 社群遞補(best-effort,失敗只降級)** —— 美服 + 台服 `api/trade/data/*` 依官方 id 對接;[cswzhang/Poe-trade-zh](https://github.com/cswzhang/Poe-trade-zh)(Apache-2.0)經 OpenCC 字表(`data/s2t.json`)簡轉繁填缺口。

### 譯名的取捨標準

**詞綴**以台服官方資料為主、遊戲檔補洞;**物品**以遊戲檔為準(兩服的物品清單沒有
共通識別碼,無法直接對應)。任何一條譯名都要能被第二個來源印證才採用。

對接一律用**語言無關的鍵**(物品用內部路徑、詞綴用官方詞綴代碼、變體條目用內部
分類碼),**不做位置對位** —— 兩服清單筆數相同純屬巧合時,位置對位會讓整段譯名錯位。

**無法確認的條目一律保留英文**(英文仍可搜尋),不顯示無把握的中文,也不會出現
空白、殘缺或半中半英的混雜。

### 逐條四方比對(3.29.6)

全部 5,997 個物品條目都做過 **① 國際官方 → ② 台服官方 → ③ poedb → ④ 遊戲檔**
的逐條比對,而且要求**語意一致**而不只是字面相同:傳奇物品的「傳奇名」與「基底名」
兩段必須各自獨立對上,且不得有兩個英文條目搶同一筆中文。

| 結果 | |
|---|---|
| 台服官方 ⇄ poedb | **零分歧** |
| 遊戲檔 ⇄ poedb | **一致率 100%** |
| 通過最嚴格的全欄位比對 | 5,200 條 |
| 弱證據(僅字面相符) | 3 條 |

已知未解:3 組是**遊戲本身**把不同基底翻成同一個中文(`Warlock Boots` 與
`Sorcerer Boots` 都叫「術士長靴」、`Velour/Velvet Gloves` 都叫「絲絨手套」、
`Dragonbone/Wyrmbone Rapier` 都叫「龍骨細劍」),任何資料源都無法區分,維持原樣;
英文原文仍在括號內可辨。

**致謝**:POE Trade zh(原作者 Baconrad,翻譯資料與中文化機制設計來源)、cswzhang/Poe-trade-zh(Apache-2.0)、[OpenCC](https://github.com/BYVoid/OpenCC)(Apache-2.0)、[repoe-fork](https://repoe-fork.github.io/)(遊戲資料匯出)、[poedb.tw](https://poedb.tw/tw/)(譯名查證)。

## 授權

本專案程式碼以 [MIT License](LICENSE) 授權。`data/` 目錄內的翻譯資料檔為第三方內容,**不在 MIT 授權範圍**,各依其來源授權:POE Trade zh 內建字典(原作者 Baconrad)、Path of Exile 遊戲文本(Grinding Gear Games 智財)、cswzhang/Poe-trade-zh 與 OpenCC 衍生資料(Apache-2.0)。Path of Exile 為 Grinding Gear Games 的商標;本專案為玩家社群工具,與 GGG 無關。

## 開發驗證

```
node tools/verify-offline.mjs        # 離線:內建字典與重建不降級回歸(不需網路)
node tools/verify-dataquality.mjs    # 資料品質:語言健檢、變體對接、基底名正規化
node tools/verify-audit.mjs          # 譯名稽核結論的回歸測試
node tools/verify-statid.mjs         # 詞綴代碼對接、數值回填、增減對稱、覆蓋率門檻
node tools/verify-fuzzy.mjs          # 下拉模糊比對:評分、門檻、去重、33 案例排名門檻
node tools/verify-results-watch.mjs  # 結果容器被 SPA 重建後的重新掛載判定
node tools/verify-mercenary.mjs      # 傭兵契約書技能/輔助名稱對照(含真實快照)
node tools/verify-remote-dict.mjs    # 遠端字典三層降級(74 項,全離線)
node tools/verify-bookmarks.mjs      # 書籤格式、Extension 匯出碼解析、聯盟與網址組法
node tools/verify-sidebar.mjs        # 側邊欄安裝面:manifest、權限模式、前綴、dbg 衝突
node tools/verify-pob-import.mjs     # PoB code 解碼、部位分類、詞綴 → 官方代碼命中率
python tools/gen-beast-names.py      # 野獸譯名盤點(加 --write 才寫入 data/translate.json)
node tools/verify-build.mjs          # 官方 API 對接與翻譯產出(需網路)
node tools/verify-fallback.mjs       # 社群遞補層與 s2t 轉換(需網路)
```

`verify-bookmarks.mjs` 另接 `--real <檔>`,可拿真實的 PoE Trade Extension 匯出碼跑一次
(該檔含個人書籤,不進存放庫)。合成 fixture 由 `node tools/gen-bookmark-fixture.mjs`
從 `tools/.fixture/pte-export-sample.json` 重產。

(`tools/` 為維護端本地工具,不隨公開存放庫發布。)

## 支持這個專案

如果這個擴充對你有幫助,歡迎請我喝杯咖啡:

<a href="https://buymeacoffee.com/hsiung" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" width="174"></a>

問題回報與建議請開 [Issue](https://github.com/Hsiung-Shao/poe-market-zh/issues),或到 [Discord 社群](https://discord.gg/6VamPQb8nC) 聊聊。

(擴充內的側邊欄 ⚙ 設定分頁最下方也有這兩個連結。)
