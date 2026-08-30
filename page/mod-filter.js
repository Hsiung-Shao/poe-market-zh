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

  // 走訪官網元件樹。duck typing 而非元件名 —— 官網改名不會失效
  // (實測名稱來自 `$options._componentTag` 而不是 `$options.name`,只認 name 會找不到)。
  function findVms() {
    const root = window.app;
    if (!root) return { panel: null, groups: [] };
    const seen = new Set();
    const groups = [];
    let panel = null;
    const walk = (vm, d) => {
      if (!vm || seen.has(vm) || d > 16) return;
      seen.add(vm);
      if (!panel && isPanel(vm)) panel = vm;
      if (isGroup(vm)) groups.push(vm);
      const kids = vm.$children;
      if (kids) for (const c of kids) walk(c, d + 1);
    };
    walk(root, 0);
    return { panel, groups };
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

  window.__pmzModFilter = { findVms, findEntry, addStatFilter, refreshReady, MSG };
})();
