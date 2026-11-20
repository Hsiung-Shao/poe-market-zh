// 阿茲瓦特史記結果卡的房間清單中文化(content/results.js 的 roomText)。
// 執行:node --test test/incursion-rooms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../content/results.js', import.meta.url)), 'utf-8');

// 只取純函式:最小沙箱,頁面上沒有結果容器
async function load() {
  const noop = () => {};
  const store = { language: 'zh_tw', uiLang: 'zh', updated: 1, itemMap: {}, uniqueMap: {} };
  const sandbox = {
    location: { pathname: '/trade/search/Standard', hostname: 'www.pathofexile.com' },
    console: { info: noop, warn: noop, log: noop },
    setTimeout, clearTimeout,
    MutationObserver: class { observe() {} disconnect() {} },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4 },
    Node: { TEXT_NODE: 3 },
    document: { querySelector: () => null, body: {}, documentElement: { style: { setProperty: noop } } },
    chrome: {
      storage: {
        local: { get: async (keys) => Object.fromEntries([keys].flat().filter((k) => k in store).map((k) => [k, store[k]])) },
        onChanged: { addListener: noop },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.runInNewContext(SRC, sandbox, { filename: 'content/results.js' });
  await new Promise((r) => setTimeout(r, 30));
  const fn = sandbox.__ptmInternals?.roomText;
  assert.equal(typeof fn, 'function', 'content/results.js 未匯出 roomText');
  return fn;
}

test('R1 帶階級的房間翻成中文名加階級', async () => {
  const roomText = await load();
  assert.equal(roomText("Doryani's Institute (Tier 3)"), '多里亞尼之院 (階級 3)');
  assert.equal(roomText('Poison Garden (Tier 1)'), '監獄花園 (階級 1)');
});

test('R2 沒有階級的房間只翻名稱', async () => {
  const roomText = await load();
  assert.equal(roomText('Apex of Atzoatl'), '阿茲瓦特之巔');
  assert.equal(roomText('Passageways'), '神殿通道');
});

test('R3 3.30 新房間有譯名', async () => {
  const roomText = await load();
  assert.equal(roomText('Cradle of Creation (Tier 3)'), '創造之搖籃 (階級 3)');
  assert.equal(roomText('Royal Forge (Tier 2)'), '皇家熔爐 (階級 2)');
});

test('R4 兩個段落標題翻成遊戲內用字', async () => {
  const roomText = await load();
  assert.equal(roomText('Open Rooms:'), '開啟房間：');
  assert.equal(roomText('Obstructed Rooms:'), '受阻的房間：');
});

test('R5 不是房間的屬性行回 null', async () => {
  const roomText = await load();
  assert.equal(roomText('Experience: 1/70'), null);
  assert.equal(roomText('Unknown Room (Tier 2)'), null);
  assert.equal(roomText(''), null);
});
