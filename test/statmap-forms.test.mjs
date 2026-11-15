// 測 buildStatMap 在同編號多寫法、單一寫法、選項型條目下的對照表內容。
// 執行:node --test test/statmap-forms.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { _test } = await import(new URL('../bg/translation.js', import.meta.url).href);

// 建立 stats 資料:entries = [[id, text, option?], ...],全放在 explicit 群組
function mk(entries) {
  return {
    result: [
      {
        id: 'explicit',
        label: 'explicit',
        entries: entries.map(([id, text, option]) => {
          const e = { id, text };
          if (option) e.option = option;
          return e;
        }),
      },
    ],
  };
}

test('S1 同編號兩種寫法、台服兩條結構相同:兩個英文鍵都不寫入', () => {
  const us = mk([
    ['explicit.stat_1', 'Area has +#% chance to contain Ritual Altars'],
    ['explicit.stat_1', 'Your Maps have +#% chance to contain Ritual Altars'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '區域 +#% 機率含有祭祀神壇'],
    ['explicit.stat_1', '你的地圖 +#% 機率含有祭祀神壇'],
  ]);
  const map = _test.buildStatMap(us, tw);
  assert.equal(map['Area has +#% chance to contain Ritual Altars'], undefined);
  assert.equal(map['Your Maps have +#% chance to contain Ritual Altars'], undefined);
});

test('S2 同編號兩種寫法、台服兩條各自只對得上一種英文:各配各的', () => {
  const us = mk([
    ['explicit.stat_1', 'Area contains Foo'],
    ['explicit.stat_1', 'Your Maps have +#% chance to contain Foo'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '區域含有甲'],
    ['explicit.stat_1', '你的地圖 +#% 機率含有甲'],
  ]);
  const map = _test.buildStatMap(us, tw);
  assert.equal(map['Area contains Foo'], '區域含有甲');
  assert.equal(map['Your Maps have +#% chance to contain Foo'], '你的地圖 +#% 機率含有甲');
});

test('S3 同編號兩種英文、台服只有一條且兩種英文都相符:兩個鍵都不寫入', () => {
  const us = mk([
    ['explicit.stat_1', '#% increased Gold found in this Area (Gold Piles)'],
    ['explicit.stat_1', '#% increased Gold found in Map (Gold Piles)'],
  ]);
  const tw = mk([['explicit.stat_1', '增加#%地圖內所獲取的金幣數量（金幣堆）']]);
  const map = _test.buildStatMap(us, tw);
  assert.equal(map['#% increased Gold found in this Area (Gold Piles)'], undefined);
  assert.equal(map['#% increased Gold found in Map (Gold Piles)'], undefined);
});

test('S4 單一寫法:照舊以編號配對', () => {
  const us = mk([['explicit.stat_1', '+# to maximum Life']]);
  const tw = mk([['explicit.stat_1', '+# 最大生命']]);
  const map = _test.buildStatMap(us, tw);
  assert.equal(map['+# to maximum Life'], '+# 最大生命');
});

test('S5 選項型條目:逐選項展開照舊', () => {
  const us = mk([
    ['explicit.stat_1', 'Added Small Passive Skills grant: #', { options: [{ id: 1, text: '+5 to Strength' }] }],
  ]);
  const tw = mk([
    ['explicit.stat_1', '附加的小天賦給予:#', { options: [{ id: 1, text: '+5 力量' }] }],
  ]);
  const map = _test.buildStatMap(us, tw);
  assert.equal(map['Added Small Passive Skills grant: +# to Strength'], '附加的小天賦給予:+# 力量');
});
