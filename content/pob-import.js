// Path of Building 匯入(純邏輯:不碰 chrome API、不碰 DOM)。
// 把一份 PoB code 拆成「每件裝備一個交易站搜尋」,交給書籤那邊建資料夾。
//
//   PoB code = base64url( zlib( XML ) )
//   XML 裡有三個東西是我們要的:
//     <Build className= ascendClassName=>      流派名
//     <ItemSet><Slot name= itemId=>            裝備部位 → 裝備編號(itemId=0 是空的)
//     <Spec><Sockets><Socket nodeId= itemId=>  天賦樹上的珠寶
//     <Item id=>…</Item>                       裝備本體(純文字,逐行)
//
// 搜尋條件(使用者裁定 2026-08-14):
//   · 傳奇/遺物 → 傳奇名 + 基底,精準命中
//   · 稀有/魔法 → 基底 + **全部詞綴**(數值當下限),到交易站再自己取消不要的
//
// XML 用正則讀,不用 DOMParser —— 這樣瀏覽器與 node 測試跑的是同一份實作
// (見 error_test_double_diverges_from_real:替身與本尊不同等於沒測)。
(function (root) {
  'use strict';

  // 物品文字裡「key: value」形式的資料行,不是詞綴
  const META_KEYS = new Set([
    'Rarity', 'Unique ID', 'Item Level', 'LevelReq', 'Implicits', 'Quality', 'Sockets',
    'Armour', 'Evasion', 'Energy Shield', 'Ward',
    'ArmourBasePercentile', 'EvasionBasePercentile', 'EnergyShieldBasePercentile', 'WardBasePercentile',
    'Cluster Jewel Node Count', 'Cluster Jewel Skill', 'Selected Variant', 'Has Alt Variant',
    'Has Alt Variant Two', 'Has Alt Variant Three', 'Has Alt Variant Four', 'Has Alt Variant Five',
    'League', 'Source', 'Talisman Tier', 'Catalyst', 'CatalystQuality', 'Prefix', 'Suffix',
    'Crafted', 'Radius', 'Limited to', 'Requires', 'Physical Damage', 'Elemental Damage',
    'Chaos Damage', 'Critical Strike Chance', 'Attacks per Second', 'Weapon Range', 'Range',
    'Implicit', 'Enchant', 'Rune', 'Charm', 'Intangibility',
  ]);
  // 沒有冒號、但也不是詞綴的狀態行
  const FLAG_LINES = new Set([
    'Corrupted', 'Mirrored', 'Split', 'Unmodifiable', 'Fractured Item', 'Synthesised Item',
    'Searing Exarch Item', 'Eater of Worlds Item', 'Shaper Item', 'Elder Item',
    'Crusader Item', 'Redeemer Item', 'Hunter Item', 'Warlord Item', 'Replica',
  ]);

  const SLOT_ZH = {
    'Weapon 1': '主手', 'Weapon 2': '副手',
    'Weapon 1 Swap': '換手主手', 'Weapon 2 Swap': '換手副手',
    Helmet: '頭盔', 'Body Armour': '胸甲', Gloves: '手套', Boots: '鞋子',
    Amulet: '項鍊', 'Ring 1': '戒指 1', 'Ring 2': '戒指 2', 'Ring 3': '戒指 3', Belt: '腰帶',
    'Flask 1': '藥水 1', 'Flask 2': '藥水 2', 'Flask 3': '藥水 3', 'Flask 4': '藥水 4', 'Flask 5': '藥水 5',
    Trinket: '飾品', Charm: '護符',
  };
  const CATEGORIES = ['武器', '防具', '飾品', '珠寶', '藥水', '其他'];

  // ── local 詞綴 ──
  // 官方交易站對「只影響這件裝備本身」的詞綴另發一個代碼,文字尾巴多 " (Local)"
  // (武器攻速 explicit.stat_210067635 vs 全域攻速 explicit.stat_681332047)。
  // PoB 匯出的物品文字兩者寫法完全一樣(都是「12% increased Attack Speed」),
  // 光看句子分不出來 —— 得看它掛在什麼裝備上。
  //
  // 分武器組/防具組是必要的,不能合成一組:手套的「+# to Accuracy Rating」是全域的,
  // 只有武器上的那句才是 local。以下兩組取自 POB 的 Mod*.lua(tradeHashes + weightKey,
  // 語言無關、GGG 原始資料):20 條 local 詞綴的落點零重疊,武器組只長在 weapon/bow/
  // wand… 這些 tag 上,防具組只長在 *_armour/shield/body_armour 上。
  // ⚠ 新賽季若多了 local 詞綴,verify-pob-import 的集合相等斷言會 FAIL,補進來即可。
  const LOCAL_WEAPON_MODS = new Set([
    '#% increased Attack Speed',
    'Adds # to # Physical Damage',
    'Adds # to # Fire Damage',
    'Adds # to # Cold Damage',
    'Adds # to # Lightning Damage',
    'Adds # to # Chaos Damage',
    '+# to Accuracy Rating',
    '#% of Physical Attack Damage Leeched as Life',
    '#% of Physical Attack Damage Leeched as Mana',
    '#% chance to Poison on Hit',
  ]);
  const LOCAL_ARMOUR_MODS = new Set([
    '+# to Armour',
    '+# to Evasion Rating',
    '+# to maximum Energy Shield',
    '#% increased Armour',
    '#% increased Evasion Rating',
    '#% increased Energy Shield',
    '#% increased Armour and Energy Shield',
    '#% increased Armour and Evasion',
    '#% increased Evasion and Energy Shield',
    '#% increased Armour, Evasion and Energy Shield',
  ]);

  const ARMOUR_SLOTS = /^(Helmet|Body Armour|Gloves|Boots)$/;
  const WEAPON_SLOTS = /^Weapon [12](?: Swap)?$/;

  // 這件裝備身上的詞綴,哪一組該換成 local 版本?回 'weapon' / 'armour' / null。
  // ⚠ 盾與箭袋都掛在 PoB 的「Weapon 2」,但兩者都不該當武器看:
  //    · 盾的攻速/命中/加成傷害在遊戲裡是全域的(POB 的 weightKey 有 dex_shield 等),
  //      而它的護甲/閃避是 local → 當防具看,靠基底防禦值認出來
  //    · 箭袋沒有防禦值,而且它的加值全是全域的 → 直接排除(69 個箭袋基底
  //      全部以 " Quiver" 結尾,已對官方 items 清單回測)
  function localKindOf(item) {
    const slot = String(item?.slot ?? '');
    const base = String(item?.base ?? '');
    if (ARMOUR_SLOTS.test(slot)) return 'armour';
    if (!WEAPON_SLOTS.test(slot)) return null; // 戒指/項鍊/腰帶/珠寶/藥水/護符/移植體
    if (/ Quiver$/.test(base)) return null;
    if (item?.hasDefence) return 'armour';
    return 'weapon';
  }

  function categoryOf(slotName, isJewel) {
    if (isJewel) return '珠寶';
    const s = String(slotName ?? '');
    if (/^Weapon/.test(s)) return '武器';
    if (/^(Helmet|Body Armour|Gloves|Boots)$/.test(s)) return '防具';
    if (/^(Amulet|Ring|Belt|Trinket)/.test(s)) return '飾品';
    if (/^Flask/.test(s)) return '藥水';
    return '其他';
  }

  // ── PoB code → XML ──
  async function decodePobCode(text) {
    const cleaned = String(text ?? '').replace(/\s+/g, '');
    if (!cleaned) throw new Error('沒有內容');
    const std = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) throw new Error('這段文字不是 PoB code(不是 base64)');
    let bytes;
    try {
      const binary = root.atob(padded);
      bytes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    } catch (_) {
      throw new Error('這段文字不是 PoB code(base64 解不開)');
    }
    // PoB 用的是帶 zlib 標頭的 deflate(magic 78 xx),對應 'deflate' 而不是 'deflate-raw'
    if (bytes.length < 2 || bytes[0] !== 0x78) throw new Error('這段文字不是 PoB code(不是 zlib 壓縮)');
    let xml;
    try {
      const stream = new root.DecompressionStream('deflate');
      const decompressed = new root.Response(
        new root.Blob([bytes]).stream().pipeThrough(stream)
      );
      xml = await decompressed.text();
    } catch (err) {
      throw new Error(`PoB code 解壓失敗:${String(err?.message ?? err)}`);
    }
    if (!/<PathOfBuilding/.test(xml)) throw new Error('解出來的不是 Path of Building 存檔');
    return xml;
  }

  // ── XML 讀取(只取需要的三種節點)──
  function unescapeXml(s) {
    return String(s)
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#(\d+);/g, (_, d) => String.fromCharCode(Number(d)))
      .replace(/&amp;/g, '&');
  }

  function attrsOf(fragment) {
    const out = {};
    const re = /([A-Za-z_][\w:-]*)\s*=\s*"([^"]*)"/g;
    let m;
    while ((m = re.exec(fragment))) out[m[1]] = unescapeXml(m[2]);
    return out;
  }

  function tagsOf(xml, tag) {
    const out = [];
    const re = new RegExp(`<${tag}\\b([^>]*)/?>`, 'g');
    let m;
    while ((m = re.exec(xml))) out.push(attrsOf(m[1]));
    return out;
  }

  function itemBlocks(xml) {
    const out = [];
    const re = /<Item\b([^>]*)>([\s\S]*?)<\/Item>/g;
    let m;
    while ((m = re.exec(xml))) {
      const attrs = attrsOf(m[1]);
      // ⚠ Item 的內文除了逐行的物品文字,還夾著 <ModRange range=… id=…/> 這類子元素
      //   (一件裝備可以有十幾個)。先把標籤清掉,否則它們會被當成詞綴送去查表。
      out.push({ id: attrs.id ?? '', text: unescapeXml(m[2].replace(/<[^>]*>/g, '')) });
    }
    return out;
  }

  // ── 單件裝備的文字 → 結構 ──
  function parseItemText(text) {
    const lines = String(text ?? '')
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean);
    if (!lines.length) return null;
    const rarity = (lines[0].match(/^Rarity:\s*(\w+)/i) ?? [])[1]?.toUpperCase() ?? 'NORMAL';
    const name = lines[1] ?? '';
    // 第三行沒有冒號、也不是狀態行時才是基底名。魔法物品(藥水)沒有這一行 ——
    // 它的基底藏在「前綴 基底 of 後綴」裡,拆不可靠,所以就不帶基底(見 itemToQuery)。
    const third = lines[2] ?? '';
    const hasBase = !!third && !third.includes(':') && !FLAG_LINES.has(third);
    const base = hasBase ? third : '';
    let implicits = 0;
    // 基底防禦值。盾牌掛在「Weapon 2」,只有這幾行認得出它不是武器(見 localKindOf)。
    let hasDefence = false;
    const mods = [];
    for (const line of lines.slice(hasBase ? 3 : 2)) {
      const key = line.split(':')[0];
      if (line.includes(':') && META_KEYS.has(key)) {
        if (key === 'Implicits') implicits = Number(line.split(':')[1]) || 0;
        if (/^(Armour|Evasion|Energy Shield|Ward):\s*\d/.test(line)) hasDefence = true;
        continue;
      }
      if (FLAG_LINES.has(line)) continue;
      mods.push(line);
    }
    return { rarity, name, base, implicits, hasDefence, mods };
  }

  // ── 詞綴 → 官方詞綴代碼 ──
  // statIdMap 是 { [官方 id]: { en, zh } },這裡建反查:英文模板 → [id…]
  // ⚠ 官方模板裡不是每個數字都是待填值:「#% chance to gain Onslaught for 4 seconds on Kill」
  //   的 4 是字面值。PoB 那邊寫的是完整句子(13% … for 4 seconds …),把所有數字都換成 #
  //   就對不上這種模板。所以第二層索引用「骨架」:數字與 # 全部拿掉再比,對上之後
  //   再用模板轉成的正則精確驗證(# → 一個數值),避免骨架相同但意思不同的誤配。
  function skeleton(s) {
    return String(s).replace(/#|-?\d+(?:\.\d+)?/g, ' ').replace(/\s+/g, ' ').trim();
  }

  function buildStatIndex(statIdMap) {
    const index = new Map();
    const bySkeleton = new Map();
    for (const [id, v] of Object.entries(statIdMap ?? {})) {
      const en = v?.en;
      if (!en) continue;
      if (!index.has(en)) index.set(en, []);
      index.get(en).push(id);
      const sk = skeleton(en);
      if (!bySkeleton.has(sk)) bySkeleton.set(sk, []);
      bySkeleton.get(sk).push({ id, en });
    }
    index.bySkeleton = bySkeleton;
    return index;
  }

  function templateToRegex(en) {
    const escaped = String(en).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`^${escaped.replace(/#/g, '(-?[\\d.]+)')}$`);
  }

  // 數值換成 #,其餘(含 + 號)照原樣 —— 官方模板就是這個形狀(+#% to Cold Resistance)
  function normalizeMod(line) {
    const clean = String(line ?? '').replace(/\{[a-z ]+\}/gi, '').trim();
    const values = [];
    const template = clean.replace(/-?\d+(?:\.\d+)?/g, (m) => {
      values.push(Number(m));
      return '#';
    });
    return { clean, template, values };
  }

  function pickId(candidates, wantImplicit) {
    if (!candidates || !candidates.length) return null;
    const prefer = wantImplicit ? 'implicit.' : 'explicit.';
    return (
      candidates.find((id) => id.startsWith(prefer)) ??
      candidates.find((id) => id.startsWith('explicit.')) ??
      candidates[0]
    );
  }

  // 這一行該不該換成 local 版本?
  // ⚠ implicit 只有武器要換:防具的 implicit 版 %護甲/%閃避 全部來自灼熱議會/世界吞噬者
  //   的 eldritch implicit,那是**全域**的;而武器基底自帶的 implicit 確實是 local
  //   (鎚的攻速、劍的命中、爪的偷取、弓的加成傷害,見 POB Data/Bases/*.lua)。
  function wantsLocal(localKind, wantImplicit, forms) {
    if (localKind === 'weapon') return forms.some((f) => LOCAL_WEAPON_MODS.has(f));
    if (localKind === 'armour' && !wantImplicit) return forms.some((f) => LOCAL_ARMOUR_MODS.has(f));
    return false;
  }

  // clean 是原始那行(數值還在),template 是數值換成 # 之後的
  function lookupStatId(index, template, wantImplicit, clean, localKind) {
    // 官方模板的 + 號有無不一定與 PoB 一致,三種形式都試
    const forms = [template, template.replace(/^\+/, ''), `+${template}`];
    if (wantsLocal(localKind, wantImplicit, forms)) {
      for (const f of forms) {
        const hit = index.get(`${f} (Local)`);
        if (hit?.length) return pickId(hit, wantImplicit);
      }
    }
    const exact = index.get(forms[0]) ?? index.get(forms[1]) ?? index.get(forms[2]) ?? null;
    if (exact?.length) return pickId(exact, wantImplicit);
    // 骨架比對:官方模板含字面數字時,精確比對必然落空
    const line = clean ?? template;
    const near = index.bySkeleton?.get(skeleton(template)) ?? [];
    const matched = near.filter((c) => templateToRegex(c.en).test(line));
    if (matched.length) return pickId(matched.map((c) => c.id), wantImplicit);
    return null;
  }

  // ── 單件裝備 → 交易站查詢 JSON ──
  function itemToQuery(item, statIndex) {
    const unmatched = [];
    const query = { status: { option: 'online' } };
    const unique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC';
    if (unique) {
      // 傳奇:名字加基底就夠精準,不必再帶詞綴(帶了反而搜不到卷軸級的差異)
      query.name = item.name;
      if (item.base) query.type = item.base;
      return { query: { query, sort: { price: 'asc' } }, unmatched, filters: 0 };
    }
    if (item.base) query.type = item.base;
    const localKind = localKindOf(item);
    const filters = [];
    item.mods.forEach((line, i) => {
      const { clean, template, values } = normalizeMod(line);
      if (!template.includes('#') && !/[A-Za-z]/.test(template)) return;
      const id = lookupStatId(statIndex, template, i < item.implicits, clean, localKind);
      if (!id) {
        unmatched.push(clean);
        return;
      }
      const filter = { id };
      if (values.length) filter.value = { min: values[0] };
      filters.push(filter);
    });
    if (filters.length) query.stats = [{ type: 'and', filters }];
    return { query: { query, sort: { price: 'asc' } }, unmatched, filters: filters.length };
  }

  // ── 整份 build ──
  function parsePobBuild(xml) {
    const build = tagsOf(xml, 'Build')[0] ?? {};
    const slots = tagsOf(xml, 'Slot');
    const sockets = tagsOf(xml, 'Socket');
    const blocks = itemBlocks(xml);
    const byId = new Map(blocks.map((b) => [b.id, b]));

    const jewelIds = new Set(sockets.map((s) => s.itemId).filter((id) => id && id !== '0'));
    const items = [];
    const seen = new Set();

    for (const slot of slots) {
      const id = slot.itemId;
      if (!id || id === '0' || seen.has(id)) continue;
      // 深淵珠寶的插槽名長這樣:「Helmet Abyssal Socket 1」
      const abyssal = / Abyssal Socket /.test(slot.name ?? '');
      const block = byId.get(id);
      if (!block) continue;
      const parsed = parseItemText(block.text);
      if (!parsed) continue;
      seen.add(id);
      items.push({
        ...parsed,
        slot: slot.name ?? '',
        slotZh: SLOT_ZH[slot.name] ?? slot.name ?? '',
        category: abyssal ? '珠寶' : categoryOf(slot.name, false),
      });
    }
    for (const id of jewelIds) {
      if (seen.has(id)) continue;
      const block = byId.get(id);
      if (!block) continue;
      const parsed = parseItemText(block.text);
      if (!parsed) continue;
      seen.add(id);
      items.push({ ...parsed, slot: 'Jewel', slotZh: '珠寶', category: '珠寶' });
    }

    const className = build.ascendClassName && build.ascendClassName !== 'None'
      ? build.ascendClassName
      : build.className ?? '';
    return {
      className: build.className ?? '',
      ascendClassName: build.ascendClassName ?? '',
      level: build.level ?? '',
      buildName: className ? `${className}${build.level ? ` Lv${build.level}` : ''}` : 'PoB 匯入',
      items,
      skipped: blocks.length - items.length, // 解不出來或沒有裝在身上的
    };
  }

  // ── 產生書籤資料(交給 bookmarks-model 建資料夾)──
  // 回 { buildName, groups: [{ category, items: [{ name, query, unmatched }] }], report }
  function buildBookmarkPlan(parsed, statIndex) {
    const report = { items: 0, withFilters: 0, unmatchedMods: [], noBase: [] };
    const groups = new Map();
    for (const item of parsed.items) {
      const { query, unmatched, filters } = itemToQuery(item, statIndex);
      const unique = item.rarity === 'UNIQUE' || item.rarity === 'RELIC';
      if (!item.base && !unique) report.noBase.push(item.name);
      if (unmatched.length) report.unmatchedMods.push(...unmatched.map((m) => `${item.name}:${m}`));
      if (filters) report.withFilters++;
      report.items++;
      const cat = item.category;
      if (!groups.has(cat)) groups.set(cat, []);
      groups.get(cat).push({
        name: `${item.slotZh}:${item.name}`,
        query,
        rarity: item.rarity,
        unmatched,
      });
    }
    // 依固定順序輸出,免得資料夾每次匯入排列都不一樣
    const ordered = CATEGORIES.filter((c) => groups.has(c)).map((c) => ({ category: c, items: groups.get(c) }));
    return { buildName: parsed.buildName, groups: ordered, report };
  }

  const api = {
    CATEGORIES,
    SLOT_ZH,
    LOCAL_WEAPON_MODS,
    LOCAL_ARMOUR_MODS,
    decodePobCode,
    parsePobBuild,
    parseItemText,
    categoryOf,
    localKindOf,
    buildStatIndex,
    normalizeMod,
    lookupStatId,
    itemToQuery,
    buildBookmarkPlan,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.pmzPobImport = api;
})(globalThis);
