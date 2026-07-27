// document_start(isolated):把 background 建好的翻譯資料覆寫進官網的
// lscache 快取(官網以 lscache 快取 trade data API 回應,直接以其內容渲染
// 下拉選單與篩選器),並同步 UI 模式給 MAIN world 的 ui-strings.js。

// 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
const dbg = (...a) => console.info(...a);

const LSCACHE_KEYS = {
  items: 'lscache-tradeitems',
  stats: 'lscache-tradestats',
  static: 'lscache-tradedata',
  filters: 'lscache-tradefilters',
};
const LOCAL_UPDATED = 'ptm-local-updated'; // 舊版鍵,只保留清除用
// lscache 覆寫的內容簽章。只比 updated 時間戳不夠:使用者在 popup 切換設定
// 時 updated 不變,lscache 就不會重寫,造成「已寫入的資料」與「現行設定」
// 不同步。簽章納入擴充 id,順便讓完整版與純翻譯版並存時不互相搶鍵。
const LSCACHE_SIG = 'ptm-lscache-sig';
const UI_MODE_KEY = 'ptm-ui-mode';
const UI_EXTRA_KEY = 'ptm-ui-extra';
// 兩層下拉:映射表交給 MAIN world 的 stat-group.js 用來把偽 id 還原成官方查詢。
// READY 是能力探測結果 —— stat-group.js 若發現自己掛不上官網元件會寫 '0',
// 下次載入就不寫偽父條目,使用者看到的是原生平鋪清單而不是會壞的選項。
const STAT_GROUPS_KEY = 'ptm-stat-groups';
const GROUPING_READY_KEY = 'ptm-grouping-ready';
const PSEUDO_ID_MARK = 'ptm_g_';
// 翻譯快照逾時門檻:開交易頁時資料舊於此即觸發背景重建(本頁先用現有資料,
// 下次重新整理生效)。賽季開版官方 items 會加新物品,舊快照會讓新物品從
// 官網下拉消失(連英文都搜不到),不能只靠每日 alarm。
const STALE_MS = 6 * 60 * 60 * 1000;

// 兩層下拉停用時剝除偽父條目。只移除我們加的那幾筆,原始條目完全不動 ——
// 官網要靠真實 id 反查才能渲染既有搜尋,原始條目一旦缺席篩選面板會掛掉。
function stripPseudoEntries(statsResult) {
  return statsResult.map((group) => ({
    ...group,
    entries: (group.entries ?? []).filter((e) => !String(e.id ?? '').includes(PSEUDO_ID_MARK)),
  }));
}

function writeLscache(translation, { grouping }) {
  for (const [kind, key] of Object.entries(LSCACHE_KEYS)) {
    let data = translation?.[kind]?.result;
    if (!data) continue;
    if (kind === 'stats' && !grouping) data = stripPseudoEntries(data);
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.removeItem(`${key}-cacheexpiration`);
      const entries = data.reduce((n, g) => n + (g.entries?.length ?? g.filters?.length ?? 0), 0);
      dbg(`[PTM] lscache 寫入 ${kind}:${data.length} 組 / ${entries} 條`);
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

// 簽章:任一項變動都必須重寫 lscache。parts 收設定類的值(會影響寫入內容)
function lscacheSignature(updated, parts) {
  return [updated ?? 0, chrome.runtime.id, ...parts].join('|');
}

async function main() {
  const { language, translation, updated, uiExtra, statGroups, statGrouping } =
    await chrome.storage.local.get([
      'language',
      'translation',
      'updated',
      'uiExtra',
      'statGroups',
      'statGrouping',
    ]);

  // 同步 UI 模式與遞補字典給 MAIN world(ui-strings.js 讀 localStorage,重新整理生效)
  // UI 字串直接替換為純中文,無雙語模式
  const mode = language === 'zh_tw' ? 'zh' : 'en';
  if (localStorage.getItem(UI_MODE_KEY) !== mode) {
    localStorage.setItem(UI_MODE_KEY, mode);
  }
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
      localStorage.removeItem(STAT_GROUPS_KEY);
    }
    return;
  }

  if (!translation) {
    // 首次安裝尚未建置:觸發背景建置,完成後下次載入生效
    chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
    dbg('[PTM] 翻譯資料建置中,完成後重新整理頁面即生效');
    return;
  }

  // 兩層下拉:**預設關閉**。
  // 0.3.1 實測發現還原機制不可靠 —— 掛在 stat-filter-group.updateFilter 上,
  // 但使用者從 option 子選單選值時官網並未走這個方法,偽 id 因此原封送到官方
  // 後端,搜尋直接失敗(Unknown stat provided: …ptm_g_…)。在找到能保證還原的
  // 掛點之前,只有明確開啟的人才會拿到合併選單。
  const grouping = statGrouping === true && !!statGroups?.mapping;
  try {
    if (grouping) {
      localStorage.setItem(STAT_GROUPS_KEY, JSON.stringify(statGroups.mapping));
      const opts = Object.values(statGroups.mapping).reduce((n, t) => n + Object.keys(t).length, 0);
      dbg(`[PTM] 合併選單:${Object.keys(statGroups.mapping).length} 組 / ${opts} 個子選項,映射表已同步`);
    } else {
      localStorage.removeItem(STAT_GROUPS_KEY);
      dbg('[PTM] 合併選單:停用(' +
        (statGrouping === false ? '設定已關閉' : '尚無分組資料,需在 popup 重建翻譯') + ')');
    }
  } catch (err) {
    console.warn('[PTM] 合併選單映射表同步失敗:', err);
  }

  const sig = lscacheSignature(updated, [grouping ? 'g1' : 'g0']);
  const localSig = localStorage.getItem(LSCACHE_SIG);
  dbg(
    `[PTM] 翻譯快照:建置於 ${updated ? new Date(updated).toLocaleString() : '無'}、` +
      `本頁簽章 ${localSig ?? '無'}、合併選單 ${grouping ? '啟用' : '停用'}`
  );
  if (sig !== localSig) {
    writeLscache(translation, { grouping });
    localStorage.setItem(LSCACHE_SIG, sig);
    localStorage.removeItem(LOCAL_UPDATED); // 舊版鍵不再使用
    localStorage.removeItem(GROUPING_READY_KEY); // 舊版鍵,診斷用,不再影響行為
    dbg('[PTM] 已更新中文化資料');
  }

  // 快照逾時 → 觸發背景重建(SW 端有 building 防抖,多分頁同開不會重複抓)
  if (updated && Date.now() - updated > STALE_MS) {
    chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
    dbg('[PTM] 翻譯資料已逾時,背景更新中,完成後重新整理生效');
  }
}

main().catch((err) => console.warn('[PTM] bootstrap 失敗:', err));
