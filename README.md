# Poe Market Zh(純翻譯版)

Path of Exile 1 國際服交易站(`pathofexile.com/trade`)**中文化專用**擴充 —— poe-trade-mate(內部完整版)的精簡分支,僅保留翻譯功能,移除書籤、物價、快捷篩選與側邊欄。兩版擴充 id 不同,可同時載入 Chrome(建議只啟用其中一個,避免互搶官網 lscache 快取)。

- **中文化**:介面、詞綴、篩選器、下拉選單中文化 + 搜尋結果列即時翻譯
- **廣義搜尋**(`page/stat-search.js`):下拉搜尋輸入**含空白的多關鍵字**時改為 token AND
  配對(每個關鍵字各自命中即可,不限順序連續;中英可混搜,如「phy gem」「物理 gems」);
  單一關鍵字維持官網原生行為。實作為 MAIN world 對 multiselect Vue 實例的
  filteredOptions watcher patch,官網結構不符時靜默停用、例外時退回原生過濾
- **顯示規則**(與完整版不同處):
  - 介面字串(標題、欄位名、按鈕、placeholder):**純中文直接替換**,不做雙語對照
  - 下拉選單選項(物品分類、詞綴清單等):「中文 (English)」對照,中英皆可搜尋
  - 動態下拉(傳奇獎勵/需求物品/完成地圖獎勵等,官網以 API 查詢值 entry.name 渲染):
    **維持純英文** —— 其過濾只吃英文,顯示中文會誤導;此為刻意設計,勿加顯示層翻譯
  - 搜尋結果列詞綴:直接替換為中文,英文原文放 hover title 供查對;popup 可開啟
    「詞綴雙語顯示」改為中文下方常駐英文原文小字(僅裝備詞綴,物品名/天賦卡不受影響)
- **popup**:PoE 暗金風單頁 —— 目前語系 + 繁體中文化 / 還原回英文 / 清除快取 / 詞綴雙語顯示(翻譯資料由安裝時與每日 alarm 自動更新,無手動更新鈕)

技術:Manifest V3 + Vanilla JS,**零建置** —— `chrome://extensions` 開「開發人員模式」→「載入未封裝項目」選本資料夾即可。

## 與完整版的關係

翻譯核心(`bg/translation.js`、`content/bootstrap.js`、`content/results.js`、`page/ui-strings.js`)與資料檔(`data/`)自完整版複製而來;**翻譯相關 bug 修復需兩邊同步**。完整版的書籤/物價/快捷篩選程式碼(`content/sidebar.js`、`bg/ninja.js`、`page/filter-actions.js` 等)不在本版。

## 架構

```
manifest.json
background.js            SW 入口:translation 訊息路由、每日重建 alarm(無狀態)
bg/translation.js        抓官方雙服 API → 依 id 對接 → 產出中文化資料 + statMap/itemMap
content/  (isolated world)
  bootstrap.js           document_start:翻譯資料覆寫官網 lscache-*、同步 UI 模式
  results.js             結果頁 MutationObserver 即時翻譯(詞綴/物品名/天賦卡)
page/  (MAIN world)
  ui-strings.js          document_start:全域 __ UI 字典(純中文直接替換/純英)
popup/                   語言切換、清除快取、更新翻譯資料
data/                    內建字典(見下)+ s2t.json 簡→繁字表
tools/                   開發用:gen-ggpk-data(ggpk 離線層)、verify-*(驗證腳本)
icons/                   16/32/48/128
```

語言狀態只有兩種:`zh_tw`(中文化)與 `us`(全英文)。isolated↔background 走 `chrome.runtime.sendMessage`;MAIN world 不碰 chrome API,UI 模式與遞補字典經 `localStorage`(`ptm-` 前綴)同步。

## 資料來源與智財

翻譯建置分兩階段(安裝/套用中文化時觸發,之後每 24 小時自動重建;開交易頁時若快照逾 6 小時亦背景重建 — 賽季開版官方新增物品時,舊快照會讓新物品從官網下拉消失,連英文都搜不到),與完整版一致:

- **第一階段:內建字典(不需網路、必定成功)** —— `data/` 內 translate.json(物品名)、translate.zh_TW.json(UI 字串)、clusterJewel.json / passivesNotable.json(天賦卡),源自 POE Trade zh;另有 ggpk.json 離線層(解析本機 `Content.ggpk` 的官方繁中,由 `tools/gen-ggpk-data.mjs` 產生,檔案不存在時自動略過)。
- **第二階段:官方 API + 社群遞補(best-effort,失敗只降級)** —— 美服 + 台服 `api/trade/data/*` 依官方 id 對接;[cswzhang/Poe-trade-zh](https://github.com/cswzhang/Poe-trade-zh)(Apache-2.0)經 OpenCC 字表(`data/s2t.json`)簡轉繁填缺口。

### 譯名的取捨標準

**以官方遊戲檔為第一真值**,並與社群匯出的遊戲資料交叉驗證,兩者分歧時查第三方資料庫仲裁。
理由:內建字典是舊賽季快照,官方改譯名後就會過期(`Split Arrow` 現為「裂化箭矢」而非「分裂箭矢」);
交易站自身的中文與遊戲內用字也多有出入,因此降為最後遞補,只在官方來源都查不到時使用。

對接一律用**語言無關的鍵**(物品用內部路徑、詞綴用 stat id、變體條目用 `type`+`disc`),
不做位置對位 —— 兩服清單筆數相同純屬巧合時,位置對位會讓整段譯名錯位。

**無法從官方來源確認的條目一律保留英文**(英文仍可搜尋),不顯示無把握的中文,
也不會出現空白、殘缺或半中半英的混雜。v0.3.0 對全部 5,997 個物品條目做過逐筆稽核。

**致謝**:POE Trade zh(原作者 Baconrad,翻譯資料與中文化機制設計來源)、cswzhang/Poe-trade-zh(Apache-2.0)、[OpenCC](https://github.com/BYVoid/OpenCC)(Apache-2.0)、[repoe-fork](https://repoe-fork.github.io/)(遊戲資料匯出)、[poedb.tw](https://poedb.tw/tw/)(譯名查證)。

## 授權

本專案程式碼以 [MIT License](LICENSE) 授權。`data/` 目錄內的翻譯資料檔為第三方內容,**不在 MIT 授權範圍**,各依其來源授權:POE Trade zh 內建字典(原作者 Baconrad)、Path of Exile 遊戲文本(Grinding Gear Games 智財)、cswzhang/Poe-trade-zh 與 OpenCC 衍生資料(Apache-2.0)。Path of Exile 為 Grinding Gear Games 的商標;本專案為玩家社群工具,與 GGG 無關。

## 開發驗證

```
node tools/verify-offline.mjs      # 離線:內建字典與重建不降級回歸(不需網路)
node tools/verify-dataquality.mjs  # 資料品質:語言健檢、變體對接、基底名正規化
node tools/verify-audit.mjs        # 譯名稽核結論的回歸測試
node tools/verify-build.mjs        # 官方 API 對接與翻譯產出(需網路)
node tools/verify-fallback.mjs     # 社群遞補層與 s2t 轉換(需網路)
```

(`tools/` 為維護端本地工具,不隨公開存放庫發布。)

官網改版時的耦合點(選擇器、lscache 鍵名)與內部完整版相同,維護時參照完整版 README 的「官網耦合點」一節。

## 支持這個專案

如果這個擴充對你有幫助,歡迎請我喝杯咖啡:

<a href="https://buymeacoffee.com/hsiung" target="_blank"><img src="https://cdn.buymeacoffee.com/buttons/v2/default-yellow.png" alt="Buy Me A Coffee" height="48" width="174"></a>

問題回報與建議請開 [Issue](https://github.com/Hsiung-Shao/poe-market-zh/issues)。
