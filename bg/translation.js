// 翻譯資料建置:同時抓美服(英文)與台服(繁中)官方 trade data API,
// 依官方 id 對接產生中文化資料。資料來自 GGG 官方公開 API,
// 另有 data/ggpk.json 離線層(解析本機 Content.ggpk 的官方遊戲資料,
// 由 tools/gen-ggpk-data.mjs 產生)作為詞綴種子與物品遞補。

const API_BASE = {
  us: 'https://www.pathofexile.com/api/trade/data/',
  tw: 'https://pathofexile.tw/api/trade/data/',
};
// 遞補層資料來源:cswzhang/Poe-trade-zh(Apache-2.0,簡體,經 s2t 轉繁)。
// 僅用於填補官方資料對不齊的缺口,官方台服資料永遠優先。
const COMMUNITY = {
  items: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/item.json',
  ui: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/interface.json',
};
const KINDS = ['items', 'stats', 'static', 'filters'];
// 不含正負號:官方模板寫作「+#%」,若把 +12 整段換成 # 會與模板 key 對不上
const NUM_RE = /\d+(?:\.\d+)?/g;
const ALARM_NAME = 'ptm-rebuild-translation';
const REBUILD_MINUTES = 24 * 60;

async function fetchKind(base, kind) {
  const res = await fetch(base + kind, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${base}${kind} => HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(base) {
  const results = await Promise.all(KINDS.map((k) => fetchKind(base, k)));
  return Object.fromEntries(KINDS.map((k, i) => [k, results[i]]));
}

// 建立 tw stats 的 id → entry 索引
function indexStatEntries(statsData) {
  const map = new Map();
  for (const group of statsData?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id) map.set(entry.id, entry);
    }
  }
  return map;
}

function bilingual(zh, en) {
  if (!zh || zh === en) return en;
  return `${zh} (${en})`;
}

// stats:依 entry.id 對接;option 型詞綴依 option.id 對接
function translateStats(usStats, twStats) {
  const out = structuredClone(usStats);
  const twIndex = indexStatEntries(twStats);
  const twGroupLabel = new Map(
    (twStats?.result ?? []).map((g) => [g.id, g.label])
  );
  for (const group of out.result ?? []) {
    const zhLabel = twGroupLabel.get(group.id);
    if (zhLabel) group.label = zhLabel;
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (!tw) continue;
      entry.text = bilingual(tw.text, entry.text);
      if (entry.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [o.id, o.text]));
        for (const opt of entry.option.options) {
          const zh = twOpts.get(opt.id);
          if (zh) opt.text = bilingual(zh, opt.text);
        }
      }
    }
  }
  return out;
}

// items:兩服為同一資料集的在地化版本,但更新進度可能不同步
// (實測 accessory 382 vs 381、monster 358 vs 544),索引對位必須先驗證:
// 筆數相等且每筆 entry 的「形狀」(是否有 name / 是否 unique)序列完全一致,
// 才視為同序;否則整分類保留英文(寧缺勿錯)。
function shapeSignature(cat) {
  return (cat.entries ?? [])
    .map((e) => `${e.name ? 'n' : '-'}${e.flags?.unique ? 'u' : '-'}`)
    .join('');
}

function alignedItemCategories(usItems, twItems) {
  const twCats = new Map((twItems?.result ?? []).map((c) => [c.id, c]));
  const pairs = [];
  for (const cat of usItems?.result ?? []) {
    const twCat = twCats.get(cat.id);
    if (!twCat) continue;
    if ((twCat.entries?.length ?? 0) !== (cat.entries?.length ?? 0)) continue;
    if (shapeSignature(cat) !== shapeSignature(twCat)) continue;
    pairs.push([cat, twCat]);
  }
  return pairs;
}

function translateItems(usItems, twItems, fallbackItems = {}) {
  const out = structuredClone(usItems);
  const aligned = new Set();
  for (const [cat, twCat] of alignedItemCategories(out, twItems)) {
    aligned.add(cat.id);
    if (twCat.label) cat.label = twCat.label;
    cat.entries.forEach((entry, i) => {
      const tw = twCat.entries[i];
      if (JSON.stringify(entry.flags ?? null) !== JSON.stringify(tw.flags ?? null)) return;
      // 注意:name/type 是送給官方 API 的查詢值,必須保持英文,只改顯示用的 text
      if (tw.text && entry.text) {
        entry.text = bilingual(tw.text, entry.text);
      } else if (!entry.text && !entry.name && entry.type && tw.type) {
        // 基底物品原本沒有 text(官網顯示 type);補上雙語 text 讓中文可搜尋,
        // 官網若不讀此欄位則無作用(實頁驗證點)
        entry.text = bilingual(tw.type, entry.type);
      }
    });
  }
  // 官方對不齊的分類 → 用遞補層補 text
  // (fallbackItems 的值已是最終顯示字串「中文 (英文)」,直接使用)
  // ⚠ 不得退用基底 type 的翻譯覆蓋 —— text 含有比 type 更多資訊的條目
  // (傳奇名、寶石品質變體前綴、地圖階級標註等)會被基底翻譯吃掉資訊,
  // 官網下拉比對 text,被吃掉的部分連英文都搜不到。只在「完整 text」或
  // 「傳奇名 name」精準命中時才翻;查無翻譯一律保留英文原文。
  // (無 text 的條目 en 即為 type,fallbackItems[en] 已涵蓋基底查表)
  for (const cat of out.result ?? []) {
    if (aligned.has(cat.id)) continue;
    for (const entry of cat.entries ?? []) {
      const en = entry.text ?? entry.type;
      if (!en) continue;
      const zh = fallbackItems[en] ?? fallbackItems[entry.name];
      if (zh) entry.text = zh;
    }
  }
  return out;
}

// 遞補字典合併,優先序低到高:社群 s2t 轉繁 < ggpk(本機遊戲檔官方繁中)
// < 內建 translate.json(繁中,值已含英文)
function mergeFallbackItems(communityItems, bundledItems, ggpkItems = {}) {
  const merged = {};
  for (const [en, zh] of Object.entries(communityItems)) merged[en] = bilingual(zh, en);
  for (const [en, zh] of Object.entries(ggpkItems)) merged[en] = bilingual(zh, en);
  for (const [en, v] of Object.entries(bundledItems)) {
    if (typeof v?.zh_tw === 'string' && v.zh_tw) merged[en] = v.zh_tw;
  }
  return merged;
}

// static(通貨等大宗交易項目):依 entry.id 對接
function translateStatic(usStatic, twStatic) {
  const out = structuredClone(usStatic);
  const twIndex = new Map();
  for (const group of twStatic?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id) twIndex.set(entry.id, entry);
    }
  }
  const twGroupLabel = new Map(
    (twStatic?.result ?? []).map((g) => [g.id, g.label])
  );
  for (const group of out.result ?? []) {
    const zhLabel = twGroupLabel.get(group.id);
    if (zhLabel) group.label = zhLabel;
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (tw?.text) entry.text = bilingual(tw.text, entry.text);
    }
  }
  return out;
}

// filters:群組與欄位依 id 對接,標題用純中文;下拉選項雙語
function translateFilters(usFilters, twFilters) {
  const out = structuredClone(usFilters);
  const twGroups = new Map((twFilters?.result ?? []).map((g) => [g.id, g]));
  for (const group of out.result ?? []) {
    const twGroup = twGroups.get(group.id);
    if (!twGroup) continue;
    if (twGroup.title) group.title = twGroup.title;
    const twFields = new Map((twGroup.filters ?? []).map((f) => [f.id, f]));
    for (const field of group.filters ?? []) {
      const tw = twFields.get(field.id);
      if (!tw) continue;
      if (tw.text) field.text = tw.text;
      if (tw.title) field.title = tw.title;
      if (field.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [String(o.id), o.text]));
        for (const opt of field.option.options) {
          const zh = twOpts.get(String(opt.id));
          if (zh && opt.text) opt.text = bilingual(zh, opt.text);
        }
      }
    }
  }
  return out;
}

// 結果頁翻譯引擎的查表:正規化英文模板(數值→#)→ 中文模板。
// # 數量不一致的項目跳過,避免回填錯位。
function buildStatMap(usStats, twStats) {
  const map = {};
  const twIndex = indexStatEntries(twStats);
  const countHash = (s) => (s.match(/#/g) ?? []).length;
  const addPair = (en, zh) => {
    if (!en || !zh || en === zh) return;
    const key = en.replace(NUM_RE, '#');
    const zhTpl = zh.replace(NUM_RE, '#');
    if (countHash(key) !== countHash(zhTpl)) return;
    if (!(key in map)) map[key] = zhTpl;
  };
  for (const group of usStats?.result ?? []) {
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (!tw) continue;
      if (entry.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [o.id, o.text]));
        for (const opt of entry.option.options) {
          const zhOpt = twOpts.get(opt.id);
          if (!zhOpt) continue;
          addPair(entry.text.replace('#', opt.text), tw.text.replace('#', zhOpt));
        }
      } else {
        addPair(entry.text, tw.text);
      }
    }
  }
  return map;
}

// ── 內建資料檔(源自 POE Trade zh,使用者指示直接沿用;README 致謝)──
// translate.json:物品名 4,636 條,值已是「中文 (英文)」格式
// translate.zh_TW.json:官網 UI 字串 1,760 條(繁中)
// clusterJewel.json / passivesNotable.json:結果頁天賦卡名稱+描述
async function loadBundled(file) {
  const res = await fetch(chrome.runtime.getURL(`data/${file}`));
  const text = await res.text();
  return JSON.parse(text.replace(/^﻿/, '')); // 部分檔案含 BOM
}

// ── ggpk 離線層:解析本機 Content.ggpk 取得的官方繁中(GGG 遊戲資料)──
// 由 tools/gen-ggpk-data.mjs 產生 data/ggpk.json;檔案不存在(尚未產生)
// 時回空集合,完全不影響建置流程
async function loadGgpk() {
  try {
    const g = await loadBundled('ggpk.json');
    return { statMap: g?.statMap ?? {}, items: g?.items ?? {} };
  } catch (_) {
    return { statMap: {}, items: {} };
  }
}

// ── 遞補層:社群資料下載與簡→繁轉換 ──
async function loadS2tMap() {
  return loadBundled('s2t.json');
}

function makeS2t(charMap) {
  return (s) => {
    let out = '';
    for (const ch of String(s)) out += charMap[ch] ?? ch;
    return out;
  };
}

// 失敗容忍:遞補層抓不到就回空物件,只影響補洞範圍
async function fetchCommunityDict(url, s2t) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return {};
    const raw = await res.json();
    const out = {};
    for (const [en, zh] of Object.entries(raw)) {
      // 濾掉非物品/字串類雜項 key(如純數字)
      if (typeof zh !== 'string' || !/[A-Za-z]/.test(en)) continue;
      out[en] = s2t(zh);
    }
    return out;
  } catch (_) {
    return {};
  }
}

// 結果頁物品名/基底翻譯查表:英文 → 中文
function buildItemMap(usItems, twItems, fallbackItems = {}) {
  const map = {};
  for (const [en, zh] of Object.entries(fallbackItems)) map[en] = zh;
  // 官方對齊資料後寫,覆蓋遞補層(台服官方用語優先)
  for (const [cat, twCat] of alignedItemCategories(usItems, twItems)) {
    cat.entries.forEach((entry, i) => {
      const tw = twCat.entries[i];
      if (JSON.stringify(entry.flags ?? null) !== JSON.stringify(tw.flags ?? null)) return;
      // 官方資料直接覆寫(含遞補層先前寫入的值)
      if (entry.name && tw.name && entry.name !== tw.name) map[entry.name] = tw.name;
      if (entry.type && tw.type && entry.type !== tw.type) map[entry.type] = tw.type;
    });
  }
  return map;
}

// 供離線測試腳本驗證對照邏輯用,執行期不使用
export const _test = {
  translateStats,
  translateItems,
  translateStatic,
  translateFilters,
  buildStatMap,
  buildItemMap,
  makeS2t,
  fetchCommunityDict,
  mergeFallbackItems,
  COMMUNITY,
};

let building = null;

// 兩階段建置:
// 第一階段「內建字典」不需網路、必定成功 —— UI 字串、物品名、天賦卡立即可用;
// 第二階段「官方 API + 社群遞補」best-effort —— 提供詞綴/篩選器 lscache 資料與
// 台服官方用語強化,失敗只降級不影響第一階段成果。
export async function buildTranslation() {
  if (building) return building;
  building = (async () => {
    try {
      // ── 第一階段:內建字典(源自 POE Trade zh)──
      await chrome.storage.local.set({
        buildStatus: { state: 'building', msg: '載入內建字典…', at: Date.now() },
      });
      const [bundledItems, bundledUI, clusterJewel, passivesNotable, ggpk] = await Promise.all([
        loadBundled('translate.json'),
        loadBundled('translate.zh_TW.json'),
        loadBundled('clusterJewel.json'),
        loadBundled('passivesNotable.json'),
        loadGgpk(),
      ]);
      const itemMapBundled = {};
      for (const [en, v] of Object.entries(bundledItems)) {
        if (typeof v?.zh_tw === 'string' && v.zh_tw) itemMapBundled[en] = v.zh_tw;
      }
      // 只在資料不存在時寫入(首次啟動);重建時不可用純內建版本
      // 降級掉上一輪第二階段已成功的完整資料
      const existing = await chrome.storage.local.get(['itemMap', 'uiExtra', 'statMap', 'updated']);
      const stageOne = {
        passives: { clusterJewel, passivesNotable },
        buildStatus: {
          state: 'building',
          msg: `內建字典已載入(物品 ${Object.keys(itemMapBundled).length}、UI ${Object.keys(bundledUI).length}),更新官方資料中…`,
          at: Date.now(),
        },
      };
      if (!existing.itemMap) stageOne.itemMap = itemMapBundled;
      if (!existing.uiExtra) stageOne.uiExtra = bundledUI;
      // ggpk 詞綴種子:讓詞綴翻譯離線即可用;第二階段成功時被官方值覆蓋
      if (!existing.statMap && Object.keys(ggpk.statMap).length) {
        stageOne.statMap = ggpk.statMap;
      }
      if (!existing.updated) stageOne.updated = Date.now();
      await chrome.storage.local.set(stageOne);

      // ── 第二階段:官方 API + 社群遞補(失敗不影響內建字典)──
      // 分項容錯:美服(英文基準)必須成功,否則整段降級;台服/社群個別失敗
      // 只影響中文覆蓋率 —— 新賽季物品仍以最新美服資料入庫(英文可搜),
      // 不因台服尚未更新而整批沿用舊快照(否則新物品從官網下拉消失)。
      try {
        const s2t = makeS2t(await loadS2tMap());
        console.info('[PTM] build:抓取官方雙服 API 與社群字典…');
        const [usRes, twRes, commItemsRes, commUiRes] = await Promise.allSettled([
          fetchAll(API_BASE.us),
          fetchAll(API_BASE.tw),
          fetchCommunityDict(COMMUNITY.items, s2t),
          fetchCommunityDict(COMMUNITY.ui, s2t),
        ]);
        if (usRes.status === 'rejected') throw usRes.reason; // 英文基準拿不到才算失敗
        const us = usRes.value;
        const tw = twRes.status === 'fulfilled' ? twRes.value : null;
        const communityItems = commItemsRes.status === 'fulfilled' ? commItemsRes.value : {};
        const communityUI = commUiRes.status === 'fulfilled' ? commUiRes.value : {};
        const degraded = [];
        if (!tw) degraded.push(`台服 API(${String(twRes.reason?.message ?? twRes.reason)})`);
        if (commItemsRes.status === 'rejected') degraded.push('社群物品字典');
        if (commUiRes.status === 'rejected') degraded.push('社群 UI 字典');
        if (degraded.length) console.warn('[PTM] build:部分來源失敗,以遞補字典補中文:', degraded.join('、'));

        const fallbackItems = mergeFallbackItems(communityItems, bundledItems, ggpk.items);
        const translation = {
          items: translateItems(us.items, tw?.items, fallbackItems),
          stats: translateStats(us.stats, tw?.stats),
          static: translateStatic(us.static, tw?.static),
          filters: translateFilters(us.filters, tw?.filters),
        };
        // ggpk 種子墊底,官方 trade API 值(台服現行用語)同 key 覆蓋
        const statMap = { ...ggpk.statMap, ...buildStatMap(us.stats, tw?.stats) };
        const itemMap = buildItemMap(us.items, tw?.items, fallbackItems);
        const updated = Date.now();
        const doneMsg =
          `完成:詞綴 ${Object.keys(statMap).length} 條、物品 ${Object.keys(itemMap).length} 條、UI ${Object.keys(bundledUI).length} 條` +
          (degraded.length ? `(部分來源失敗:${degraded.join('、')})` : '');
        await chrome.storage.local.set({
          translation,
          statMap,
          itemMap,
          uiExtra: { ...communityUI, ...bundledUI }, // 內建繁中字典優先
          updated,
          buildStatus: { state: 'done', msg: doneMsg, at: updated },
        });
        console.info('[PTM] build:', doneMsg);
        return { ok: true, updated, degraded: degraded.length ? degraded : undefined };
      } catch (apiErr) {
        // 如實揭露降級範圍:曾成功建置過 → 沿用舊官方資料;從未成功 → 詞綴暫不可用
        const { translation: prevTranslation } = await chrome.storage.local.get('translation');
        const scope = prevTranslation
          ? '沿用上次成功的官方資料'
          : Object.keys(ggpk.statMap).length
            ? '詞綴改用本機遊戲檔字典,篩選器翻譯暫不可用(內建字典的物品/UI/天賦卡翻譯不受影響)'
            : '詞綴與篩選器翻譯暫不可用(內建字典的物品/UI/天賦卡翻譯不受影響)';
        const failMsg = `官方資料更新失敗,${scope}:${String(apiErr?.message ?? apiErr)}`;
        console.warn('[PTM] build:', failMsg);
        await chrome.storage.local.set({
          buildStatus: { state: 'done', msg: failMsg, at: Date.now() },
        });
        return { ok: true, partial: true };
      }
    } catch (err) {
      await chrome.storage.local.set({
        buildStatus: { state: 'error', msg: String(err?.message ?? err), at: Date.now() },
      });
      return { ok: false, error: String(err?.message ?? err) };
    } finally {
      building = null;
    }
  })();
  return building;
}

export async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: REBUILD_MINUTES });
  }
}

export function isRebuildAlarm(alarm) {
  return alarm?.name === ALARM_NAME;
}

export async function handleTranslationMessage(msg) {
  switch (msg.t) {
    case 'translation:build':
      return buildTranslation();
    case 'translation:status': {
      const { buildStatus, updated } = await chrome.storage.local.get(['buildStatus', 'updated']);
      return { buildStatus: buildStatus ?? null, updated: updated ?? null };
    }
    case 'translation:clear':
      await chrome.storage.local.remove([
        'translation', 'statMap', 'itemMap', 'uiExtra', 'passives', 'updated', 'buildStatus',
      ]);
      return { ok: true };
    default:
      return null;
  }
}
