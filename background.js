// Service Worker 入口:只做訊息路由與 alarm 註冊,狀態一律放 chrome.storage,
// SW 隨時休眠不影響功能。(Lite 版:僅翻譯,無書籤/物價/快捷篩選)

import {
  buildTranslation,
  ensureAlarm,
  isRebuildAlarm,
  handleTranslationMessage,
} from './bg/translation.js';

chrome.runtime.onInstalled.addListener(async () => {
  const defaults = await chrome.storage.local.get('language');
  const language = defaults.language ?? 'zh_tw';
  await chrome.storage.local.set({ language });
  await ensureAlarm();
  // 安裝/更新後立即建置,使用者開啟交易頁時內建字典已就緒
  if (language === 'zh_tw') buildTranslation();
});

chrome.runtime.onStartup?.addListener(() => {
  ensureAlarm();
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!isRebuildAlarm(alarm)) return;
  const { language } = await chrome.storage.local.get('language');
  if (language === 'zh_tw') buildTranslation();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg.t !== 'string' || !msg.t.startsWith('translation:')) return false;
  const route = handleTranslationMessage(msg);
  if (!route) return false;
  route
    .then(sendResponse)
    .catch((err) => sendResponse({ ok: false, error: String(err?.message ?? err) }));
  return true; // 保持通道等待非同步回應
});
