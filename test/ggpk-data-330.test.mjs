// data/ggpk.json(GGPK 離線翻譯資料)3.30 版內容驗證。
// 執行:node --test test/ggpk-data-330.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const D = JSON.parse(fs.readFileSync(new URL('../data/ggpk.json', import.meta.url), 'utf8'));

// 逐鍵比對,失敗訊息帶出是哪個鍵
const checkAll = (table, pairs) => {
  for (const [k, v] of Object.entries(pairs)) {
    assert.strictEqual(table?.[k], v, k);
  }
};

test('G1 資料版本是 3.30', () => {
  const v = D.meta?.game_version;
  assert.equal(typeof v, 'string', `game_version 型別:${typeof v}`);
  assert.ok(v.startsWith('3.30'), `game_version=${v}`);
});

test('G2 回報的傳奇有中文名', () => {
  assert.strictEqual(D.items['Hide of the Vendigo'], '范迪戈之革');
});

test('G3 其他 3.30 新傳奇有中文名', () => {
  checkAll(D.items, {
    'Mantle of Dreams': '夢縈之袍',
    'Veil of Flesh': '血肉帷幕',
    'Corpse Rose': '屍綻血玫',
    'The Sword of Ages': '萬世之劍',
    'Putrid Seed': '腐敗之種',
  });
});

test('G4 3.30 新通貨與基底有中文名', () => {
  checkAll(D.items, {
    'Feral Astrolabe': '野性星盤',
    'Frayed Thread': '磨損綢帶',
    'Threaded Delirium Orb': '綢帶之譫妄玉',
    'Vendigo Claws': '溫迪戈之爪',
  });
});

test('G5 回報物品的三條詞綴有離線模板', () => {
  checkAll(D.statMap, {
    'Can Attack as though using a Claw while main hand is empty': '可以在主手為空時視同使用爪攻擊',
    '# to # Added Cold Damage with Unarmed Attacks': '空手攻擊附加#至#冰冷傷害',
    "#% increased Attack Speed if you've used an Attack Movement Skill Recently":
      '若你近期使用過一個攻擊快行技能，增加#%攻擊速度',
  });
});

test('G6 既有常用名稱沒被洗掉', () => {
  checkAll(D.items, {
    'Chaos Orb': '混沌石',
    Headhunter: '獵首',
    Mageblood: '魔血',
    'Exquisite Leather': '精製皮甲',
  });
  checkAll(D.statMap, {
    '+# to maximum Life': '+# 最大生命',
    '#% increased Evasion Rating': '增加 #% 閃避值',
  });
});

test('G7 資料量沒有大幅縮水', () => {
  const floor95 = (n) => Math.floor(n * 0.95);
  const cases = [['items', 6449], ['statMap', 33277], ['modNames', 5004]];
  for (const [name, base] of cases) {
    const n = Object.keys(D[name] ?? {}).length;
    assert.ok(n >= floor95(base), `${name} 鍵數 ${n} < ${floor95(base)}`);
  }
});

test('G8 詞綴模板沒有方括號標記', () => {
  const re = /\[[^\[\]]+\]/;
  const hits = [];
  for (const [k, v] of Object.entries(D.statMap)) {
    if (re.test(k) || re.test(v)) hits.push(k);
  }
  assert.strictEqual(hits.length, 0, `命中 ${hits.length} 筆,第一筆鍵:${hits[0]}`);
});

test('G9 加了標記的常用詞綴仍查得到', () => {
  for (const k of ['#% chance to Blind Enemies on Hit', '#% chance to Blind Enemies on Hit with Melee Weapons']) {
    const v = D.statMap[k];
    assert.equal(typeof v, 'string', `${k} 型別:${typeof v}`);
    assert.ok(v.includes('致盲'), `${k} 值:${v}`);
  }
});
