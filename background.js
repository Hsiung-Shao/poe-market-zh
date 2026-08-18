// Service Worker 入口:只做訊息路由與 alarm 註冊,狀態一律放 chrome.storage,
// SW 隨時休眠不影響功能。

import {
  buildTranslation,
  ensureAlarm,
  isRebuildAlarm,
  handleTranslationMessage,
} from './bg/translation.js';
import { handleNinjaMessage } from './bg/ninja.js';

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = await chrome.storage.local.get('language');
  const language = defaults.language ?? 'zh_tw';
  await chrome.storage.local.set({ language });
  await ensureAlarm();
  // 安裝/更新後立即建置,使用者開啟交易頁時內建字典已就緒
  if (language === 'zh_tw') buildTranslation();
  maybeAskForNinja();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!isRebuildAlarm(alarm)) return;
  const { language } = await chrome.storage.local.get('language');
  if (language === 'zh_tw') buildTranslation();
});

// poe.ninja 是選用權限(optional_host_permissions):放進 host_permissions 會讓
// Chrome 在擴充更新後停用它、等使用者手動重新授權,不能為了一個附加功能
// 打斷所有現有使用者。content script 不能呼叫 chrome.permissions,所以由這裡代查。
const NINJA_ORIGIN = 'https://poe.ninja/*';

const NINJA_ASK_URL = 'popup/popup.html?ask=ninja';

function handlePermissionMessage(msg) {
  if (msg.t === 'perm:ninja') {
    return chrome.permissions
      .contains({ origins: [NINJA_ORIGIN] })
      .then((granted) => ({ ok: true, granted }))
      .catch(() => ({ ok: true, granted: false }));
  }
  // 開授權頁:content script 不能呼叫 permissions.request(需要擴充頁面的使用者手勢),
  // 所以側邊欄的開關是把 popup 開成分頁,讓使用者在那裡按下允許。
  if (msg.t === 'perm:ninja-ask') {
    return chrome.tabs
      .create({ url: chrome.runtime.getURL(NINJA_ASK_URL) })
      .then(() => ({ ok: true }))
      .catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
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
