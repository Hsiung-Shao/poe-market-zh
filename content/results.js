// document_end(isolated):搜尋結果頁即時翻譯。
// 詞綴翻譯兩條路徑,依序嘗試:
//   1. **官方 stat id**(主要)—— 官網在每條詞綴的 DOM 上帶
//      data-field="stat.<id>",直接取 id 查 statIdMap,再用該條的美服模板
//      建擷取正則抓出實際數值,填進中文模板。
//   2. 英文全句比對(後備)—— 把數值正規化成 # 查 statMap。
// 之所以以 id 為主:英文全句當鍵太脆弱,措辭、正負號、字面數字任一有出入
// 整條就翻不出來(實測命中率 59% vs id 法 95%)。抓不到 data-field 時
// 自動退回路徑 2,行為與加入 id 查表之前完全相同。
// 兩條路徑都查不到就保留原文(寧缺勿錯)。
// 翻譯採直接替換,英文原文放 title 屬性 hover 可查;popup 可開啟
// 「詞綴雙語顯示」(bilingualMods),改為在中文下方常駐英文原文小字
// (僅裝備詞綴;物品名/天賦卡不受此設定影響)。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  // 本頁是哪一款遊戲。bootstrap.js(document_start,同一個 isolated world)已經算好
  // 並掛在 globalThis;**document_end 這個時點跨檔 globalThis 是可靠的**
  // (壞掉的只有 document_start 那一刻,見 bootstrap.js 的警語)。
  // 仍留一條自己算的備援 —— 萬一 bootstrap 因故沒跑起來,這裡不該跟著整支死掉。
  const GAME =
    globalThis.PMZ_GAME ??
    (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2', label: 'PoE2' } : { id: 'poe1', label: 'PoE1' });
  if (!globalThis.PMZ_GAME) {
    console.warn('[PTM] bootstrap 沒有掛上 PMZ_GAME,結果列改用自算的遊戲別:', GAME.id);
  }
  const TAG = GAME.label;
  const IS_POE2 = GAME.id === 'poe2';
  // storage 鍵:PoE2 一律 `2` 後綴(與 shared/games.js、bootstrap.js 同一組)
  const K = IS_POE2
    ? { statMap: 'statMap2', statIdMap: 'statIdMap2', itemMap: 'itemMap2', uniqueMap: 'uniqueMap2', updated: 'updated2' }
    : { statMap: 'statMap', statIdMap: 'statIdMap', itemMap: 'itemMap', uniqueMap: 'uniqueMap', updated: 'updated' };
  // ⚠ 這張表少一個鍵不會有任何人抗議:`K.漏掉的` 是 undefined,
  //   `chrome.storage.local.get([… , undefined])` 在實機直接拋 TypeError,
  //   init 的 catch 只印一行 warn —— **整支結果列翻譯靜默停擺**。
  //   2026-08-30 加 `updated` 時就這樣炸過一次,所以下面立刻自檢。
  for (const [name, key] of Object.entries(K)) {
    if (typeof key !== 'string' || !key) throw new Error(`[PTM] storage 鍵表缺 ${name}`);
  }

  // ── 官網 DOM 耦合點(改版時優先檢查這裡)──
  const SELECTORS = {
    resultsContainer: '.results',
    mod: '.item-mod',
    modText: '.lc.s',
    // 官方 stat id 的載體,是 .item-mod 的後代。實機結構(2026-07-28 實測):
    //   <div class="item-mod item-mod--explicit">
    //     <span data-field="stat.explicit.stat_3610535490" class="s lc">詞綴文字</span>
    //     <span class="lc l"><span class="d">[30]</span></span>   ← roll 範圍
    //     <span class="lc r"><span class="d">(≥53)</span></span>  ← 物品等級
    //   </div>
    // 帶 data-field 的那個 span 同時就是 .lc.s(class 順序無關),因此譯文
    // 寫回的目標與 id 的來源是同一個元素。
    modField: '[data-field^="stat."]',
    // 傭兵契約書(3.29)的技能區塊。與一般詞綴同為 .item-mod,但結構完全不同:
    //   <div class="item-mod item-mod--mercenary">
    //     <div><img class="lci"><span>技能名</span></div>
    //     <div><span>輔助名</span> ( <span>Tier 3</span> ) </div>
    //   </div>
    // 沒有 <br>、沒有 .lc.s、也沒有 data-field。依 <br> 切行的 modText 會把整塊
    // 黏成一串(實測「Elemental WeaknessIncreased Area of Effect (Tier 2)」),
    // 兩條既有路徑都必然落空,因此改走逐個名稱 span 的專用路徑。
    // 傭兵契約書是 PoE1 3.29 的東西;PoE2 沒有這個區塊,選擇器留著也不會命中
    mercenaryBlock: '.item-mod--mercenary',
    // ── 以下 per-game(2026-08-26 於 PoE2 活站逐項實測)──
    // PoE1:<div class="itemName"><span class="lc">名稱</span></div>
    // PoE2:<div class="item-popup item-popup--unique item-popup--poe2">
    //         <div class="item-popup__header …">
    //           <div class="item-popup__header-line">傳奇名 / 稀有名</div>
    //           <div class="item-popup__header-line">基底名</div>
    //   一張卡最多兩行,兩行各自查表(官方 items 的傳奇名與基底名本來就是兩個欄位)。
    // ⚠ `.notableProperty` / `.itemBoxContent` 在 PoE2 **都不存在**
    //   (星團珠寶/塗油是 PoE1 才有的東西)。
    itemName: IS_POE2 ? '.item-popup__header-line' : '.itemName .lc',
    notable: IS_POE2 ? null : '.notableProperty', // 天賦卡(星團珠寶/塗油)
    notableTitle: '.colourAugmented',
    notableDesc: '.lc',
    // 傳奇卡的根節點(PoE2)。同一個英文可以既是基底/寶石名又是傳奇名
    // (`Briarpatch` = 寶石「荊棘叢」+ 傳奇靴「薔薇眼罩」,台服 trade2 兩者都證實),
    // 一張扁平表分不出來 —— 靠卡片自己的 BEM 修飾字判角色。
    uniqueCard: IS_POE2 ? '.item-popup--unique' : null,
  };

  // 與 bg/translation.js 的正規化規則一致(不含正負號)
  const NUM_RE = /\d+(?:\.\d+)?/g;
  // 負數 roll 用(如 Players have -12% to all maximum Resistances):
  // 模板以 #% 表示、值域為負,查詢與回填需把負號一起吸進 #
  const SIGNED_NUM_RE = /-?\d+(?:\.\d+)?/g;
  const DEBOUNCE_MS = 100;
  // 「譯文殘留英文原文」的取樣上限(見 translateModElement 的說明)
  const DIRTY_SCAN_LIMIT = 40;

  const state = {
    statMap: null,
    statIdMap: null, // { [statId]: { en, zh, src } },依官方 stat id 查表
    itemMap: null, // 基底名 / 寶石名
    uniqueMap: null, // 傳奇名(獨立一張,見 SELECTORS.uniqueCard 的說明)
    passives: null, // { clusterJewel, passivesNotable }(PoE1 專屬)
    bilingualMods: false, // 詞綴雙語顯示(中文下附英文原文小字)
  };

  // 診斷統計(打包後 dbg 為 no-op,只剩極少量計數;可在 console 打
  // __ptmResults() 看目前這批結果的翻譯命中狀況)
  const stat = {
    seen: 0, byId: 0, byText: 0, miss: 0, dirty: 0,
    noField: 0, // 有 .item-mod 但抓不到 data-field(官網改版的警訊)
    reattach: 0, // 結果容器被 SPA 重建後重新掛載監聽的次數
    merc: 0, mercMiss: 0, // 傭兵契約書:譯出的名稱數 / 查無的名稱數
    mercMissSamples: [],
    missSamples: [], dirtySamples: [],
  };

  function fillTemplate(zhTpl, nums) {
    let i = 0;
    return zhTpl.replace(/#/g, () => nums[i++] ?? '#');
  }

  // ── 依官方 stat id 翻譯 ──
  const STAT_FIELD_PREFIX = 'stat.'; // data-field="stat.explicit.stat_123" → explicit.stat_123
  const REGEX_ESCAPE = /[.*+?^${}()|[\]\\]/g;
  // increased/reduced 與 more/less 是**同一個 stat id 的兩種型態**,官方模板
  // 只會給其中一種。原文與模板不同態時必須兩邊同步互換,否則會把「增加」
  // 譯成「減少」—— 語意完全相反。中文側找不到對應詞就放棄 id 路徑,
  // 交給英文全句比對(它用的是精確原文,不會譯反)。
  // 測試用一律非全域 —— /g 正則的 .test() 會保留 lastIndex,同一個物件重複
  // 呼叫會時真時假。替換才用 /g。
  const SYMMETRY = [
    { want: /\bincreased\b/i, has: /\breduced\b/i, swap: /\breduced\b/gi, to: 'increased', zhHas: '減少', zhTo: '增加' },
    { want: /\breduced\b/i, has: /\bincreased\b/i, swap: /\bincreased\b/gi, to: 'reduced', zhHas: '增加', zhTo: '減少' },
    { want: /\bmore\b/i, has: /\bless\b/i, swap: /\bless\b/gi, to: 'more', zhHas: '更少', zhTo: '更多' },
    { want: /\bless\b/i, has: /\bmore\b/i, swap: /\bmore\b/gi, to: 'less', zhHas: '更多', zhTo: '更少' },
  ];

  function applySymmetry(text, enTpl, zhTpl) {
    for (const s of SYMMETRY) {
      // 原文是 want 態、模板是 has 態(且不含 want)才需要互換
      if (!s.want.test(text) || !s.has.test(enTpl) || s.want.test(enTpl)) continue;
      if (!zhTpl.includes(s.zhHas)) return null; // 中文找不到對應詞,不冒險譯反
      return { en: enTpl.replace(s.swap, s.to), zh: zhTpl.split(s.zhHas).join(s.zhTo) };
    }
    return { en: enTpl, zh: zhTpl };
  }

  // 用美服模板當擷取正則:轉義正則特殊字元後,把 # 換成捕獲群組。
  // 比「數值→#」穩健 —— 正負號與字面數字(如 per 100 maximum Mana 的
  // 100)都由模板自己界定,不會被誤當成待填的數值。
  // 純函式,離線可測(見 tools/verify-statid.mjs)。
  function renderStat(text, enTpl, zhTpl) {
    const sym = applySymmetry(text, enTpl, zhTpl);
    if (!sym) return null;
    const pattern = sym.en.replace(REGEX_ESCAPE, '\\$&').replace(/#/g, '(\\S+)');
    let m;
    try {
      m = new RegExp(`^${pattern}$`).exec(text);
    } catch (_) {
      return null; // 模板轉不成合法正則就放棄,交給後備路徑
    }
    if (!m) return null;
    let i = 1;
    return sym.zh.replace(/#/g, () => m[i++] ?? '#');
  }

  function lookupById(mod, text) {
    if (!state.statIdMap) return null;
    let el = null;
    if (mod.matches?.(SELECTORS.modField)) {
      el = mod;
    } else {
      const found = mod.querySelectorAll(SELECTORS.modField);
      // 一個 .item-mod 底下出現多個 stat id 時無從判定這段文字屬於哪一個,
      // 直接放棄 id 路徑交給文字比對,不猜
      if (found.length === 1) el = found[0];
    }
    const field = el?.getAttribute('data-field');
    if (!field) { stat.noField++; return null; }
    const hit = state.statIdMap[field.slice(STAT_FIELD_PREFIX.length)];
    if (!hit) return null;
    const direct = renderStat(text, hit.en, hit.zh);
    if (direct) return direct;
    // ⚠ `(Local)` 是**交易站篩選清單**的消歧義後綴,物品那一行根本不會印它
    //   (「只影響這件裝備本身」的詞綴另發一個 id,文字與全域版一模一樣)。
    //   拿帶後綴的模板去組擷取正則 → `^(\S+) to Accuracy Rating \(Local\)$` ——
    //   對上畫面的「+143 to Accuracy Rating」永遠比不中,整條退回文字路徑,
    //   而文字路徑的鍵同樣帶後綴,也落空 → **完全沒翻**。
    //   受影響的正好是最常見的四個(命中值/護甲值/閃避值/最大能量護盾),
    //   因為它們帶 `+` 號;沒有 `+` 的(增加 #% 攻擊速度)剛好被文字路徑救回來,
    //   所以看起來像「只有幾條沒翻」而不像系統性缺陷(使用者 2026-08-26 回報)。
    //   ⚠ 先試沒剝的再試剝過的:萬一哪天官網真的把後綴印出來,原路徑仍會先命中。
    return renderStat(text, stripLocal(hit.en), stripLocalZh(hit.zh));
  }

  // 台服對應的後綴是「 (部分)」(PoE2 的 US 端 9 個相異 (Local) 模板,台服 8 個是
  // 這個形態、1 個未翻;PoE1 有 20 條)。全形括號一併吃掉,官方兩種都出現過。
  const LOCAL_EN_RE = /\s*\(Local\)\s*$/;
  const LOCAL_ZH_RE = /\s*[(（]部分[)）]\s*$/;
  const stripLocal = (s) => String(s ?? '').replace(LOCAL_EN_RE, '');
  const stripLocalZh = (s) => String(s ?? '').replace(LOCAL_ZH_RE, '');

  // 回傳 { tpl, numRe }:命中的中文模板與應使用的數值抓取規則
  function lookupStat(text) {
    const key = text.replace(NUM_RE, '#');
    let tpl = state.statMap[key] ?? state.statMap[`${key} (Local)`];
    if (tpl) return { tpl, numRe: NUM_RE };
    const signedKey = text.replace(SIGNED_NUM_RE, '#');
    tpl = state.statMap[signedKey] ?? state.statMap[`${signedKey} (Local)`];
    if (tpl) return { tpl, numRe: SIGNED_NUM_RE };
    return null;
  }

  // 依 <br> 把元素內容切成「行 → 該行的文字節點」。官網會把詞綴文字拆進
  // 巢狀元素(強調色的數值等),所以必須走訪所有後代文字節點,只看直接子節點
  // 會漏掉包在子元素裡的片段 —— 那正是譯文與殘留英文黏成一行的原因。
  function textLines(el) {
    const lines = [[]];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT);
    let node = walker.nextNode();
    while (node) {
      if (node.nodeName === 'BR') lines.push([]);
      else if (node.nodeType === Node.TEXT_NODE) lines[lines.length - 1].push(node);
      node = walker.nextNode();
    }
    return lines;
  }

  // 多行詞綴(如征服者壁壘)在字典中是以 \n 分隔的合併模板;
  // textContent 會把 <br> 兩側直接黏在一起,故依行重建
  function modText(el) {
    return textLines(el)
      .map((nodes) => nodes.map((n) => n.textContent).join('').trim())
      .join('\n')
      .trim();
  }

  // 翻譯結果寫回:**非破壞性**逐行替換 —— 結果列由官網 Vue 渲染,
  // 清空重建/增刪節點會讓 Vue 的 virtual DOM 與實際 DOM 不符,重繪時
  // diff 中斷,整個結果區卡死(卡 Searching)。只改既有文字節點的內容、
  // 保留 <br> 與節點結構:每行第一個文字節點寫入整行譯文,同行其餘
  // 文字節點清空(節點保留)。
  function setModText(el, zh) {
    const zhLines = zh.split('\n');
    textLines(el).forEach((nodes, i) => {
      if (!nodes.length) return;
      nodes[0].textContent = zhLines[i] ?? '';
      // 同行其餘節點清空(節點保留,不增刪)—— 未清乾淨就會殘留英文接在譯文後面
      for (let k = 1; k < nodes.length; k++) nodes[k].textContent = '';
    });
  }

  // ── 傭兵契約書(3.29)──
  // 官方交易 API 有 `mercenary.*` 這組條目(兩服各 534 條、依 id 完全對接),
  // 但結果列的 DOM **不帶 data-field**,拿不到 id,只能以英文名反查。
  // API 的條目文字含階級後綴(`Greater More Duration (Tier 3)` /
  // 「高階更多持續時間 (階級 3)」),而畫面上名稱與階級是**分開兩個元素**,
  // 所以建表時把兩邊的後綴都剝掉,只留名稱本體;
  // 「(Tier N)」那段由官網自己查 `__['Tier {tier}']` 翻(見 page/ui-strings.js)。
  const MERC_ID_PREFIX = 'mercenary.';
  const TIER_EN_RE = /\s*\(Tier\s*\d+\)\s*$/;
  const TIER_ZH_RE = /\s*[(（]階級\s*\d+[)）]\s*$/;

  // 純函式,離線可測(tools/verify-mercenary.mjs)
  function buildMercenaryNames(statIdMap) {
    const map = new Map();
    for (const [id, v] of Object.entries(statIdMap ?? {})) {
      if (!id.startsWith(MERC_ID_PREFIX)) continue;
      const en = String(v?.en ?? '').replace(TIER_EN_RE, '').trim();
      const zh = String(v?.zh ?? '').replace(TIER_ZH_RE, '').trim();
      // en === zh 代表官方那筆根本沒翻,收進來只會讓 hover 原文變成中文
      if (!en || !zh || en === zh) continue;
      map.set(en, zh);
    }
    return map;
  }

  let mercNames = null;
  function mercenaryNames() {
    if (!mercNames) mercNames = buildMercenaryNames(state.statIdMap);
    return mercNames;
  }

  // 階級那段官網走的是**新版 Vue3 的 gettext i18n**(`catalog[lang]...`),
  // 而它在英文站是 `lang === defaultLang → 直接回原文`,連查表都不做 ——
  // 也就是說塞進 page/ui-strings.js 的 `__` 字典完全沒有作用,只能在這裡翻。
  // 「階級 N」是官方用詞:台服 trade API 的傭兵條目即為「… (階級 3)」。
  // 純函式,離線可測。
  const TIER_TEXT_RE = /^Tier\s*(\d+)$/;
  function tierText(text) {
    const m = TIER_TEXT_RE.exec(String(text ?? '').trim());
    return m ? `階級 ${m[1]}` : null;
  }

  function translateMercenary(mod) {
    const names = mercenaryNames();
    if (!names.size) return;
    // 逐個 span 比對:技能名與輔助名各自一個 span,階級那個 span 內容是
    // 「Tier 3」不在表內,自然略過,不必特別排除
    mod.querySelectorAll('span').forEach((span) => {
      const text = modText(span);
      if (!text) return;
      // 階級:自己翻,不進名稱表也不算命中/漏譯
      const tier = tierText(text);
      if (tier) { setModText(span, tier); return; }
      const zh = names.get(text);
      if (!zh) {
        if (stat.mercMissSamples.length < 5) {
          stat.mercMiss++;
          stat.mercMissSamples.push(text.slice(0, 50));
        }
        return;
      }
      setModText(span, zh);
      stat.merc++;
      if (state.bilingualMods) {
        // 英文原文要掛在**整行的容器**上,不能 append 進 span:span 是行內元素,
        // 塞 block 進去會把同一行後面的「(階級 N)」擠到下一行(使用者實測回報)
        const line = span.parentElement ?? span;
        const orig = document.createElement('div');
        orig.className = 'ptm-orig';
        orig.style.cssText = 'font-size:11px;color:#7a6f5a;line-height:1.3;';
        orig.textContent = text;
        line.appendChild(orig);
      } else {
        span.title = text;
      }
    });
  }

  function translateModElement(mod) {
    if (mod.dataset.ptmDone) return;
    // 傭兵區塊要在既有邏輯之前攔下:它同樣是 .item-mod,但整塊沒有 <br>,
    // 走既有路徑只會把整塊黏成一串然後算成「查無」
    if (mod.matches?.(SELECTORS.mercenaryBlock)) {
      translateMercenary(mod);
      mod.dataset.ptmDone = '1';
      return;
    }
    const el = mod.querySelector(SELECTORS.modText) ?? mod;
    const text = modText(el);
    if (!text) return;
    stat.seen++;
    // 主要路徑:官方 stat id;失敗才退回英文全句比對
    let zh = lookupById(mod, text);
    if (zh) stat.byId++;
    else {
      const hit = state.statMap ? lookupStat(text) : null;
      if (hit) {
        stat.byText++;
        zh = fillTemplate(hit.tpl, text.match(hit.numRe) ?? []);
      }
    }
    if (!zh) {
      stat.miss++;
      if (stat.missSamples.length < 5) stat.missSamples.push(text.slice(0, 70));
    }
    if (zh) {
      setModText(el, zh);
      // 譯文寫回後若元素裡還殘留英文原文,代表官網把文字拆進了我們沒清到的
      // 結構(中英會黏成一行)。這是使用者回報過的症狀,留樣本供比對。
      // ⚠ 這個檢查會**再走一次 TreeWalker**,等於每條詞綴多付 1/3 的走訪成本。
      //   它只是為了留診斷樣本 —— 症狀是結構性的,前幾十條看不到就不會有,
      //   對整批全掃拿不到任何多的資訊。只對前 DIRTY_SCAN_LIMIT 條取樣。
      if (stat.seen <= DIRTY_SCAN_LIMIT) {
        const after = modText(el);
        if (after !== zh) {
          stat.dirty++;
          if (stat.dirtySamples.length < 3) {
            stat.dirtySamples.push({ 期望: zh.slice(0, 50), 實際: after.slice(0, 80), html: el.innerHTML.slice(0, 200) });
          }
        }
      }
      if (state.bilingualMods) {
        // 雙語模式:中文下方常駐英文原文小字(lite 版不掛 css,樣式 inline)
        const orig = document.createElement('div');
        orig.className = 'ptm-orig';
        orig.style.cssText = 'font-size:11px;color:#7a6f5a;line-height:1.3;';
        orig.textContent = text;
        el.appendChild(orig);
      } else {
        el.title = text; // 英文原文 hover 可查
      }
    }
    mod.dataset.ptmDone = '1';
  }

  // 這一行是不是「傳奇卡的第一行(= 傳奇名)」。PoE2 的傳奇卡兩行都是
  // .item-popup__header-line:第一行傳奇名、第二行基底名。
  function isUniqueNameLine(el) {
    if (!state.uniqueMap || !SELECTORS.uniqueCard) return false;
    if (!el.closest?.(SELECTORS.uniqueCard)) return false;
    return el.parentElement?.querySelector(SELECTORS.itemName) === el;
  }

  function translateNameElement(el) {
    if (el.dataset.ptmDone) return;
    const text = el.textContent.trim();
    // 傳奇名優先查 uniqueMap;其餘(含傳奇卡第二行的基底名)走 itemMap
    const zh = (isUniqueNameLine(el) ? state.uniqueMap[text] : null) ?? state.itemMap[text];
    if (zh) {
      // 字典值多為「中文 (English)」;結果列採直接替換,strip 為純中文,
      // 英文原文放 hover title
      const suffix = ` (${text})`;
      el.textContent = zh.endsWith(suffix) ? zh.slice(0, -suffix.length) : zh;
      el.title = text;
    }
    el.dataset.ptmDone = '1';
  }

  // 天賦卡翻譯:標題查 clusterJewel → passivesNotable;
  // 描述區 .lc 內容為以 <br> 分隔的文字行,第一行保留、其後逐行替換
  // (以節點操作實作,不使用 innerHTML)
  function translateNotable(elm) {
    if (elm.dataset.ptmNotable) return;
    elm.dataset.ptmNotable = '1';
    const titleEl = elm.querySelector(SELECTORS.notableTitle);
    if (!titleEl) return;
    const name = titleEl.textContent.trim();
    const data =
      state.passives.clusterJewel?.[name]?.zh_tw ?? state.passives.passivesNotable?.[name]?.zh_tw;
    if (!data?.name) return;
    titleEl.textContent = data.name;
    titleEl.title = name;
    const lc = elm.querySelector(SELECTORS.notableDesc);
    if (!lc || !Array.isArray(data.desc)) return;
    // 依 <br> 切行,與翻譯資料的行序對位
    const lines = [[]];
    for (const node of [...lc.childNodes]) {
      if (node.nodeName === 'BR') lines.push([]);
      else lines[lines.length - 1].push(node);
    }
    lines.forEach((nodes, idx) => {
      if (idx === 0 || !nodes.length) return; // 第一行為標題/空行,保留
      const zh = data.desc[idx - 1];
      if (!zh) return;
      nodes[0].replaceWith(document.createTextNode(zh));
      nodes.slice(1).forEach((n) => n.remove());
    });
  }

  let statTimer = null;
  function reportStats() {
    if (statTimer) return;
    statTimer = setTimeout(() => {
      statTimer = null;
      if (!stat.seen && !stat.merc) return;
      if (stat.seen) {
        dbg(`[PTM/${TAG}] 結果列:詞綴 ${stat.seen} 條 → id 命中 ${stat.byId}、文字命中 ${stat.byText}、` +
          `查無 ${stat.miss};譯文殘留原文 ${stat.dirty} 條(僅前 ${DIRTY_SCAN_LIMIT} 條取樣)`);
      }
      if (stat.merc || stat.mercMiss) {
        dbg(`[PTM/${TAG}] 結果列:傭兵技能/輔助 譯出 ${stat.merc} 條、查無 ${stat.mercMiss} 條`);
        if (stat.mercMiss) dbg('[PTM] 傭兵查無樣本:', stat.mercMissSamples);
      }
      // id 路徑完全沒命中代表 data-field 抓不到(官網改版),此時全靠後備的
      // 英文全句比對,命中率會明顯掉下來 —— 值得在主控台明說
      if (state.statIdMap && stat.seen && !stat.byId) {
        console.warn(`[PTM] 未從 data-field 取得任何官方詞綴 id(${stat.noField} 條無此屬性),` +
          '已全部退回英文全句比對。官網可能改版,請回報。');
      }
      if (stat.miss) dbg('[PTM] 查無翻譯樣本:', stat.missSamples);
      if (stat.dirty) console.warn('[PTM] 譯文殘留英文原文(中英會黏成一行),樣本:', stat.dirtySamples);
    }, 500);
  }

  // ── 大表延後載入 ──
  // 每張表只會真的 get 一次;重複呼叫拿到的是同一個 promise。
  const loading = {};
  function loadTable(name, key, assign) {
    if (loading[name]) return loading[name];
    loading[name] = chrome.storage.local
      .get(key)
      .then((got) => { assign(got[key] ?? null); })
      .catch((err) => { console.warn(`[PTM] ${name} 載入失敗:`, err); });
    return loading[name];
  }

  // 詞綴的兩張表。statMap 是 statIdMap 落空時的後備,兩條路徑都可能用到,
  // 所以一起載 —— 分開載只是把同一批成本拆成兩次跨程序往返。
  const ensureStatTables = () =>
    Promise.all([
      loadTable('statIdMap', K.statIdMap, (v) => { state.statIdMap = v; }),
      loadTable('statMap', K.statMap, (v) => { state.statMap = v; }),
    ]);

  // 天賦卡(星團珠寶/塗油)只有 PoE1 有,而且只在搜那類東西時才會出現在結果列 ——
  // 不預載,真的看到 .notableProperty 才付這 0.20 MB。
  const ensurePassives = () =>
    SELECTORS.notable
      ? loadTable('passives', 'passives', (v) => { state.passives = v; })
      : Promise.resolve();

  // 搜尋結果從送出到回來要好幾秒(2026-08-30 活站實測第一筆 7.8 s),閒置時
  // 預載綽綽有餘;真的比預載更早到,processContainer 會 await 一次。
  function preloadBigTables() {
    const go = () => { ensureStatTables(); };
    if (typeof requestIdleCallback === 'function') requestIdleCallback(go, { timeout: 3000 });
    else setTimeout(go, 1500);
  }

  async function processContainer(root) {
    // 詞綴需要 statIdMap 或 statMap(皆為官方 API 產物,任一有就能翻);
    // 物品名/天賦卡只需內建字典,各自獨立降級
    const mods = root.querySelectorAll(SELECTORS.mod);
    if (mods.length) {
      await ensureStatTables();
      if (state.statIdMap || state.statMap) mods.forEach(translateModElement);
    }
    if (state.itemMap) {
      root.querySelectorAll(SELECTORS.itemName).forEach(translateNameElement);
    }
    // 天賦卡只有 PoE1 有(PoE2 結果列沒有 .notableProperty),選擇器為 null 就整段跳過
    if (SELECTORS.notable) {
      const notables = [...root.querySelectorAll(SELECTORS.notable)];
      if (root.matches?.(SELECTORS.notable)) notables.push(root);
      if (notables.length) {
        await ensurePassives();
        if (state.passives) notables.forEach(translateNotable);
      }
    }
    // 詞綴群組名中文化 + 加入篩選按鈕(content/mod-row.js,同一個 isolated world)。
    // 掛在這裡而不是另開一套 MutationObserver —— 結果列串流時每一列都會經過
    // 這裡,多一套監聽只是多付一份成本。沒載入就自然跳過。
    globalThis.__pmzModRow?.(root);
    reportStats();
  }

  // ── 兩階段監聽:等結果容器出現 → 監聽新增列 ──
  let debounceTimer = null;
  const pending = new Set();

  function schedule(node) {
    pending.add(node);
    if (debounceTimer) return;
    debounceTimer = setTimeout(() => {
      debounceTimer = null;
      // 串流時官網一列一列塞進來,同一批常常同時收到父節點與它底下的子節點。
      // 子節點會被父節點那次 querySelectorAll 完整涵蓋,再跑一次純粹是白工 ——
      // 只留批次中最上層的那些。走祖先鏈(DOM 深度個位數)比兩兩 contains 便宜。
      const roots = [...pending].filter((n) => {
        for (let p = n.parentElement; p; p = p.parentElement) if (pending.has(p)) return false;
        return true;
      });
      pending.clear();
      roots.forEach((n) => { processContainer(n).catch((err) => console.warn('[PTM] 結果列處理失敗:', err)); });
    }, DEBOUNCE_MS);
  }

  // 官網是 SPA,切到 History 分頁(/trade/history)會把整個搜尋畫面連同
  // .results 容器銷毀,切回搜尋分頁時建立的是**全新節點**。
  // 2026-07-29 於官網實測:切走後舊節點 isConnected=false、全頁 .results
  // 歸零;切回後的節點與原節點不同一。(切「大宗通貨交易」則不會重建。)
  // 舊寫法找到容器一次就把 body observer disconnect,此後永遠監聽那個已
  // 脫離文件的節點 —— 使用者回報的「History 來回後結果完全沒翻譯」即此,
  // 而且完全無聲。因此 body observer 改為常駐,容器被換掉就重新掛上去。
  let container = null;
  let containerObserver = null;

  // 判定某個新增節點是否代表「結果容器被重建」。純函式,離線可測
  // (tools/verify-results-watch.mjs)。以有無 matches 方法辨識元素節點,
  // 文字節點自然被濾掉,不依賴 instanceof 以便在測試沙箱中執行。
  function newContainerIn(node, current) {
    if (!node || typeof node.matches !== 'function') return null;
    // 結果列串流時每一列都會進到這裡,而列是掛在現用容器底下的,先擋掉
    // 才不會每列都跑一次 querySelector
    if (current && current.contains?.(node)) return null;
    const found = node.matches(SELECTORS.resultsContainer)
      ? node
      : node.querySelector(SELECTORS.resultsContainer);
    return found && found !== current ? found : null;
  }

  function attachContainer(el) {
    if (containerObserver) containerObserver.disconnect();
    container = el;
    containerObserver = new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) schedule(node);
        }
      }
    });
    containerObserver.observe(el, { childList: true, subtree: true });
    processContainer(el).catch((err) => console.warn('[PTM] 結果列處理失敗:', err));
  }

  function waitForResults() {
    const existing = document.querySelector(SELECTORS.resultsContainer);
    if (existing) attachContainer(existing);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          const found = newContainerIn(node, container);
          if (!found) continue;
          stat.reattach++;
          dbg(`[PTM/${TAG}] 結果容器已重建(第 ${stat.reattach} 次),重新掛上監聽`);
          attachContainer(found);
          return;
        }
      }
    }).observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    // ── 只載小表 ──
    // 詞綴表很大(2026-08-30 實測:statIdMap 2.45 MB + statMap 1.01 MB,
    // 五張表一次 get 共 3.90 MB),而 `chrome.storage.local.get` 是跨程序搬運 ——
    // 每開一個交易站分頁都在開頁的關鍵路徑上付這個代價,偏偏交易站首頁
    // (還沒搜尋)一條詞綴都沒有。大表改成閒置時預載,見下方 preloadBigTables。
    const got = await chrome.storage.local.get([
      'language',
      K.itemMap, // 0.24 MB,物品名一進頁面就可能要用
      K.uniqueMap,
      K.updated, // 只用來判斷「這一款到底建置過沒有」
      'bilingualMods',
    ]);
    if (got.language !== 'zh_tw') return;
    state.itemMap = got[K.itemMap] ?? null; // 內建字典即可提供
    state.uniqueMap = got[K.uniqueMap] ?? null;
    state.bilingualMods = got.bilingualMods === true;
    // 無資料就不掛 observer(建置過就會有 updated,詞綴表稍後才載得進來)
    if (!got[K.updated] && !state.itemMap) return;
    dbg(`[PTM/${TAG}] 結果列:物品表 ${Object.keys(state.itemMap ?? {}).length} 條、` +
      `傳奇名表 ${Object.keys(state.uniqueMap ?? {}).length} 條、` +
      `雙語顯示 ${state.bilingualMods ? '開' : '關'};詞綴表待閒置時載入`);
    // 手動診斷:在 console 打 __ptmResults() 看目前這批結果的命中狀況
    // 打包版 dbg 為 no-op,但在 console 直接呼叫仍看得到回傳值
    window.__ptmResults = () => { dbg('[PTM] 結果列診斷', stat); return stat; };
    // 供離線驗證腳本呼叫真正的實作與常數(不另外複製一份,避免測試與實機分歧)
    window.__ptmRenderStat = renderStat;
    window.__ptmInternals = {
      SELECTORS,
      statIdOf: (field) => field.slice(STAT_FIELD_PREFIX.length),
      newContainerIn,
      buildMercenaryNames,
      tierText,
      loadTable,
    };
    waitForResults();
    preloadBigTables();
  }

  init().catch((err) => console.warn('[PTM] results 初始化失敗:', err));
})();
