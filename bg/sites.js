// pobb.in / poe.ninja 中文化的背景端:依開關與授權註冊 content/site-zh.js,並把名稱表放進 storage。
//
// ⚠ 兩站都走 optional_host_permissions + 動態註冊,**不寫進 manifest 的 content_scripts**:
//   manifest 裡的 matches 等同新增 host 權限,Chrome 會在擴充更新後把整個擴充停用等使用者重新授權
//   (同 poe.ninja 物價、dict 分支那兩次的理由)。
// ⚠ poe.ninja 的權限與「物價查詢」共用同一條 origin:任一邊收回權限,另一邊也跟著失效 ——
//   所以註冊一律以「開關開著 **且** 權限還在」為準,權限變動時重新同步。
//
// storage:
//   siteZh     { pobbin: bool, ninja: bool }   使用者開關(預設都關)
//   siteNames  data/sitenames.json 的 { poe1, poe2 } 兩段(天賦 / 昇華 / 職業 / 面板用詞)

import { chineseDataAllowed } from './translation.js';

export const SITES = {
  pobbin: { id: 'pmz-site-pobbin', origins: ['https://pobb.in/*'] },
  ninja: { id: 'pmz-site-ninja', origins: ['https://poe.ninja/*'] },
};
const SCRIPT_FILES = ['content/site-zh.js'];
// 名稱表格式變了就加一,舊的 storage 內容會被換掉
export const SITE_NAMES_VERSION = 1;

async function granted(site) {
  try {
    return await chrome.permissions.contains({ origins: SITES[site].origins });
  } catch (_) {
    return false;
  }
}

// 把「應該註冊的」與「已經註冊的」對齊。任何時候呼叫都安全(冪等)。
export async function syncSiteScripts() {
  if (!chrome.scripting?.registerContentScripts) return { ok: false, error: 'scripting API 不可用' };
  const { siteZh } = await chrome.storage.local.get('siteZh');
  const want = [];
  // English 介面 / 還原英文:與交易站同一道守門,一個中文字都不換(中文資料也已被清掉)
  const allowed = await chineseDataAllowed();
  for (const site of allowed ? Object.keys(SITES) : []) {
    if (siteZh?.[site] === true && (await granted(site))) want.push(site);
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
  if (want.length) await ensureSiteNames();
  return { ok: true, active: want };
}

// 名稱表很小(約 270 KB)而且是擴充內建的,不走遠端字典那套
export async function ensureSiteNames() {
  const { siteNames } = await chrome.storage.local.get('siteNames');
  if (siteNames?.v === SITE_NAMES_VERSION && siteNames.poe1 && siteNames.poe2) return { ok: true, cached: true };
  const res = await fetch(chrome.runtime.getURL('data/sitenames.json'));
  const data = await res.json();
  await chrome.storage.local.set({ siteNames: { v: SITE_NAMES_VERSION, meta: data.meta, poe1: data.poe1, poe2: data.poe2 } });
  return { ok: true, cached: false };
}

export async function handleSitesMessage(msg) {
  switch (msg.t) {
    case 'sites:sync':
      return syncSiteScripts();
    case 'sites:names':
      return ensureSiteNames();
    default:
      return null;
  }
}
