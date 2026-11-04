// 點工具列的擴充圖示 → 打開交易站側邊欄的 ⚙ 設定(2026-11-04 起 popup 不再有設定畫面,使用者裁定)。
// 有交易站分頁就切過去(目前視窗作用中的優先,否則最近用過的),沒有就開新分頁;
// 先寫旗標再切分頁:側邊欄被關掉的人要靠 sidebarEnabled 重新打開,openSettingsReq 讓側邊欄展開到設定。

// ⚠ 與 manifest 側邊欄的 matches 相同(/trade/*、/trade2/*):裸 /trade(未登入時的 /trade?lang=…)不掛側邊欄,
//   切過去或開到那裡都打不開設定
export const TRADE_URL_PATTERNS = [
  'https://www.pathofexile.com/trade/*',
  'https://pathofexile.com/trade/*',
  'https://www.pathofexile.com/trade2/*',
  'https://pathofexile.com/trade2/*',
  'https://pathofexile.tw/trade/*',
  'https://pathofexile.tw/trade2/*',
];
const TRADE_RE = /^https:\/\/(www\.)?pathofexile\.(com|tw)\/trade2?\//;
const DEFAULT_URL = 'https://www.pathofexile.com/trade/search';

// windowId = 目前聚焦的視窗:別的視窗剛好作用中的交易站分頁不優先(否則會把使用者拉到另一個視窗)
export function pickTradeTab(tabs, windowId) {
  const trade = (tabs ?? []).filter((t) => TRADE_RE.test(t?.url ?? ''));
  if (!trade.length) return null;
  return trade.find((t) => t.active === true && (windowId == null || t.windowId === windowId))
    ?? trade.reduce((a, b) => ((b.lastAccessed ?? 0) > (a.lastAccessed ?? 0) ? b : a));
}

export async function openTradeSettings() {
  await chrome.storage.local.set({ sidebarEnabled: true, openSettingsReq: Date.now() });
  let tabs = [];
  try { tabs = await chrome.tabs.query({ url: TRADE_URL_PATTERNS }); } catch (_) { /* 查不到就開新的 */ }
  const win = await chrome.windows.getLastFocused?.().catch(() => null);
  const tab = pickTradeTab(tabs, win?.id);
  if (tab) {
    await chrome.tabs.update(tab.id, { active: true });
    await chrome.windows.update(tab.windowId, { focused: true }).catch(() => {});
    return;
  }
  // 側邊欄記下的上一次交易站(台服 / PoE2 使用者開回自己那一站)
  const { lastTradeUrl } = await chrome.storage.local.get('lastTradeUrl');
  await chrome.tabs.create({ url: typeof lastTradeUrl === 'string' && TRADE_RE.test(lastTradeUrl) ? lastTradeUrl : DEFAULT_URL });
}
