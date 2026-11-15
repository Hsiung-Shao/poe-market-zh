// 同編號多種寫法、佔位符數不符、選項型條目的 translateStats 行為測試。
// 執行:node --test test/dropdown-stat-forms.test.mjs
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

const texts = (stats) => stats.result[0].entries.map((e) => e.text);

test('T1 同編號兩種寫法且遊戲檔都有:各自顯示自己的中文', () => {
  const us = mk([
    ['explicit.stat_1', 'Area contains The Sacred Grove'],
    ['explicit.stat_1', 'Your Maps have +#% chance to contain The Sacred Grove'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '區域含有聖殿密園'],
    ['explicit.stat_1', '你的地圖 +#% 機率含有聖殿密園'],
  ]);
  const fb = {
    'Area contains The Sacred Grove': '區域含有聖殿密園',
    'Your Maps have +#% chance to contain The Sacred Grove': '你的地圖 +#% 機率含有聖殿密園',
  };
  const out = _test.translateStats(us, tw, fb);
  assert.equal(texts(out)[0], '區域含有聖殿密園 (Area contains The Sacred Grove)');
  assert.equal(
    texts(out)[1],
    '你的地圖 +#% 機率含有聖殿密園 (Your Maps have +#% chance to contain The Sacred Grove)',
  );
});

test('T2 同編號兩種寫法、數字結構相同且遊戲檔只有第一種:第一種用遊戲檔', () => {
  const us = mk([
    ['explicit.stat_1', '#% increased Magic Pack Size'],
    ['explicit.stat_1', '#% increased Magic Pack Size in your Maps'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '增加 #% 魔法怪物群大小'],
    ['explicit.stat_1', '增加 #% 你地圖中的魔法怪物群大小'],
  ]);
  const fb = { '#% increased Magic Pack Size': '增加 #% 魔法怪物群大小' };
  const out = _test.translateStats(us, tw, fb);
  assert.equal(texts(out)[0], '增加 #% 魔法怪物群大小 (#% increased Magic Pack Size)');
});

test('T3 同編號兩種寫法、遊戲檔都沒有、台服兩條都符合佔位符:兩條都維持英文', () => {
  const us = mk([
    ['explicit.stat_1', 'Area is inhabited by an additional Invasion Boss'],
    ['explicit.stat_1', 'Your Maps are inhabited by an additional Invasion Boss'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '區域含有額外 1 位侵略頭目'],
    ['explicit.stat_1', '你的地圖含有額外 1 位侵略頭目'],
  ]);
  const out = _test.translateStats(us, tw, {});
  assert.equal(texts(out)[0], 'Area is inhabited by an additional Invasion Boss');
  assert.equal(texts(out)[1], 'Your Maps are inhabited by an additional Invasion Boss');
});

test('T4 同編號兩種寫法、遊戲檔都沒有、台服只有一條佔位符數相符:用相符的那一條', () => {
  const us = mk([
    ['explicit.stat_1', 'Area contains Foo'],
    ['explicit.stat_1', 'Your Maps have +#% chance to contain Foo'],
  ]);
  const tw = mk([
    ['explicit.stat_1', '區域含有甲'],
    ['explicit.stat_1', '你的地圖 +#% 機率含有甲'],
  ]);
  const out = _test.translateStats(us, tw, {});
  assert.equal(texts(out)[0], '區域含有甲 (Area contains Foo)');
  assert.equal(texts(out)[1], '你的地圖 +#% 機率含有甲 (Your Maps have +#% chance to contain Foo)');
});

test('T5 單一寫法但台服佔位符數不符且遊戲檔沒有:維持英文', () => {
  const us = mk([['explicit.stat_1', 'Trigger Level 15 Stalking Pustule on Kill']]);
  const tw = mk([['explicit.stat_1', '擊殺時觸發等級 # 的潛行毒玉']]);
  const out = _test.translateStats(us, tw, {});
  assert.equal(texts(out)[0], 'Trigger Level 15 Stalking Pustule on Kill');
});

test('T6 單一寫法且台服符合:採用台服(即使遊戲檔用字不同)', () => {
  const us = mk([['explicit.stat_1', '+# to maximum Life']]);
  const tw = mk([['explicit.stat_1', '+# 最大生命']]);
  const out = _test.translateStats(us, tw, { '+# to maximum Life': '+# 生命上限' });
  assert.equal(texts(out)[0], '+# 最大生命 (+# to maximum Life)');
});

test('T7 台服沒有該編號而遊戲檔有:採用遊戲檔', () => {
  const us = mk([['explicit.stat_1', 'Only Game File Has This #']]);
  const tw = mk([]);
  const out = _test.translateStats(us, tw, { 'Only Game File Has This #': '只有遊戲檔有 #' });
  assert.equal(texts(out)[0], '只有遊戲檔有 # (Only Game File Has This #)');
});

test('T8 選項型條目:文字與各選項依編號翻譯', () => {
  const us = mk([
    [
      'explicit.stat_1',
      'Added Small Passive Skills grant: #',
      { options: [{ id: 1, text: '+5 to Strength' }, { id: 2, text: '+5 to Dexterity' }] },
    ],
  ]);
  const tw = mk([
    [
      'explicit.stat_1',
      '附加的小天賦給予:#',
      { options: [{ id: 1, text: '+5 力量' }, { id: 2, text: '+5 敏捷' }] },
    ],
  ]);
  const out = _test.translateStats(us, tw, {});
  const e = out.result[0].entries[0];
  assert.equal(e.text, '附加的小天賦給予:# (Added Small Passive Skills grant: #)');
  assert.equal(e.option.options[0].text, '+5 力量 (+5 to Strength)');
  assert.equal(e.option.options[1].text, '+5 敏捷 (+5 to Dexterity)');
});
