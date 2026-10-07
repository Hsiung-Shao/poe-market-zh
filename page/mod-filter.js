// MAIN world / document_start:把結果卡上的單條詞綴加進篩選區(或排除)。
//
// 為什麼要分成兩支檔:畫按鈕、讀字典的那一半在 isolated world
// (content/mod-row.js,只有它拿得到 chrome.storage),而官網的 Vue 根實例
// `window.app` **只有 MAIN world 看得到**。兩邊靠 window.postMessage 溝通,
// 這與 bootstrap.js → ui-strings.js 的既有分工是同一個形狀。
//
// ── 2026-08-30 於活站(已登入)逐項實測後才寫的,不是猜的 ──
//   • `stat-filter-group` 全頁只有一個,duck typing 找(有 selectFilter+removeFilter)
//   • `selectFilter(entry)` 就是「使用者從下拉選了一條詞綴」走的路徑:
//     內部 commit `setStatFilter` 再 `$root.save()`,**不會觸發搜尋**
//   • 送進去的 entry 一定要是**官網自己 availableOptions 裡的那個物件**,
//     用結果列 `.item-mod` 的 `data-field`(官方 stat id,語言無關鍵)去找;
//     自己造一個形狀相近的物件是在賭官網怎麼用它
//   • 排除:`item-filter-panel.selectStatGroup({ type: 'not' })` 會 push 一個
//     `{ id: 1, title: "不", type: "not" }` 群組,再往那個群組 selectFilter
//   • 實測加一條再 removeFilter/removeMe 可以乾淨還原,沒有殘留
//
// ⚠ **取用實例,不碰原型。** Vue 2 把 methods 逐一 bind 後掛成實例的自有屬性,
//   原型上沒有這些方法(活站實測 hasOwnProperty=true、原型上是 undefined)。
//   這是 agent-data `error_vue2_methods_not_on_prototype` 記載過的坑。
// ⚠ 與 0.3.x「同類詞綴合併選單」失敗的情境**不同**:那次是把偽 id 塞進清單、
//   指望送出前換回真 id(`error_host_state_hook_missed_path`),這次全程用官網
//   自己的真實 entry,沒有任何需要「還原」的東西。

(() => {
  const dbg = (...a) => console.info(...a);

  const MSG = 'pmz:addStatFilter';
  // 兩個 world 共享 DOM,拿它當「這個功能現在真的可用嗎」的旗號 ——
  // isolated world 那邊據此決定要不要畫按鈕。
  // ⚠ 閘門必須**即時反映實際狀態**,不要用 localStorage 記憶上次的結果:
  //   那會讓修好之後還要多重新整理一次才恢復(同上 error 檔的教訓)。
  const READY_ATTR = 'pmzFilterReady';

  const isGroup = (vm) =>
    vm && typeof vm.selectFilter === 'function' && typeof vm.removeFilter === 'function' && vm.group;
  const isPanel = (vm) => vm && typeof vm.selectStatGroup === 'function';
  // 左欄的屬性篩選群組(type_filters 等;物品類別在這裡)。group.id 是字串,詞綴群組是數字
  const isPropGroup = (vm) =>
    vm && typeof vm.clearMe === 'function' && typeof vm.updateFilter === 'function' &&
    typeof vm.group?.id === 'string';

  // 走訪官網元件樹。duck typing 而非元件名 —— 官網改名不會失效
  // (實測名稱來自 `$options._componentTag` 而不是 `$options.name`,只認 name 會找不到)。
  function findVms() {
    const root = window.app;
    if (!root) return { panel: null, groups: [], props: [] };
    const seen = new Set();
    const groups = [];
    const props = [];
    let panel = null;
    const walk = (vm, d) => {
      if (!vm || seen.has(vm) || d > 16) return;
      seen.add(vm);
      if (!panel && isPanel(vm)) panel = vm;
      if (isGroup(vm)) groups.push(vm);
      else if (isPropGroup(vm)) props.push(vm);
      const kids = vm.$children;
      if (kids) for (const c of kids) walk(c, d + 1);
    };
    walk(root, 0);
    return { panel, groups, props };
  }

  // 官方 stat id → 官網自己的 entry 物件
  function findEntry(groupVm, statId) {
    for (const grp of groupVm?.availableOptions ?? []) {
      const hit = (grp.entries ?? []).find((e) => e && e.id === statId);
      if (hit) return hit;
    }
    return null;
  }

  const nextTick = () => new Promise((r) => setTimeout(r, 0));

  async function addStatFilter(statId, exclude, min) {
    let { panel, groups } = findVms();
    if (!groups.length) return { ok: false, why: '找不到詞綴篩選群組' };

    const wantType = exclude ? 'not' : 'and';
    let target = groups.find((g) => g.group?.type === wantType);

    // 沒有現成的排除群組就請官網自己建一個(它會 commit pushStatGroup),
    // 建完要等一拍 Vue 才畫得出新元件
    if (!target && exclude) {
      if (!panel) return { ok: false, why: '找不到篩選面板,無法新增排除群組' };
      panel.selectStatGroup({ type: 'not' });
      await nextTick();
      ({ groups } = findVms());
      target = groups.find((g) => g.group?.type === 'not');
    }
    // 連 and 群組都沒有(理論上不會,官網預設就有一個)——退回第一個可用的
    if (!target) target = groups[0];
    if (!target) return { ok: false, why: '沒有可用的篩選群組' };

    const entry = findEntry(target, statId);
    // 查不到就**什麼都不做**。硬塞一個自己造的物件進去,官網下次用 id 反查清單
    // 會落空,整個篩選面板會停止渲染(error_injected_ui_entries_break_host_lookup)。
    if (!entry) return { ok: false, why: `篩選清單裡沒有這個詞綴(${statId})` };

    target.selectFilter(entry);

    // 帶數值下限:selectFilter 只是把詞綴加進去,值要另外用 updateFilter 設。
    // 2026-08-30 活站實測:`updateFilter(index, { min })` 之後,Vuex 的
    // `state.persistent.stats[g].filters[i]` 會從 `{ id }` 變成
    // `{ id, disabled:false, value:{ min } }` —— 那正是送去 API 的查詢值。
    // index 取剛加進去的那一筆(官網是 push 到尾端)。
    if (Number.isFinite(min)) {
      const idx = target.filters.length - 1;
      if (idx >= 0) {
        try {
          target.updateFilter(idx, { min });
        } catch (err) {
          // 值設不上去不該讓「加入詞綴」也跟著失敗 —— 詞綴已經進去了,
          // 使用者自己補一個數字就好,比整條消失好
          console.warn('[PTM] 詞綴已加入,但數值下限設定失敗:', err);
          return { ok: true, exclude, group: target.group?.id, minFailed: true };
        }
      }
    }
    return { ok: true, exclude, group: target.group?.id, min: Number.isFinite(min) ? min : undefined };
  }

  window.addEventListener('message', async (e) => {
    // 只收自己這一頁發出來的訊息
    if (e.source !== window) return;
    const d = e.data;
    if (!d || d.t !== MSG || typeof d.statId !== 'string' || !d.statId) return;
    try {
      const min = typeof d.min === 'number' && Number.isFinite(d.min) ? d.min : undefined;
      const r = await addStatFilter(d.statId, d.exclude === true, min);
      if (!r.ok) console.warn('[PTM] 加入篩選失敗:', r.why);
      else {
        dbg(`[PTM] 已${r.exclude ? '排除' : '加入篩選'}:${d.statId}` +
          `${r.min != null ? `(下限 ${r.min})` : ''}(群組 ${r.group})`);
      }
    } catch (err) {
      console.warn('[PTM] 加入篩選發生例外:', err);
    }
  });

  // 旗號:官網元件樹真的找得到篩選群組才算可用。SPA 會重建畫面,所以每次有人
  // 問(isolated world 在畫按鈕前會讀這個屬性)都重新判定,不做快取。
  function refreshReady() {
    const { groups } = findVms();
    const el = document.documentElement;
    if (groups.length) el.dataset[READY_ATTR] = '1';
    else delete el.dataset[READY_ATTR];
    return groups.length > 0;
  }
  // isolated world 沒辦法直接呼叫這裡的函式,改用自訂事件當「請重新判定」的敲門磚
  window.addEventListener('pmz:checkFilterReady', refreshReady);
  document.addEventListener('DOMContentLoaded', refreshReady);
  setTimeout(refreshReady, 1500);

  // ── 篩選列階級選單(content/tier-picker.js)的頁面端 ──
  //
  // isolated world 看不到 Vue,所以這裡把它要的東西**寫成 DOM 屬性**,填值則收 postMessage 代辦:
  //   每一條詞綴篩選列(item-filter 元件的 $el):
  //     data-pmz-stat-id  官方 stat id(語言無關;我們把標題翻成中文也不影響)
  //     data-pmz-gi       詞綴群組索引 = group.id = state.persistent.stats 的陣列索引
  //     data-pmz-fi       這一列在群組 state.filters 裡的索引
  //     data-pmz-gtype    群組類型(and / not / count / weight…;not 群組不放選單)
  //   <html>:
  //     data-pmz-item-cat   物品類別選項 id(例 weapon.onesword;沒選 = 空字串)
  //     data-pmz-item-type  搜尋列選的基底英文名(state.persistent.type;沒選 = 空字串)
  //     data-pmz-item-cats  類別選項 id → 頁面上顯示的名稱(家族切換的標籤用;跟著頁面語言)
  //
  // ── 2026-10-01 對照官網 legacy bundle(dist/legacy/trade.*.js)原始碼確認,並在活站實測
  //    (PoE1 未登入時搜尋面板仍會掛上;PoE2 未登入整個 legacy app 不載入)──
  //   • StatFilterGroup 的 filters 是 `_.map(this.state.filters, …)`,模板
  //     `<item-filter v-for="(filter, index) in filters" :index="index" :key="filter.id">`
  //     → 群組的 $children 裡帶 filter + index 的就是各列,index 與 state.filters 一一對應
  //   • 群組 `group.id` 由 ItemFilterPanel.groupsRight 設成 stateRight(= persistent.stats)的索引
  //   • 物品類別:PropertyFilterGroup.updateFilter commit `setPropertyFilter`
  //     → `persistent.filters[群組].filters[篩選 id] = { option }`,類別即
  //     `persistent.filters.type_filters.filters.category.option`
  //   • 填值:StatFilterGroup.updateFilter(i, patch) = commit setStatFilter + `$root.save(!0)`,
  //     **不觸發搜尋**(與上方帶入下限同一條路)
  // ⚠ 屬性只在值真的變了才寫:isolated world 監聽這些屬性,每次都寫會形成「寫 → 觸發 → 再寫」的迴圈。
  const ATTR = { stat: 'data-pmz-stat-id', gi: 'data-pmz-gi', fi: 'data-pmz-fi', gtype: 'data-pmz-gtype' };
  const setAttr = (el, k, v) => { if (el.getAttribute(k) !== v) el.setAttribute(k, v); };

  // 類別名稱表只在選項清單變了才重寫(切語言 / 官網重建元件)
  let catNamesSig = '';
  function categoryNames(props) {
    const tf = props.find((p) => p.group?.id === 'type_filters');
    const cat = (tf?.group?.filters ?? []).find((f) => f?.id === 'category');
    const out = {};
    for (const o of cat?.option?.options ?? []) {
      if (o && typeof o.id === 'string' && typeof o.text === 'string') out[o.id] = o.text;
    }
    return out;
  }

  // Vuex 的 subscribe 是官方 API(只讀回呼):任何 commit(加 / 刪詞綴、改類別、改值)之後重新標一次。
  // 官網切分頁可能重建整個 app → 換了 store 就重掛。
  let hookedStore = null;
  let annotateTimer = null;
  function hookStore(store) {
    if (!store || hookedStore === store || typeof store.subscribe !== 'function') return;
    hookedStore = store;
    store.subscribe(() => {
      // commit 之後 Vue 下一個 microtask 才重畫;setTimeout 0 排在那之後,拿到的是新的 DOM
      if (annotateTimer) return;
      annotateTimer = setTimeout(() => { annotateTimer = null; annotateFilters(); }, 0);
    });
  }

  function annotateFilters() {
    const root = window.app;
    const st = root?.$store?.state?.persistent;
    if (!st) return 0;
    hookStore(root.$store);
    const { groups, props } = findVms();
    let n = 0;
    for (const g of groups) {
      const gi = g.group?.id;
      if (!Number.isInteger(gi)) continue;
      for (const c of g.$children ?? []) {
        if (!c?.filter || !Number.isInteger(c.index) || !(c.$el instanceof Element)) continue;
        // 只認官網自己的 state:索引對到的那筆 id 必須就是這一列的 filter.id(不一致 = 正在重畫,下一輪再標)
        const id = g.state?.filters?.[c.index]?.id;
        if (typeof id !== 'string' || id !== c.filter.id) continue;
        setAttr(c.$el, ATTR.stat, id);
        setAttr(c.$el, ATTR.gi, String(gi));
        setAttr(c.$el, ATTR.fi, String(c.index));
        setAttr(c.$el, ATTR.gtype, String(g.group?.type ?? ''));
        n++;
      }
    }
    const html = document.documentElement;
    const cat = st.filters?.type_filters?.filters?.category?.option;
    setAttr(html, 'data-pmz-item-cat', typeof cat === 'string' ? cat : '');
    setAttr(html, 'data-pmz-item-type', typeof st.type === 'string' ? st.type : '');
    const names = categoryNames(props);
    const sig = JSON.stringify(names);
    if (Object.keys(names).length && sig !== catNamesSig) {
      catNamesSig = sig;
      html.setAttribute('data-pmz-item-cats', sig);
    }
    return n;
  }
  // isolated world 看到篩選面板有變動時敲這個門(同 pmz:checkFilterReady 的做法;事件同步派送,
  // 回來時屬性已經寫好)
  window.addEventListener('pmz:annotateFilters', annotateFilters);

  // 填值:{ t:'pmz:setFilterValue', reqId, statId, gi, fi, min?, max? } → 回 { t:'pmz:setFilterValueDone', reqId, ok, … }
  const SET_MSG = 'pmz:setFilterValue';
  function setFilterValue(d) {
    const { groups } = findVms();
    const g = groups.find((x) => x.group?.id === d.gi);
    if (!g) return { ok: false, why: `找不到詞綴群組 ${d.gi}` };
    const list = g.state?.filters ?? [];
    let fi = d.fi;
    if (list[fi]?.id !== d.statId) {
      // 索引過期(例:使用者剛刪掉上面一列,屬性還沒重標):群組裡恰好一列是這個詞綴才改用它,
      // 多列或沒有就放棄 —— 寫錯列比沒寫更糟
      const hits = list.map((f, i) => (f?.id === d.statId ? i : -1)).filter((i) => i >= 0);
      if (hits.length !== 1) return { ok: false, why: `群組 ${d.gi} 找不到唯一的 ${d.statId}` };
      fi = hits[0];
    }
    const patch = {};
    if (typeof d.min === 'number' && Number.isFinite(d.min)) patch.min = d.min;
    if (typeof d.max === 'number' && Number.isFinite(d.max)) patch.max = d.max;
    if (!Object.keys(patch).length) return { ok: false, why: '沒有數值' };
    g.updateFilter(fi, patch);
    return { ok: true, gi: d.gi, fi, ...patch };
  }
  window.addEventListener('message', (e) => {
    // 只收自己這個視窗、自己這個來源送出的訊息(iframe / 第三方腳本也能 postMessage)
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.t !== SET_MSG || typeof d.statId !== 'string' || !Number.isInteger(d.gi) || !Number.isInteger(d.fi)) return;
    let r;
    try {
      r = setFilterValue(d);
      if (r.ok) dbg(`[PTM] 階級選單填值:${d.statId}(群組 ${r.gi} 第 ${r.fi} 列)${JSON.stringify({ min: r.min, max: r.max })}`);
      else console.warn('[PTM] 階級選單填值失敗:', r.why);
    } catch (err) {
      console.warn('[PTM] 階級選單填值發生例外:', err);
      r = { ok: false, why: String(err?.message ?? err) };
    }
    window.postMessage({ t: 'pmz:setFilterValueDone', reqId: d.reqId, ...r }, location.origin);
  });

  // ── 功能導覽(content/tour.js)的示範 ──
  //
  // 使用者 2026-10-02 要求「模糊搜尋」那步要真的示範:篩選區收著就展開、在「＋ 新增詞綴篩選」下拉打一段
  // 示範字、再示範「加了一條詞綴之後」的樣子(下一步框那一列的 ≈T▾)。導覽在 isolated world 看不到 Vue,
  // 這裡代辦;{ t:'pmz:tourDemo', reqId, op, … } → 回 { t:'pmz:tourDemoDone', reqId, op, ok, … }。
  //
  // ── 2026-10-02 對照官網 legacy bundle(dist/legacy/trade.*.js)原始碼確認 ──
  //   • 展開 / 收起篩選區:transient mutation `showAdvancedSearch(bool)`(官網自己切分頁時就這樣 commit),
  //     收起的樣子是 `.search-bar.search-advanced.search-advanced-hidden { height:0; overflow:hidden }`
  //     —— 裡面的元素**仍有大小**,只是被裁掉(導覽舊版就是因此把聚光框畫到結果列標頭上)
  //   • 示範詞綴:**直接 commit `setStatFilter` / `removeStatFilter`,刻意不走 selectFilter / removeFilter** ——
  //     那兩個會接著 `$root.save(true)`:標記目前搜尋 dirty、寫 localStorage 的 state、把網址 replaceState
  //     成 gzip 查詢碼。示範結束要「完全還原」,這三樣沒有一個還原得乾淨(dirty 沒有反向 mutation)。
  //     不 save 的話 Vuex 以外什麼都沒動:移除後 persistent 與導覽前逐筆相同,網址、localStorage 都沒碰過。
  //     兩個 mutation 都不觸發搜尋(搜尋只由 doSearch 發)。
  //   • 下拉:群組元件 `$refs.search` 就是 vue-multiselect 實例。**不呼叫 activate()** —— 它會把焦點移進輸入框,
  //     導覽卡片一拿回焦點就 blur → deactivate 收起。改成直接設 isOpen / search(元件自己的 data,不是 Vuex),
  //     模糊比對的 patch 原本在 focusin 掛,這裡沒有 focus,改呼叫 page/stat-search.js 開放的 __ptmSearch.patch。
  // ⚠ 只動自己加的東西:加之前群組裡已經有同一個詞綴就**不加**(回傳那一列給導覽框);移除時再確認那一列
  //   的 stat id,群組裡恰好一列是它才移除(加之前沒有 → 現在唯一那列就是我們加的),對不上寧可不動。
  // ⚠ 頁面離開(pagehide)時自己清乾淨:導覽那邊的 postMessage 在卸載時不保證送得到。
  const TOUR_MSG = 'pmz:tourDemo';
  const TOUR_DONE = 'pmz:tourDemoDone';
  const TOUR_STATS = new Set(['explicit.stat_3299347043']); // +# to maximum Life(PoE1 / PoE2 同 id,兩款都有階級表)
  const demo = { expanded: false, added: null, ms: null };
  const storeOf = () => window.app?.$store ?? null;
  const andGroup = () => findVms().groups.find((g) => g.group?.type === 'and' && Number.isInteger(g.group?.id)) ?? null;

  function tourExpand() {
    const store = storeOf();
    if (!store?.state?.transient) return { ok: false, why: '找不到交易 App' };
    const hidden = store.state.transient.advancedSearchHidden === true;
    if (hidden) {
      store.commit('showAdvancedSearch', true);
      demo.expanded = true;
    }
    return { ok: true, wasHidden: hidden };
  }
  function tourCollapse() {
    if (!demo.expanded) return { ok: true, collapsed: false };
    demo.expanded = false;
    const store = storeOf();
    if (!store?.state?.transient) return { ok: false, why: '找不到交易 App' };
    if (store.state.transient.advancedSearchHidden !== true) store.commit('showAdvancedSearch', false);
    return { ok: true, collapsed: true };
  }
  // queries:候選示範字(依序);挑第一個「下拉真的有結果」的 —— 全新安裝第一次開頁時中文詞綴表可能還沒建好,
  // 清單是純英文,中文示範字會變成「No elements found」(2026-10-02 實站冒煙抓到),那就改用英文那個
  const optionCount = (ms) => {
    try { return (ms.filteredOptions ?? []).filter((o) => o && !o.$isLabel).length; } catch (_) { return 0; }
  };
  function tourOpenSearch(queries) {
    const g = andGroup();
    const ms = g?.$refs?.search;
    if (!ms || typeof ms.isOpen !== 'boolean' || !('search' in ms)) return { ok: false, why: '找不到「新增詞綴篩選」下拉' };
    const list = (Array.isArray(queries) ? queries : [queries]).map((q) => String(q ?? '').slice(0, 40)).filter(Boolean);
    if (!list.length) return { ok: false, why: '沒有示範字' };
    if (demo.ms && demo.ms !== ms) tourCloseSearch();
    try { window.__ptmSearch?.patch?.(ms); } catch (_) { /* 沒有模糊比對(台服)就只顯示官網原生結果 */ }
    demo.ms = ms;
    let query = list[0];
    for (const q of list) {
      ms.search = q;
      if (optionCount(ms) > 0) { query = q; break; }
    }
    ms.search = query;
    ms.isOpen = true;
    return { ok: true, gi: g.group.id, query, options: optionCount(ms), fuzzy: typeof window.__ptmSearch?.patch === 'function' };
  }
  function tourCloseSearch() {
    const ms = demo.ms;
    if (!ms) return { ok: true, closed: false };
    demo.ms = null;
    ms.search = '';
    ms.isOpen = false;
    return { ok: true, closed: true };
  }
  function tourAddFilter(statId) {
    if (!TOUR_STATS.has(statId)) return { ok: false, why: `不是示範用的詞綴(${statId})` };
    if (demo.added) return { ok: true, ...demo.added, existing: false };
    const store = storeOf();
    const g = andGroup();
    if (!store || !g) return { ok: false, why: '找不到詞綴篩選群組' };
    const gi = g.group.id;
    const list = store.state?.persistent?.stats?.[gi]?.filters;
    if (!Array.isArray(list)) return { ok: false, why: `群組 ${gi} 沒有篩選清單` };
    const had = list.findIndex((f) => f?.id === statId);
    if (had >= 0) return { ok: true, gi, fi: had, statId, existing: true }; // 使用者自己就有 → 直接框那一列,不加
    if (!findEntry(g, statId)) return { ok: false, why: `篩選清單裡沒有這個詞綴(${statId})` };
    const n0 = list.length;
    store.commit('setStatFilter', { group: gi, value: { id: statId } });
    const after = store.state.persistent.stats[gi].filters;
    if (after.length !== n0 + 1 || after[n0]?.id !== statId) return { ok: false, why: '加入後的清單與預期不符' };
    demo.added = { gi, fi: n0, statId };
    return { ok: true, gi, fi: n0, statId, existing: false };
  }
  function tourRemoveFilter() {
    const a = demo.added;
    if (!a) return { ok: true, removed: false };
    demo.added = null;
    const store = storeOf();
    const list = store?.state?.persistent?.stats?.[a.gi]?.filters;
    if (!Array.isArray(list)) return { ok: false, why: `群組 ${a.gi} 不見了` };
    const hits = list.map((f, i) => (f?.id === a.statId ? i : -1)).filter((i) => i >= 0);
    if (hits.length !== 1) return { ok: false, why: `群組 ${a.gi} 有 ${hits.length} 列 ${a.statId},不確定哪列是示範的,不動` };
    store.commit('removeStatFilter', { group: a.gi, index: hits[0] });
    return { ok: true, removed: true, gi: a.gi, fi: hits[0] };
  }
  function tourCleanup() {
    const out = {};
    for (const [k, fn] of [['search', tourCloseSearch], ['filter', tourRemoveFilter], ['panel', tourCollapse]]) {
      try { out[k] = fn(); } catch (err) { out[k] = { ok: false, why: String(err?.message ?? err) }; }
    }
    return { ok: Object.values(out).every((r) => r.ok), ...out };
  }
  const TOUR_OPS = {
    expand: () => tourExpand(),
    collapse: () => tourCollapse(),
    openSearch: (d) => tourOpenSearch(d.queries),
    closeSearch: () => tourCloseSearch(),
    addFilter: (d) => tourAddFilter(d.statId),
    removeFilter: () => tourRemoveFilter(),
    cleanup: () => tourCleanup(),
  };
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.t !== TOUR_MSG || typeof d.op !== 'string' || !Object.hasOwn(TOUR_OPS, d.op)) return;
    let r;
    try {
      r = TOUR_OPS[d.op](d);
      if (!r.ok) console.warn(`[PTM] 導覽示範 ${d.op} 失敗:`, r.why ?? JSON.stringify(r));
      else dbg(`[PTM] 導覽示範 ${d.op}:${JSON.stringify(r)}`);
    } catch (err) {
      console.warn(`[PTM] 導覽示範 ${d.op} 發生例外:`, err);
      r = { ok: false, why: String(err?.message ?? err) };
    }
    window.postMessage({ t: TOUR_DONE, reqId: d.reqId, op: d.op, ...r }, location.origin);
  });
  window.addEventListener('pagehide', () => {
    if (demo.expanded || demo.added || demo.ms) tourCleanup();
  });

  // ── 大量賣家自動載入(2026-10-07,2026-10-08 依活站改寫):替使用者按官網的「Load More」──
  // ⚠ 活站的結果列已改成另一套前端(Vue 3,`dist/js/trade.<hash>.js` 的 ItemResultSet),不在 window.app
  //   (舊 Vue 2)的元件樹裡 —— 第一版照舊 legacy bundle 走 $children 找 fetchNext,活站一個都找不到
  //   (使用者 2026-10-08 實測 found: [])。新版結果列底部有官方的 `button.load-more-btn`:
  //   按下 = 官網自己取還沒載入的前 10 個 id 發一次 fetch、畫出新的 10 列;載入中 disabled,全部載完按鈕消失,
  //   429 時跳官方的「Too many requests」。這裡只按這顆鈕,**不自己組 API 請求**、不碰新前端的內部物件。
  //   即時搜尋仍由舊 App 管(Vuex `transient.search.active.live`)。
  // ⚠ 按之前在**同一個 task 內**再檢查一次:側邊欄的判斷到這裡之間,使用者可能已換搜尋或開即時搜尋。
  const STEP_MSG = 'pmz:resultsStep';
  const STEP_DONE = 'pmz:resultsStepDone';
  const RESULTS_SEL = { set: '.resultset', row: '.row[data-id]', more: 'button.load-more-btn' };
  const SITE_PAGE = 10; // 官網一批載入幾筆(= content/bulk-model.js 的 PAGE;不同 world,各寫一次)
  // 「哪一次搜尋」:依結果區塊節點的身分編號(新前端每次搜尋重建一個 .resultset;同條件重搜搜尋編號可能不變)
  const resultEpochs = new WeakMap();
  let epochSeq = 0;
  function epochOf(el) {
    if (!resultEpochs.has(el)) resultEpochs.set(el, ++epochSeq);
    return resultEpochs.get(el);
  }
  // 畫面上看得到的結果區塊(隱藏的舊搜尋不算)
  const visibleSets = () => [...document.querySelectorAll(RESULTS_SEL.set)].filter((el) => el.isConnected && el.getClientRects().length > 0);
  // d: { target, fire, epoch }。fire 為真且全部條件成立才按「Load More」;回傳目前狀態
  function resultsStep(d) {
    if (!window.app) return { ok: false, why: 'noApp' };
    const sets = visibleSets();
    if (!sets.length) return { ok: false, why: 'noResults' };
    if (sets.length > 1) return { ok: false, why: 'ambiguous' };
    const el = sets[0];
    if (el.classList.contains('exchange')) return { ok: false, why: 'noResults' };
    if (window.app.$store?.state?.transient?.search?.active?.live) return { ok: false, why: 'live' };
    // 已載入 = 結果列數(抓不到的「Item not found」列也帶 data-id,同樣算載入過,與官網 fetchable 同一個判準)
    const loaded = el.querySelectorAll(RESULTS_SEL.row).length;
    const btn = el.querySelector(RESULTS_SEL.more);
    const done = !btn; // 官網只在還有沒載入的 id 時畫這顆鈕
    // 總數:畫面上沒有(列數上限 100 只在官網內部);沒載完時給「至少再一批」當下限,planStep 只用它判斷第一批
    const total = done ? loaded : loaded + SITE_PAGE;
    const epoch = epochOf(el);
    const info = { ok: true, epoch, loaded, total, done, fetching: !!btn?.disabled, fired: false };
    const target = Number(d?.target) || 0;
    const sameSearch = d?.epoch == null || d.epoch === epoch;
    // 第一批(官網自己抓的 10 筆 = content/bulk-model.js 的 PAGE)還沒到就不碰:那時鈕可能還能按,一按就重抓同一批
    if (d?.fire === true && sameSearch && btn && !btn.disabled && loaded < target && loaded >= SITE_PAGE) {
      btn.click();
      // 新前端在下一個 tick 才把鈕設成 disabled,這裡讀不到;按的是可按的鈕,官網一定會發這一批
      info.fired = true;
      info.fetching = true;
    }
    return info;
  }
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.t !== STEP_MSG) return;
    let r;
    try {
      r = resultsStep(d);
    } catch (err) {
      console.warn('[PTM] 大量賣家自動載入失敗:', err);
      r = { ok: false, why: 'error' };
    }
    window.postMessage({ t: STEP_DONE, reqId: d.reqId, ...r }, location.origin);
  });

  window.__pmzModFilter = { findVms, findEntry, addStatFilter, refreshReady, MSG, annotateFilters, setFilterValue, tourOps: TOUR_OPS, tourState: () => ({ expanded: demo.expanded, added: demo.added, open: !!demo.ms }), resultsStep };
})();
