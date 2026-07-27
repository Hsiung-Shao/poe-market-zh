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
// 0.3.x「同類詞綴合併選單」留下的鍵。功能已移除,這裡只保留清除用 ——
// 舊版可能在使用者的 localStorage 留下映射表與能力旗標。
const LEGACY_GROUPING_KEYS = ['ptm-stat-groups', 'ptm-grouping-ready'];
// 翻譯快照逾時門檻:開交易頁時資料舊於此即觸發背景重建(本頁先用現有資料,
// 下次重新整理生效)。賽季開版官方 items 會加新物品,舊快照會讓新物品從
// 官網下拉消失(連英文都搜不到),不能只靠每日 alarm。
const STALE_MS = 6 * 60 * 60 * 1000;

function writeLscache(translation) {
  for (const [kind, key] of Object.entries(LSCACHE_KEYS)) {
    const data = translation?.[kind]?.result;
    if (!data) continue;
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
  const { language, translation, updated, uiExtra } = await chrome.storage.local.get([
    'language',
    'translation',
    'updated',
    'uiExtra',
  ]);

  // 清掉 0.3.x 合併選單留下的鍵(功能已移除)
  for (const k of LEGACY_GROUPING_KEYS) localStorage.removeItem(k);

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
    }
    return;
  }

  if (!translation) {
    // 首次安裝尚未建置:觸發背景建置,完成後下次載入生效
    chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
    dbg('[PTM] 翻譯資料建置中,完成後重新整理頁面即生效');
    return;
  }

  const sig = lscacheSignature(updated, []);
  const localSig = localStorage.getItem(LSCACHE_SIG);
  dbg(
    `[PTM] 翻譯快照:建置於 ${updated ? new Date(updated).toLocaleString() : '無'}、` +
      `本頁簽章 ${localSig ?? '無'}`
  );
  if (sig !== localSig) {
    writeLscache(translation);
    localStorage.setItem(LSCACHE_SIG, sig);
    localStorage.removeItem(LOCAL_UPDATED); // 舊版鍵不再使用
    dbg('[PTM] 已更新中文化資料');
  }

  // 快照逾時 → 觸發背景重建(SW 端有 building 防抖,多分頁同開不會重複抓)
  if (updated && Date.now() - updated > STALE_MS) {
    chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
    dbg('[PTM] 翻譯資料已逾時,背景更新中,完成後重新整理生效');
  }
}

main().catch((err) => console.warn('[PTM] bootstrap 失敗:', err));
