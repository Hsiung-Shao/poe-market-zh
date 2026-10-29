// 國際服前綴詞綴(Bonded / 範圍內天賦也會賦予)在台服缺譯時,以「中文前綴 + 內層台服譯文」組合的測試。
// 執行:node --test test/stat-prefix-compose.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { _test } = await import(new URL('../bg/translation.js', import.meta.url).href);

// 建立 /api/trade2/data/stats 形狀的資料:groups = { 群組id: [[entryId, text, option?], ...] }
function mkStats(groups) {
  return {
    result: Object.entries(groups).map(([gid, entries]) => ({
      id: gid,
      label: gid,
      entries: entries.map(([id, text, option]) => {
        const e = { id, text, type: gid };
        if (option) e.option = option;
        return e;
      }),
    })),
  };
}

// 在 stats 中依 id 找條目,回傳 { group, entry }
function find(stats, id) {
  for (const group of stats.result) {
    const entry = group.entries.find((e) => e.id === id);
    if (entry) return { group, entry };
  }
  return { group: undefined, entry: undefined };
}

function countId(stats, id) {
  return stats.result.reduce((n, g) => n + g.entries.filter((e) => e.id === id).length, 0);
}

test('T1 台服缺 Bonded 時以內層譯文組出命定', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '增加#%命中值']] });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  const { group, entry } = find(stats, 'rune.stat_1');
  // 沒組出條目 / 前綴或內層譯文拼錯 會失敗
  assert.ok(entry, '應產出 rune.stat_1');
  assert.equal(entry.text, '命定: 增加#%命中值');
  // 新建的群組 id 錯會讓條目掛到別的群組
  assert.equal(group.id, 'rune');
  // 計數沒累加會失敗
  assert.equal(counts.adopted, 1);
});

test('T2 小型、核心兩種範圍前綴都能組合', () => {
  const us = mkStats({
    enchant: [
      ['enchant.stat_10', 'Small Passive Skills in Radius also grant #% increased Armour'],
      ['enchant.stat_11', 'Notable Passive Skills in Radius also grant #% increased Armour'],
    ],
    explicit: [['explicit.stat_20', '#% increased Armour']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_20', '增加#%護甲']] });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 兩種前綴對錯(小型/核心互換、漏掉其一)會失敗
  assert.equal(find(stats, 'enchant.stat_10').entry?.text, '範圍內小型天賦也會賦予 增加#%護甲');
  assert.equal(find(stats, 'enchant.stat_11').entry?.text, '範圍內核心天賦也會賦予 增加#%護甲');
  assert.equal(counts.adopted, 2);
});

test('T3 內層無正號時借正號版並剝掉加號', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: # to maximum Life']],
    explicit: [['explicit.stat_2', '+# to maximum Life']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '+#最大生命']] });
  const { stats } = _test.composePrefixTwStats(us, tw);
  // 沒借正號版會找不到內層;沒剝加號會變成「命定: +#最大生命」
  assert.equal(find(stats, 'rune.stat_1').entry?.text, '命定: #最大生命');
});

test('T4 台服已有譯文的條目不覆蓋', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
  });
  const tw = mkStats({
    rune: [['rune.stat_1', '命定: 台服原譯']],
    explicit: [['explicit.stat_2', '增加#%命中值']],
  });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 覆蓋台服原譯會失敗
  assert.equal(find(stats, 'rune.stat_1').entry?.text, '命定: 台服原譯');
  // 重複加入同 id 條目會失敗
  assert.equal(countId(stats, 'rune.stat_1'), 1);
  assert.equal(counts.adopted, 0);
});

test('T5 內層無譯文時保留缺口', () => {
  // 案例 a:台服完全沒有內層條目
  {
    const us = mkStats({
      rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
      explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
    });
    const tw = mkStats({ explicit: [] });
    const { stats, counts } = _test.composePrefixTwStats(us, tw);
    // 硬塞英文或半截譯文會失敗
    assert.equal(find(stats, 'rune.stat_1').entry, undefined);
    assert.equal(counts.noInner, 1);
    assert.equal(counts.adopted, 0);
  }
  // 案例 b:台服內層譯文等於英文(等同未翻)
  {
    const us = mkStats({
      rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
      explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
    });
    const tw = mkStats({ explicit: [['explicit.stat_2', '#% increased Accuracy Rating']] });
    const { stats, counts } = _test.composePrefixTwStats(us, tw);
    // 把未翻的英文當譯文採用會失敗
    assert.equal(find(stats, 'rune.stat_1').entry, undefined);
    assert.equal(counts.noInner, 1);
    assert.equal(counts.adopted, 0);
  }
  // 案例 c:國際服根本沒有內層條目
  {
    const us = mkStats({ rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']] });
    const tw = mkStats({ explicit: [] });
    const { stats, counts } = _test.composePrefixTwStats(us, tw);
    assert.equal(find(stats, 'rune.stat_1').entry, undefined);
    assert.equal(counts.noInner, 1);
  }
});

test('T6 內層有多種譯文時不採用', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [
      ['explicit.stat_2', '#% increased Accuracy Rating'],
      ['implicit.stat_3', '#% increased Accuracy Rating'],
    ],
  });
  const tw = mkStats({
    explicit: [['explicit.stat_2', '增加#%命中值']],
    implicit: [['implicit.stat_3', '提高#%命中率']],
  });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 任意挑其中一種譯文會失敗(結果不確定)
  assert.equal(find(stats, 'rune.stat_1').entry, undefined);
  assert.equal(counts.adopted, 0);
});

test('T7 帶選項的條目跳過', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating', { options: [{ id: 1, text: 'A' }] }]],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '增加#%命中值']] });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 帶 option 的條目被組出譯文會失敗(option 文字無法對應)
  assert.equal(find(stats, 'rune.stat_1').entry, undefined);
  assert.equal(counts.skippedOption, 1);
  assert.equal(counts.adopted, 0);
});

test('T8 組合結果進得了結果列對照表', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '增加#%命中值']] });
  const { stats: composed } = _test.composePrefixTwStats(us, tw);
  const r = _test.buildStatIdMap(us, composed, {});
  const m = r.map ?? r;
  // 組合條目沒進對照表,或來源標成非台服 會失敗
  assert.ok(m['rune.stat_1'], '對照表應含 rune.stat_1');
  assert.equal(m['rune.stat_1'].zh, '命定: 增加#%命中值');
  assert.equal(m['rune.stat_1'].src, 'tw');
});

test('T9 不改動輸入物件', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '增加#%命中值']] });
  const usBefore = structuredClone(us);
  const twBefore = structuredClone(tw);
  _test.composePrefixTwStats(us, tw);
  // 直接在傳入的 twStats 上加條目(汙染呼叫端快取)會失敗
  assert.deepEqual(tw, twBefore);
  assert.deepEqual(us, usBefore);
});

test('T10 原字有歧義時不改查正號版', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: # to Strength']],
    explicit: [
      ['explicit.stat_2', '# to Strength'],
      ['explicit.stat_3', '# to Strength'],
      ['explicit.stat_4', '+# to Strength'],
    ],
  });
  const tw = mkStats({
    explicit: [
      ['explicit.stat_2', '#力量'],
      ['explicit.stat_3', '#點力量'],
      ['explicit.stat_4', '+#點力量'],
    ],
  });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 原字有兩種譯文卻退而借正號版(拼出「命定: #點力量」)會失敗
  assert.equal(find(stats, 'rune.stat_1').entry, undefined);
  assert.equal(counts.noInner, 1);
  assert.equal(counts.adopted, 0);
});

test('T11 內層 id 對到多種英文時不組合', () => {
  const us = mkStats({
    rune: [['rune.stat_1', 'Bonded: #% increased Accuracy Rating']],
    explicit: [['explicit.stat_2', '#% increased Accuracy Rating']],
    implicit: [['explicit.stat_2', '#% increased Global Accuracy Rating']],
  });
  const tw = mkStats({ explicit: [['explicit.stat_2', '增加#%命中值']] });
  const { stats, counts } = _test.composePrefixTwStats(us, tw);
  // 同 id 對到兩種英文時仍採用其譯文(可能是錯配)會失敗
  assert.equal(find(stats, 'rune.stat_1').entry, undefined);
  assert.equal(counts.noInner, 1);
  assert.equal(counts.adopted, 0);
});
