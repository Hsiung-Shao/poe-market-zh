// document_end(isolated):搜尋結果頁即時翻譯。
// 翻譯法:把詞綴文字的數值正規化成 #,查 statMap(英文模板 → 中文模板),
// 再把原數值依序回填中文模板。查不到就保留原文(寧缺勿錯)。
// 翻譯採直接替換,英文原文放 title 屬性 hover 可查;popup 可開啟
// 「詞綴雙語顯示」(bilingualMods),改為在中文下方常駐英文原文小字
// (僅裝備詞綴;物品名/天賦卡不受此設定影響)。

(() => {
  // ── 官網 DOM 耦合點(改版時優先檢查這裡)──
  const SELECTORS = {
    resultsContainer: '.results',
    mod: '.item-mod',
    modText: '.lc.s',
    itemName: '.itemName .lc',
    notable: '.notableProperty', // 天賦卡(星團珠寶/塗油)
    notableTitle: '.colourAugmented',
    notableDesc: '.lc',
  };

  // 與 bg/translation.js 的正規化規則一致(不含正負號)
  const NUM_RE = /\d+(?:\.\d+)?/g;
  const DEBOUNCE_MS = 100;

  const state = {
    statMap: null,
    itemMap: null,
    passives: null, // { clusterJewel, passivesNotable }
    bilingualMods: false, // 詞綴雙語顯示(中文下附英文原文小字)
  };

  function fillTemplate(zhTpl, nums) {
    let i = 0;
    return zhTpl.replace(/#/g, () => nums[i++] ?? '#');
  }

  function lookupStat(text) {
    const key = text.replace(NUM_RE, '#');
    return state.statMap[key] ?? state.statMap[`${key} (Local)`] ?? null;
  }

  function translateModElement(mod) {
    if (mod.dataset.ptmDone) return;
    const el = mod.querySelector(SELECTORS.modText) ?? mod;
    const text = el.textContent.trim();
    if (!text) return;
    const zhTpl = lookupStat(text);
    if (zhTpl) {
      const nums = text.match(NUM_RE) ?? [];
      const zh = fillTemplate(zhTpl, nums);
      el.textContent = zh; // 純文字寫入,不經 HTML 解析
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
      el.textContent = zh;
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

  function processContainer(root) {
    // 詞綴需要 statMap(官方 API);物品名/天賦卡只需內建字典,各自獨立降級
    if (state.statMap) {
      root.querySelectorAll(SELECTORS.mod).forEach(translateModElement);
    }
    if (state.itemMap) {
      root.querySelectorAll(SELECTORS.itemName).forEach(translateNameElement);
    }
    if (state.passives) {
      root.querySelectorAll(SELECTORS.notable).forEach(translateNotable);
      if (root.matches?.(SELECTORS.notable)) translateNotable(root);
    }
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
    const { language, statMap, itemMap, passives, bilingualMods } = await chrome.storage.local.get([
      'language',
      'statMap',
      'itemMap',
      'passives',
      'bilingualMods',
    ]);
    if (language !== 'zh_tw') return;
    state.statMap = statMap ?? null; // 官方 API 產物,可能尚未建置
    state.itemMap = itemMap ?? null; // 內建字典即可提供
    state.passives = passives ?? null;
    state.bilingualMods = bilingualMods === true;
    if (!state.statMap && !state.itemMap && !state.passives) return; // 無資料就不掛 observer
    waitForResults();
  }

  init().catch((err) => console.warn('[PTM] results 初始化失敗:', err));
})();
