// 台服沒有編號的組合型詞綴,靠 data/ggpk.json 的 statMap 用英文全文查中文的 translateStats 測試。
// 執行:node --test test/composed-stats.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const { _test } = await import(new URL('../bg/translation.js', import.meta.url).href);

const raw = fs.readFileSync(new URL('../data/ggpk.json', import.meta.url), 'utf8').replace(/^﻿/, '');
const statMap = JSON.parse(raw).statMap;

// 建立 stats 資料:entries = [[id, text], ...],全放在指定群組
function mk(group, entries) {
  return {
    result: [
      {
        id: group,
        label: group,
        entries: entries.map(([id, text]) => ({ id, text, type: group })),
      },
    ],
  };
}

const texts = (stats) => stats.result[0].entries.map((e) => e.text);
const run = (us, tw = { result: [] }) => texts(_test.translateStats(us, tw, statMap));

// 單條、台服沒有該編號的情境
function single(code, title, group, id, en, zh) {
  test(`${code} ${title}`, () => {
    assert.equal(run(mk(group, [[id, en]]))[0], `${zh} (${en})`);
  });
}

single('C1', '星團附加天賦顯示中文', 'enchant', 'enchant.stat_3599615742|12795',
  '1 added passive skill is Versatility', '1 個附加的天賦為俊敏');
single('C2', '同名天賦用編號對到的譯名', 'enchant', 'enchant.stat_3599615742|33287',
  '1 added passive skill is Juggernaut', '1 個附加的天賦為戰神');
single('C3', '插槽輔助顯示中文', 'explicit', 'explicit.effect_3419961156',
  'Socketed Gems are Supported by Level # Impale Support', '插槽中的寶石被等級 # 的 穿刺輔助 輔助');
single('C4a', '賦予技能(有等級)顯示中文', 'explicit', 'explicit.effect_4211392390',
  'Grants Level # Lightning Warp', '賦予等級 # 的 閃電傳送');
single('C4b', '賦予技能(無等級)顯示中文', 'implicit', 'implicit.effect_4121000032',
  'Grants Summon Harbinger of Focus', '賦予 召喚專注神諭');
single('C5', '注能輔助不重複「輔助」', 'imbued', 'imbued.pseudo_built_in_support|3674002686',
  'Supported by Level 1 Impotence', '被等級1的枯竭輔助');
single('C6', '巔峰頭目前綴顯示中文', 'implicit', 'implicit.stat_1297664519',
  'While a Pinnacle Atlas Boss is in your Presence, #% reduced Mana Cost of Attacks',
  '在巔峰頭目面前時，減少 #% 攻擊的魔力消耗');

test('C7 只有 # 的條目維持原樣', () => {
  const us = mk('explicit', [['explicit.stat_3360430812', '#']]);
  const tw = mk('explicit', [['explicit.stat_3360430812', '#']]);
  assert.equal(run(us, tw)[0], '#');
});

single('D1', '譫妄獎勵類型顯示中文', 'explicit', 'explicit.delirium_reward_essences',
  'Delirium Reward Type: Essences', '譫妄獎勵類型：精髓');

test('D2 盜賊流亡者兩種寫法各自顯示中文', () => {
  const id = 'explicit.stat_3550168289';
  const en1 = 'Area is inhabited by an additional Rogue Exile';
  const en2 = 'Your Maps are inhabited by an additional Rogue Exile';
  const us = mk('explicit', [[id, en1], [id, en2]]);
  const tw = mk('explicit', [
    [id, '地圖含有額外 # 個盜賊流亡者'],
    [id, '你的地圖含有額外 # 個盜賊流亡者'],
  ]);
  const out = run(us, tw);
  assert.equal(out[0], `地圖含有額外 1 個盜賊流亡者 (${en1})`);
  assert.equal(out[1], `你的地圖含有額外 1 個盜賊流亡者 (${en2})`);
});

test('D3 侵略頭目 Area 寫法顯示中文', () => {
  const id = 'explicit.stat_279246355';
  const en1 = 'Area is inhabited by an additional Invasion Boss';
  const en2 = 'Your Maps are inhabited by an additional Invasion Boss';
  const us = mk('explicit', [[id, en1], [id, en2]]);
  const tw = mk('explicit', [
    [id, '地圖中含有 # 隻額外侵略聯盟的頭目'],
    [id, '你的地圖含有額外 1 位侵略頭目'],
  ]);
  const out = run(us, tw);
  assert.equal(out[0], `地圖中含有 1 隻額外侵略聯盟的頭目 (${en1})`);
  assert.equal(out[1], `你的地圖含有額外 1 位侵略頭目 (${en2})`);
});

single('D4', '括號尾綴 (Local) 顯示中文', 'implicit', 'implicit.stat_3523867985',
  '#% increased Armour, Evasion and Energy Shield (Local)', '增加 #% 護甲、閃避與能量護盾 (部分)');
single('D5', '括號尾綴 (Staves) 顯示中文', 'fractured', 'fractured.stat_1001829678',
  '+#% Chance to Block Attack Damage while wielding a Staff (Staves)', '持長杖時 +#% 攻擊傷害格擋率 (法杖)');
single('D6', '句中帶固定數字的條目顯示中文', 'implicit', 'implicit.stat_3203086927',
  "+#% to Damage over Time Multiplier if you've dealt a Critical Strike in the past 8 seconds",
  '若你過去 8 秒有造成暴擊，+#% 持續傷害加成');
