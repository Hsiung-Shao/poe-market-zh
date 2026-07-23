// document_start(isolated):把 background 建好的翻譯資料覆寫進官網的
// lscache 快取(官網以 lscache 快取 trade data API 回應,直接以其內容渲染
// 下拉選單與篩選器),並同步 UI 模式給 MAIN world 的 ui-strings.js。

const LSCACHE_KEYS = {
  items: 'lscache-tradeitems',
  stats: 'lscache-tradestats',
  static: 'lscache-tradedata',
  filters: 'lscache-tradefilters',
};
const LOCAL_UPDATED = 'ptm-local-updated';
const UI_MODE_KEY = 'ptm-ui-mode';
const UI_EXTRA_KEY = 'ptm-ui-extra';

function writeLscache(translation) {
  for (const [kind, key] of Object.entries(LSCACHE_KEYS)) {
    const data = translation?.[kind]?.result;
    if (!data) continue;
    try {
      localStorage.setItem(key, JSON.stringify(data));
      localStorage.removeItem(`${key}-cacheexpiration`);
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

async function main() {
  const { language, translation, updated, uiExtra } = await chrome.storage.local.get([
    'language',
    'translation',
    'updated',
    'uiExtra',
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
    if (localStorage.getItem(LOCAL_UPDATED)) {
      clearLscache();
      localStorage.removeItem(LOCAL_UPDATED);
    }
    return;
  }

  if (!translation) {
    // 首次安裝尚未建置:觸發背景建置,完成後下次載入生效
    chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
    console.info('[PTM] 翻譯資料建置中,完成後重新整理頁面即生效');
    return;
  }

  const localUpdated = Number(localStorage.getItem(LOCAL_UPDATED) ?? 0);
  if ((updated ?? 0) > localUpdated) {
    writeLscache(translation);
    localStorage.setItem(LOCAL_UPDATED, String(updated));
    console.info('[PTM] 已更新中文化資料');
  }
}

main().catch((err) => console.warn('[PTM] bootstrap 失敗:', err));
