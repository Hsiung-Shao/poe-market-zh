# Changelog

本專案版本紀錄。格式參考 [Keep a Changelog](https://keepachangelog.com/zh-TW/),版號採 [SemVer](https://semver.org/lang/zh-TW/)。

## [0.2.3] - 2026-07-26

### 修復
- 詞綴篩選下拉:台服 API 缺席的詞綴(如 Map is occupied by The Purifier)改以現有詞綴模板字典(ggpk 官方繁中)補上雙語顯示,與結果列翻譯一致;字典也查無才保留英文

## [0.2.2] - 2026-07-26

### 修復
- **變體寶石翻譯錯位**(如 Summon Chaos Golem of Hordes 被配到「召喚食腐魔像」):items 翻譯比對從「兩服清單位置對位」全面改為**以英文名為準查字典**(ggpk 官方繁中+內建+社群),兩服更新進度不同步時不再發生任何錯位;字典查無的條目保留英文原文可搜。分類標題仍依語言無關的分類 id 對接台服。
- 搜尋結果列物品名改純中文顯示(原文 hover 可查),與詞綴的直接替換原則一致

## [0.2.1] - 2026-07-26

### 新增
- 「詞綴雙語顯示」開關:開啟後搜尋結果詞綴在中文下方常駐英文原文小字(預設關閉,英文原文 hover 可查)
- 下拉搜尋**多關鍵字廣義配對**:輸入含空格的多個關鍵字(如 `phy gem`)即列出全部命中的詞綴,不限順序、中英可混搜;單一關鍵字維持官網原生行為

### 修復
- 賽季開版後新物品(如 Allflame 新深淵珠寶)從搜尋下拉消失的問題,三層修正:
  - 翻譯快照逾 6 小時開交易頁自動背景重建,不再只靠每日排程
  - 資料建置改以**最新國際服(英文)資料為基準**:台服/社群字典個別失效只影響中文覆蓋,不再整批退回舊資料
  - 未翻譯物品一律保留**英文全名**可搜,不再被基底物品翻譯覆蓋吃掉傳奇名/品質變體資訊

### 品質
- 發佈版不含開發診斷 log(log 僅存在於開發目錄)

## [0.1.0] - 2026-07-23

初版(未公開發布)。

- 篩選器、詞綴、下拉選單中文化(下拉「中文 (English)」對照,中英皆可搜)
- 搜尋結果列詞綴/物品名/天賦卡即時翻譯(純中文直接替換)
- PoE 暗金風 popup:繁體中文化 / 還原回英文 / 清除快取
- 官方美服+台服 trade data API 依 id 對接,安裝時建置、每 24 小時自動更新
- MIT License(程式碼);`data/` 第三方翻譯資料依各來源授權

[0.2.3]: https://github.com/Hsiung-Shao/poe-market-zh/releases/tag/v0.2.3
[0.2.2]: https://github.com/Hsiung-Shao/poe-market-zh/releases/tag/v0.2.2
[0.2.1]: https://github.com/Hsiung-Shao/poe-market-zh/releases/tag/v0.2.1
[0.1.0]: https://github.com/Hsiung-Shao/poe-market-zh/commit/4856d52
