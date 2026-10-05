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
// ── 只指給使用者看;唯一的例外是篩選區的「示範」,而且全部還原 ──
//   · 絕不送出搜尋、不改使用者既有的篩選值、不碰 Vuex(isolated world 本來也看不到)。
//   · 示範(使用者 2026-10-02 要求):「模糊搜尋」那步把收著的篩選區展開、在「＋ 新增詞綴篩選」下拉打一段
//     示範字;「階級選單」那步加一列示範詞綴(+# 最大生命)讓 ≈T▾ 有東西可框。這些都由 MAIN world 的
//     page/mod-filter.js 代辦(postMessage `pmz:tourDemo`,只收同視窗同來源),那邊只 commit 官網自己的
//     mutation、不呼叫 save(不改網址 / localStorage / 搜尋 dirty)。**離開需要它的步驟、結束、Esc、
//     頁面離開都會還原**:關下拉清字、移除示範列(只移除自己加的那列,先核對 stat id)、原本收著就收回去。
//   · 官網(Vue 管)的節點導覽這邊一個都不增刪、不改屬性;導覽 UI 整組 append 到 document.body,
//     **不放進側邊欄的 .pmz-body**(sidebar.js 的 render() 會清空它)。另外會「動」頁面的只有
//     scrollIntoView(把要框的東西捲進畫面,與使用者自己捲動相同)。
//   · 側邊欄透過 sidebar.js 開放的極小 API(__pmzSidebarApi)切分頁,一律不寫 sidebarUi,
//     導覽結束還原成導覽前的開合與分頁。設定列以 sidebar.js 掛的 data-pmz-setting / data-pmz-section 定位。
//   · 錨點不在畫面上(例如還沒搜尋就沒有結果列)→ 改成置中卡片並說明「搜尋之後會出現…」。
//     「在畫面上」要扣掉被祖先 overflow 裁掉的部分:官網收起篩選區是 height:0 + overflow:hidden,
//     裡面的元素大小照舊 —— 舊版只看大小,把聚光框畫到了結果列標頭上(使用者 2026-10-02 回報)。
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
    // 詞綴篩選群組裡的「+ Add Stat Filter」:只在 .filter-group-body 裡的 .filter-padded(右欄最下面的
    // 「+ Add Stat Group」是 pane 直屬的 .filter-padded、屬性群組的 body 裡沒有 .filter-padded,都不會中)
    addStat: '.search-advanced-items .filter-group-body .filter-padded .multiselect',
    addStatOpen: 'multiselect--active', // vue-multiselect 開著時的 class
    dropdown: '.multiselect__content-wrapper',
    tierPick: '.pmz-tier-pick', // content/tier-picker.js
    row: '.resultset .row[data-id]',
    orig: '.ptm-orig', // content/results.js 雙語模式的英文原文
    tail: '.pmz-mod-tail', // content/mod-row.js + tier-badge.js 共用的詞綴尾巴
    badge: '.pmz-tier-badge', // content/tier-badge.js
    pseudo: '.item-mod--pseudo',
    copy: 'button.copy.pmz-copy-on', // content/copy-item.js 放出來的 PoE2 複製鈕
    links: '.pmz-wiki-links', // content/result-links.js 的 poedb / wiki 快捷鈕(平時藏、滑過那一列才出現)
    replay: '.pmz-tour-replay', // sidebar.js 設定 → 進階 的重播鈕
  };
  // sidebar.js 設定列 / 區塊標題上的穩定屬性(不靠文字、不靠 class 順序)
  const SETTING_ATTR = 'data-pmz-setting';
  const SECTION_ATTR = 'data-pmz-section';
  // 「在設定調整」那步框的四列:結果列 ＋/−、階級標記、階級選單、填值方式(選單關掉時那列不存在)
  const MOD_SETTING_KEYS = ['modFilterButtons', 'tierBadges', 'tierPicker', 'tierPickerMode'];

  // 篩選區示範(page/mod-filter.js 代辦;見檔頭)
  const DEMO_MSG = 'pmz:tourDemo';
  const DEMO_DONE = 'pmz:tourDemoDone';
  const DEMO_STAT = 'explicit.stat_3299347043'; // +# to maximum Life(PoE1 / PoE2 同 id,兩款都有階級表)
  // 示範字:交易站是中文就打中文簡稱,否則(English 介面 / 關掉中文化)打英文。兩個都是「官網原生比對不到、
  // 模糊比對才找得到」的例子(CLAUDE.md「下拉模糊搜尋」:暴率 → 暴擊率;regen life → Life Regeneration)
  // ⚠ 這是打進官網下拉的「搜尋資料」,不是介面字串,所以不進 i18n 表(verify-i18n D1 對這個名字放行)
  const DEMO_QUERY_ZH = '暴率';
  const DEMO_QUERY_EN = 'regen life';
  const demoQuery = (c) => (c.zhSite ? DEMO_QUERY_ZH : DEMO_QUERY_EN);
  const DEMO_TIMEOUT_MS = 1500; // MAIN world 沒回應(官網改版、App 沒掛)→ 當作失敗,退回說明
  const DEMO_ROW_WAIT_MS = 2500; // 加了示範列後等官網重畫 + tier-picker 放上 ≈T▾

  const AUTO_DELAY_MS = 1000; // 條件成立後再等一下,讓官網的篩選區、結果列先畫完
  const WAIT_MS = 20000; // 等交易 App / 側邊欄的上限;等不到就不自動跑(旗標保留)
  const STORE = { pending: 'tourPending', seen: 'tourSeenAt' };

  const reducedMotion = () => {
    try { return !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches; } catch (_) { return false; }
  };

  // ── 找錨點 ──
  const style = (n) => { try { return getComputedStyle(n) ?? null; } catch (_) { return null; } };
  const CLIP_RE = /hidden|auto|scroll|clip/;
  // 看得見的部分(扣掉被祖先 overflow 裁掉的);完全被裁掉 = null。
  // fixed 定位的元素(側邊欄)不受它外層 overflow 影響,走到 fixed 就停。
  function visibleRect(node) {
    if (!node || node.isConnected === false || typeof node.getBoundingClientRect !== 'function') return null;
    const r = node.getBoundingClientRect();
    if (!r || !(r.width > 0) || !(r.height > 0)) return null;
    const cs = style(node);
    if (cs && (cs.visibility === 'hidden' || cs.display === 'none')) return null;
    let box = { left: r.left, top: r.top, right: r.left + r.width, bottom: r.top + r.height };
    let fixed = cs?.position === 'fixed';
    for (let p = node.parentElement; p && !fixed && p !== document.body && p !== document.documentElement; p = p.parentElement) {
      const ps = style(p);
      if (!ps) continue;
      if (CLIP_RE.test(`${ps.overflow ?? ''} ${ps.overflowX ?? ''} ${ps.overflowY ?? ''}`)) {
        const pr = p.getBoundingClientRect();
        box = {
          left: Math.max(box.left, pr.left),
          top: Math.max(box.top, pr.top),
          right: Math.min(box.right, pr.left + pr.width),
          bottom: Math.min(box.bottom, pr.top + pr.height),
        };
        if (box.right - box.left < 1 || box.bottom - box.top < 1) return null;
      }
      if (ps.position === 'fixed') fixed = true;
    }
    return { ...box, width: box.right - box.left, height: box.bottom - box.top };
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

  // ── 頁面上的錨點 ──
  // 「＋ 新增詞綴篩選」:下拉開著(示範中)就框輸入框 + 展開的清單,否則框第一個看得見的
  function addStatAnchor() {
    const list = [...document.querySelectorAll(SEL.addStat)];
    const open = list.find((n) => n.classList.contains(SEL.addStatOpen) && visibleRect(n));
    const ms = open ?? list.find((n) => visibleRect(n));
    if (!ms) return null;
    return [ms, open ? ms.querySelector(SEL.dropdown) : null];
  }
  // 示範那一列(page/mod-filter.js 回傳的群組 / 列索引;核對 stat id 才算)
  function demoRow() {
    const f = run?.demo?.filter;
    if (!f || !Number.isInteger(f.gi) || !Number.isInteger(f.fi)) return null;
    const row = document.querySelector(`[data-pmz-gi="${f.gi}"][data-pmz-fi="${f.fi}"]`);
    return row && row.getAttribute('data-pmz-stat-id') === f.statId ? row : null;
  }
  // 階級選單:示範列(連同列上的 ≈T▾);沒有示範列就框第一個看得見的選單
  function tierPickAnchor() {
    const row = demoRow();
    if (row && visibleRect(row)) return [row, row.querySelector(SEL.tierPick)];
    return firstVisible(SEL.tierPick);
  }
  // 詞綴尾巴:第一筆看得見的結果裡**整欄**尾巴(徽章 + ＋/−)的聯集,不只第一條。
  // ⚠ 使用者 2026-10-02 回報聚光框只框到一條的 ＋/−、沒框到徽章:第一個 .pmz-mod-tail 常是
  //   隱性 / 附魔那條(沒有階級資料 → 只有按鈕)。偽屬性的尾巴不算(那是另一區)。
  //   有徽章的話挑第一筆「至少一條帶徽章」的結果。
  function tailAnchor(c) {
    const rows = document.querySelectorAll(SEL.row);
    let fallback = null;
    for (let i = 0; i < rows.length && i < 30; i++) {
      if (!visibleRect(rows[i])) continue;
      const tails = [...rows[i].querySelectorAll(SEL.tail)].filter((t) => !t.closest(SEL.pseudo) && visibleRect(t));
      if (!tails.length) continue;
      if (!on(c.settings.tierBadges) || tails.some((t) => visibleRect(t.querySelector(SEL.badge)))) return tails;
      fallback ??= tails;
    }
    return fallback ?? firstVisible(SEL.tail);
  }

  // 快捷鈕:第一個看得見的;都藏著(沒滑過)就框第一個所在的那一欄
  function linksAnchor() {
    const shown = firstVisible(SEL.links);
    if (shown) return shown;
    for (const n of document.querySelectorAll(SEL.links)) {
      const cell = n.parentElement;
      if (cell && visibleRect(cell)) return cell;
    }
    return null;
  }

  // ── 側邊欄裡的錨點 ──
  const panelQuery = (env, sel) => env.nodes?.panel?.querySelector(sel) ?? null;
  const settingRows = (env) => MOD_SETTING_KEYS.map((k) => panelQuery(env, `[${SETTING_ATTR}="${k}"]`)).filter(Boolean);
  // 設定分頁的一個區塊 = 標題到下一個區塊標題之前的所有兄弟
  function sectionNodes(env, id) {
    const title = panelQuery(env, `[${SECTION_ATTR}="${id}"]`);
    if (!title) return [];
    const out = [title];
    for (let n = title.nextElementSibling; n && !n.hasAttribute(SECTION_ATTR); n = n.nextElementSibling) out.push(n);
    return out;
  }
  const scrollTo = (node, block) => {
    try { node?.scrollIntoView({ block, behavior: 'auto' }); } catch (_) { /* 舊瀏覽器 */ }
  };

  // ── 步驟 ──
  // when(ctx):這一步在這個情境下有沒有意義(站別 / 遊戲 / 介面語言 / 側邊欄 / 功能開關)
  // prepare(env):顯示前把側邊欄擺到對的狀態;anchor(env, ctx):要框的元素(或陣列,框聯集);
  // body(ctx, demo):段落陣列;miss:錨點不在畫面上時的補充說明鍵;page:錨點在官網頁面上(要捲進畫面);
  // demo:這一步需要的篩選區示範 { panel, dropdown, filter }(沒寫 = 都不要,離開時還原)
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
    // 大量賣家:預設關,設定開了才有這個分頁(只有明確 true 才算開,與 sidebar.js tabEnabled 相同)
    { id: 'bulk', ...sidebarTab('bulk'), when: (c) => c.sidebar && c.settings.bulkSellers === true, miss: 'sb.tour.bulk.miss' },
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
    // 備份與匯入:框整個區塊。PoB code 只有 PoE1(sidebar.js CODE_SOURCES)
    {
      id: 'backup',
      when: (c) => c.sidebar,
      prepare: (env) => {
        env.api.showTab('settings');
        scrollTo(sectionNodes(env, 'backup')[0], 'start');
      },
      anchor: (env) => sectionNodes(env, 'backup'),
      body: (c) => [tr('sb.tour.backup.body'), tr('sb.tour.backup.file'), tr('sb.tour.backup.ext'), c.game === 'poe1' ? tr('sb.tour.backup.pob') : null],
    },
    // 模糊搜尋是 MAIN world 的 page/stat-search.js,只掛國際服(manifest 第一條)。
    // 示範:展開篩選區、在下拉打示範字(離開這步就關下拉、清字;下一步不需要就收回篩選區)
    {
      id: 'fuzzy',
      when: (c) => c.site === 'intl',
      page: true,
      demo: { panel: true, dropdown: true },
      anchor: () => addStatAnchor(),
      body: (c, d) => [tr('sb.tour.fuzzy.body'), d?.dropdown && d.query ? tr('sb.tour.fuzzy.demo', { query: d.query }) : null],
      miss: 'sb.tour.fuzzy.miss',
    },
    // 示範:加一列 +# 最大生命(使用者自己已經有這列就直接框它,不加)
    {
      id: 'tierPick',
      when: (c) => on(c.settings.tierPicker),
      page: true,
      demo: { panel: true, filter: true },
      anchor: () => tierPickAnchor(),
      body: (c, d) => [tr('sb.tour.tierPick.body'), d?.filter && !d.filter.existing ? tr('sb.tour.tierPick.demo') : null],
      miss: 'sb.tour.tierPick.miss',
    },
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
      anchor: (env, c) => tailAnchor(c),
      body: (c) => [
        on(c.settings.tierBadges) ? tr('sb.tour.tail.badges') : null,
        on(c.settings.modFilterButtons) ? tr('sb.tour.tail.buttons') : null,
      ],
      miss: 'sb.tour.tail.miss',
    },
    // 上面三樣(＋/−、階級標記、階級選單 + 填值方式)在 設定 → 顯示 的開關
    {
      id: 'modSettings',
      when: (c) => c.sidebar,
      prepare: (env) => {
        env.api.showTab('settings');
        scrollTo(settingRows(env)[0], 'center');
      },
      anchor: (env) => settingRows(env),
    },
    { id: 'pseudo', when: (c) => on(c.settings.highlightPseudo), page: true, anchor: () => firstVisible(SEL.pseudo), miss: 'sb.tour.pseudo.miss' },
    // 複製物品只有 PoE2 國際服(content/copy-item.js:台服物品 JSON 是中文,先不做)
    { id: 'copy', when: (c) => c.game === 'poe2' && c.site === 'intl', page: true, anchor: () => firstVisible(SEL.copy), miss: 'sb.tour.copy.miss' },
    // poedb / wiki 快捷鈕:只掛國際服、預設關(content/result-links.js)。鈕平時藏著(滑過那一列才出現),
    // 看得見就框鈕,否則框它所在的那一欄(官方 refresh / searchBy 那欄)
    { id: 'links', when: (c) => c.site === 'intl' && c.settings.resultLinks === true, page: true, anchor: () => linksAnchor(), miss: 'sb.tour.links.miss' },
    // ninja / pobb.in 的開關只在中文介面的 popup 出現(popup #zhOnlySites);交易站上沒有東西可框
    { id: 'sites', when: (c) => c.uiLang === 'zh' },
    {
      id: 'done',
      prepare: (env) => {
        if (!env.api) return;
        env.api.showTab('settings');
        scrollTo(env.nodes?.panel?.querySelector(SEL.replay), 'center');
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
        id: `pmz-tour-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
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
        // 篩選區示範目前的樣子(以 MAIN world 回報成功的為準);demoUsed = 送過任何示範請求
        demo: { panel: false, dropdown: false, query: null, filter: null },
        demoUsed: false,
        demoQ: Promise.resolve(),
        reqs: new Map(),
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
    // 示範一律還原(關下拉清字 → 移除示範列 → 原本收著就收回)。不等回覆:run 已經是 null,
    // 排隊中的示範請求看到 run 換掉就不再送;已經送出的會排在這則之前被 MAIN world 處理,所以清得到。
    if (r.demoUsed) postDemo('cleanup', `${r.id}-end`);
    for (const done of r.reqs.values()) done({ ok: false, why: 'ended' });
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
    // 篩選區示範的回覆(page/mod-filter.js):只收同視窗、同來源、自己發出的 reqId
    const onMsg = (e) => {
      if (e.source !== window || e.origin !== location.origin) return;
      const d = e.data;
      if (!d || d.t !== DEMO_DONE || typeof d.reqId !== 'string') return;
      r.reqs.get(d.reqId)?.(d);
    };
    window.addEventListener('message', onMsg);
    r.cleanup.push(() => window.removeEventListener('message', onMsg));
    // 頁面離開(重新整理、換頁、關分頁):當作程式中止 → 還原示範、旗標保留(下次再跑)
    const onHide = () => end('abort');
    window.addEventListener('pagehide', onHide);
    r.cleanup.push(() => window.removeEventListener('pagehide', onHide));
  }

  // ── 篩選區示範(page/mod-filter.js 代辦)──
  function postDemo(op, reqId, extra = {}) {
    window.postMessage({ t: DEMO_MSG, reqId, op, ...extra }, location.origin);
  }
  function demoCall(r, op, extra = {}) {
    r.demoUsed = true;
    return new Promise((resolve) => {
      const reqId = `${r.id}-${r.reqs.size}-${Math.random().toString(36).slice(2, 8)}`;
      const timer = setTimeout(() => r.reqs.get(reqId)?.({ ok: false, why: 'timeout' }), DEMO_TIMEOUT_MS);
      r.reqs.set(reqId, (d) => { clearTimeout(timer); r.reqs.delete(reqId); resolve(d); });
      postDemo(op, reqId, extra);
    });
  }
  // 把示範調成「目前這一步」要的樣子。一律排隊(連按 → ← 時前一輪還在等回覆),
  // 每一輪都讀當下的步驟,所以最後一定收斂到最後停下的那步。
  function queueDemo() {
    const r = run;
    if (!r) return Promise.resolve();
    r.demoQ = r.demoQ.then(() => syncDemo(r)).catch((err) => console.warn('[PTM] 導覽示範失敗:', err));
    return r.demoQ;
  }
  async function syncDemo(r) {
    const live = () => run === r;
    if (!live()) return;
    const step = r.steps[r.i];
    const want = step.demo ?? {};
    const d = r.demo;
    let changed = false;
    // 先拆(不需要的)再裝(需要的);拆的順序:下拉 → 示範列 → 篩選區
    if (!want.dropdown && d.dropdown) { d.dropdown = false; d.query = null; changed = true; await demoCall(r, 'closeSearch'); }
    if (!live()) return;
    if (!want.filter && d.filter) { d.filter = null; changed = true; await demoCall(r, 'removeFilter'); }
    if (!live()) return;
    if (!want.panel && d.panel) { d.panel = false; changed = true; await demoCall(r, 'collapse'); }
    const same = () => live() && r.steps[r.i] === step;
    if (!same()) return; // 等回覆時換了步驟:排在後面的那一輪會處理
    if (want.panel && !d.panel) {
      const x = await demoCall(r, 'expand');
      if (!same()) return;
      d.panel = x.ok === true;
      changed = true;
    }
    if (want.filter && !d.filter && d.panel) {
      const x = await demoCall(r, 'addFilter', { statId: DEMO_STAT });
      if (x.ok === true) d.filter = { gi: x.gi, fi: x.fi, statId: x.statId, existing: x.existing === true };
      if (!same()) return;
      changed = true;
      // 等官網畫出那一列、mod-filter 標上索引、tier-picker 放上 ≈T▾(選單關掉時只等那一列)
      if (d.filter) {
        const picker = on(r.ctx.settings.tierPicker);
        await waitUntil(() => !same() || (picker ? !!demoRow()?.querySelector(SEL.tierPick) : !!demoRow()), DEMO_ROW_WAIT_MS, 100);
      }
      if (!same()) return;
    }
    if (want.dropdown && !d.dropdown && d.panel) {
      // 候選示範字:先試這個介面該打的,下拉沒結果(例如中文詞綴表還沒建好)再退英文;實際打了哪個由 MAIN 回報
      const queries = [...new Set([demoQuery(r.ctx), DEMO_QUERY_EN])];
      const x = await demoCall(r, 'openSearch', { queries });
      if (!same()) return;
      d.dropdown = x.ok === true;
      d.query = typeof x.query === 'string' ? x.query : null;
      changed = true;
    }
    if (changed && same()) afterDemo(r, step);
  }
  // 示範改了版面:重寫說明(有沒有示範成功會影響內文)、捲進畫面、重量
  function afterDemo(r, step) {
    renderBody(step);
    r.hasAnchor = null;
    if (step.page) bringIntoView(step);
    measure();
    settle();
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
    renderBody(step);
    r.prev.disabled = i === 0;
    r.next.textContent = i === total - 1 ? tr('sb.tour.done') : tr('sb.tour.next');
    r.card.dataset.step = step.id;
    r.hasAnchor = null;
    if (step.page) bringIntoView(step);
    measure();
    settle();
    try { r.next.focus({ preventScroll: true }); } catch (_) { /* 沒有 focus 選項的舊瀏覽器 */ }
    // 篩選區示範:這一步要的裝上、不要的還原(非同步;好了之後 afterDemo 重量一次)
    queueDemo();
  }

  function renderBody(step) {
    const r = run;
    r.body.textContent = '';
    const paras = (step.body ? step.body(r.ctx, r.demo) : [tr(`sb.tour.${step.id}.body`)]).filter(Boolean);
    for (const p of paras) r.body.appendChild(el('div', 'pmz-tour-p', p));
  }

  // 頁面上的錨點(聯集)不在可視範圍 → 把第一個看得見的捲到中間(只捲,不改任何東西)
  function bringIntoView(step) {
    const a = resolveAnchor(step);
    const u = a.length ? unionRect(a) : null;
    if (!u || (u.top >= 0 && u.bottom <= innerHeight)) return;
    const first = a.find((n) => visibleRect(n));
    try { first?.scrollIntoView({ block: 'center', behavior: reducedMotion() ? 'auto' : 'smooth' }); } catch (_) { /* 舊瀏覽器 */ }
  }

  function resolveAnchor(step) {
    if (!step.anchor) return [];
    let a = null;
    try { a = step.anchor(run.env, run.ctx); } catch (_) { a = null; }
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
  async function waitUntil(cond, ms, every = 250) {
    for (let t = 0; t <= ms; t += every) {
      if (cond()) return true;
      await sleep(every);
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
    current: () => (run ? { id: run.steps[run.i].id, i: run.i, total: run.steps.length, anchor: run.card.dataset.anchor, side: run.card.dataset.side, demo: { ...run.demo } } : null),
    demoIdle: () => run?.demoQ ?? Promise.resolve(), // 測試用:等目前排隊的示範調整做完
    planSteps,
    placeCard,
    STEP_IDS: STEPS.map((s) => s.id),
    SEL,
  };

  autoStart().catch((err) => console.warn('[PTM] 功能導覽啟動失敗:', err));
})();
