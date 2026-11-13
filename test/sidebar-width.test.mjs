// content/bookmarks-model.js 的 sidebarWidth(側邊欄寬度換算)單元測試。
// 執行:node --test test/sidebar-width.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../content/bookmarks-model.js');

// 尚未匯出時回 undefined,讓失敗以斷言呈現而非 TypeError
const sw = (v, w) => (typeof M.sidebarWidth === 'function' ? M.sidebarWidth(v, w) : undefined);

test('W1 沒設定過時回預設 420', () => {
  for (const v of [undefined, null, NaN, 'abc']) {
    assert.strictEqual(sw(v, 1920), 420, `輸入 ${String(v)}`);
  }
});

test('W2 小於下限時回下限', () => {
  assert.strictEqual(sw(100, 1920), 360);
});

test('W3 大於上限時回上限', () => {
  assert.strictEqual(sw(5000, 2560), 900);
});

test('W4 視窗窄時上限跟著縮', () => {
  // 1200 - 44 - 480 = 676
  assert.strictEqual(sw(800, 1200), 676);
});

test('W5 視窗窄到放不下時仍回下限', () => {
  assert.strictEqual(sw(420, 600), 360);
});

test('W6 範圍內的小數四捨五入', () => {
  assert.strictEqual(sw(500.6, 1920), 501);
});

test('W7 範圍內的值原樣回傳', () => {
  assert.strictEqual(sw(420, 1920), 420);
  assert.strictEqual(sw(640, 1920), 640);
});
