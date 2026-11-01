// bg/sites.js syncSiteScripts(網站 content script 註冊對齊)單元測試。
// 執行:node --test test/sites-sync.test.mjs
// 只 mock chrome.* 外部 I/O;被測模組只 import 一次,每個測試用 reset() 重設狀態。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const POBB_ID = 'pmz-site-pobbin';
const NINJA_ID = 'pmz-site-ninja'; // 已廢止的舊 id
const POBB_ORIGIN = 'https://pobb.in/*';
const NINJA_ORIGIN = 'https://poe.ninja/*';

// 可變的 mock 狀態(由 reset 重設)
let storage = {};
let granted = new Set();
let registered = new Map();
let unregisterCalls = [];
let registerCalls = [];

function reset({ storage: s = {}, granted: g = [], registered: r = [] } = {}) {
  storage = { ...s };
  granted = new Set(g);
  registered = new Map(r.map((id) => [id, { id, matches: [], js: ['content/site-zh.js'] }]));
  unregisterCalls = [];
  registerCalls = [];
}

const noopEvent = { addListener() {}, removeListener() {}, hasListener: () => false };

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
        async set() {},
      },
      onChanged: noopEvent,
    },
    permissions: {
      async contains({ origins = [] } = {}) {
        return origins.every((o) => granted.has(o));
      },
      onAdded: noopEvent,
      onRemoved: noopEvent,
    },
    scripting: {
      async getRegisteredContentScripts(filter = {}) {
        const all = [...registered.values()];
        return filter.ids ? all.filter((s) => filter.ids.includes(s.id)) : all;
      },
      async unregisterContentScripts({ ids } = {}) {
        unregisterCalls.push({ ids: [...(ids || [])] });
        for (const id of ids || []) registered.delete(id);
      },
      async registerContentScripts(scripts) {
        registerCalls.push(scripts.map((s) => ({ ...s })));
        for (const s of scripts) registered.set(s.id, s);
      },
    },
    runtime: {
      getManifest: () => ({ version: '0.0.0' }),
      getURL: (p) => `chrome-extension://test/${p}`,
      onInstalled: noopEvent,
      onStartup: noopEvent,
      onMessage: noopEvent,
    },
  };
}

let syncSiteScripts;
before(async () => {
  installChromeMock();
  ({ syncSiteScripts } = await import('../bg/sites.js'));
});

const ZH = { siteZh: true, uiLang: 'zh', language: 'zh_tw' };
const BOTH = [POBB_ORIGIN, NINJA_ORIGIN];
const unregisteredIds = () => unregisterCalls.flatMap((c) => c.ids);
const registeredIdsInCalls = () => registerCalls.flat().map((s) => s.id);

test('T1 舊 ninja 註冊會被註銷、pobb.in 保留', async () => {
  reset({ storage: ZH, granted: BOTH, registered: [NINJA_ID, POBB_ID] });
  await syncSiteScripts();
  // 沒清舊 id 會讓已廢止的 ninja 腳本殘留在 poe.ninja
  assert.ok(unregisteredIds().includes(NINJA_ID));
  // 誤註銷 pobb.in 會讓 pobb.in 中文化消失
  assert.ok(!unregisteredIds().includes(POBB_ID));
  assert.deepEqual([...registered.keys()], [POBB_ID]);
  // 又把 ninja 註冊回去代表廢止沒生效
  assert.ok(!registeredIdsInCalls().includes(NINJA_ID));
});

test('T1b 重複對齊不再動作(冪等)', async () => {
  reset({ storage: ZH, granted: BOTH, registered: [NINJA_ID, POBB_ID] });
  await syncSiteScripts();
  await syncSiteScripts();
  unregisterCalls = [];
  registerCalls = [];
  await syncSiteScripts();
  // 非冪等會每次重複註銷或重新註冊,造成多餘 API 呼叫
  assert.deepEqual(unregisterCalls, []);
  assert.deepEqual(registerCalls, []);
});

test('T2 首次只註冊 pobb.in,不註冊 ninja', async () => {
  reset({ storage: ZH, granted: BOTH, registered: [] });
  const res = await syncSiteScripts();
  // 多註冊 ninja 或漏註冊 pobb.in 都會讓 key 不符
  assert.deepEqual([...registered.keys()], [POBB_ID]);
  const s = registered.get(POBB_ID);
  assert.deepEqual(s.matches, [POBB_ORIGIN]);
  assert.deepEqual(s.js, ['content/site-zh.js']);
  assert.deepEqual(res.active, ['pobbin']);
});

test('T3 只有 ninja 權限時不註冊任何東西', async () => {
  reset({ storage: { siteZh: true, uiLang: 'zh', language: 'zh_tw' }, granted: [NINJA_ORIGIN], registered: [] });
  const res = await syncSiteScripts();
  // 把 poe.ninja 權限當成網站中文化授權會誤註冊
  assert.deepEqual(registerCalls, []);
  assert.equal(registered.size, 0);
  assert.deepEqual(res.active, []);
});

test('T4 關閉開關後兩個腳本全部註銷', async () => {
  reset({
    storage: { siteZh: false, uiLang: 'zh', language: 'zh_tw' },
    granted: BOTH,
    registered: [NINJA_ID, POBB_ID],
  });
  await syncSiteScripts();
  // 關開關仍殘留任一腳本,代表使用者關不掉中文化
  assert.equal(registered.size, 0);
  const ids = unregisteredIds();
  assert.ok(ids.includes(NINJA_ID));
  assert.ok(ids.includes(POBB_ID));
});

test('T4b 英文介面時兩個腳本全部註銷', async () => {
  reset({
    storage: { siteZh: true, uiLang: 'en', language: 'us' },
    granted: BOTH,
    registered: [NINJA_ID, POBB_ID],
  });
  await syncSiteScripts();
  // 忽略 uiLang/language 條件會讓英文使用者仍被注入中文
  assert.equal(registered.size, 0);
});
