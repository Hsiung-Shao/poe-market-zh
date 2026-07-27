// MAIN world / document_start:兩層下拉的「還原」機制。
//
// 我們在詞綴清單中額外放了幾筆偽父條目(id 帶 ptm_g_),它們的 option 子選單
// 對應到一整群真實詞綴。使用者選定子項後,這裡負責把官網篩選器狀態裡的偽 id
// **當場換成真實 id**,因此偽 id 從不進入任何持久化路徑 —— 搜尋請求、網址、
// 儲存的搜尋、分享連結拿到的一律是官方認得的查詢。
//
// 為什麼改狀態而不是攔截送出的請求:偽 id 會經由多條路徑外流(?q= 導航、
// 官網自己的 save、儲存搜尋、其他擴充直接讀 store),攔截網路只擋得住其中一條;
// 而且攔截失敗是靜默的,壞掉的查詢直送官方後端可能觸發流量限制。改狀態則是
// **裝得上就一定正確、裝不上就完全不啟用**。
//
// 掛不上時寫 ptm-grouping-ready=0,下次載入 bootstrap 便不再放偽父條目,
// 使用者看到的就是官網原本的平鋪清單(功能等同未安裝本功能,不會壞)。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const MARK = 'ptm_g_';
  const MAPPING_KEY = 'ptm-stat-groups';
  const READY_KEY = 'ptm-grouping-ready';
  const PATCHED = Symbol('ptmStatGroup');

  const isPseudo = (id) => typeof id === 'string' && id.includes(MARK);

  // 映射表必須在**用到的當下**才讀:本腳本與寫入映射表的 bootstrap 分屬不同
  // world,兩者都是 document_start,執行先後沒有保證,載入時快取會拿到空表。
  function mapping() {
    try {
      return JSON.parse(localStorage.getItem(MAPPING_KEY) ?? '{}');
    } catch (_) {
      return {};
    }
  }

  function resolve(id, optionId) {
    const hit = mapping()[id]?.[String(optionId)];
    return hit ? { id: hit.id, value: { ...hit.value } } : null;
  }

  function markUnavailable(why) {
    try {
      localStorage.setItem(READY_KEY, '0');
    } catch (_) { /* 無痕模式等寫不進去:下次仍會嘗試,不影響正確性 */ }
    console.warn('[PTM] 合併選單無法掛載,已停用(下次載入恢復原生清單):', why);
  }

  // 官網以 vue 元件 stat-filter-group 管理每一組詞綴條件,patch 它的 updateFilter。
  // ⚠ 必須 patch **實例**而非原型:Vue 2 會把 methods 逐一 bind 到實例上,原型上
  // 找不到 updateFilter(實測就是踩這個坑)。因此每個實例第一次被碰到時各自掛,
  // 靠 Symbol 標記避免重複包裝。
  function patchInstance(vm) {
    if (!vm || vm[PATCHED]) return true;
    const orig = vm.updateFilter;
    if (typeof orig !== 'function') return false;
    vm.updateFilter = function (idx, value) {
      try {
        const filter = this.filters?.[idx] ?? this.state?.filters?.[idx];
        dbg('[PTM] 合併選單:updateFilter idx=' + idx, '目前 id=' + (filter?.id ?? '(無)'),
          'value=' + JSON.stringify(value));
        if (filter && isPseudo(filter.id)) {
          const picked = value?.option ?? value;
          const real = resolve(filter.id, picked);
          if (real) {
            // 換 id 的同時換上該成員該有的 value 形狀:自帶 option 的成員送
            // { option: 真option },其餘成員送 {} —— 形狀送錯官方 API 會拒絕
            dbg('[PTM] 合併選單:還原 ' + filter.id + ' option=' + picked +
              ' → ' + real.id + ' value=' + JSON.stringify(real.value));
            filter.id = real.id;
            return orig.call(this, idx, real.value);
          }
          // 查不到就別送出去試(壞查詢可能觸發官方流量限制)
          console.warn('[PTM] 合併選單找不到對應條件,已略過此次選擇。id=' + filter.id +
            ' option=' + picked + ',映射表內有 ' + Object.keys(mapping()[filter.id] ?? {}).length + ' 個選項');
          return undefined;
        }
      } catch (err) {
        console.warn('[PTM] 合併選單還原失敗,改用原生行為:', err);
      }
      return orig.apply(this, arguments);
    };
    vm[PATCHED] = true;
    dbg('[PTM] 合併選單:已掛上 stat-filter-group.updateFilter(實例 #' + (++patchCount) + ')');
    return true;
  }

  // 認得出 stat-filter-group 的特徵:條件清單 + 三個操作方法。以形狀判定而非
  // 元件名稱,官網改名也不會失效(名稱只拿來寫 log)。
  const isGroupVm = (vm) =>
    !!vm && typeof vm.updateFilter === 'function' && (vm.filters || vm.state?.filters);

  // 從 DOM 往上找承載 stat-filter-group 的 vue 實例(Vue 2 會把實例掛在 $el.__vue__)
  function findGroupVm(el) {
    for (let node = el; node; node = node.parentElement) {
      if (isGroupVm(node.__vue__)) return node.__vue__;
    }
    return null;
  }

  // 主動掃描:從官網掛在全域的 app 往下走元件樹,一次把現有的條件列全部掛上,
  // 不必等使用者去碰。這是幾個在架的同類擴充共用的存取路徑,比從 DOM 往上找
  // 更早生效;兩者並用,新增的條件列再由 DOM 那條補上。
  function scanFromApp() {
    const app = window.app;
    if (!app) return 0;
    let found = 0;
    const walk = (vm, depth) => {
      if (!vm || depth > 12) return;
      if (isGroupVm(vm) && patchInstance(vm)) found++;
      for (const child of vm.$children ?? []) walk(child, depth + 1);
    };
    try {
      walk(app, 0);
    } catch (err) {
      dbg('[PTM] 合併選單:掃描元件樹時中斷(改由使用者互動時掛載):', err.message);
    }
    if (found) patchOk = true;
    return found;
  }

  // 等 window.app 出現:先同步試一次,沒有就觀察 DOM 變動,逾時放棄
  function whenAppReady(cb, timeout = 20000) {
    if (window.app) { cb(); return; }
    const started = Date.now();
    const ob = new MutationObserver(() => {
      if (window.app) { ob.disconnect(); cb(); }
      else if (Date.now() - started > timeout) { ob.disconnect(); dbg('[PTM] 合併選單:等不到官網 app,改由使用者互動時掛載'); }
    });
    ob.observe(document.documentElement, { childList: true, subtree: true });
  }

  let patchOk = false;
  let patchCount = 0;
  let settled = false;
  // 每次碰到篩選面板都試一次:官網會為新增的條件列建立新實例,而 patch 是
  // 掛在實例上的,只做一次會漏掉後來才出現的那幾列
  function trySettle(el) {
    const vm = findGroupVm(el);
    if (!vm) return; // 還沒點到詞綴列上,不算失敗,繼續等
    settled = true;
    if (patchInstance(vm)) {
      patchOk = true;
      try {
        localStorage.removeItem(READY_KEY);
      } catch (_) { /* 忽略 */ }
    } else if (!patchOk) {
      markUnavailable('stat-filter-group 沒有 updateFilter');
    }
  }

  // 使用者一碰篩選面板就完成掛載。用 capture 確保早於官網自己的處理
  for (const type of ['focusin', 'pointerdown']) {
    document.addEventListener(type, (e) => {
      if (e.target instanceof HTMLElement) trySettle(e.target);
    }, true);
  }

  // app 就緒不代表條件列元件已建好(官網是漸進掛載的),掃不到就隔一段再試,
  // 幾次都沒有就交給使用者互動時的 DOM 路徑
  whenAppReady(() => {
    let tries = 0;
    const tick = () => {
      const n = scanFromApp();
      if (n) { dbg(`[PTM] 合併選單:從元件樹掃到並掛上 ${n} 個條件列`); return; }
      if (++tries < 5) setTimeout(tick, 400 * tries);
      else dbg('[PTM] 合併選單:元件樹尚無條件列,改由使用者操作篩選面板時掛載');
    };
    tick();
  });

  // ── 送出前的最後一道防線 ──
  // 狀態層的還原不能保證涵蓋所有路徑:0.3.1 實測發現從 option 子選單選值時,
  // 官網並未呼叫 updateFilter,偽 id 因而原封送到官方後端,搜尋直接失敗。
  // 這裡在請求真正送出前掃過 body,把殘留的偽 id 換回真實條件;換不掉就中止,
  // 絕不讓壞查詢離開瀏覽器(送壞查詢除了報錯,還可能觸發官方流量限制)。
  const isSearchUrl = (u) => /\/api\/trade\d*\/search\//.test(String(u ?? ''));

  function rewriteQuery(payload) {
    let changed = 0;
    let unresolved = 0;
    for (const group of payload?.query?.stats ?? []) {
      for (const f of group?.filters ?? []) {
        if (!isPseudo(f?.id)) continue;
        const picked = f.value?.option;
        const real = picked === undefined ? null : resolve(f.id, picked);
        if (real) {
          dbg(`[PTM] 合併選單:送出前還原 ${f.id} option=${picked} → ${real.id}`);
          f.id = real.id;
          f.value = { ...real.value, ...(f.disabled !== undefined ? {} : {}) };
          changed++;
        } else {
          unresolved++;
        }
      }
    }
    return { changed, unresolved };
  }

  /** 回傳改寫後的 body 字串;無法還原時回 null(呼叫端須中止請求) */
  function sanitizeBody(body) {
    if (typeof body !== 'string' || !body.includes(MARK)) return body;
    let payload;
    try {
      payload = JSON.parse(body);
    } catch (_) {
      return body; // 不是 JSON,交給官網原樣處理
    }
    const { changed, unresolved } = rewriteQuery(payload);
    if (unresolved) {
      console.warn(`[PTM] 合併選單:${unresolved} 個條件無法還原成官方詞綴,已中止這次搜尋。` +
        '請移除該條件後重試,或在擴充設定中關閉「同類詞綴合併選單」。');
      return null;
    }
    return changed ? JSON.stringify(payload) : body;
  }

  const origSend = XMLHttpRequest.prototype.send;
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__ptmUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (body) {
    try {
      if (isSearchUrl(this.__ptmUrl)) {
        const fixed = sanitizeBody(body);
        if (fixed === null) return; // 中止:不呼叫原生 send
        return origSend.call(this, fixed);
      }
    } catch (err) {
      console.warn('[PTM] 合併選單:送出前檢查失敗,改用原生行為:', err);
    }
    return origSend.call(this, body);
  };

  const origFetch = window.fetch;
  window.fetch = function (input, init) {
    try {
      const url = typeof input === 'string' ? input : input?.url;
      if (isSearchUrl(url) && typeof init?.body === 'string') {
        const fixed = sanitizeBody(init.body);
        if (fixed === null) return Promise.reject(new Error('[PTM] 合併選單:條件無法還原,已中止搜尋'));
        if (fixed !== init.body) return origFetch.call(this, input, { ...init, body: fixed });
      }
    } catch (err) {
      console.warn('[PTM] 合併選單:送出前檢查失敗,改用原生行為:', err);
    }
    return origFetch.call(this, input, init);
  };

  // 供顯示層(stat-search.js)查詢本功能是否真的可用
  window.__ptmStatGroup = {
    isPseudo,
    // 即時閘門:只有真的掛上還原機制、且映射表在手,才讓顯示層放出合併選單。
    // 掛不上時使用者看到的就是官網原生清單,不會選到送不出去的條件。
    available: () => patchOk && Object.keys(mapping()).length > 0,
    // 手動診斷:遇到問題時在 console 打 __ptmStatGroup.diag() 貼結果回報
    diag() {
      const table = mapping();
      const groups = Object.entries(table).map(([id, opts]) =>
        ({ 合併選單: id, 子選項數: Object.keys(opts).length }));
      const out = {
        映射表: groups,
        已掛上還原機制: patchOk ? `是(${patchCount} 個條件列)`
          : settled ? '否(元件形狀不符)' : '尚未掛載(官網 app 未就緒且未碰過篩選面板)',
        官網app: window.app ? '有' : '找不到',
        能力旗標: localStorage.getItem(READY_KEY) ?? '(正常)',
        目前篩選條件: null,
        偽id殘留: [],
      };
      try {
        const q = window.app?.$store?.state?.transient?.search?.active?.query;
        const stats = q?.stats ?? [];
        out.目前篩選條件 = JSON.stringify(stats);
        for (const g of stats) {
          for (const f of g?.filters ?? []) if (isPseudo(f?.id)) out.偽id殘留.push(f.id);
        }
      } catch (err) {
        out.目前篩選條件 = '讀取失敗:' + err.message;
      }
      dbg('[PTM] 合併選單診斷', out);
      return out; // 打包版 dbg 為 no-op,但在 console 直接呼叫仍看得到回傳值
    },
  };
  dbg('[PTM] 合併選單:腳本已載入,等待使用者操作篩選面板後掛載');
})();
