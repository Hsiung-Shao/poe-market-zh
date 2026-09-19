// 交易站物品 JSON → 遊戲「進階物品說明」文字(Ctrl+C 那一份,PoB 吃的就是它)。
//
// ── 為什麼要自己組 ──
// PoE1 的 trade fetch API 會附一份 `item.extended.text`(base64 的遊戲文字),
// 官網結果列那顆「Copy Item」鈕只是把它解碼後丟進剪貼簿。
// **PoE2 的 trade2 沒有這個欄位**(2026-09-19 對 live API 實測),所以 trade2
// 的結果列根本沒有那顆鈕 —— 要在 PoE2 補上同樣的功能,只能自己從結構化 JSON 組。
//
// ── 正確性怎麼保證 ──
// PoE1 同時給了「結構化 JSON」與「官方正解文字」,兩服的 fetch 回應又逐欄同形,
// 所以本檔的產生規則全部是拿 PoE1 的語料**逐字元對答案**得出來的,不是照著
// 印象寫(見 tools/verify-item-text.mjs,語料由 tools/gen-itemtext-corpus.mjs 抓)。
//
// ⚠ **不輸出 `Item Class:` 那一行**。那一行的內容不在 API 的 JSON 裡,只能用
//   基底名去猜;而 PoB 自己在 Item.lua 的註解已經寫明
//   「Item class is already determined by the base type」——它讀到就直接跳過。
//   猜一個可能錯的類別給使用者,不如不寫(無法用官方來源確認就不寫)。
//
// ⚠ 換行一律 CRLF、結尾也有一個 CRLF,與遊戲和官方那份完全一致。
//
// 純函式:不碰 DOM、不碰 chrome API,離線可測。
(function (root) {
  'use strict';

  const SEP = '--------';

  // GGG 的字串標記:`[Key|Display]` 顯示 Display、`[Key]` 顯示 Key。
  // PoE2 的 API 大量使用(`[Quality]`、`[EnergyShield|Energy Shield]`),
  // PoE1 目前沒有 —— 兩邊共用同一支剝除器,有就剝、沒有就原樣。
  // 巢狀會出現(GGPK 實際有三層),由內往外剝到不動為止。
  const MARKUP_PAIR = /\[([^[\]|]+)\|([^[\]]+)\]/g;
  const MARKUP_SOLO = /\[([^[\]|]+)\]/g;
  function stripMarkup(s) {
    let out = String(s ?? '');
    for (let i = 0; i < 3; i++) {
      const next = out.replace(MARKUP_PAIR, '$2').replace(MARKUP_SOLO, '$1');
      if (next === out) break;
      out = next;
    }
    return out;
  }

  // 一條「屬性」行:`名稱: 值1, 值2`(值為空就只印名稱,例如技能寶石的標籤行)。
  // values 的第二欄是顯示型態,1 = 這個值被詞綴加強過 → 遊戲會補「 (augmented)」。
  const TEMPLATE_SLOT = /\{(\d+)\}/g;
  function propLine(p) {
    const name = stripMarkup(p?.name);
    const vals = Array.isArray(p?.values) ? p.values : [];
    if (!vals.length) return name;
    // values 第二欄是**顯示色**:0 是預設,非 0 代表這個值來自詞綴 → 補「 (augmented)」。
    // ⚠ 不是只有 1 才算:武器的元素傷害是 6(閃電色),官方一樣標 (augmented)。
    // ⚠ (augmented) 是**逐個值**標的,不是整行標一次:
    //   「Elemental Damage: 14-32 (augmented), 8-115 (augmented)」
    const shown = vals.map((v) => `${stripMarkup(v?.[0])}${(v?.[1] ?? 0) !== 0 ? ' (augmented)' : ''}`);
    // displayMode 3:名稱本身是模板,{0} 換成對應的值(「Can Store {0} Uses」)
    if (p?.displayMode === 3) {
      return name.replace(TEMPLATE_SLOT, (_m, k) => shown[Number(k)] ?? '');
    }
    return `${name}: ${shown.join(', ')}`;
  }

  // 詞綴陣列有兩種形態:純字串,或 `{ description, hash, mods }`(帶詞綴階級資料)。
  // 兩種都可能出現在同一個回應裡,所以逐筆判斷,不看第一筆就決定。
  // 部分詞綴在遊戲裡會標來源(附魔、工藝、分裂),官方正解語料逐條確認過。
  function modLines(list, suffix) {
    const out = [];
    for (const m of Array.isArray(list) ? list : []) {
      const text = typeof m === 'string' ? m : m?.description;
      if (text == null) continue;
      // 詞綴內部的換行字元原樣保留,不可以拆成兩行 —— 官方正解裡
      //   Projectiles can Chain when impacting the ground / Projectiles do not…
      //   是**一條**詞綴自己帶一個換行,拆開會多出一行。
      out.push(stripMarkup(text) + (suffix ?? ''));
    }
    return out;
  }

  // 插槽:同一組用 `-` 相連,不同組之間空一格。
  // ⚠ 行尾那個空白是遊戲原本就有的(官方正解逐字元比對過),不可以 trim 掉。
  function socketLine(sockets) {
    if (!Array.isArray(sockets) || !sockets.length) return null;
    const groups = [];
    for (const s of sockets) {
      const g = s?.group ?? 0;
      // PoE1 用 sColour(R/G/B/W/A/DV),PoE2 的符文插槽沒有顏色,attr 是 'S'
      const ch = s?.sColour ?? s?.attr ?? 'S';
      (groups[g] ??= []).push(ch);
    }
    return `Sockets: ${groups.filter(Boolean).map((g) => g.join('-')).join(' ')} `;
  }

  // 狀態旗標:遊戲各自成一段印出來。順序取自官方正解語料。
  const FLAGS = [
    ['corrupted', 'Corrupted'],
    ['mirrored', 'Mirrored'],
    ['split', 'Split'],
    ['duplicated', 'Mirrored'],
    ['fractured', 'Fractured Item'],
    ['synthesised', 'Synthesised Item'],
    ['searing', 'Searing Exarch Item'],
    ['tangled', 'Eater of Worlds Item'],
  ];

  // 把一份 trade fetch 的 `item` 物件組成遊戲文字。
  // opts.note:結果列上的價格備註(item.note 沒有時才用,例如 listing 那一側才有價)
  function buildItemText(item, opts) {
    if (!item || typeof item !== 'object') return null;
    const blocks = [];
    const push = (lines) => {
      const arr = (Array.isArray(lines) ? lines : [lines]).filter((l) => l != null && l !== '');
      if (arr.length) blocks.push(arr);
    };

    // ── 抬頭:稀有度 + 名稱 + 基底 ──
    const head = [`Rarity: ${stripMarkup(item.rarity ?? item.frameTypeId ?? 'Normal')}`];
    const name = stripMarkup(item.name ?? '').trim();
    const base = stripMarkup(item.baseType ?? item.typeLine ?? '').trim();
    const typeLine = stripMarkup(item.typeLine ?? '').trim();
    // 瓦爾寶石這類「一個物品兩個技能」的,抬頭印的是**基礎技能**的名字,
    // 瓦爾那一半在後面自成一整段(見下方 hybrid)。
    const hybrid = item.hybrid && typeof item.hybrid === 'object' ? item.hybrid : null;
    const hybridBase = stripMarkup(hybrid?.baseTypeName ?? '').trim();
    if (name) head.push(name);
    // 有名字時第二行是基底;沒名字時只有一行,用畫面上那個 typeLine
    head.push(name ? base : (hybridBase || typeLine));
    push(head);

    // 藥水的 utilityMods(「100% increased Global Critical Strike Chance」)
    // 不另起一段,直接接在屬性後面 —— 官方正解如此。
    push([
      ...(Array.isArray(item.properties) ? item.properties : []).map(propLine),
      ...modLines(item.utilityMods),
    ]);

    const reqs = Array.isArray(item.requirements) ? item.requirements : [];
    if (reqs.length) push(['Requirements:', ...reqs.map(propLine)]);

    push(socketLine(item.sockets));

    if (Number(item.ilvl) > 0) push(`Item Level: ${item.ilvl}`);

    // 地圖的怪物等級自成一段,接在物品等級之後
    if (Number(item.monsterLevel) > 0) push(`Monster Level: ${item.monsterLevel}`);

    // ⚠ 「Unidentified」不在抬頭,而是在物品等級之後自成一段(官方正解如此)
    if (item.identified === false) push('Unidentified');

    // 技能寶石的技能說明(secDescrText)自成一段,在詞綴之前
    push(stripMarkup(item.secDescrText ?? ''));

    push(modLines(item.enchantMods, ' (enchant)'));
    push(modLines(item.scourgeMods));
    push(modLines(item.implicitMods));
    // 一件裝備身上這幾種詞綴是**同一段**,遊戲不會用分隔線把它們拆開
    push([
      ...modLines(item.fracturedMods, ' (fractured)'),
      ...modLines(item.explicitMods),
      ...modLines(item.craftedMods, ' (crafted)'),
      ...modLines(item.veiledMods),
    ]);

    // 瓦爾寶石的另一半:技能名自成一段,接著屬性、說明、詞綴
    if (hybrid) {
      push(typeLine);
      push((Array.isArray(hybrid.properties) ? hybrid.properties : []).map(propLine));
      push(stripMarkup(hybrid.secDescrText ?? ''));
      push(modLines(hybrid.explicitMods));
    }

    push((Array.isArray(item.additionalProperties) ? item.additionalProperties : []).map(propLine));

    // ⚠ flavourText 的每一段結尾帶一個 CR(API 是照遊戲的 CRLF 切的),
    //   不清掉就會在每行尾巴多一個看不見的字元 —— 逐字元比對才抓得到。
    push((Array.isArray(item.flavourText) ? item.flavourText : [])
      .flatMap((t) => stripMarkup(t).split(/\r\n|\r|\n/))
      .filter(Boolean));
    push(stripMarkup(item.descrText ?? ''));

    for (const [key, label] of FLAGS) if (item[key] === true) push(label);

    const note = item.note ?? opts?.note;
    // 價格備註在遊戲裡是 `Note: ~price 1 chaos` —— API 的 note 欄位不含前綴
    if (note) push(`Note: ${stripMarkup(note)}`);

    return `${blocks.map((b) => b.join('\r\n')).join(`\r\n${SEP}\r\n`)}\r\n`;
  }

  // PoE1 的 API 自帶正解,直接解 base64 就好 —— 有就用它,不要用我們組的。
  // (base64 是 UTF-8 的位元組,不能用 atob 直接當字元。)
  function officialItemText(item) {
    const b64 = item?.extended?.text;
    if (typeof b64 !== 'string' || !b64) return null;
    try {
      const bin = atob(b64);
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      return new TextDecoder('utf-8').decode(bytes);
    } catch (_) {
      return null;
    }
  }

  function itemTextFor(item, opts) {
    return officialItemText(item) ?? buildItemText(item, opts);
  }

  const api = { buildItemText, officialItemText, itemTextFor, stripMarkup, _test: { propLine, modLines, socketLine } };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.pmzItemText = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);
