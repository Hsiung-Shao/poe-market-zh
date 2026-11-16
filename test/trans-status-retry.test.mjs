// content/bookmarks-model.js 的 transRetryDelay(翻譯資料狀態查詢失敗後的重試間隔)單元測試。
// 執行:node --test test/trans-status-retry.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const M = require('../content/bookmarks-model.js');

// 尚未匯出時回 undefined,讓失敗以斷言呈現而非 TypeError
const rd = (n) => (typeof M.transRetryDelay === 'function' ? M.transRetryDelay(n) : undefined);

test('R1 第 1 次失敗後等 1 秒重試', () => {
  assert.strictEqual(rd(1), 1000);
});

test('R2 第 2、3 次失敗後間隔拉長', () => {
  assert.strictEqual(rd(2), 3000, '輸入 2');
  assert.strictEqual(rd(3), 8000, '輸入 3');
});

test('R3 第 4 次失敗起不再重試', () => {
  for (const n of [4, 5, 100]) {
    assert.strictEqual(rd(n), null, `輸入 ${n}`);
  }
});

test('R4 不合理的次數不重試', () => {
  for (const n of [0, -1, NaN, undefined, 1.5, '2']) {
    assert.strictEqual(rd(n), null, `輸入 ${typeof n === 'string' ? `'${n}'` : String(n)}`);
  }
});
