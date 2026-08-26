// 兩款遊戲(PoE1 `/trade/` 與 PoE2 `/trade2/`)的**背景端**命名空間。
//
// ⚠⚠ **這個檔只給 Service Worker 用,不要列進 content_scripts。**
//   2026-08-26 於官網實測到的坑:把常數表放在同一個 `content_scripts` 條目的前一個
//   檔案、由它設 `globalThis.X`,在 **isolated world 的 `document_start`** 讀不到
//   (`TypeError: Cannot read properties of undefined`),整支腳本一行都不執行,
//   而且離線檢查、`node --check`、manifest 驗證全部看不出來 —— 只有頁面 console
//   看得到。同樣的寫法在 **MAIN world 的 document_start** 與 **isolated 的
//   document_end** 都正常,所以極容易誤判可行。
//   → content script 那一側改成**各自自帶所需常數**(見 content/bootstrap.js),
//     兩份 `store` 鍵名由 tools/verify-poe2.mjs 鎖住逐鍵相同。
//   SW 這一側是 ES module 靜態 import,求值順序有保證,沒有這個問題。
//
// ⚠ PoE1 的鍵**一個都不能改**:改了等於要求所有現有使用者重建資料。
//   PoE2 一律另立新鍵(storage 用 `2` 後綴;`lscache-trade2*` 是官網自己的鍵名)。

// chrome.storage.local 的鍵。**這份與 content/bootstrap.js 裡的那份必須逐鍵相同**
// (那邊不能 import,見上方警語),tools/verify-poe2.mjs 有交叉鎖。
const STORE_KEYS = {
  poe1: {
    translation: 'translation',
    statMap: 'statMap',
    statIdMap: 'statIdMap',
    itemMap: 'itemMap',
    uniqueMap: 'uniqueMap',
    uiExtra: 'uiExtra',
    updated: 'updated',
    buildStatus: 'buildStatus',
  },
  poe2: {
    translation: 'translation2',
    statMap: 'statMap2',
    statIdMap: 'statIdMap2',
    itemMap: 'itemMap2',
    uniqueMap: 'uniqueMap2',
    uiExtra: 'uiExtra2',
    updated: 'updated2',
    buildStatus: 'buildStatus2',
  },
};

const API_ORIGIN = 'https://www.pathofexile.com';
const TW_ORIGIN = 'https://pathofexile.tw';

export const GAMES = {
  poe1: {
    id: 'poe1',
    label: 'PoE1',
    api: { us: `${API_ORIGIN}/api/trade/data/`, tw: `${TW_ORIGIN}/api/trade/data/` },
    snapshot: { us: 'api-us.json', tw: 'api-tw.json' },
    store: STORE_KEYS.poe1,
    // 遞補層:cswzhang/Poe-trade-zh(Apache-2.0,**簡體**,經 s2t 轉繁)
    community: {
      items: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/item.json',
      ui: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/interface.json',
    },
    communityNeedsS2t: true, // 沒有 s2t 就整層停用,否則簡體字會直接進字典
    ggpkDict: 'ggpk.json',
    passives: true, // 天賦卡(星團珠寶/塗油)只有 PoE1 有
    // 台服已有 97.4% 的 stat id,開跨群橋接只多 357 條卻會動到已驗證的行為,
    // 值得另開一次帶稽核的變更,不順手做。
    bridgeStats: false,
  },
  poe2: {
    id: 'poe2',
    label: 'PoE2',
    api: { us: `${API_ORIGIN}/api/trade2/data/`, tw: `${TW_ORIGIN}/api/trade2/data/` },
    snapshot: { us: 'api2-us.json', tw: 'api2-tw.json' },
    store: STORE_KEYS.poe2,
    // 遞補層:cswzhang/POE2-Trade-zh_tw(Apache-2.0,**本來就是繁中**)。
    // ⚠ 有明顯錯譯(`Class`→「角色」、`Points`→「黯幣」),只當最後一層。
    community: {
      items: 'https://raw.githubusercontent.com/cswzhang/POE2-Trade-zh_tw/master/json/items2.json',
      ui: 'https://raw.githubusercontent.com/cswzhang/POE2-Trade-zh_tw/master/json/interface2.json',
    },
    communityNeedsS2t: false, // 已是繁中,s2t 只是順手修掉夾雜簡體的防衛層
    ggpkDict: 'ggpk2.json',
    passives: false,
    // 台服 trade2 只有 71.6% 的 stat id 有譯文,缺口幾乎全在 crafted/fractured,
    // 而同一個 stat 的 explicit 版有翻。守門見 bg/translation.js 的 bridgeTwStats。
    bridgeStats: true,
  },
};

export const GAME_IDS = Object.keys(GAMES);

// 全部 storage 鍵(popup 的「清除快取」要一次清乾淨)
export const allStoreKeys = () => GAME_IDS.flatMap((id) => Object.values(GAMES[id].store));
