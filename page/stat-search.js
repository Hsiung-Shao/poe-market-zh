// MAIN world / document_start:下拉搜尋「廣義配對」增強。
// 官網 multiselect 下拉(詞綴篩選、物品搜尋等)的內建過濾是「整段連續
// 子字串」比對 —— 輸入「phy gem」比不到「+# to Level of all Physical
// Spell Skill Gems」。此模組把「含空白的多關鍵字查詢」改為 token AND:
// 每個關鍵字各自命中(不限順序、不限連續)即列出;單一關鍵字維持官網
// 原生行為完全不變。
//
// 作法:focusin 時對 .multiselect 的 Vue 2 實例做一次性 patch ——
// 改寫 _computedWatchers.filteredOptions 的 getter(Vue 內部以
// getter.call(vm, vm) 求值)。官網改版導致結構不符時,find 不到
// watcher 就靜默不啟用,任何例外都退回原生過濾,不影響其他功能。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const PATCHED = Symbol('ptmTokenAnd');
  // 0.3.x 的「同類詞綴合併選單」曾在這裡加一層摺疊顯示,已隨該功能一併移除
  // (見 CHANGELOG 0.4.0)。本檔現在只做多關鍵字搜尋增強。

  function labelOf(ms, opt) {
    if (opt == null) return '';
    if (typeof opt === 'string') return opt;
    try {
      if (typeof ms.customLabel === 'function') return String(ms.customLabel(opt, ms.label) ?? '');
    } catch (_) { /* 官網自訂 label 失敗就退回欄位取值 */ }
    return String(ms.label ? opt[ms.label] ?? '' : opt);
  }

  function matches(text, tokens) {
    const t = text.toLowerCase();
    return tokens.every((k) => t.includes(k));
  }

  // 重現 vue-multiselect 的 filteredOptions 輸出形狀:
  // group 模式為 [{$groupLabel, $isLabel:true}, ...選項],flat 模式為選項陣列
  function andFilter(ms, tokens) {
    const opts = ms.options ?? [];
    const limit = typeof ms.optionsLimit === 'number' ? ms.optionsLimit : 1000;
    if (ms.groupValues && ms.groupLabel) {
      const flat = [];
      for (const g of opts) {
        const vals = (g[ms.groupValues] ?? []).filter((o) => matches(labelOf(ms, o), tokens));
        if (vals.length) flat.push({ $groupLabel: g[ms.groupLabel], $isLabel: true }, ...vals);
        if (flat.length >= limit) break;
      }
      return flat.slice(0, limit);
    }
    return opts.filter((o) => matches(labelOf(ms, o), tokens)).slice(0, limit);
  }

  function patch(ms) {
    if (!ms || ms[PATCHED]) return;
    const w = ms._computedWatchers?.filteredOptions;
    if (!w || typeof w.getter !== 'function') return; // 結構不符:靜默不啟用
    const orig = w.getter;
    w.getter = function (vm) {
      const self = vm ?? this;
      try {
        const raw = String(self.search ?? '').trim().toLowerCase();
        const tokens = raw.split(/\s+/).filter(Boolean);
        if (tokens.length >= 2) return andFilter(self, tokens);
      } catch (_) { /* 任何意外退回原生過濾 */ }
      return orig.call(self, self);
    };
    ms[PATCHED] = true;
    dbg('[PTM] 下拉:已掛上 filteredOptions(多關鍵字搜尋)');
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const input = e.target;
      if (!(input instanceof HTMLElement) || !input.classList.contains('multiselect__input')) return;
      const root = input.closest('.multiselect');
      patch(root?.__vue__);
    },
    true
  );
})();
