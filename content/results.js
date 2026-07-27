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
    itemName: '.itemName .lc',
    notable: '.notableProperty', // 天賦卡(星團珠寶/塗油)
    notableTitle: '.colourAugmented',
    notableDesc: '.lc',
  };

  // 與 bg/translation.js 的正規化規則一致(不含正負號)
  const NUM_RE = /\d+(?:\.\d+)?/g;
  // 負數 roll 用(如 Players have -12% to all maximum Resistances):
  // 模板以 #% 表示、值域為負,查詢與回填需把負號一起吸進 #
  const SIGNED_NUM_RE = /-?\d+(?:\.\d+)?/g;
  const DEBOUNCE_MS = 100;

  const state = {
    statMap: null,
    statIdMap: null, // { [statId]: { en, zh, src } },依官方 stat id 查表
    itemMap: null,
    passives: null, // { clusterJewel, passivesNotable }
    bilingualMods: false, // 詞綴雙語顯示(中文下附英文原文小字)
  };

  // 診斷統計(打包後 dbg 為 no-op,只剩極少量計數;可在 console 打
  // __ptmResults() 看目前這批結果的翻譯命中狀況)
  const stat = {
    seen: 0, byId: 0, byText: 0, miss: 0, dirty: 0,
    noField: 0, // 有 .item-mod 但抓不到 data-field(官網改版的警訊)
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
    return renderStat(text, hit.en, hit.zh);
  }

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

  function translateModElement(mod) {
    if (mod.dataset.ptmDone) return;
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
      const after = modText(el);
      if (after !== zh && stat.dirtySamples.length < 3) {
        stat.dirty++;
        stat.dirtySamples.push({ 期望: zh.slice(0, 50), 實際: after.slice(0, 80), html: el.innerHTML.slice(0, 200) });
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

  function translateNameElement(el) {
    if (el.dataset.ptmDone) return;
    const text = el.textContent.trim();
    const zh = state.itemMap[text];
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
      if (!stat.seen) return;
      dbg(`[PTM] 結果列:詞綴 ${stat.seen} 條 → id 命中 ${stat.byId}、文字命中 ${stat.byText}、` +
        `查無 ${stat.miss};譯文殘留原文 ${stat.dirty} 條`);
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

  function processContainer(root) {
    // 詞綴需要 statIdMap 或 statMap(皆為官方 API 產物,任一有就能翻);
    // 物品名/天賦卡只需內建字典,各自獨立降級
    if (state.statIdMap || state.statMap) {
      root.querySelectorAll(SELECTORS.mod).forEach(translateModElement);
    }
    if (state.itemMap) {
      root.querySelectorAll(SELECTORS.itemName).forEach(translateNameElement);
    }
    if (state.passives) {
      root.querySelectorAll(SELECTORS.notable).forEach(translateNotable);
      if (root.matches?.(SELECTORS.notable)) translateNotable(root);
    }
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
      const batch = [...pending];
      pending.clear();
      batch.forEach((n) => processContainer(n));
    }, DEBOUNCE_MS);
  }

  function watchResults(container) {
    processContainer(container);
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        for (const node of m.addedNodes) {
          if (node instanceof HTMLElement) schedule(node);
        }
      }
    }).observe(container, { childList: true, subtree: true });
  }

  function waitForResults() {
    const existing = document.querySelector(SELECTORS.resultsContainer);
    if (existing) {
      watchResults(existing);
      return;
    }
    const bodyObserver = new MutationObserver(() => {
      const container = document.querySelector(SELECTORS.resultsContainer);
      if (container) {
        bodyObserver.disconnect();
        watchResults(container);
      }
    });
    bodyObserver.observe(document.body, { childList: true, subtree: true });
  }

  async function init() {
    const { language, statMap, statIdMap, itemMap, passives, bilingualMods } =
      await chrome.storage.local.get([
        'language',
        'statMap',
        'statIdMap',
        'itemMap',
        'passives',
        'bilingualMods',
      ]);
    if (language !== 'zh_tw') return;
    state.statMap = statMap ?? null; // 官方 API 產物,可能尚未建置
    state.statIdMap = statIdMap ?? null; // 同上;舊版升級後首次重建才會有
    state.itemMap = itemMap ?? null; // 內建字典即可提供
    state.passives = passives ?? null;
    state.bilingualMods = bilingualMods === true;
    // 無資料就不掛 observer
    if (!state.statIdMap && !state.statMap && !state.itemMap && !state.passives) return;
    dbg(`[PTM] 結果列:詞綴 id 表 ${Object.keys(state.statIdMap ?? {}).length} 條、` +
      `詞綴文字表 ${Object.keys(state.statMap ?? {}).length} 條、` +
      `物品表 ${Object.keys(state.itemMap ?? {}).length} 條、雙語顯示 ${state.bilingualMods ? '開' : '關'}`);
    // 手動診斷:在 console 打 __ptmResults() 看目前這批結果的命中狀況
    // 打包版 dbg 為 no-op,但在 console 直接呼叫仍看得到回傳值
    window.__ptmResults = () => { dbg('[PTM] 結果列診斷', stat); return stat; };
    // 供離線驗證腳本呼叫真正的實作與常數(不另外複製一份,避免測試與實機分歧)
    window.__ptmRenderStat = renderStat;
    window.__ptmInternals = { SELECTORS, statIdOf: (field) => field.slice(STAT_FIELD_PREFIX.length) };
    waitForResults();
  }

  init().catch((err) => console.warn('[PTM] results 初始化失敗:', err));
})();
