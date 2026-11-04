// bg/sites.js syncSiteScripts(網站 content script 註冊對齊)單元測試。
// 執行:node --test test/sites-sync.test.mjs
// 只 mock chrome.* 外部 I/O;被測模組只 import 一次,每個測試用 reset() 重設狀態。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

const POBB_ID = 'pmz-site-pobbin';
const NINJA_ID = 'pmz-site-ninja'; // poe.ninja 雙語顯示;受 bilingualMods 控制
const POBB_ORIGIN = 'https://pobb.in/*';
const NINJA_ORIGIN = 'https://poe.ninja/*';

// 可變的 mock 狀態(由 reset 重設)
let storage = {};
let granted = new Set();
let registered = new Map();
let unregisterCalls = [];
let registerCalls = [];
let updateCalls = [];

function reset({ storage: s = {}, granted: g = [], registered: r = [] } = {}) {
  storage = { ...s };
  granted = new Set(g);
  registered = new Map(r.map((id) => [id, { id, matches: [], js: ['content/site-zh.js'] }]));
  unregisterCalls = [];
  registerCalls = [];
  updateCalls = [];
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
      async updateContentScripts(scripts) {
        updateCalls.push(scripts.map((s) => ({ ...s })));
        for (const s of scripts) if (registered.has(s.id)) registered.set(s.id, { ...registered.get(s.id), ...s });
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
  assert.deepEqual(s.js, ['shared/bi-style.js', 'content/site-zh.js']); // 2026-11-04 起先載雙語外觀共用檔
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

const ZH_LANG = { uiLang: 'zh', language: 'zh_tw' };

test('S1 雙語開且有 ninja 權限才註冊 ninja,不連帶註冊 pobb.in', async () => {
  reset({ storage: { bilingualMods: true, ...ZH_LANG }, granted: [NINJA_ORIGIN], registered: [] });
  await syncSiteScripts();
  // 沒註冊 ninja 代表 poe.ninja 雙語顯示永遠不會啟動
  const s = registered.get(NINJA_ID);
  assert.ok(s);
  assert.deepEqual(s.matches, [NINJA_ORIGIN]);
  assert.deepEqual(s.js, ['shared/bi-style.js', 'content/site-zh.js']); // 2026-11-04 起先載雙語外觀共用檔
  // siteZh 沒開卻註冊 pobb.in,代表兩站條件綁在一起
  assert.ok(!registered.has(POBB_ID));
});

test('S2 雙語關時註銷已註冊的 ninja', async () => {
  reset({ storage: { bilingualMods: false, ...ZH_LANG }, granted: [NINJA_ORIGIN], registered: [NINJA_ID] });
  await syncSiteScripts();
  // 關掉雙語仍殘留腳本,代表使用者關不掉 poe.ninja 雙語
  assert.ok(unregisteredIds().includes(NINJA_ID));
  assert.ok(!registered.has(NINJA_ID));
});

test('S3 沒有 poe.ninja 權限時只註冊 pobb.in', async () => {
  reset({ storage: { siteZh: true, bilingualMods: true, ...ZH_LANG }, granted: [POBB_ORIGIN], registered: [] });
  await syncSiteScripts();
  // 沒檢查 ninja 權限就註冊,會在未授權的站台註冊腳本而失敗或違反權限
  assert.deepEqual([...registered.keys()], [POBB_ID]);
});

test('S4 兩站條件各自獨立:siteZh 只管 pobb.in、bilingualMods 只管 ninja', async () => {
  reset({ storage: { siteZh: true, bilingualMods: false, ...ZH_LANG }, granted: BOTH, registered: [] });
  await syncSiteScripts();
  // bilingualMods 關卻註冊了 ninja,代表 ninja 條件誤用 siteZh
  assert.deepEqual([...registered.keys()], [POBB_ID]);
  storage = { siteZh: false, bilingualMods: true, ...ZH_LANG };
  await syncSiteScripts();
  // siteZh 關卻殘留 pobb.in,或沒補註冊 ninja,代表條件互相牽連
  assert.deepEqual([...registered.keys()], [NINJA_ID]);
});

test('S5 英文介面時兩個腳本都註銷', async () => {
  reset({
    storage: { siteZh: true, bilingualMods: true, uiLang: 'en', language: 'us' },
    granted: BOTH,
    registered: [POBB_ID, NINJA_ID],
  });
  await syncSiteScripts();
  // ninja 沒套用「中文資料允許」條件,英文使用者的 poe.ninja 會被注入中文
  assert.equal(registered.size, 0);
  assert.ok(unregisteredIds().includes(POBB_ID));
  assert.ok(unregisteredIds().includes(NINJA_ID));
});

test('S6 兩個開關都開且都有權限時兩個腳本都註冊', async () => {
  reset({ storage: { siteZh: true, bilingualMods: true, ...ZH_LANG }, granted: BOTH, registered: [] });
  await syncSiteScripts();
  // 後註冊的覆蓋或漏掉任一個,都會讓一個站台沒有功能
  assert.deepEqual([...registered.keys()].sort(), [NINJA_ID, POBB_ID].sort());
});

const NEW_JS = ['shared/bi-style.js', 'content/site-zh.js'];
const updateArgs = () => updateCalls.flat();

test('S7 舊版註冊的 js 清單會被更新', async () => {
  reset({ storage: { siteZh: true, ...ZH_LANG }, granted: [POBB_ORIGIN], registered: [POBB_ID] });
  await syncSiteScripts();
  // 沒呼叫 update(或呼叫多次),舊版使用者升級後拿不到共用樣式檔
  assert.equal(updateCalls.length, 1);
  const args = updateArgs();
  assert.equal(args.length, 1);
  // 更新到錯的 id 會改到別站的腳本
  assert.equal(args[0].id, POBB_ID);
  // 清單內容或順序不對(共用檔必須在前)會讓 site-zh.js 找不到 PMZ_BISTYLE
  assert.deepEqual(args[0].js, NEW_JS);
  // 用 unregister 重註冊代替 update,會讓腳本短暫消失且多餘動作
  assert.ok(!unregisteredIds().includes(POBB_ID));
});

test('S7b 清單相同不更新', async () => {
  reset({ storage: { siteZh: true, ...ZH_LANG }, granted: [POBB_ORIGIN], registered: [POBB_ID] });
  registered.get(POBB_ID).js = [...NEW_JS];
  await syncSiteScripts();
  // 清單已相同仍呼叫 update,代表每次對齊都做多餘的 API 呼叫(非冪等)
  assert.deepEqual(updateCalls, []);
});

test('S7c 新註冊帶新清單', async () => {
  reset({ storage: { siteZh: true, ...ZH_LANG }, granted: [POBB_ORIGIN], registered: [] });
  await syncSiteScripts();
  // 新註冊仍只帶舊清單,新裝使用者會缺共用樣式檔
  const reg = registerCalls.flat().find((x) => x.id === POBB_ID);
  assert.ok(reg);
  assert.deepEqual(reg.js, NEW_JS);
});
