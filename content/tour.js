// document_end(isolated,國際服 + 台服、PoE1 + PoE2):首次安裝的功能導覽(逐步聚光)。
//
// ── 什麼時候跑(使用者 2026-10-01 裁定)──
//   · 自動:**只有全新安裝**。background.js 的 onInstalled(reason === 'install')寫 `tourPending: true`,
//     更新一律不寫 → 既有使用者升級永遠不會自動看到。條件全部成立才開始:
//       tourPending === true + 已選好介面語言 + 在交易站搜尋頁 + 交易 App 已掛上
//       + 側邊欄已建好(或使用者把側邊欄關了)+ 分頁在前景,然後再等約 1 秒讓頁面穩定。
//     完成或略過(含 Esc)→ 移除 tourPending、寫 tourSeenAt;中途關分頁 → 旗標保留,下次再跑。
//   · 手動:側邊欄 設定 → 進階 →「重新播放導覽」(sidebar.js 呼叫 __pmzTour.start),不看旗標。
//   兩個鍵都是獨立 storage 鍵,不在 settings 裡(不進備份、不受 DEFAULT_SETTINGS 升級鎖約束),
//   切 English 清中文資料時也不清(bg/translation.js purgeChineseData 的清單沒有它們)。
//
// ── 只指給使用者看,一個東西都不動 ──
//   · 絕不送出搜尋、不改篩選值、不 postMessage 給 MAIN world、不碰 Vuex。
//   · 官網(Vue 管)的節點一個都不增刪、不改屬性;導覽 UI 整組 append 到 document.body,
//     **不放進側邊欄的 .pmz-body**(sidebar.js 的 render() 會清空它)。唯一會「動」頁面的是
//     scrollIntoView(把要框的東西捲進畫面,與使用者自己捲動相同)。
//   · 側邊欄透過 sidebar.js 開放的極小 API(__pmzSidebarApi)切分頁,一律不寫 sidebarUi,
//     導覽結束還原成導覽前的開合與分頁。
//   · 錨點不在畫面上(例如還沒搜尋就沒有結果列)→ 改成置中卡片並說明「搜尋之後會出現…」。
//
// ⚠ 同一個 isolated world 的 content script 共享頂層 lexical scope(跨 content_scripts 條目也是),
//   所以整支包在 IIFE 裡,頂層一個名字都不宣告(CLAUDE.md「側邊欄」段)。
(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  if (globalThis.__pmzTour) return; // 重複注入(擴充重新載入後的舊 world)只留第一份

  const I18N = globalThis.PMZ_I18N;
  const tr = (k, v) => (I18N ? I18N.t(k, v) : k);

  // 站別 / 遊戲別:document_end 可以讀 bootstrap 掛的值,但一律有自算備援(CLAUDE.md「鍵的分組」)
  const SITE = (globalThis.PMZ_SITE
    ?? (/(^|\.)pathofexile\.tw$/.test(location.hostname) ? 'tw' : 'intl')) === 'tw' ? 'tw' : 'intl';
  const GAME = (() => {
    const g = globalThis.PMZ_GAME?.id;
    if (g === 'poe1' || g === 'poe2') return g;
    const p = location.pathname;
    return /^\/trade2(\/|$)/.test(p) || /^\/trade\/[^/]+\/poe2(\/|$)/.test(p) ? 'poe2' : 'poe1';
  })();
  // 只在搜尋頁自動開始(以物易物、歷史頁不跑)
  const SEARCH_PAGE_RE = /^\/trade2?\/search(\/|$)/;

  // ── 官網 DOM 耦合點(改版時優先檢查這裡)──
  const SEL = {
    app: '.search-panel', // 交易 App 已掛上(PoE1 未登入也會掛;只剩登入頁時不自動跑)
    addStat: '.search-advanced-items .filter-padded .multiselect', // 詞綴區最下面的「+ Add Stat Filter」
    tierPick: '.pmz-tier-pick', // content/tier-picker.js
    row: '.resultset .row[data-id]',
    orig: '.ptm-orig', // content/results.js 雙語模式的英文原文
    tail: '.pmz-mod-tail', // content/mod-row.js + tier-badge.js 共用的詞綴尾巴
    pseudo: '.item-mod--pseudo',
    copy: 'button.copy.pmz-copy-on', // content/copy-item.js 放出來的 PoE2 複製鈕
    replay: '.pmz-tour-replay', // sidebar.js 設定 → 進階 的重播鈕
  };

  const AUTO_DELAY_MS = 1000; // 條件成立後再等一下,讓官網的篩選區、結果列先畫完
  const WAIT_MS = 20000; // 等交易 App / 側邊欄的上限;等不到就不自動跑(旗標保留)
  const STORE = { pending: 'tourPending', seen: 'tourSeenAt' };

  const reducedMotion = () => {
    try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  };

  // ── 找錨點 ──
  function visibleRect(node) {
    if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== 'function') return null;
    const r = node.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    try {
      const cs = getComputedStyle(node);
      if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) return null;
    } catch (_) { /* 拿不到樣式就只看大小 */ }
    return r;
  }
  // 第一個看得見的(只看前 60 個:結果列可能很長,第一筆就夠指了)
  function firstVisible(sel, root = document) {
    const list = root.querySelectorAll(sel);
    for (let i = 0; i < list.length && i < 60; i++) if (visibleRect(list[i])) return list[i];
    return null;
  }
  // 多個元素 → 聯集框(側邊欄分頁 = rail 上那顆鈕 + 面板)
  function unionRect(nodes) {
    let out = null;
    for (const n of nodes) {
      const r = visibleRect(n);
      if (!r) continue;
      out = out
        ? { left: Math.min(out.left, r.left), top: Math.min(out.top, r.top), right: Math.max(out.right, r.right), bottom: Math.max(out.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    if (!out) return null;
    return { ...out, width: out.right - out.left, height: out.bottom - out.top };
  }

  // ── 步驟 ──
  // when(ctx):這一步在這個情境下有沒有意義(站別 / 遊戲 / 介面語言 / 側邊欄 / 功能開關)
  // prepare(env):顯示前把側邊欄擺到對的狀態;anchor(env):要框的元素(或陣列);
  // body(ctx):段落陣列;miss:錨點不在畫面上時的補充說明鍵;page:錨點在官網頁面上(要捲進畫面)
  const on = (v) => v !== false; // 設定鍵讀法與各功能相同:只有明確 false 才是關
  const sidebarTab = (tab) => ({
    when: (c) => c.sidebar,
    prepare: (env) => { env.api.showTab(tab); },
    anchor: (env) => [env.nodes?.railBtn(tab), env.nodes?.panel],
  });
  const STEPS = [
    {
      id: 'welcome',
      body: (c) => [tr('sb.tour.welcome.body'), c.site === 'tw' ? tr('sb.tour.welcome.tw') : null],
    },
    {
      id: 'rail',
      when: (c) => c.sidebar,
      prepare: (env) => { env.api.setOpen(false); }, // 收合時才是可拖曳的小塊
      anchor: (env) => env.nodes?.rail,
    },
    { id: 'bookmarks', ...sidebarTab('bookmarks') },
    { id: 'history', ...sidebarTab('history') },
    // 物價只有 PoE1 國際服(bg/ninja.js 打 poe.ninja/poe1;台服拔掉)
    { id: 'prices', ...sidebarTab('prices'), when: (c) => c.sidebar && c.game === 'poe1' && c.site === 'intl' },
    {
      id: 'settings',
      ...sidebarTab('settings'),
      prepare: (env) => {
        env.api.showTab('settings');
        const body = env.nodes?.panel?.querySelector('.pmz-body');
        if (body) body.scrollTop = 0;
      },
      body: (c) => [tr('sb.tour.settings.body'), c.zhSite ? tr('sb.tour.settings.zhExtra') : null],
    },
    // 模糊搜尋是 MAIN world 的 page/stat-search.js,只掛國際服(manifest 第一條)
    { id: 'fuzzy', when: (c) => c.site === 'intl', page: true, anchor: () => firstVisible(SEL.addStat), miss: 'sb.tour.fuzzy.miss' },
    { id: 'tierPick', when: (c) => on(c.settings.tierPicker), page: true, anchor: () => firstVisible(SEL.tierPick), miss: 'sb.tour.tierPick.miss' },
    {
      id: 'translate',
      when: (c) => c.zhSite,
      page: true,
      anchor: () => {
        const orig = firstVisible(SEL.orig);
        return orig ? (orig.closest('.item-mod') ?? orig) : firstVisible(SEL.row);
      },
      miss: 'sb.tour.translate.miss',
    },
    {
      id: 'tail',
      when: (c) => on(c.settings.tierBadges) || on(c.settings.modFilterButtons),
      page: true,
      anchor: () => firstVisible(SEL.tail),
      body: (c) => [
        on(c.settings.tierBadges) ? tr('sb.tour.tail.badges') : null,
        on(c.settings.modFilterButtons) ? tr('sb.tour.tail.buttons') : null,
      ],
      miss: 'sb.tour.tail.miss',
    },
    { id: 'pseudo', when: (c) => on(c.settings.highlightPseudo), page: true, anchor: () => firstVisible(SEL.pseudo), miss: 'sb.tour.pseudo.miss' },
    // 複製物品只有 PoE2 國際服(content/copy-item.js:台服物品 JSON 是中文,先不做)
    { id: 'copy', when: (c) => c.game === 'poe2' && c.site === 'intl', page: true, anchor: () => firstVisible(SEL.copy), miss: 'sb.tour.copy.miss' },
    // ninja / pobb.in 的開關只在中文介面的 popup 出現(popup #zhOnlySites);交易站上沒有東西可框
    { id: 'sites', when: (c) => c.uiLang === 'zh' },
    {
      id: 'done',
      prepare: (env) => {
        if (!env.api) return;
        env.api.showTab('settings');
        const btn = env.nodes?.panel?.querySelector(SEL.replay);
        try { btn?.scrollIntoView({ block: 'center', behavior: 'auto' }); } catch (_) { /* 舊瀏覽器 */ }
      },
      anchor: (env) => env.nodes?.panel?.querySelector(SEL.replay) ?? null,
      noMiss: true, // 側邊欄關著時本來就沒有重播鈕,說明文字已經講了怎麼打開
      body: (c) => [tr(c.sidebar ? 'sb.tour.done.body' : 'sb.tour.done.noSidebar')],
    },
  ];

  // 依情境挑出要顯示的步驟(純函式,tools/verify-tour.mjs 直接呼叫)
  function planSteps(ctx) {
    const c = { settings: {}, ...ctx };
    if (c.zhSite === undefined) c.zhSite = c.site === 'intl' && c.uiLang === 'zh' && c.translate !== false;
    return STEPS.filter((s) => !s.when || s.when(c)).map((s) => s.id);
  }

  // 說明卡放哪裡(純函式):目標上 / 下 / 左 / 右放得下的那一側,都放不下 → 貼底置中;沒有目標 → 置中。
  // 很高的目標(側邊欄)先試左右,其他先試上下。
  function placeCard(t, card, vw, vh, gap = 14, pad = 12) {
    const clampX = (x) => Math.max(pad, Math.min(x, vw - card.w - pad));
    const clampY = (y) => Math.max(pad, Math.min(y, vh - card.h - pad));
    if (!t || vw < 480) return { x: clampX((vw - card.w) / 2), y: clampY((vh - card.h) / 2), side: 'center' };
    const room = {
      bottom: vh - t.bottom - gap - pad >= card.h,
      top: t.top - gap - pad >= card.h,
      right: vw - t.right - gap - pad >= card.w,
      left: t.left - gap - pad >= card.w,
    };
    const order = t.height > vh * 0.5 ? ['left', 'right', 'bottom', 'top'] : ['bottom', 'top', 'right', 'left'];
    const side = order.find((s) => room[s]);
    const midX = clampX(t.left + t.width / 2 - card.w / 2);
    const midY = clampY(t.top + t.height / 2 - card.h / 2);
    if (side === 'bottom') return { x: midX, y: t.bottom + gap, side };
    if (side === 'top') return { x: midX, y: t.top - gap - card.h, side };
    if (side === 'right') return { x: t.right + gap, y: midY, side };
    if (side === 'left') return { x: t.left - gap - card.w, y: midY, side };
    return { x: clampX((vw - card.w) / 2), y: clampY(vh - card.h - pad), side: 'overlay' };
  }

  // ── 執行狀態 ──
  let run = null; // { steps, i, ctx, env, saved, prevFocus, root, spot, card, …, cleanup[] }
  let starting = false;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  async function buildCtx() {
    const got = await chrome.storage.local.get(['uiLang', 'language', 'sidebarEnabled', 'settings']);
    const ui = I18N?.effectiveUiLang(got.uiLang, got.language) === 'en' ? 'en' : 'zh';
    I18N?.setLang(ui); // 側邊欄關掉時 sidebar.js 仍會先設語言;這裡再設一次不會有差
    const api = globalThis.__pmzSidebarApi ?? null;
    const translate = (got.language ?? 'zh_tw') === 'zh_tw';
    return {
      site: SITE,
      game: GAME,
      uiLang: ui,
      translate,
      zhSite: SITE === 'intl' && ui === 'zh' && translate, // 這一頁會不會被翻成中文
      sidebar: got.sidebarEnabled !== false && !!api,
      settings: got.settings && typeof got.settings === 'object' ? got.settings : {},
      api,
    };
  }

  // ── 開始 / 結束 ──
  async function start({ replay = false } = {}) {
    if (run || starting || document.querySelector('.pmz-tour')) return false;
    starting = true;
    try {
      const ctx = await buildCtx();
      if (run) return false;
      const ids = planSteps(ctx);
      const steps = ids.map((id) => STEPS.find((s) => s.id === id));
      const api = ctx.sidebar ? ctx.api : null;
      run = {
        replay,
        ctx,
        steps,
        i: 0,
        env: { api, nodes: api?.nodes?.() ?? null },
        saved: api?.getState?.() ?? null,
        prevFocus: document.activeElement ?? null,
        cleanup: [],
        hasAnchor: null,
        raf: 0,
      };
      buildUi();
      show(0);
      dbg(`[PTM] 功能導覽開始(${replay ? '重播' : '首次安裝'}):${ids.join(' → ')}`);
      return true;
    } finally {
      starting = false;
    }
  }

  // reason:'done'(按完成)/ 'skip'(略過或 Esc)= 使用者明確結束 → 清旗標;'abort' = 程式中止 → 旗標保留
  function end(reason = 'abort') {
    if (!run) return false;
    const r = run;
    run = null;
    for (const fn of r.cleanup) { try { fn(); } catch (_) { /* 個別清理失敗不影響其他 */ } }
    r.root.remove();
    if (r.env.api && r.saved) r.env.api.restore(r.saved);
    if (reason === 'done' || reason === 'skip') {
      chrome.storage.local.remove(STORE.pending).catch?.(() => {});
      chrome.storage.local.set({ [STORE.seen]: Date.now() }).catch?.(() => {});
    }
    const pf = r.prevFocus;
    if (pf && pf.isConnected !== false && typeof pf.focus === 'function' && pf !== document.body) {
      try { pf.focus({ preventScroll: true }); } catch (_) { /* 焦點還不回去就算了 */ }
    }
    dbg(`[PTM] 功能導覽結束:${reason}(第 ${r.i + 1} / ${r.steps.length} 步)`);
    return true;
  }

  function buildUi() {
    const root = el('div', 'pmz-tour');
    const block = el('div', 'pmz-tour-block'); // 擋住頁面點擊(導覽是 modal)
    const spot = el('div', 'pmz-tour-spot');
    spot.setAttribute('aria-hidden', 'true');
    const card = el('div', 'pmz-tour-card');
    card.setAttribute('role', 'dialog');
    card.setAttribute('aria-modal', 'true');
    card.setAttribute('aria-labelledby', 'pmz-tour-title');
    card.setAttribute('aria-describedby', 'pmz-tour-body');
    card.setAttribute('aria-label', tr('sb.tour.dialog'));
    const count = el('div', 'pmz-tour-count');
    const content = el('div', 'pmz-tour-content');
    content.setAttribute('aria-live', 'polite');
    const title = el('div', 'pmz-tour-title');
    title.id = 'pmz-tour-title';
    const body = el('div', 'pmz-tour-body');
    body.id = 'pmz-tour-body';
    const note = el('div', 'pmz-tour-note');
    content.append(title, body, note);
    const keys = el('div', 'pmz-tour-keys', tr('sb.tour.keys'));
    const foot = el('div', 'pmz-tour-foot');
    const skip = el('button', 'pmz-tour-skip', tr('sb.tour.skip'));
    const nav = el('div', 'pmz-tour-nav');
    const prev = el('button', 'pmz-tour-prev', tr('sb.tour.prev'));
    const next = el('button', 'pmz-tour-next');
    for (const b of [skip, prev, next]) b.type = 'button';
    nav.append(prev, next);
    foot.append(skip, nav);
    card.append(count, content, keys, foot);
    root.append(block, spot, card);
    if (reducedMotion()) root.classList.add('pmz-tour-still');
    document.body.appendChild(root);
    Object.assign(run, { root, block, spot, card, count, title, body, note, prev, next, skip });

    skip.addEventListener('click', () => end('skip'));
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));

    // 鍵盤:capture 階段先攔,處理到的鍵不讓官網收到
    const onKey = (e) => {
      if (!run) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); end('skip'); return; }
      if (e.key === 'ArrowRight') { e.preventDefault(); e.stopPropagation(); go(1); return; }
      if (e.key === 'ArrowLeft') { e.preventDefault(); e.stopPropagation(); go(-1); return; }
      if (e.key === 'Tab') {
        // 焦點留在卡片裡(modal)
        const f = [skip, prev, next].filter((b) => !b.disabled);
        const at = f.indexOf(document.activeElement);
        e.preventDefault();
        e.stopPropagation();
        const nextIdx = at < 0 ? 0 : (at + (e.shiftKey ? -1 : 1) + f.length) % f.length;
        f[nextIdx]?.focus({ preventScroll: true });
      }
    };
    document.addEventListener('keydown', onKey, true);
    run.cleanup.push(() => document.removeEventListener('keydown', onKey, true));

    // 目標移動就重算(rAF 節流):捲動(任何容器,capture)、視窗大小、元素大小
    const onMove = () => schedule();
    window.addEventListener('scroll', onMove, { capture: true, passive: true });
    window.addEventListener('resize', onMove, { passive: true });
    run.cleanup.push(() => {
      window.removeEventListener('scroll', onMove, { capture: true });
      window.removeEventListener('resize', onMove);
    });
    // ⚠ 清理函式在 end() 把 run 設成 null 之後才跑:一律用這裡抓住的 r,不要讀 run
    const r = run;
    if (typeof ResizeObserver === 'function') {
      r.ro = new ResizeObserver(onMove);
      r.ro.observe(card);
      r.cleanup.push(() => r.ro.disconnect());
    }
    r.cleanup.push(() => {
      for (const t of r.timers ?? []) clearTimeout(t);
      if (r.raf) (globalThis.cancelAnimationFrame ?? clearTimeout)(r.raf);
    });
  }

  function go(delta) {
    if (!run) return;
    const j = run.i + delta;
    if (j < 0) return;
    if (j >= run.steps.length) { end('done'); return; }
    show(j);
  }

  function show(i) {
    const r = run;
    r.i = i;
    const step = r.steps[i];
    // 頁面上的步驟:側邊欄回到導覽前的樣子(官網內容的位置就是使用者平常看到的位置)
    try {
      if (step.prepare) step.prepare(r.env);
      else if (step.page && r.env.api && r.saved) r.env.api.restore(r.saved);
    } catch (err) {
      console.warn('[PTM] 導覽步驟準備失敗,改用置中說明:', err);
    }
    const total = r.steps.length;
    r.count.textContent = tr('sb.tour.step', { n: i + 1, total });
    r.title.textContent = tr(`sb.tour.${step.id}.title`);
    r.body.textContent = '';
    const paras = (step.body ? step.body(r.ctx) : [tr(`sb.tour.${step.id}.body`)]).filter(Boolean);
    for (const p of paras) r.body.appendChild(el('div', 'pmz-tour-p', p));
    r.prev.disabled = i === 0;
    r.next.textContent = i === total - 1 ? tr('sb.tour.done') : tr('sb.tour.next');
    r.card.dataset.step = step.id;
    r.hasAnchor = null;
    // 頁面上的錨點不在可視範圍 → 捲進畫面(只捲,不改任何東西)
    if (step.page) {
      const a = resolveAnchor(step);
      const rect = a.length === 1 ? visibleRect(a[0]) : null;
      if (rect && (rect.top < 0 || rect.bottom > innerHeight)) {
        try { a[0].scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { /* 舊瀏覽器 */ }
      }
    }
    measure();
    settle();
    try { r.next.focus({ preventScroll: true }); } catch (_) { /* 沒有 focus 選項的舊瀏覽器 */ }
  }

  function resolveAnchor(step) {
    if (!step.anchor) return [];
    let a = null;
    try { a = step.anchor(run.env); } catch (_) { a = null; }
    return (Array.isArray(a) ? a : [a]).filter(Boolean);
  }

  // 側邊欄滑入、捲動動畫期間位置一直在變:接下來一小段時間多量幾次。
  // 用 setTimeout 而不是 rAF 迴圈 —— 背景分頁不跑 rAF(sidebar.js 踩過)。
  function settle() {
    for (const t of run.timers ?? []) clearTimeout(t);
    run.timers = [60, 160, 280, 450, 700].map((ms) => setTimeout(() => run && measure(), ms));
  }

  function schedule() {
    if (!run || run.raf) return;
    const raf = globalThis.requestAnimationFrame ?? ((f) => setTimeout(f, 16));
    run.raf = raf(() => { if (run) { run.raf = 0; measure(); } });
  }

  function measure() {
    const r = run;
    if (!r) return;
    const step = r.steps[r.i];
    const nodes = resolveAnchor(step);
    const rect = nodes.length ? unionRect(nodes) : null;
    const vw = innerWidth;
    const vh = innerHeight;
    const has = !!rect;
    if (has !== r.hasAnchor) {
      r.hasAnchor = has;
      r.root.classList.toggle('pmz-tour-dim', !has);
      r.spot.hidden = !has;
      const missKey = step.anchor && !step.noMiss ? (step.miss ?? 'sb.tour.miss') : null;
      r.note.textContent = !has && missKey ? tr(missKey) : '';
      r.note.hidden = has || !missKey;
      r.card.dataset.anchor = has ? 'on' : step.anchor ? 'missing' : 'none';
    }
    let target = null;
    if (rect) {
      const P = 6; // 框比元素大一圈
      const left = Math.max(-4, rect.left - P);
      const top = Math.max(-4, rect.top - P);
      const right = Math.min(vw + 4, rect.right + P);
      const bottom = Math.min(vh + 4, rect.bottom + P);
      target = { left, top, right, bottom, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
      Object.assign(r.spot.style, { left: `${left}px`, top: `${top}px`, width: `${target.width}px`, height: `${target.height}px` });
    }
    const cr = r.card.getBoundingClientRect();
    const pos = placeCard(target, { w: cr.width || 340, h: cr.height || 200 }, vw, vh);
    r.card.dataset.side = pos.side;
    Object.assign(r.card.style, { left: `${Math.round(pos.x)}px`, top: `${Math.round(pos.y)}px` });
  }

  // ── 自動開始(首次安裝)──
  const sleep = (ms) => new Promise((res) => setTimeout(res, ms));
  async function waitUntil(cond, ms) {
    for (let t = 0; t <= ms; t += 250) {
      if (cond()) return true;
      await sleep(250);
    }
    return false;
  }
  function whenVisible() {
    if (document.visibilityState !== 'hidden') return Promise.resolve();
    return new Promise((res) => {
      const f = () => {
        if (document.visibilityState === 'hidden') return;
        document.removeEventListener('visibilitychange', f);
        res();
      };
      document.addEventListener('visibilitychange', f);
    });
  }

  let autoTried = false;
  async function autoStart() {
    if (autoTried || !SEARCH_PAGE_RE.test(location.pathname)) return;
    const got = await chrome.storage.local.get([STORE.pending, 'uiLang', 'language', 'sidebarEnabled']);
    if (got[STORE.pending] !== true) return;
    // 還沒選語言(全新安裝、語言選擇頁還沒按)→ 等使用者選好(側邊欄頂端的選擇列或 popup 都會寫 uiLang)
    if (!I18N?.isChosen(I18N.effectiveUiLang(got.uiLang, got.language))) { waitForLang(); return; }
    autoTried = true;
    const ready = await waitUntil(
      () => !!document.querySelector(SEL.app) && (got.sidebarEnabled === false || !!globalThis.__pmzSidebarApi),
      WAIT_MS);
    if (!ready) { dbg('[PTM] 功能導覽:交易 App 或側邊欄沒有就緒,這次不自動開始(下次開頁再試)'); return; }
    await whenVisible();
    await sleep(AUTO_DELAY_MS);
    // 等待期間可能已在另一個分頁跑完(旗標被清掉)
    const again = await chrome.storage.local.get(STORE.pending);
    if (again[STORE.pending] !== true) return;
    await start({ replay: false });
  }

  let langListener = null;
  function waitForLang() {
    if (langListener) return;
    langListener = (changes, area) => {
      if (area !== 'local' || !changes.uiLang || !I18N?.isChosen(changes.uiLang.newValue)) return;
      chrome.storage.onChanged.removeListener(langListener);
      langListener = null;
      autoStart().catch((err) => console.warn('[PTM] 功能導覽啟動失敗:', err));
    };
    chrome.storage.onChanged.addListener(langListener);
  }

  globalThis.__pmzTour = {
    start,
    stop: (reason) => end(reason === 'done' || reason === 'skip' ? reason : 'abort'),
    isActive: () => !!run,
    current: () => (run ? { id: run.steps[run.i].id, i: run.i, total: run.steps.length, anchor: run.card.dataset.anchor, side: run.card.dataset.side } : null),
    planSteps,
    placeCard,
    STEP_IDS: STEPS.map((s) => s.id),
    SEL,
  };

  autoStart().catch((err) => console.warn('[PTM] 功能導覽啟動失敗:', err));
})();
