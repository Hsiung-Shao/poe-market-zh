// document_start(isolated):把 background 建好的翻譯資料覆寫進官網的 lscache
// 快取(官網以 lscache 快取 trade data API 的回應,直接以其內容渲染下拉選單與
// 篩選面板),並把 UI 模式與遞補字典同步給 MAIN world 的 ui-strings.js。
//
// ── 兩款遊戲,依網址判定 ──
//   PoE1  https://www.pathofexile.com/trade/search/Allflame/mkg9kekMf6
//   PoE2  https://www.pathofexile.com/trade2/search/poe2/Runes%20of%20Aldur
// `trade2` 與 `/poe2/` 兩個訊號在 PoE2 一定同時出現、在 PoE1 一定都不出現,
// 判定沒有模糊地帶(`bookmarks-model.js` 的 TRADE_PATH_RE 用的是同一組訊號)。
// ⚠ 兩者是**同一個 origin**,所以每一組鍵都必須分開:官網自己把 PoE2 的快取命名成
//   `lscache-trade2*`(2026-08-26 活站實測,兩份同時存在互不覆寫),我們的簽章鍵與
//   UI 遞補字典鍵也跟著分兩組。
//
// ⚠⚠ **這個檔不得依賴任何其他 content script 先跑過。**
//   2026-08-26 實測:把常數表放在同一個 `content_scripts` 條目的前一個檔、由它設
//   `globalThis.X`,在 **isolated world 的 document_start** 讀不到 ——
//   `TypeError: Cannot read properties of undefined`,整支腳本一行都不執行,
//   而且 `node --check`、manifest 檢查、離線驗證全部看不出來,只有頁面 console
//   看得到。(同樣寫法在 MAIN world 的 document_start 與 isolated 的 document_end
//   都正常,所以極易誤判可行。)
//   → 常數表**內嵌在本檔**;`shared/games.js` 那份只給 Service Worker 用,
//     兩份的 `store` 鍵名由 tools/verify-poe2.mjs 鎖住逐鍵相同。

// 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
const dbg = (...a) => console.info(...a);

// ⚠ 與 shared/games.js 的 STORE_KEYS 必須逐鍵相同(verify-poe2 有交叉鎖)
const PMZ_TABLE = {
  poe1: {
    id: 'poe1',
    label: 'PoE1',
    store: {
      translation: 'translation',
      statMap: 'statMap',
      statIdMap: 'statIdMap',
      itemMap: 'itemMap',
      uniqueMap: 'uniqueMap',
      uiExtra: 'uiExtra',
      updated: 'updated',
      buildStatus: 'buildStatus',
      lscacheError: 'lscacheError',
      modNames: 'modNames',
    },
    lscache: {
      items: 'lscache-tradeitems',
      stats: 'lscache-tradestats',
      static: 'lscache-tradedata',
      filters: 'lscache-tradefilters',
    },
    page: { sig: 'ptm-lscache-sig', uiExtra: 'ptm-ui-extra' },
  },
  poe2: {
    id: 'poe2',
    label: 'PoE2',
    store: {
      translation: 'translation2',
      statMap: 'statMap2',
      statIdMap: 'statIdMap2',
      itemMap: 'itemMap2',
      uniqueMap: 'uniqueMap2',
      uiExtra: 'uiExtra2',
      updated: 'updated2',
      buildStatus: 'buildStatus2',
      lscacheError: 'lscacheError2',
      modNames: 'modNames2',
    },
    lscache: {
      items: 'lscache-trade2items',
      stats: 'lscache-trade2stats',
      static: 'lscache-trade2data',
      filters: 'lscache-trade2filters',
    },
    page: { sig: 'ptm-lscache-sig2', uiExtra: 'ptm-ui-extra2' },
  },
};

// 判定唯一依據是 pathname。`/trade2` 必須先判,否則 `/trade` 的前綴會先命中。
function pmzGameOf(pathname) {
  const p = String(pathname ?? '');
  return /^\/trade2(\/|$)/.test(p) || /^\/trade\/[^/]+\/poe2(\/|$)/.test(p) ? 'poe2' : 'poe1';
}

const PMZ_GAME = PMZ_TABLE[pmzGameOf(location.pathname)];
const PMZ_TAG = PMZ_GAME.label;
// 交給 document_end 的 results.js / sidebar.js 用(那個時點跨檔 globalThis 是可靠的,
// 壞掉的只有 document_start 那一刻)。它們仍各自有備援,不會因為這裡沒設就整支死掉。
globalThis.PMZ_GAME = PMZ_GAME;

const LSCACHE_KEYS = PMZ_GAME.lscache;
const LOCAL_UPDATED = 'ptm-local-updated'; // 舊版鍵,只保留清除用
// lscache 覆寫的內容簽章。只比 updated 時間戳不夠:使用者在 popup 切換設定時
// updated 不變,lscache 就不會重寫,造成「已寫入的資料」與「現行設定」不同步。
// 簽章納入擴充 id,順便讓完整版與純翻譯版並存時不互相搶鍵。
const LSCACHE_SIG = PMZ_GAME.page.sig;
const UI_MODE_KEY = 'ptm-ui-mode'; // 語系是全域設定,兩款共用
const UI_EXTRA_KEY = PMZ_GAME.page.uiExtra;
// 舊版留下、現在沒有任何程式碼會讀寫的頁面鍵,開頁時順手清掉。
// ⚠ 不是潔癖:localStorage 是 **per-origin 5 MB**,而本站光是 lscache 就吃掉
//   4.4 MB(2026-08-30 在使用者機器上實測 4.96 MB / 5 MB,寫 100 KB 就
//   QuotaExceededError)。每一個孤兒鍵都在跟官網搶那最後幾十 KB。
//   `ptm-stat-groups` / `ptm-grouping-ready`:0.3.x「同類詞綴合併選單」的殘留。
//   `ptm2-ui-extra`:更早版本的 uiExtra 命名(現行是 `ptm-ui-extra` / `ptm-ui-extra2`)。
const LEGACY_PAGE_KEYS = ['ptm-stat-groups', 'ptm-grouping-ready', 'ptm2-ui-extra'];
// 翻譯快照逾時門檻:開交易頁時資料舊於此即觸發背景重建(本頁先用現有資料,
// 下次重新整理生效)。賽季開版官方 items 會加新物品,舊快照會讓新物品從官網
// 下拉消失(連英文都搜不到),不能只靠每日 alarm。
const STALE_MS = 6 * 60 * 60 * 1000;
// 「這款遊戲的交易站被實際開過」一天最多記一次,避免每次開頁都動 storage。
const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

// 「現在沒在看的那一款」的 lscache 鍵。localStorage 是 **per-origin 5 MB**,
// 擴充的 unlimitedStorage 權限管不到頁面自己的 localStorage —— 而 PoE1 + PoE2
// 兩份中文化快取加起來就 4.4 MB。空間不夠時先清掉沒在用的那一款讓路:
// 官網下次開那一款會自己重抓,不會壞掉,只是那一次會多一趟 API。
const OTHER_LSCACHE_KEYS = Object.values(
  PMZ_TABLE[PMZ_GAME.id === 'poe1' ? 'poe2' : 'poe1'].lscache
);

let freedOtherGame = false;
function freeOtherGameCache() {
  if (freedOtherGame) return false;
  freedOtherGame = true;
  for (const key of OTHER_LSCACHE_KEYS) {
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}-cacheexpiration`);
  }
  console.warn('[PTM] localStorage 空間不足,已清除另一款遊戲的官網快取讓路(下次開那一款會自動重抓)');
  return true;
}

// 寫一筆頁面鍵。配額爆掉時清掉另一款的官網快取再試一次。回傳是否成功。
//
// ⚠⚠ **這一層 try 不是防禦性程式碼,是必需品。** `localStorage.setItem` 在配額
//   用盡時會拋,而 main() 是一條直線 —— 任何一次裸寫拋出來,整支 bootstrap 就
//   中止在那裡:後面的 lscache 覆寫不會做,連「空間不足」的診斷都不會留下,
//   使用者只看得到「下拉還是英文」。2026-08-30 的離線驗證 E 段抓到的就是這個:
//   當時 `ptm-ui-mode` 那一行是裸寫的,使用者的 localStorage 已經 4.96/5 MB。
//   → **頁面鍵一律走這支,不要直接呼叫 localStorage.setItem。**
function setPageItem(key, value) {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      localStorage.setItem(key, value);
      return true;
    } catch (err) {
      // 配額以外的錯誤(或讓路過後仍失敗)沒有第二條路,直接放棄這一筆
      if (err?.name !== 'QuotaExceededError' || !freeOtherGameCache()) {
        console.warn('[PTM] 頁面鍵寫入失敗:', key, err);
        return false;
      }
    }
  }
  return false;
}

// 寫一筆 lscache。回傳是否成功。
function setLscacheItem(key, payload) {
  if (!setPageItem(key, payload)) return false;
  // 官網自己的過期戳記:留著它官網會判定快取過期、自己重抓一份蓋掉我們的
  localStorage.removeItem(`${key}-cacheexpiration`);
  return true;
}

// 粗估目前用量(UTF-16,兩 bytes 一字元)。只在失敗路徑呼叫 —— 它會把整個
// localStorage 讀過一遍,不是可以順手做的事。
function usedLocalStorageKB() {
  try {
    let chars = 0;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      chars += (k?.length ?? 0) + (localStorage.getItem(k)?.length ?? 0);
    }
    return Math.round((chars * 2) / 1024);
  } catch (_) {
    return null;
  }
}

// 回傳寫不進去的種類清單(空陣列 = 全部成功)
function writeLscache(translation) {
  const failed = [];
  for (const [kind, key] of Object.entries(LSCACHE_KEYS)) {
    const data = translation?.[kind]?.result;
    if (!data) continue;
    if (!setLscacheItem(key, JSON.stringify(data))) {
      failed.push(kind);
      continue;
    }
    const entries = data.reduce((n, g) => n + (g.entries?.length ?? g.filters?.length ?? 0), 0);
    dbg(`[PTM/${PMZ_TAG}] lscache 寫入 ${kind}:${data.length} 組 / ${entries} 條`);
  }
  return failed;
}

function clearLscache() {
  for (const key of Object.values(LSCACHE_KEYS)) {
    localStorage.removeItem(key);
    localStorage.removeItem(`${key}-cacheexpiration`);
  }
}

function lscacheSignature(updated, parts) {
  return [updated ?? 0, chrome.runtime.id, ...parts].join('|');
}

// background 依這份清單決定要建/重建哪幾份資料 —— 只玩一款的人不必為另一款
// 每天多抓 4 個端點、多存一份資料。
async function markGameSeen() {
  try {
    const { gamesSeen } = await chrome.storage.local.get('gamesSeen');
    const prev = gamesSeen?.[PMZ_GAME.id];
    if (prev && Date.now() - prev < SEEN_REFRESH_MS) return;
    await chrome.storage.local.set({
      gamesSeen: { ...(gamesSeen ?? {}), [PMZ_GAME.id]: Date.now() },
    });
  } catch (_) { /* 記不到不影響翻譯,下次開頁再試 */ }
}

async function main() {
  // 「content script 在交易站上跑得起來」的證據。背景那邊看不到這件事,而它是唯一能
  // 分辨兩種失敗的訊號:瀏覽器管理原則的 runtime_blocked_hosts 會連 **JavaScript
  // 注入**一起擋,那種情況下拿到再多資料也沒有地方用;若只是背景請求被擋,翻譯
  // 其實還活著。診斷訊息靠這筆分流(見 diagnoseApiFailure)。
  chrome.storage.local.set({ contentAliveAt: Date.now() }).catch(() => {});
  markGameSeen();

  const K = PMZ_GAME.store;
  // ⚠ **這一輪刻意不拿 K.translation。** 那是四份官方 API 的中文化結果,離線量到
  //   1.67 MB(英文快照;中文更大,頁面端的 lscache 實測 4.4 MB),而
  //   `chrome.storage.local.get` 是跨程序搬運 —— 光 structuredClone 就 11 ms,
  //   加上另一端的讀取與解析更多。這裡是 document_start,每開一個交易站分頁都在
  //   付,偏偏**簽章相符時它會被原封不動丟掉**(常態就是相符)。
  //   改成算完簽章、確定真的要寫 lscache 才去拿,見下方 needTranslation。
  const stored = await chrome.storage.local.get(['language', K.updated, K.uiExtra]);
  const language = stored.language;
  const updated = stored[K.updated];
  const uiExtra = stored[K.uiExtra];

  // 清掉舊版遺留的孤兒鍵(見 LEGACY_PAGE_KEYS 的說明:是在搶 5 MB 額度)
  for (const k of LEGACY_PAGE_KEYS) localStorage.removeItem(k);

  // 同步 UI 模式與遞補字典給 MAIN world(ui-strings.js 讀 localStorage,重新整理生效)
  // UI 字串直接替換為純中文,無雙語模式
  const mode = language === 'zh_tw' ? 'zh' : 'en';
  if (localStorage.getItem(UI_MODE_KEY) !== mode) setPageItem(UI_MODE_KEY, mode);
  if (mode === 'en') localStorage.removeItem(UI_EXTRA_KEY);
  else if (uiExtra) setPageItem(UI_EXTRA_KEY, JSON.stringify(uiExtra));

  if (language !== 'zh_tw') {
    // 切回英文:清掉覆寫,讓官網重抓原文資料
    if (localStorage.getItem(LSCACHE_SIG) || localStorage.getItem(LOCAL_UPDATED)) {
      clearLscache();
      localStorage.removeItem(LSCACHE_SIG);
      localStorage.removeItem(LOCAL_UPDATED);
    }
    return;
  }

  const sig = lscacheSignature(updated, []);
  const localSig = localStorage.getItem(LSCACHE_SIG);
  dbg(
    `[PTM/${PMZ_TAG}] 翻譯快照:建置於 ${updated ? new Date(updated).toLocaleString() : '無'}、` +
      `本頁簽章 ${localSig ?? '無'}`
  );

  // 真的要寫 lscache(或還沒建置過)才把那幾 MB 搬過來。
  // 拿 updated 當「這一款建置過沒有」的輕量代理:第二階段是把 translation 與
  // updated **同一次 set** 寫進去的,`translation:clear` 也是整組一起 remove。
  // ⚠ 唯一的例外是**首次安裝、第一階段與第二階段之間**:那時
  //   `if (!existing[K.updated]) stageOne[K.updated] = Date.now()` 會先寫 updated,
  //   translation 還不存在。那個窗口裡本頁一定還沒寫過 lscache(localSig 是 null)
  //   → sig 必不相符 → 照樣會去拿 translation,拿到 undefined 就走下面的建置分支,
  //   與改動前完全一樣。不要把這裡改成「有 updated 就跳過」。
  const needTranslation = !updated || sig !== localSig;
  const translation = needTranslation
    ? (await chrome.storage.local.get(K.translation))[K.translation]
    : null;

  if (!translation && needTranslation) {
    // 這一款尚未建置(全新安裝,或第一次開這款的交易站):觸發背景建置,
    // 完成後下次載入生效 —— 與首次安裝完全相同的體驗
    chrome.runtime.sendMessage({ t: 'translation:build', game: PMZ_GAME.id }).catch(() => {});
    dbg(`[PTM/${PMZ_TAG}] 翻譯資料建置中,完成後重新整理頁面即生效`);
    return;
  }

  if (sig !== localSig) {
    const failed = writeLscache(translation);
    if (failed.length) {
      // ⚠ 寫不進去 = 那幾類的下拉會維持英文,而且以前**完全無聲**(只有一行
      //   console.warn,沒有人會看到)。簽章刻意不寫,下次開頁會再試一次;
      //   同時把狀態送進 storage,讓 popup 講得出「為什麼還是英文」。
      localStorage.removeItem(LSCACHE_SIG);
      const usedKB = usedLocalStorageKB();
      console.warn(
        `[PTM] localStorage 空間不足,${failed.join('、')} 未能寫入` +
          `${usedKB ? `(目前用量約 ${usedKB} KB,上限約 5120 KB)` : ''}`
      );
      chrome.storage.local.set({ [K.lscacheError]: { at: Date.now(), failed, usedKB } }).catch(() => {});
    } else {
      setPageItem(LSCACHE_SIG, sig);
      localStorage.removeItem(LOCAL_UPDATED); // 舊版鍵不再使用
      chrome.storage.local.remove(K.lscacheError).catch(() => {});
      dbg(`[PTM/${PMZ_TAG}] 已更新中文化資料`);
    }
  }

  // 快照逾時 → 觸發背景重建(SW 端有防抖,多分頁同開不會重複抓)
  if (updated && Date.now() - updated > STALE_MS) {
    chrome.runtime.sendMessage({ t: 'translation:build', game: PMZ_GAME.id }).catch(() => {});
    dbg(`[PTM/${PMZ_TAG}] 翻譯資料已逾時,背景更新中,完成後重新整理生效`);
  }
}

main().catch((err) => console.warn('[PTM] bootstrap 失敗:', err));
