// 詞綴下拉的「兩層選單」資料層(純函式,不碰 chrome.* / DOM / localStorage)。
//
// 官方 stats 清單裡有幾群條目共用同一個前綴而只有尾段不同(「有房間:阿茲瓦特
// 之巔」等 86 筆、「有日誌區域:X」15 筆…),在下拉中平鋪成一長串很難找。
// 這裡把這種群合併成**一個偽父條目 + option 子選單**,讓官網原生渲染成兩層
// 下拉(與官方「地圖被 # 佔據」同形)。
//
// 三個必須遵守的約束:
//
// 1. **輸出必為超集合**:原始成員條目一筆都不能刪。官網在重新整理或開啟他人
//    分享的搜尋時,是拿後端回傳的**真實 id** 去反查 stats 清單才能渲染那一列;
//    成員一旦從清單消失,反查落空會讓 Vue computed 拋例外,整個篩選面板掛掉。
// 2. **只收純列舉群**:成員文字含 `#` 代表需要數值篩選,而官網對 option 型
//    詞綴是「用下拉取代數值輸入框」,摺疊會讓使用者再也搜不到「至少 +5」。
// 3. **合成 option id 必須是內容雜湊**,不可用遞增索引 —— 否則賽季更新增刪
//    成員時,舊的分享連結會靜默指到**別的**條目(比報錯更糟)。

// 前綴切分:全形或半形冒號。前綴至少 2 字,避免把整句話當前綴
const PREFIX_RE = /^(.{2,40}?)[：:]\s*(.+)$/s;
// 譯文格式為「中文 (English)」,取其中文半邊
const ZH_HALF_RE = /^(.*?)\s*\((?=[^()]*[A-Za-z])[^()]*\)\s*$/;
const MIN_MEMBERS = 6;
export const PSEUDO_ID_MARK = 'ptm_g_';

// FNV-1a → 正 31-bit。同樣的輸入永遠得到同樣的 option id,與成員的清單位置無關
function hash31(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return ((h >>> 0) % 0x7ffffffe) + 1; // 1 ‥ 2^31-1,避開 0(官網以 0 為未選)
}

function slugify(en) {
  return en.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 40) || 'group';
}

const zhHalf = (text) => text.match(ZH_HALF_RE)?.[1] ?? text;

// 官網以 id 的第一段判斷詞綴類型(pseudo/explicit/enchant…),因此偽 id 必須
// 掛在成員原本的類型底下,不能自立一個 `ptm.` 頂層命名空間
const pseudoId = (groupId, en) => `${groupId}.${PSEUDO_ID_MARK}${slugify(en)}`;

// 把一個 group 的條目依英文前綴分桶。以**英文**為準是刻意的:英文是語言無關的
// 穩定基準,台服措辭改版不會讓分組跳掉
function bucketByPrefix(entries, enById) {
  const buckets = new Map();
  entries.forEach((entry, index) => {
    const en = enById.get(entry.id);
    if (!en) return;
    const m = en.match(PREFIX_RE);
    if (!m) return;
    const key = m[1].trim();
    if (!buckets.has(key)) buckets.set(key, []);
    buckets.get(key).push({ entry, en, enTail: m[2].trim(), index });
  });
  return buckets;
}

// 純列舉 = 群內所有成員的中英文都不含 `#`(不需要數值輸入)
const isPureEnum = (members) =>
  members.every(({ entry, en }) => !en.includes('#') && !(entry.text ?? '').includes('#'));

/**
 * @param translatedStats `translateStats()` 的產物(entry.text 為「中文 (English)」)
 * @param usStats 美服原始 stats,提供語言無關的英文基準
 * @returns {{stats, mapping, groups}} stats 為超集合;mapping 供頁面層把偽 id 還原成真實查詢
 */
export function buildStatGroups(translatedStats, usStats, { minMembers = MIN_MEMBERS } = {}) {
  const enById = new Map();
  for (const group of usStats?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id && entry.text) enById.set(entry.id, entry.text);
    }
  }

  const stats = structuredClone(translatedStats);
  const mapping = {};
  const groups = [];

  for (const group of stats.result ?? []) {
    const buckets = bucketByPrefix(group.entries ?? [], enById);
    const parents = [];
    for (const [enPrefix, members] of buckets) {
      if (members.length < minMembers || !isPureEnum(members)) continue;

      // 譯文半邊也必須有**同樣一致**的前綴結構,否則拆不出乾淨的父/子文字,
      // 會產出前後綴錯位的亂碼(實測:英文基準異常時就會踩到)。寧可不分組。
      const zhParts = members.map(({ entry }) => zhHalf(entry.text ?? '').match(PREFIX_RE));
      if (zhParts.some((m) => !m)) continue;
      const zhPrefixes = new Set(zhParts.map((m) => m[1].trim()));
      if (zhPrefixes.size !== 1) continue;
      const zhPrefix = [...zhPrefixes][0];

      const parentId = pseudoId(group.id, enPrefix);
      if (mapping[parentId]) continue; // slug 撞名:保守跳過,不冒錯配的險
      const options = [];
      const table = {};
      members.forEach(({ entry, enTail }, i) => {
        // 中英並列讓子選單兩種語言都搜得到(官網的 option 下拉同樣可輸入過濾)
        const label = `${zhParts[i][2].trim()} (${enTail})`;
        // 成員自帶 option(如「開啟房間/關閉房間」)時攤成組合,否則單一項。
        // value 形狀必須跟著分流:非 option 型成員送 `{option: N}` 會被官方 API 拒絕
        const own = entry.option?.options ?? [];
        const variants = own.length
          ? own.map((o) => ({ text: `${label} - ${o.text}`, value: { option: o.id }, key: `${entry.id}|${o.id}` }))
          : [{ text: label, value: {}, key: entry.id }];
        for (const v of variants) {
          let oid = hash31(v.key);
          while (table[oid]) oid = (oid % 0x7ffffffe) + 1; // 碰撞:線性探測,仍為確定性
          table[oid] = { id: entry.id, value: v.value };
          options.push({ id: oid, text: v.text });
        }
      });

      parents.push({
        at: members[0].index,
        entry: { id: parentId, text: `${zhPrefix}:# (${enPrefix}: #)`, option: { options } },
      });
      mapping[parentId] = table;
      groups.push({ id: parentId, group: group.id, enPrefix, members: members.length, options: options.length });
    }
    // 偽父插在該群**第一個成員的位置**,不是群組末端 —— 放末端的話,使用者搜
    // 「有房間」時 86 筆成員全排在它前面,等於看不到;不搜尋時更要捲過整個
    // 群組才碰得到。插在成員起點,則兩種情況下它都是該群的第一個。
    // 原始條目內容與相對順序不變,只是中間多插了幾筆(超集合約束仍成立)。
    if (parents.length) {
      const byIndex = new Map(parents.map((p) => [p.at, p.entry]));
      const rebuilt = [];
      (group.entries ?? []).forEach((entry, i) => {
        const parent = byIndex.get(i);
        if (parent) rebuilt.push(parent);
        rebuilt.push(entry);
      });
      group.entries = rebuilt;
    }
  }

  return { stats, mapping, groups };
}

/** 把偽 id + 合成 option id 還原成真正的查詢條件;查無回 null(呼叫端須 fail-closed) */
export function resolvePseudo(mapping, id, optionId) {
  const hit = mapping?.[id]?.[String(optionId)];
  return hit ? { id: hit.id, value: { ...hit.value } } : null;
}

export const isPseudoId = (id) => typeof id === 'string' && id.includes(PSEUDO_ID_MARK);

/**
 * 送出前的最後一道防線:找出查詢中殘留的偽 id。
 * 只走訪 stats[].filters[].id 這條**結構化**路徑 —— 絕不可對整個 query 做字串
 * 比對,因為查詢裡有自由文字欄位(賣家帳號等),使用者輸入剛好含標記就會被改壞。
 */
export function findPseudoIds(query) {
  const found = [];
  for (const group of query?.stats ?? []) {
    for (const filter of group?.filters ?? []) {
      if (isPseudoId(filter?.id)) found.push({ id: filter.id, groupType: group.type });
    }
  }
  return found;
}

export const _test = { hash31, slugify, bucketByPrefix, isPureEnum, zhHalf, pseudoId };
