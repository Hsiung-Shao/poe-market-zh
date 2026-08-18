// poe.ninja 匯率代理:content script 受 CORS 限制,由 background 代抓。
// 注意:poe.ninja 舊版 /api/data/currencyoverview 已於 2026 下線(404),
// 改用新版 exchange API;lines[].primaryValue 即「1 單位 = N chaos」。
// 結果快取於 storage.session(TTL 15 分鐘),msg.force 可略過快取。

const TTL_MS = 15 * 60 * 1000;
// exchange API 一次只回一個 type(type=All 為空),逐類抓後合併;
// 實測有資料的類別(2026-07):其餘(Catalyst/Incubator/Rune)為空
const EXCHANGE_TYPES = [
  'Currency', 'Fragment', 'Scarab', 'Oil', 'Essence', 'Fossil',
  'Resonator', 'DeliriumOrb', 'Tattoo', 'Omen', 'Runegraft',
];
const NINJA_URL = (league, type) =>
  `https://poe.ninja/poe1/api/economy/exchange/current/overview?league=${encodeURIComponent(league)}&type=${type}`;
// 寶石類不在 exchange API(實測回 0 筆),poe.ninja 網站實際走 stash item overview 端點;
// lines[] 直接含完整 icon 網址與 chaosValue,無 items[] 副表
const ITEM_TYPES = ['SkillGem', 'ImbuedGem'];
const ITEM_URL = (league, type) =>
  `https://poe.ninja/poe1/api/economy/stash/current/item/overview?league=${encodeURIComponent(league)}&type=${type}`;
// 站方追蹤中的聯盟清單;economyLeagues[0] 即 poe.ninja 預設的最新賽季聯盟
const INDEX_STATE_URL = 'https://poe.ninja/poe1/api/data/index-state';
// 不以 ninja: 開頭,避免被 cacheEconomy 的跨聯盟清理誤刪
const LEAGUES_CACHE_KEY = 'ninjaLeagues';
const LEAGUES_TTL_MS = 6 * 60 * 60 * 1000; // 聯盟清單極少變動,快取 6 小時

async function fetchType(league, type) {
  const res = await fetch(NINJA_URL(league, type), { credentials: 'omit' });
  if (!res.ok) throw new Error(`poe.ninja ${type} HTTP ${res.status}`);
  return res.json();
}

async function fetchItemType(league, type) {
  const res = await fetch(ITEM_URL(league, type), { credentials: 'omit' });
  if (!res.ok) throw new Error(`poe.ninja ${type} HTTP ${res.status}`);
  return res.json();
}

// poe.ninja 站方預設隱藏低信心樣本(實測邊界:count 5 顯示、count 1-3 隱藏);
// 不過濾的話排行頂端全是 1-3 筆掛單的哄抬價(如 Lv1 寶石標 436 div)
const LOW_CONFIDENCE_MIN_COUNT = 5;

// index-state → {leagues, latest};無資料回 null
function parseIndexState(data) {
  const leagues = (data?.economyLeagues ?? []).map((l) => l?.name).filter(Boolean);
  return leagues.length ? { leagues, latest: leagues[0] } : null;
}

// 變體標示轉人話:SkillGem 依 gemLevel/gemQuality/corrupted 組「L5/Q20 腐」,
// ImbuedGem 的 variant 為灌注名照用;缺結構欄位時退回原始 variant 字串
function gemVariantLabel(type, line) {
  if (type !== 'SkillGem' || typeof line.gemLevel !== 'number') return line.variant ?? null;
  const quality = typeof line.gemQuality === 'number' ? `/Q${line.gemQuality}` : '';
  return `L${line.gemLevel}${quality}${line.corrupted ? ' 腐' : ''}`;
}

// stash item overview lines → 物價清單項目(只進 list 不進 rates:寶石不是通貨);
// div 直接沿用站方 divineValue(顯示與 poe.ninja 一致,不自行換算);
// count 供 UI 標示中信心(5-9)警示;依價值降冪排序
function mapItemLines(type, data) {
  const out = [];
  for (const line of data?.lines ?? []) {
    if (!line?.name || typeof line.chaosValue !== 'number' || line.chaosValue <= 0) continue;
    if (!(line.count >= LOW_CONFIDENCE_MIN_COUNT)) continue; // 低信心(含缺 count)不收
    out.push({
      name: line.name,
      image: line.icon ?? null,
      category: type,
      value: line.chaosValue,
      div: typeof line.divineValue === 'number' ? line.divineValue : null,
      count: line.count,
      variant: gemVariantLabel(type, line),
    });
  }
  out.sort((a, b) => b.value - a.value);
  return out;
}

async function fetchEconomy(league) {
  // 單類失敗不拖垮整體(部分聯盟可能缺某類)
  const [results, itemResults] = await Promise.all([
    Promise.allSettled(EXCHANGE_TYPES.map((t) => fetchType(league, t))),
    Promise.allSettled(ITEM_TYPES.map((t) => fetchItemType(league, t))),
  ]);
  const rates = { 'Chaos Orb': 1 };
  const list = [];
  const seen = new Set();
  let anyOk = false;
  for (const r of results) {
    if (r.status !== 'fulfilled') continue;
    anyOk = true;
    const data = r.value;
    const itemById = new Map((data?.items ?? []).map((i) => [i.id, i]));
    for (const line of data?.lines ?? []) {
      const item = itemById.get(line.id);
      if (!item?.name || typeof line.primaryValue !== 'number' || line.primaryValue <= 0) continue;
      if (seen.has(line.id)) continue; // 跨類別去重(依 API 內部 id)
      seen.add(line.id);
      rates[item.name] = line.primaryValue;
      list.push({
        name: item.name,
        image: item.image ? `https://web.poecdn.com${item.image}` : null,
        category: item.category ?? null,
        value: line.primaryValue,
      });
    }
  }
  if (!anyOk) throw new Error('poe.ninja 全部類別抓取失敗');
  list.sort((a, b) => b.value - a.value);
  // 寶石類附加在通貨清單之後:分類抽屜順序不變,「技能寶石/灌注寶石」排最後
  ITEM_TYPES.forEach((type, i) => {
    const r = itemResults[i];
    if (r.status === 'fulfilled') list.push(...mapItemLines(type, r.value));
  });
  return { rates, list };
}

// 寶石項目的圖示網址很長(約佔清單 2/3 體積),配額不足時優先犧牲
function stripGemImages(list) {
  return list.map((i) =>
    ITEM_TYPES.includes(i.category) && i.image ? { ...i, image: null } : i,
  );
}

// 快取寫入 best-effort:session 配額按記憶體估算計(遠大於 JSON 長度),
// 寶石清單加入後可能不足 —— 降級順序:完整 → 寶石去圖示 → 不快取。
// 寫入失敗一律不影響資料回傳(先前把 set 和 fetch 包同一個 try,
// 配額爆掉時資料明明抓到了 UI 卻顯示讀取失敗)。
async function cacheEconomy(cacheKey, rates, list) {
  try {
    // 只保留當前聯盟,避免多聯盟快取堆積爆配額
    const keys = chrome.storage.session.getKeys
      ? await chrome.storage.session.getKeys()
      : Object.keys(await chrome.storage.session.get(null));
    const stale = keys.filter((k) => k.startsWith('ninja:') && k !== cacheKey);
    if (stale.length) await chrome.storage.session.remove(stale);
  } catch (_) { /* 清舊快取失敗不影響後續寫入嘗試 */ }
  for (const l of [list, stripGemImages(list)]) {
    try {
      await chrome.storage.session.set({ [cacheKey]: { rates, list: l, at: Date.now() } });
      return;
    } catch (_) { /* 配額不足,降一級再試 */ }
  }
  console.warn('[PTM] poe.ninja 快取寫入失敗(session 配額不足),本次結果不快取');
}

// 聯盟清單查詢(供設定分頁選單與「最新聯盟」預設值使用)
async function handleLeaguesMessage() {
  try {
    const cached = (await chrome.storage.session.get(LEAGUES_CACHE_KEY))[LEAGUES_CACHE_KEY];
    if (cached?.leagues && Date.now() - cached.at < LEAGUES_TTL_MS) {
      return { ok: true, leagues: cached.leagues, latest: cached.latest, cached: true };
    }
    const res = await fetch(INDEX_STATE_URL, { credentials: 'omit' });
    if (!res.ok) throw new Error(`poe.ninja index-state HTTP ${res.status}`);
    const parsed = parseIndexState(await res.json());
    if (!parsed) throw new Error('poe.ninja index-state 無聯盟資料');
    try {
      await chrome.storage.session.set({ [LEAGUES_CACHE_KEY]: { ...parsed, at: Date.now() } });
    } catch (_) { /* 快取失敗不影響回傳 */ }
    return { ok: true, ...parsed, cached: false };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

export async function handleNinjaMessage(msg) {
  if (msg.t === 'ninja:leagues') return handleLeaguesMessage();
  if (msg.t !== 'ninja:rates' || !msg.league) return null;
  const cacheKey = `ninja:${msg.league}`;
  try {
    if (!msg.force) {
      const cached = (await chrome.storage.session.get(cacheKey))[cacheKey];
      if (cached?.list && Date.now() - cached.at < TTL_MS) {
        return { ok: true, rates: cached.rates, list: cached.list, cached: true };
      }
    }
    const { rates, list } = await fetchEconomy(msg.league);
    await cacheEconomy(cacheKey, rates, list);
    return { ok: true, rates, list, cached: false };
  } catch (err) {
    return { ok: false, error: String(err?.message ?? err) };
  }
}

// 供離線測試腳本驗證用,執行期不使用
export const _test = { fetchEconomy, NINJA_URL, ITEM_URL, mapItemLines, stripGemImages, parseIndexState, gemVariantLabel };
