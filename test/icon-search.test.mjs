// content/bookmarks-model.js 的 iconMatchesQuery(圖示搜尋)與 iconFrames(圖示格數)單元測試。
// 執行:node --test test/icon-search.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../content/bookmarks-model.js');

// 尚未匯出時回 undefined,讓失敗以斷言呈現而非 TypeError
const match = (n, q) => (typeof M.iconMatchesQuery === 'function' ? M.iconMatchesQuery(n, q) : undefined);
const frames = (u) => (typeof M.iconFrames === 'function' ? M.iconFrames(u) : undefined);

const NAME = '朽木法杖 (Driftwood Wand)';

test('S1 空查詢時全部符合', () => {
  for (const q of ['', '   ', undefined]) {
    assert.strictEqual(match(NAME, q), true, `查詢 ${JSON.stringify(q)}`);
  }
});

test('S2 中文片段符合', () => {
  assert.strictEqual(match(NAME, '法杖'), true);
});

test('S3 英文不分大小寫', () => {
  assert.strictEqual(match(NAME, 'WAND'), true);
  assert.strictEqual(match(NAME, 'driftwood'), true);
});

test('S4 多關鍵字要全部符合', () => {
  assert.strictEqual(match(NAME, '朽木 wand'), true);
  assert.strictEqual(match(NAME, '朽木 bow'), false);
});

test('S5 不符合回 false', () => {
  assert.strictEqual(match(NAME, '弓'), false);
});

test('S6 名稱不是字串不拋錯', () => {
  for (const n of [undefined, null, 123]) {
    assert.doesNotThrow(() => match(n, 'a'));
    assert.strictEqual(match(n, 'a'), false, `名稱 ${String(n)}`);
  }
});

test('F1 網址帶 #f3 回 3', () => {
  assert.strictEqual(frames('https://web.poecdn.com/image/Art/2DItems/Flasks/lifeflask1.png#f3'), 3);
});

test('F2 一般網址回 1', () => {
  for (const u of ['https://web.poecdn.com/image/Art/2DItems/Flasks/lifeflask1.png', '📁', undefined]) {
    assert.strictEqual(frames(u), 1, `網址 ${String(u)}`);
  }
});
