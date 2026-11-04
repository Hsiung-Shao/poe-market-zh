// bg/open-settings.js(點工具列圖示開設定)與 bg/perms.js(host 權限訊息)單元測試。
// 執行:node --test test/open-settings.test.mjs
// 只 mock chrome.* 外部 I/O;被測模組在 mock 設好後動態 import,載入失敗以斷言失敗呈現。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const TRADE = (id, extra = {}) => ({ id, windowId: 1, url: 'https://www.pathofexile.com/trade/search/Standard', active: false, lastAccessed: 0, ...extra });
const OTHER = (id, extra = {}) => ({ id, windowId: 1, url: 'https://example.com/', active: false, lastAccessed: 0, ...extra });

// 可變的 mock 狀態(由 reset 重設)
let storage = {};
let tabsList = [];
let events = []; // 依序記錄 { type, args }
let containsCalls = [];
let containsResult = false;
let requestMode = 'resolve'; // resolve / reject
let requestResult = true;
let requestCalls = [];

function reset(opts = {}) {
  storage = { ...(opts.storage || {}) };
  tabsList = opts.tabs || [];
  events = [];
  containsCalls = [];
  containsResult = opts.containsResult ?? false;
  requestMode = opts.requestMode || 'resolve';
  requestResult = opts.requestResult ?? true;
  requestCalls = [];
}

const noopEvent = { addListener() {}, removeListener() {}, hasListener: () => false };
const log = (type, ...args) => events.push({ type, args });

function installChromeMock() {
  globalThis.chrome = {
    storage: {
      local: {
        async get(keys) {
          const list = Array.isArray(keys) ? keys : typeof keys === 'string' ? [keys] : Object.keys(keys || {});
          const out = {};
          for (const k of list) if (k in storage) out[k] = storage[k];
          return out;
        },
        async set(obj) {
          log('storage.set', obj);
          Object.assign(storage, obj);
        },
      },
      onChanged: noopEvent,
    },
    tabs: {
      async query() { return tabsList; },
      async update(...a) { log('tabs.update', ...a); return {}; },
      async create(...a) { log('tabs.create', ...a); return {}; },
      onUpdated: noopEvent,
      onRemoved: noopEvent,
    },
    windows: {
      async update(...a) { log('windows.update', ...a); return {}; },
    },
    permissions: {
      async contains(arg) { containsCalls.push(arg); return containsResult; },
      async request(arg) {
        requestCalls.push(arg);
        if (requestMode === 'reject') throw new Error('may only be called from a user gesture');
        return requestResult;
      },
      onAdded: noopEvent,
      onRemoved: noopEvent,
    },
    runtime: {
      getURL: (p) => 'chrome-extension://x/' + p,
      onMessage: noopEvent,
      onInstalled: noopEvent,
    },
    action: { onClicked: noopEvent },
  };
}

let openMod = null;
let permsMod = null;
let openErr = null;
let permsErr = null;

before(async () => {
  installChromeMock();
  try { openMod = await import('../bg/open-settings.js'); } catch (e) { openErr = e; }
  try { permsMod = await import('../bg/perms.js'); } catch (e) { permsErr = e; }
});

function needOpen() {
  if (!openMod || typeof openMod.pickTradeTab !== 'function' || typeof openMod.openTradeSettings !== 'function') {
    assert.fail('bg/open-settings.js 尚未實作' + (openErr ? `(${openErr.message})` : ''));
  }
  return openMod;
}
function needPerms() {
  if (!permsMod || typeof permsMod.handlePermissionMessage !== 'function') {
    assert.fail('bg/perms.js 尚未實作' + (permsErr ? `(${permsErr.message})` : ''));
  }
  return permsMod;
}
const idx = (type) => events.findIndex((e) => e.type === type);
const count = (type) => events.filter((e) => e.type === type).length;

test('O1 有作用中交易站分頁就挑它', () => {
  const { pickTradeTab } = needOpen();
  const tabs = [
    OTHER(1, { active: true, lastAccessed: 999 }),
    TRADE(2, { active: true, lastAccessed: 10 }),
    TRADE(3, { active: false, lastAccessed: 500 }),
  ];
  // 抓:只看 lastAccessed 而忽略 active,或把非交易站 active 分頁選進來
  assert.equal(pickTradeTab(tabs).id, 2);
});

test('O1b 沒有作用中就挑最近用過的交易站分頁', () => {
  const { pickTradeTab } = needOpen();
  const tabs = [
    TRADE(2, { lastAccessed: 10 }),
    TRADE(3, { url: 'https://pathofexile.tw/trade2/search', lastAccessed: 500 }),
    OTHER(4, { lastAccessed: 9999 }),
  ];
  // 抓:取第一個而不是 lastAccessed 最大,或沒涵蓋 .tw / trade2
  assert.equal(pickTradeTab(tabs).id, 3);
});

test('O1c 沒有交易站分頁回 null', () => {
  const { pickTradeTab } = needOpen();
  // 抓:回 undefined、或把非交易站的 pathofexile.com 其他頁(如論壇)誤認為交易站
  assert.equal(pickTradeTab([OTHER(1, { active: true }), OTHER(2, { url: 'https://www.pathofexile.com/forum' })]), null);
  assert.equal(pickTradeTab([]), null);
});

test('O1d 側邊欄不會出現的 /trade 頁(未登入的 /trade?lang=…)不算交易站分頁', () => {
  const { pickTradeTab } = needOpen();
  // 抓:比對寬過 content script 的 /trade/*,切過去卻沒有側邊欄可打開設定
  assert.equal(pickTradeTab([TRADE(1, { url: 'https://www.pathofexile.com/trade?lang=en_US', active: true }), TRADE(2, { url: 'https://www.pathofexile.com/trade' })]), null);
});

test('O2 沒有交易站分頁就開新分頁到預設網址', async () => {
  const { openTradeSettings } = needOpen();
  reset({ tabs: [OTHER(1, { active: true })] });
  await openTradeSettings();
  const creates = events.filter((e) => e.type === 'tabs.create');
  // 抓:沒開分頁、開多次、預設網址錯、或對非交易站分頁誤做切換
  assert.equal(creates.length, 1);
  // 預設網址要落在 content script 的 /trade/* 內(2026-11-04 e2e 發現裸 /trade 會停在不掛側邊欄的頁)
  assert.equal(creates[0].args[0].url, 'https://www.pathofexile.com/trade/search');
  assert.equal(count('tabs.update'), 0);
});

test('O3 打開前先寫旗標(set 在 create 之前)', async () => {
  const { openTradeSettings } = needOpen();
  reset({ tabs: [] });
  await openTradeSettings();
  const setIdx = idx('storage.set');
  assert.ok(setIdx >= 0, '應呼叫 storage.local.set');
  const payload = events[setIdx].args[0];
  // 抓:旗標沒寫或型別不對(側邊欄收不到請求)
  assert.equal(payload.sidebarEnabled, true);
  assert.equal(typeof payload.openSettingsReq, 'number');
  // 抓:先開分頁後寫旗標,側邊欄載入時讀不到請求
  assert.ok(setIdx < idx('tabs.create'), 'set 應早於 tabs.create');
});

test('O3b 已有分頁時旗標也先於切換分頁寫入', async () => {
  const { openTradeSettings } = needOpen();
  reset({ tabs: [TRADE(7, { windowId: 3 })] });
  await openTradeSettings();
  const setIdx = idx('storage.set');
  assert.ok(setIdx >= 0);
  // 抓:切換分頁路徑漏寫旗標、或順序顛倒
  assert.ok(setIdx < idx('tabs.update'), 'set 應早於 tabs.update');
  assert.equal(events[setIdx].args[0].sidebarEnabled, true);
});

test('O4 台服使用者開回台服', async () => {
  const { openTradeSettings } = needOpen();
  const url = 'https://pathofexile.tw/trade/search/Standard';
  reset({ tabs: [], storage: { lastTradeUrl: url } });
  await openTradeSettings();
  // 抓:忽略 lastTradeUrl 一律開國際服
  assert.equal(events.find((e) => e.type === 'tabs.create').args[0].url, url);
});

test('O5 已有交易站分頁就切過去而不開新的', async () => {
  const { openTradeSettings } = needOpen();
  reset({ tabs: [OTHER(1), TRADE(7, { windowId: 3 })] });
  await openTradeSettings();
  const tu = events.find((e) => e.type === 'tabs.update');
  const wu = events.find((e) => e.type === 'windows.update');
  // 抓:沒切分頁 / 沒聚焦視窗(分頁在背景視窗時使用者看不到)/ 仍多開新分頁
  assert.deepEqual(tu.args, [7, { active: true }]);
  assert.deepEqual(wu.args, [3, { focused: true }]);
  assert.equal(count('tabs.create'), 0);
});

test('P1 pobb.in 授權:Chrome 直接要成功', async () => {
  const { handlePermissionMessage } = needPerms();
  reset({ requestResult: true });
  const r = await handlePermissionMessage({ t: 'perm:pobbin-ask' });
  // 抓:origin 寫錯、沒回 direct、granted 沒帶 request 結果
  assert.deepEqual(requestCalls[0], { origins: ['https://pobb.in/*'] });
  assert.deepEqual(r, { ok: true, granted: true, direct: true });
  assert.equal(count('tabs.create'), 0);
});

test('P2 pobb.in 授權:request 拋錯就開授權頁', async () => {
  const { handlePermissionMessage } = needPerms();
  reset({ requestMode: 'reject' });
  const r = await handlePermissionMessage({ t: 'perm:pobbin-ask' });
  const creates = events.filter((e) => e.type === 'tabs.create');
  // 抓:拋錯沒接住(訊息通道掛掉)、退路網址錯、direct 旗標誤報
  assert.equal(creates.length, 1);
  assert.ok(creates[0].args[0].url.endsWith('popup/popup.html?ask=pobbin'), creates[0].args[0].url);
  assert.equal(r.ok, true);
  assert.equal(r.direct, false);
});

test('P3 查 pobb.in 權限:未授權回 granted false', async () => {
  const { handlePermissionMessage } = needPerms();
  reset({ containsResult: false });
  const r = await handlePermissionMessage({ t: 'perm:pobbin' });
  // 抓:查詢的 origin 錯、或把 granted 寫死成 true
  assert.deepEqual(containsCalls[0], { origins: ['https://pobb.in/*'] });
  assert.deepEqual(r, { ok: true, granted: false });
});

test('P3b 查 poe.ninja 權限:已授權回 granted true', async () => {
  const { handlePermissionMessage } = needPerms();
  reset({ containsResult: true });
  const r = await handlePermissionMessage({ t: 'perm:ninja' });
  // 抓:ninja 誤用 pobb.in 的 origin
  assert.deepEqual(containsCalls[0], { origins: ['https://poe.ninja/*'] });
  assert.deepEqual(r, { ok: true, granted: true });
});

test('P4 ninja 授權:request 拋錯開 ask=ninja 的退路頁', async () => {
  const { handlePermissionMessage } = needPerms();
  reset({ requestMode: 'reject' });
  const r = await handlePermissionMessage({ t: 'perm:ninja-ask' });
  const creates = events.filter((e) => e.type === 'tabs.create');
  // 抓:ninja 退路網址誤用 ask=pobbin、request 的 origin 錯
  assert.deepEqual(requestCalls[0], { origins: ['https://poe.ninja/*'] });
  assert.equal(creates.length, 1);
  assert.ok(creates[0].args[0].url.endsWith('popup/popup.html?ask=ninja'), creates[0].args[0].url);
  assert.equal(r.direct, false);
});

test('P5 不認得的訊息回 null', () => {
  const { handlePermissionMessage } = needPerms();
  reset();
  // 抓:吞掉其他訊息(讓別的 handler 收不到)或回 undefined
  assert.equal(handlePermissionMessage({ t: 'perm:foo' }), null);
});
