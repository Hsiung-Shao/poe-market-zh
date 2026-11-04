// shared/bi-style.js(雙語第二行樣式:字級與顏色正規化)單元測試。
// 執行:node --test test/bi-style.test.mjs
// 被測檔是非模組的瀏覽器腳本,用 node:vm 在獨立 context 執行,從 globalThis.PMZ_BISTYLE 取物件。
// 載入失敗(檔案不存在 / 沒掛物件)以斷言失敗呈現,不讓整支測試炸掉。
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../shared/bi-style.js');
const NOT_READY = 'shared/bi-style.js 尚未實作';

let api = null;

before(() => {
  try {
    const code = fs.readFileSync(FILE, 'utf8');
    const ctx = {};
    ctx.globalThis = ctx;
    ctx.window = ctx;
    ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(code, ctx, { filename: FILE });
    api = ctx.PMZ_BISTYLE || null;
  } catch {
    api = null;
  }
});

// 每個測試先確認模組已載入;沒載入就以斷言失敗呈現
function need() {
  assert.ok(api, NOT_READY);
  return api;
}

test('B0 常數值正確', () => {
  const s = need();
  // 抓預設色被改錯
  assert.equal(s.DEFAULT_COLOR, '#6ee7a8');
  // 抓預設字級被改錯
  assert.equal(s.DEFAULT_SIZE, 11);
  // 抓下限被改錯
  assert.equal(s.MIN, 10);
  // 抓上限被改錯
  assert.equal(s.MAX, 25);
});

test('B1 字級夾在 10–25', () => {
  const s = need();
  // 抓低於下限沒被夾到 MIN
  assert.equal(s.normSize(5), 10);
  // 抓高於上限沒被夾到 MAX
  assert.equal(s.normSize(30), 25);
  // 抓小數沒四捨五入成整數(13.6 -> 14)
  assert.equal(s.normSize(13.6), 14);
});

test('B2 字級非數字回預設 11', () => {
  const s = need();
  // 抓 undefined 變成 NaN 或被夾成 MIN
  assert.equal(s.normSize(undefined), 11);
  // 抓非數字字串沒擋掉
  assert.equal(s.normSize('abc'), 11);
  // 抓 null 被 Number(null)=0 誤當成 0 而夾成 10
  assert.equal(s.normSize(null), 11);
  // 抓 NaN 沒擋掉
  assert.equal(s.normSize(NaN), 11);
});

test('B3 顏色只收 #rrggbb 並轉小寫', () => {
  const s = need();
  // 抓大寫沒轉小寫
  assert.equal(s.normColor('#ABCDEF'), '#abcdef');
  // 抓顏色名稱被放行(可能造成非預期樣式)
  assert.equal(s.normColor('red'), '#6ee7a8');
  // 抓三位簡寫被放行
  assert.equal(s.normColor('#fff'), '#6ee7a8');
  // 抓 undefined 沒回預設色
  assert.equal(s.normColor(undefined), '#6ee7a8');
});
