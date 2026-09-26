// poe.ninja / pobb.in 中文化的背景端:依開關與授權註冊 content/site-zh.js,並在需要時抓名稱表。
//
// ⚠ 兩站都走 optional_host_permissions + 動態註冊,**不寫進 manifest 的 content_scripts**:
//   manifest 裡的 matches 等同新增 host 權限,Chrome 會在擴充更新後把整個擴充停用等使用者重新授權
//   (同 poe.ninja 物價、dict 分支那兩次的理由)。
// ⚠ poe.ninja 的權限與「物價查詢」共用同一條 origin:關掉中文化**不收回權限**(物價照常);
//   反過來權限被收回時中文化跟著失效 —— 所以註冊一律以「開關開著 **且** 權限還在」為準,權限變動時重新同步。
//
// storage:
//   siteZh     bool   使用者開關,兩站共用一顆(使用者 2026-09-26 要求合併;預設關)
//   dict:sitenames1.json / dict:sitenames2.json   名稱表(遠端字典快取,bg/dict-source.js 管)
//   siteNamesChecked { poe1, poe2 }   上次向遠端確認名稱表的時間

import { chineseDataAllowed } from './translation.js';
import { loadDict } from './dict-source.js';

export const SITES = {
  pobbin: { id: 'pmz-site-pobbin', origins: ['https://pobb.in/*'] },
  ninja: { id: 'pmz-site-ninja', origins: ['https://poe.ninja/*'] },
};
export const SITE_ORIGINS = Object.values(SITES).flatMap((s) => s.origins);
const SCRIPT_FILES = ['content/site-zh.js'];

async function granted(site) {
  try {
    return await chrome.permissions.contains({ origins: SITES[site].origins });
  } catch (_) {
    return false;
  }
}

// 把「應該註冊的」與「已經註冊的」對齊。任何時候呼叫都安全(冪等)。
// ⚠ 權限、開關、介面語言可能同時變(切 English 時語言與清資料一起來),兩次對齊並行跑會互相蓋掉
//   (實測:一次讀到「還是中文」、晚一步才註冊,結果 English 下仍掛著腳本)。一律串行,每次都讀最新狀態。
let syncChain = Promise.resolve();
export function syncSiteScripts() {
  const run = syncChain.then(syncOnce, syncOnce);
  syncChain = run.catch(() => {});
  return run;
}

async function syncOnce() {
  if (!chrome.scripting?.registerContentScripts) return { ok: false, error: 'scripting API 不可用' };
  const { siteZh } = await chrome.storage.local.get('siteZh');
  const want = [];
  // English 介面 / 還原英文:與交易站同一道守門,一個中文字都不換(中文資料也已被清掉)
  const allowed = siteZh === true && (await chineseDataAllowed());
  for (const site of allowed ? Object.keys(SITES) : []) {
    // 兩站權限是一起要的,但使用者可以在擴充管理頁只收回其中一個 → 各自看
    if (await granted(site)) want.push(site);
  }
  const existing = await chrome.scripting.getRegisteredContentScripts({ ids: Object.values(SITES).map((s) => s.id) });
  const have = new Set(existing.map((s) => s.id));
  const drop = Object.keys(SITES).filter((s) => have.has(SITES[s].id) && !want.includes(s)).map((s) => SITES[s].id);
  const add = want.filter((s) => !have.has(SITES[s].id));
  if (drop.length) await chrome.scripting.unregisterContentScripts({ ids: drop });
  if (add.length) {
    await chrome.scripting.registerContentScripts(add.map((s) => ({
      id: SITES[s].id,
      matches: SITES[s].origins,
      js: SCRIPT_FILES,
      runAt: 'document_idle',
      persistAcrossSessions: true,
    })));
  }
  return { ok: true, active: want };
}

// ── 名稱表:只有遠端(dict 分支),而且只抓網頁當下那一款 ──
// 沒開網站中文化的人一個位元組都不下載;只逛 PoE1 的人不會下載 PoE2 那份(使用者 2026-09-26 要求)。
// 走 bg/dict-source.js 的 loadDict:遠端索引比雜湊,沒變就用快取(dict:<檔名>),網頁端直接讀那份快取。
export const SITE_NAMES_FILES = { poe1: 'sitenames1.json', poe2: 'sitenames2.json' };
const CHECK_MS = 6 * 60 * 60 * 1000; // 與交易站資料同一個新鮮度門檻(content/bootstrap.js STALE_MS)

export async function ensureSiteNames(game) {
  const file = SITE_NAMES_FILES[game];
  if (!file) return { ok: false, error: `unknown game: ${game}` };
  if (!(await chineseDataAllowed())) return { ok: false, error: 'translation disabled' };
  const cacheKey = `dict:${file}`;
  const got = await chrome.storage.local.get([cacheKey, 'siteNamesChecked']);
  const checked = got.siteNamesChecked ?? {};
  if (got[cacheKey] && Date.now() - (checked[game] ?? 0) < CHECK_MS) return { ok: true, cached: true };
  await loadDict(file); // 遠端 → 快取;兩層都沒有會 throw(沒有內建版本)
  await chrome.storage.local.set({ siteNamesChecked: { ...checked, [game]: Date.now() } });
  return { ok: true, cached: false };
}

export async function handleSitesMessage(msg) {
  switch (msg.t) {
    case 'sites:sync':
      return syncSiteScripts();
    case 'sites:names':
      return ensureSiteNames(msg.game);
    default:
      return null;
  }
}
