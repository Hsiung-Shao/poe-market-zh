// Service Worker 入口:只做訊息路由,狀態一律放 chrome.storage,
// SW 隨時休眠不影響功能。

import { buildTranslation, chineseDataAllowed, handleTranslationMessage, purgeChineseData } from './bg/translation.js';
import { handleNinjaMessage } from './bg/ninja.js';

// 要建哪幾款遊戲的資料:**依使用者實際開過的交易站決定**(使用者 2026-08-26 裁定)。
// content/bootstrap.js 每次在 /trade/ 或 /trade2/ 上跑起來就記一筆 gamesSeen[game]。
// 兩款全建會讓每次重建從 8 個端點變 16 個、chrome.storage 用量約翻倍,
// 而多數人只玩其中一款。
// ⚠ 全新安裝時 gamesSeen 是空的 —— 這時只建 PoE1,維持「裝完打開交易站就有中文」
//   的既有行為;PoE2 在第一次開 /trade2/ 時觸發建置,重新整理後生效
//   (與首次安裝完全相同的體驗,不是回歸)。
async function gamesToBuild() {
  const { gamesSeen } = await chrome.storage.local.get('gamesSeen');
  const seen = Object.keys(gamesSeen ?? {});
  return seen.length ? seen : ['poe1'];
}

chrome.runtime.onInstalled.addListener(async (details) => {
  const defaults = await chrome.storage.local.get(['language', 'uiLang']);
  // 舊版(≤ 329.5.2)的遠端字典快取鍵:translate.json 已併入 ggpk.json 的 legacyItems,
  // 這個鍵沒有任何程式會再讀,不清會永久留 400 KB 在 storage 裡
  await chrome.storage.local.remove('dict:translate.json').catch(() => {});
  // 介面語言(使用者 2026-09-21 裁定):**不自動判斷,由使用者自己選**。
  //   · 全新安裝:開語言選擇頁,選好之前不建任何資料(chineseDataAllowed 要求 uiLang === 'zh')
  //   · 舊使用者更新:沒有 uiLang → 補成 'zh',行為與以前完全相同
  if (defaults.uiLang !== 'zh' && defaults.uiLang !== 'en') {
    if (details?.reason === 'install') {
      openExtensionPage(LANG_ASK_URL);
      return; // 物價權限在語言選擇頁選完之後一起問,不另開第二個分頁
    }
    await chrome.storage.local.set({ uiLang: 'zh', language: defaults.language ?? 'zh_tw' });
  }
  // 安裝/更新後立即建置,使用者開啟交易頁時內建字典已就緒(English / 不翻時守門會擋下)
  if (await chineseDataAllowed()) for (const g of await gamesToBuild()) buildTranslation(g);
  maybeAskForNinja();
});

// 切到 English:把已經下載的中文資料清掉(使用者 2026-09-21 要求)。
// 掛在 storage 變更上而不是各個按鈕裡 —— popup 與側邊欄都能切,這裡一處保證都會清。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.uiLang) return;
  if (changes.uiLang.newValue === 'en' && changes.uiLang.oldValue !== 'en') {
    purgeChineseData().catch((err) => console.warn('[PTM] 清除中文資料失敗:', err));
  }
});

// 資料更新不再走每日 alarm(2026-09-08 使用者裁定,alarms 權限一併移除):
// content/bootstrap.js 開交易頁時看到快照逾 STALE_MS(6 小時)就送 translation:build,
// 沒開網站就不更新 —— 攔截 fetch 餵給官網的是我們的快照,所以新鮮度靠「開頁時檢查」維持。

// poe.ninja 是選用權限(optional_host_permissions):放進 host_permissions 會讓
// Chrome 在擴充更新後停用它、等使用者手動重新授權,不能為了一個附加功能
// 打斷所有現有使用者。content script 不能呼叫 chrome.permissions,所以由這裡代查。
const NINJA_ORIGIN = 'https://poe.ninja/*';

const NINJA_ASK_URL = 'popup/popup.html?ask=ninja';
// 全新安裝的語言選擇頁(同一支 popup,選完語言接著問物價權限)
const LANG_ASK_URL = 'popup/popup.html?ask=lang';

function openExtensionPage(url) {
  chrome.tabs.create({ url: chrome.runtime.getURL(url) }).catch(() => { /* 開不起來:使用者仍可從 popup 選 */ });
}

function handlePermissionMessage(msg) {
  if (msg.t === 'perm:ninja') {
    return chrome.permissions
      .contains({ origins: [NINJA_ORIGIN] })
      .then((granted) => ({ ok: true, granted }))
      .catch(() => ({ ok: true, granted: false }));
  }
  // 直接跳 Chrome 的權限對話框(使用者 2026-09-08 要求「點了就出現允許/拒絕」):
  // content script 本身不能呼叫 permissions.request,但它在**點擊當下**送來的
  // runtime.sendMessage 會把使用者手勢帶進這個 onMessage 處理器,所以這裡可以直接要。
  // ⚠ 側邊欄那端的 sendMessage 必須是點擊處理器裡的第一個非同步動作(前面不能 await),
  //   否則手勢就過期了。手勢真的沒帶到(拋「must be called during a user gesture」)才退回
  //   舊做法:把 popup 開成分頁讓使用者在那裡按。
  // ⚠ Firefox 不把 onMessage 當使用者輸入處理器,request 在這裡**一定**被拒
  //   (「may only be called from a user input handler」),所以 Firefox 永遠走下面的
  //   .catch 開授權頁 —— 這是預期行為,不是 bug,不要為了 Firefox 把 request 拿掉。
  if (msg.t === 'perm:ninja-ask') {
    return chrome.permissions
      .request({ origins: [NINJA_ORIGIN] })
      .then((granted) => ({ ok: true, granted, direct: true }))
      .catch(() =>
        chrome.tabs
          .create({ url: chrome.runtime.getURL(NINJA_ASK_URL) })
          .then(() => ({ ok: true, direct: false }))
          .catch((err) => ({ ok: false, error: String(err?.message ?? err) }))
      );
  }
  // 收回權限不需要使用者手勢,背景直接做得到
  if (msg.t === 'perm:ninja-remove') {
    return chrome.permissions
      .remove({ origins: [NINJA_ORIGIN] })
      .then((removed) => ({ ok: true, granted: !removed }))
      .catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
  }
  return null;
}

// 安裝或更新後主動問一次物價權限(只問一次,問過就不再打擾)。
// 沒有 tabs 權限也不會壞:失敗就靜靜跳過,使用者仍可從 popup 自己開。
async function maybeAskForNinja() {
  try {
    const { ninjaAsked } = await chrome.storage.local.get('ninjaAsked');
    if (ninjaAsked) return;
    if (await chrome.permissions.contains({ origins: [NINJA_ORIGIN] })) return;
    await chrome.storage.local.set({ ninjaAsked: true });
    await chrome.tabs.create({ url: chrome.runtime.getURL(NINJA_ASK_URL) });
  } catch (_) { /* 開不起來就算了,不影響翻譯 */ }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.t !== 'string') return false;
  const route = msg.t.startsWith('translation:')
    ? handleTranslationMessage(msg)
    : msg.t.startsWith('ninja:')
      ? handleNinjaMessage(msg)
      : msg.t.startsWith('perm:')
        ? handlePermissionMessage(msg)
        : null;
  if (!route) return false;
  route
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // 保持通道等待非同步回應
});
