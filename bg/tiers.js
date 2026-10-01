// 篩選列階級選單(content/tier-picker.js)的背景端:依遊戲抓詞綴階級表。
//
// 階級表 tierladders1.json / tierladders2.json 只在遠端 dict 分支(tools/gen-tier-ladders.mjs 產生,
// 兩款各約 80 KB),走 bg/dict-source.js 的 loadDict(遠端索引比雜湊 → 快取 `dict:<檔名>`),
// 交易站頁面直接讀那份快取。**只在使用者開著階級選單、而且交易站頁面開口要時才抓那一款**,
// 6 小時確認一次新鮮度(同 bg/sites.js ensureSiteNames 的模式)。
//
// ⚠ 這裡**刻意不經過 chineseDataAllowed()**:English 介面的硬性要求是「不載入任何中文資料、不與台服 API
//   比對」(verify-intl 開頭),而階級表只有官方 stat id 與數值,一個中文字都沒有、也不碰台服 ——
//   性質與 English 介面照樣要抓的國際服 stats(PoB 匯入的 statIndexEn)相同。階級選單在 English 介面
//   一樣有用,所以兩種介面都給。切到 English 時快取仍會被 clearDictCache 一併清掉(它在 DICT_STORAGE_KEYS 裡),
//   下次開交易站重抓一次,不影響「English 不留中文資料」的保證。
//
// storage:
//   dict:tierladders1.json / dict:tierladders2.json   階級表(遠端字典快取,bg/dict-source.js 管)
//   tierLaddersChecked { poe1, poe2 }                  上次向遠端確認階級表的時間

import { loadDict } from './dict-source.js';

export const TIER_LADDER_FILES = { poe1: 'tierladders1.json', poe2: 'tierladders2.json' };
const CHECK_MS = 6 * 60 * 60 * 1000; // 與交易站資料、網站名稱表同一個新鮮度門檻

// 使用者關掉階級選單(settings.tierPicker === false)就一個位元組都不抓。讀取端一律 `=== false` 才算關,
// 舊使用者沒有這個鍵 = 開(與 content/sidebar.js DEFAULT_SETTINGS 一致)。
async function pickerEnabled() {
  const { settings } = await chrome.storage.local.get('settings');
  return settings?.tierPicker !== false;
}

export async function ensureTierLadders(game) {
  const file = TIER_LADDER_FILES[game];
  if (!file) return { ok: false, error: `unknown game: ${game}` };
  if (!(await pickerEnabled())) return { ok: false, error: 'tier picker disabled' };
  const cacheKey = `dict:${file}`;
  const got = await chrome.storage.local.get([cacheKey, 'tierLaddersChecked']);
  const checked = got.tierLaddersChecked ?? {};
  if (got[cacheKey] && Date.now() - (checked[game] ?? 0) < CHECK_MS) return { ok: true, cached: true };
  try {
    // 遠端 → 快取;兩層都沒有會 throw(沒有內建版本)。
    // freshIndex:不沿用交易站建置時抓的索引(可能是舊的、還沒有階級表),見 loadDict 的說明
    await loadDict(file, { freshIndex: true });
  } catch (err) {
    if (!(await loadLocalDevLadders(file, cacheKey))) throw err;
  }
  await chrome.storage.local.set({ tierLaddersChecked: { ...checked, [game]: Date.now() } });
  return { ok: true, cached: false };
}

// ── 本機開發備援(只給「載入未封裝項目」的開發版)──
// 階級表推上 dict 分支之前,開發版也要能手動測:遠端與快取都拿不到時改讀擴充資料夾裡
// tools/gen-tier-ladders.mjs 產生的 store/dict/<檔名>(gitignored)。與 bg/sites.js 的名稱表備援同一套規則
// (那份的寫法由 verify-site-zh L18–L20 逐字鎖住,所以這裡另寫一份而不是抽共用函式)。
// ⚠ 發布包(tools/pack.mjs 的 INCLUDE)沒有 store/,這條在正式版一定 404 → 照原本丟出錯誤,行為不變。
//   商店安裝的 Chrome 版 manifest 帶 update_url,連試都不試。
const isUnpacked = () => !('update_url' in chrome.runtime.getManifest());
async function loadLocalDevLadders(file, cacheKey) {
  if (!isUnpacked()) return false;
  try {
    const res = await fetch(chrome.runtime.getURL(`store/dict/${file}`));
    if (!res.ok) return false;
    const text = await res.text();
    const json = JSON.parse(text); // 形狀不對就當沒有
    if (!json?.stats || typeof json.stats !== 'object') return false;
    await chrome.storage.local.set({ [cacheKey]: { text, size: text.length, storedAt: Date.now(), devLocal: true } });
    console.warn(`[PTM] 階級表 ${file}:遠端拿不到,開發版改用本機 store/dict/(正式版不會走這條)`);
    return true;
  } catch (_) {
    return false;
  }
}

export async function handleTiersMessage(msg) {
  switch (msg.t) {
    case 'tiers:ladders':
      return ensureTierLadders(msg.game);
    default:
      return null;
  }
}
