// bg/ninja.js mapItemLines(stash item overview → 物價清單)單元測試。
// 執行:node --test test/ninja-map.test.mjs
// 2026-08-25 從已停更的 poeMarketTranslate/poe-trade-mate 搬過來(該專案無版控,
// 已刪除)。同批的 league-url.test.mjs 沒有搬:它依賴 content/league-url.js,
// 這個專案沒有那個模組。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../bg/ninja.js';

const { mapItemLines, stripGemImages, parseIndexState, gemVariantLabel } = _test;

// 依實測 API 形狀縮減的 fixture(Ancestors 聯盟,2026-07)
const FIXTURE = {
  lines: [
    {
      name: 'Awakened Enlighten Support',
      icon: 'https://web.poecdn.com/gen/image/abc/Enlightenplus.png',
      variant: '1',
      gemLevel: 1,
      chaosValue: 108215,
      count: 12,
      listingCount: 12,
    },
    {
      name: 'Kinetic Blast of Clustering',
      icon: 'https://web.poecdn.com/gen/image/def/ClusterBurst.png',
      variant: 'Power Charge On Critical',
      chaosValue: 37215,
      divineValue: 150,
      count: 8,
      listingCount: 8,
    },
    { name: 'Enhance Support', icon: null, variant: '16', chaosValue: 250000, count: 5 },
  ],
};

test('正常行映射:欄位齊全且 category 標記為傳入 type', () => {
  const out = mapItemLines('SkillGem', FIXTURE);
  assert.equal(out.length, 3);
  const enlighten = out.find((i) => i.name === 'Awakened Enlighten Support');
  assert.deepEqual(enlighten, {
    name: 'Awakened Enlighten Support',
    image: 'https://web.poecdn.com/gen/image/abc/Enlightenplus.png',
    category: 'SkillGem',
    value: 108215,
    div: null, // 無 divineValue → null
    count: 12,
    variant: 'L1', // gemLevel 1 → 人話標示
  });
  assert.ok(out.every((i) => i.category === 'SkillGem'));
  // divineValue 原樣帶出,顯示與站方一致
  assert.equal(out.find((i) => i.name === 'Kinetic Blast of Clustering').div, 150);
});

test('gemVariantLabel:等級/品質/腐化組人話標示', () => {
  assert.equal(gemVariantLabel('SkillGem', { gemLevel: 20, gemQuality: 20, corrupted: true }), 'L20/Q20 腐');
  assert.equal(gemVariantLabel('SkillGem', { gemLevel: 5, corrupted: true }), 'L5 腐');
  assert.equal(gemVariantLabel('SkillGem', { gemLevel: 1 }), 'L1');
  assert.equal(gemVariantLabel('SkillGem', { gemLevel: 1, gemQuality: 23 }), 'L1/Q23');
  // 缺結構欄位退回原始 variant;ImbuedGem 一律用灌注名
  assert.equal(gemVariantLabel('SkillGem', { variant: '21/20c' }), '21/20c');
  assert.equal(gemVariantLabel('ImbuedGem', { gemLevel: 20, variant: 'Power Charge On Critical' }), 'Power Charge On Critical');
  assert.equal(gemVariantLabel('SkillGem', {}), null);
});

test('缺 icon 回 null、variant 原樣保留(含灌注名字串)', () => {
  const out = mapItemLines('ImbuedGem', FIXTURE);
  assert.equal(out.find((i) => i.name === 'Enhance Support').image, null);
  assert.equal(
    out.find((i) => i.name === 'Kinetic Blast of Clustering').variant,
    'Power Charge On Critical',
  );
});

test('無效行過濾:缺 name、chaosValue 非正數或非數字', () => {
  const out = mapItemLines('SkillGem', {
    lines: [
      { name: '', chaosValue: 10, count: 20 },
      { name: 'Zero Gem', chaosValue: 0, count: 20 },
      { name: 'Negative Gem', chaosValue: -5, count: 20 },
      { name: 'NaN Gem', chaosValue: 'high', count: 20 },
      null,
      { name: 'Valid Gem', chaosValue: 1.5, count: 20 },
    ],
  });
  assert.equal(out.length, 1);
  assert.equal(out[0].name, 'Valid Gem');
});

test('低信心過濾:count < 5 或缺 count 的哄抬價不收(實測站方邊界 5/3)', () => {
  const out = mapItemLines('SkillGem', {
    lines: [
      { name: 'Troll Gem', chaosValue: 108215, count: 3 }, // 3 筆掛單標 436 div
      { name: 'Single Listing Gem', chaosValue: 86835, count: 1 },
      { name: 'No Count Gem', chaosValue: 999 },
      { name: 'Boundary Gem', chaosValue: 10420, count: 5 }, // 站方顯示的最低邊界
      { name: 'Reliable Gem', chaosValue: 134, count: 125 },
    ],
  });
  assert.deepEqual(out.map((i) => i.name), ['Boundary Gem', 'Reliable Gem']);
});

test('依 value 降冪排序', () => {
  const out = mapItemLines('SkillGem', FIXTURE);
  assert.deepEqual(out.map((i) => i.value), [250000, 108215, 37215]);
});

test('空回應/缺 lines 回空陣列', () => {
  assert.deepEqual(mapItemLines('SkillGem', null), []);
  assert.deepEqual(mapItemLines('SkillGem', {}), []);
  assert.deepEqual(mapItemLines('SkillGem', { lines: [] }), []);
});

test('缺 variant 的行 variant 為 null', () => {
  const out = mapItemLines('SkillGem', { lines: [{ name: 'Plain Gem', chaosValue: 3, count: 6 }] });
  assert.equal(out[0].variant, null);
});

test('parseIndexState:economyLeagues[0] 即最新聯盟', () => {
  // 依實測 index-state 形狀縮減的 fixture
  const parsed = parseIndexState({
    economyLeagues: [
      { name: 'Ancestors', url: 'ancestors', displayName: 'Ancestors' },
      { name: 'Mirage', url: 'mirage', displayName: 'Mirage' },
      { name: 'Standard', url: 'standard', displayName: 'Standard' },
      { url: 'broken' }, // 缺 name 的行過濾
    ],
  });
  assert.deepEqual(parsed, { leagues: ['Ancestors', 'Mirage', 'Standard'], latest: 'Ancestors' });
});

test('parseIndexState:無資料回 null', () => {
  assert.equal(parseIndexState(null), null);
  assert.equal(parseIndexState({}), null);
  assert.equal(parseIndexState({ economyLeagues: [] }), null);
  assert.equal(parseIndexState({ economyLeagues: [{ url: 'x' }] }), null);
});

test('stripGemImages:只去掉寶石的圖示,通貨圖示保留', () => {
  const list = [
    { name: 'Divine Orb', image: 'https://web.poecdn.com/div.png', category: 'Currency', value: 250 },
    { name: 'Enhance Support', image: 'https://web.poecdn.com/enh.png', category: 'SkillGem', value: 100, variant: '16' },
    { name: 'Kinetic Blast of Clustering', image: 'https://web.poecdn.com/kb.png', category: 'ImbuedGem', value: 50, variant: 'X' },
    { name: 'No Icon Gem', image: null, category: 'SkillGem', value: 5, variant: null },
  ];
  const out = stripGemImages(list);
  assert.equal(out[0].image, 'https://web.poecdn.com/div.png'); // 通貨不動
  assert.equal(out[1].image, null);
  assert.equal(out[2].image, null);
  assert.equal(out[3].image, null);
  // 其他欄位不變、原陣列不被就地修改
  assert.equal(out[1].variant, '16');
  assert.equal(list[1].image, 'https://web.poecdn.com/enh.png');
});
