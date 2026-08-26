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
// 0.3.x「同類詞綴合併選單」留下的鍵。功能已移除,這裡只保留清除用。
const LEGACY_GROUPING_KEYS = ['ptm-stat-groups', 'ptm-grouping-ready'];
// 翻譯快照逾時門檻:開交易頁時資料舊於此即觸發背景重建(本頁先用現有資料,
// 下次重新整理生效)。賽季開版官方 items 會加新物品,舊快照會讓新物品從官網
// 下拉消失(連英文都搜不到),不能只靠每日 alarm。
const STALE_MS = 6 * 60 * 60 * 1000;
// 「這款遊戲的交易站被實際開過」一天最多記一次,避免每次開頁都動 storage。
const SEEN_REFRESH_MS = 24 * 60 * 60 * 1000;

function writeLscache(translation) {
  for (const [kind, key] of Object.entries(LSCACHE_KEYS)) {
    const data = translation?.[kind]?.result;
    if (!data) continue;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.removeItem(`${key}-cacheexpiration`);
      const entries = data.reduce((n, g) => n + (g.entries?.length ?? g.filters?.length ?? 0), 0);
      dbg(`[PTM/${PMZ_TAG}] lscache 寫入 ${kind}:${data.length} 組 / ${entries} 條`);
    } catch (err) {
      console.warn('[PTM] lscache 寫入失敗:', key, err);
    }
  }
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
  const stored = await chrome.storage.local.get(['language', K.translation, K.updated, K.uiExtra]);
  const language = stored.language;
  const translation = stored[K.translation];
  const updated = stored[K.updated];
  const uiExtra = stored[K.uiExtra];

  // 清掉 0.3.x 合併選單留下的鍵(功能已移除)
  for (const k of LEGACY_GROUPING_KEYS) localStorage.removeItem(k);

  // 同步 UI 模式與遞補字典給 MAIN world(ui-strings.js 讀 localStorage,重新整理生效)
  // UI 字串直接替換為純中文,無雙語模式
  const mode = language === 'zh_tw' ? 'zh' : 'en';
  if (localStorage.getItem(UI_MODE_KEY) !== mode) localStorage.setItem(UI_MODE_KEY, mode);
  try {
    if (mode === 'en') localStorage.removeItem(UI_EXTRA_KEY);
    else if (uiExtra) localStorage.setItem(UI_EXTRA_KEY, JSON.stringify(uiExtra));
  } catch (err) {
    console.warn('[PTM] UI 遞補字典同步失敗:', err);
  }

  if (language !== 'zh_tw') {
    // 切回英文:清掉覆寫,讓官網重抓原文資料
    if (localStorage.getItem(LSCACHE_SIG) || localStorage.getItem(LOCAL_UPDATED)) {
      clearLscache();
      localStorage.removeItem(LSCACHE_SIG);
      localStorage.removeItem(LOCAL_UPDATED);
    }
    return;
  }

  if (!translation) {
    // 這一款尚未建置(全新安裝,或第一次開這款的交易站):觸發背景建置,
    // 完成後下次載入生效 —— 與首次安裝完全相同的體驗
    chrome.runtime.sendMessage({ t: 'translation:build', game: PMZ_GAME.id }).catch(() => {});
    dbg(`[PTM/${PMZ_TAG}] 翻譯資料建置中,完成後重新整理頁面即生效`);
    return;
  }

  const sig = lscacheSignature(updated, []);
  const localSig = localStorage.getItem(LSCACHE_SIG);
  dbg(
    `[PTM/${PMZ_TAG}] 翻譯快照:建置於 ${updated ? new Date(updated).toLocaleString() : '無'}、` +
      `本頁簽章 ${localSig ?? '無'}`
  );
  if (sig !== localSig) {
    writeLscache(translation);
    localStorage.setItem(LSCACHE_SIG, sig);
    localStorage.removeItem(LOCAL_UPDATED); // 舊版鍵不再使用
    dbg(`[PTM/${PMZ_TAG}] 已更新中文化資料`);
  }

  // 快照逾時 → 觸發背景重建(SW 端有防抖,多分頁同開不會重複抓)
  if (updated && Date.now() - updated > STALE_MS) {
    chrome.runtime.sendMessage({ t: 'translation:build', game: PMZ_GAME.id }).catch(() => {});
    dbg(`[PTM/${PMZ_TAG}] 翻譯資料已逾時,背景更新中,完成後重新整理生效`);
  }
}

main().catch((err) => console.warn('[PTM] bootstrap 失敗:', err));
