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
  const MAPPING_KEY = 'ptm-stat-groups';

  // ── 兩層下拉的顯示層 ──
  // 資料層在清單裡多放了偽父條目、並保留全部原始成員(官網要靠真實 id 反查才
  // 能渲染既有搜尋,成員不能刪)。這裡決定「當下該讓使用者看到哪一種」:
  //   ・沒在搜尋 → 顯示偽父、收起成員(解決一長串同前綴條目洗版)
  //   ・正在搜尋 → 成員照常出現,打「阿茲瓦特」仍是一步命中,不破壞多關鍵字搜尋
  //   ・還原機制沒掛上 → 偽父一律不顯示,退回官網原生清單(選了才不會壞)
  let memberCache = { raw: null, ids: new Set() };
  function memberIds() {
    const raw = localStorage.getItem(MAPPING_KEY) ?? '';
    if (raw === memberCache.raw) return memberCache.ids;
    const ids = new Set();
    try {
      for (const table of Object.values(JSON.parse(raw || '{}'))) {
        for (const hit of Object.values(table)) ids.add(hit.id);
      }
    } catch (_) { /* 映射表壞掉就當作沒有成員可收,顯示原生清單 */ }
    memberCache = { raw, ids };
    return ids;
  }

  // 過濾後可能留下沒有任何條目的群組標題,一併清掉
  function dropEmptyLabels(list) {
    return list.filter((o, i) => !o?.$isLabel || (list[i + 1] && !list[i + 1].$isLabel));
  }

  // 摺疊決策每次按鍵都會求值,只在結果「變了」時才記一次,避免洗版
  let lastLog = '';
  // 還原機制若整個沒載入,也要能自己認出偽父並藏起來(否則使用者選得到一個
  // 送不出去的條件)。故不依賴 __ptmStatGroup 存在。
  const PSEUDO_MARK = 'ptm_g_';
  function applyGrouping(list, searching) {
    if (!Array.isArray(list)) return list;
    const api = window.__ptmStatGroup ?? { isPseudo: (id) => id.includes(PSEUDO_MARK), available: () => false };
    const available = api.available();
    if (available && searching) {
      const pseudo = list.filter((o) => typeof o?.id === 'string' && api.isPseudo(o.id)).length;
      const line = `搜尋中:${list.length} 項(含合併選單 ${pseudo} 個,成員照常顯示)`;
      if (line !== lastLog) { lastLog = line; dbg('[PTM] 下拉:' + line); }
      return list; // 搜尋中:成員照常出現
    }
    const members = available ? memberIds() : null;
    const out = list.filter((o) => {
      const id = o?.id;
      if (typeof id !== 'string') return true; // 群組標題、option 子選項(數字 id)
      if (api.isPseudo(id)) return available;
      return !members || !members.has(id);
    });
    const line = available
      ? `收合:${list.length} → ${out.length} 項(收起成員 ${list.length - out.length} 筆)`
      : `合併選單未啟用(還原機制未就緒),顯示原生清單 ${out.length} 項`;
    if (line !== lastLog) { lastLog = line; dbg('[PTM] 下拉:' + line); }
    return out.length === list.length ? list : dropEmptyLabels(out);
  }

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
        const base = tokens.length >= 2 ? andFilter(self, tokens) : orig.call(self, self);
        return applyGrouping(base, tokens.length > 0);
      } catch (_) { /* 任何意外退回原生過濾 */ }
      return orig.call(self, self);
    };
    ms[PATCHED] = true;
    dbg('[PTM] 下拉:已掛上 filteredOptions(多關鍵字搜尋 + 合併選單顯示)');
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
