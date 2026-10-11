// 階級面板來源標籤(異界的 / 創生之樹 召喚物 / 創生之樹 法術)的 i18n 字串測試。
// 執行:node --test test/tier-source-i18n.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const box = {};
box.globalThis = box;
box.window = box;
vm.createContext(box);
vm.runInContext(fs.readFileSync(fileURLToPath(new URL('../shared/i18n.js', import.meta.url)), 'utf-8'), box, { filename: 'shared/i18n.js' });
const T = box.PMZ_I18N.tables;

test('T6 來源標籤中英皆有', () => {
  for (const lang of ['zh', 'en']) {
    for (const k of ['otherworldly', 'genesis_minion', 'genesis_caster'].map((s) => `tierpick.infl.${s}`)) {
      const v = T[lang][k];
      // 缺鍵、空字串、或 tr() 退回鍵名就會失敗
      assert.ok(typeof v === 'string' && v.trim() && v !== k, `${lang} ${k} = ${JSON.stringify(v)}`);
    }
  }
});
