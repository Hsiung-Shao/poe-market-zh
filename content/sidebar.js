// document_end(isolated):右側側邊欄 —— 書籤(兩層資料夾)/ 物價 / 設定。
// 同時負責 SPA 網址變化偵測與設定同步。資料格式與匯入解析全在 bookmarks-model.js
// (純邏輯、可離線測試),這支只負責畫面與互動。
//
// ⚠ 這支不碰翻譯層:bootstrap.js / results.js / ui-strings.js / stat-search.js
//   一行都不依賴,側邊欄壞掉也不影響中文化。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  // ⚠ 必須放在 IIFE 裡面:同一個 isolated world 的 content script **共享頂層
  //   lexical scope**(即使分屬不同的 content_scripts 條目)。bootstrap.js 也有
  //   頂層 const dbg,放外面會得到 "Identifier 'dbg' has already been declared",
  //   整支側邊欄一行都不會執行(2026-08-14 實測)。results.js 也是放 IIFE 內。
  const dbg = (...a) => console.info(...a);
  const M = globalThis.pmzBookmarks;
  if (!M) {
    console.warn('[PTM] 書籤資料模型未載入,側邊欄停用');
    return;
  }

  const FOLDER_ICONS = ['📁', '⚔️', '🛡️', '💍', '💎', '🧪', '📜', '🗺️', '🔥', '❄️', '⚡', '💰'];
  // ── 官網 DOM 耦合點:書籤預設名稱來源(改版時優先檢查)──
  // ⚠ 只認物品搜尋框(.search-select)。2026-08-14 實測:PoE Trade Mate 原本用的
  //   `.search-bar .multiselect__single` 在現行版面抓到的是 **realm 選單**,
  //   每個書籤都會被命名成「PoE 1 PC」。抓不到就回 null,由呼叫端改用 search id。
  const NAME_SOURCES = [
    ['.search-select .multiselect__single', 'text'],
    ['.search-select input.multiselect__input', 'value'],
    ['.search-left .multiselect__single', 'text'],
  ];
  // 過濾各語言模式下的輸入框 placeholder(中文化開/關都要擋)。
  // 「search 」帶空白,避免誤殺物品 Searching Eye Jewel。
  const NAME_PLACEHOLDER_RE = /^(search |add stat|搜尋|加入詞綴|新增詞綴)/i;
  // ⚠ 前綴一定要是 pmz-:PoE Trade Mate 用的是 ptm-settings,兩個擴充可能同時
  //   裝在同一個瀏覽器,共用鍵會互相覆寫設定。
  const SETTINGS_KEY = 'pmz-settings';
  const DEFAULT_SETTINGS = {
    autoInstantBuyout: false, // 開頁自動把狀態設為「即刻購買」
    highlightPseudo: true, // 結果列的偽屬性(合計)詞綴高亮
    league: '', // 聯盟:物價與書籤共用;空字串 = 自動(poe.ninja 最新 / 目前頁面)
    sidebarSide: 'right',
    sidebarTop: 45, // 開關鈕垂直位置(vh 百分比,可拖曳調整)
    lastLeague: '', // 最後看到的聯盟,設定為「自動」時當退路
  };

  const state = {
    data: { version: M.VERSION, folders: [] },
    settings: { ...DEFAULT_SETTINGS },
    iconList: [], // 遊戲圖像清單(內建 data/icons.json)
    iconIndex: null, // 英文名 → 圖檔位址(匯入時對照 Extension 的 icon 列舉)
    itemMap: null, // 物價分頁的中文名對照(懶載入)
    prices: { league: null, list: [], at: 0, filter: '', openCats: new Set(['Currency']) },
    ninjaLeagues: null, // poe.ninja 聯盟清單 {leagues, latest}(懶載入)
    ninjaPerm: null, // poe.ninja 選用權限:null = 還沒查
    // 與 popup 共用的兩個 storage 鍵。⚠ 一定要進 state:render 是「清空再重畫」,
    // 在 render 裡非同步讀 storage 再 append,兩次 render 交錯就會畫出兩份
    // (2026-08-16 使用者截圖回報:切一次中文化,下半部整組重複)。
    language: 'zh_tw',
    bilingualMods: false,
    history: [], // 最近開過的搜尋(只記有名字的)
    historyPickId: null, // 歷史列展開「加入書籤」的那一筆
    tab: 'bookmarks',
    open: false,
    addFormOpen: false,
    editingFolderId: null, // 正在改名(同時顯示圖示選擇器)的資料夾
    dataMsg: null, // 匯出/匯入結果訊息 { ok, text, detail? }
    codeBoxOpen: null, // 匯入輸入框:null | 'ext'(Extension 匯出碼)| 'pob'(PoB code)
  };

  // ── URL 解析與 SPA 導航偵測 ──
  function currentSearch() {
    return M.parseSearchUrl(location.href);
  }

  function leagueFor(bm) {
    return M.resolveLeague(bm, location.href, {
      settingLeague: state.settings.league,
      lastLeague: state.settings.lastLeague,
    });
  }

  function urlFor(bm) {
    return M.buildTradeUrl(location.origin, bm, leagueFor(bm));
  }

  // ── 帶條件的書籤:開過一次就把官方搜尋編號記起來 ──
  // 這種書籤存的是查詢條件,每次開都要讓官網重新建立一次搜尋(所以「點下去很慢」)。
  // 開啟前先把「我正在開哪一個書籤」寫進 sessionStorage(點下去會整頁重載,記憶體留不住),
  // 頁面回來後看到網址已經變成 /search/<聯盟>/<編號> 就寫回書籤,下次直接開那個編號。
  const PENDING_KEY = 'pmz-pending-open';

  function openBookmark(bm) {
    const league = leagueFor(bm);
    if (!bm.searchId && bm.query) {
      try {
        sessionStorage.setItem(PENDING_KEY, JSON.stringify({ id: bm.id, league, at: Date.now() }));
      } catch (_) { /* 無痕或配額問題:頂多下次還是慢一點 */ }
    }
    location.href = M.buildTradeUrl(location.origin, bm, league);
  }

  function adoptSearchId() {
    let pending = null;
    try {
      pending = JSON.parse(sessionStorage.getItem(PENDING_KEY) ?? 'null');
    } catch (_) { /* 壞掉就當沒有 */ }
    if (!pending?.id) return;
    if (Date.now() - (pending.at ?? 0) > 60_000) {
      try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
      return;
    }
    const cur = M.parseSearchUrl(location.href);
    if (!cur?.searchId) return; // 官網還在把 ?q= 換成編號,等下一次網址變化
    for (const folder of state.data.folders) {
      const bm = folder.bookmarks.find((b) => b.id === pending.id);
      if (!bm || bm.searchId) continue;
      if (bm.cachedSearchId === cur.searchId && bm.cachedLeague === pending.league) break;
      bm.cachedSearchId = cur.searchId;
      bm.cachedLeague = pending.league;
      persist();
      dbg(`[PTM] 書籤「${bm.name}」記下搜尋編號 ${cur.searchId}(${pending.league}),下次直接開`);
      break;
    }
    try { sessionStorage.removeItem(PENDING_KEY); } catch (_) {}
  }

  function guessSearchName() {
    for (const [sel, kind] of NAME_SOURCES) {
      const node = document.querySelector(sel);
      const raw = kind === 'value' ? node?.value : node?.textContent;
      const text = raw?.trim().replace(/^~/, '');
      if (text && !NAME_PLACEHOLDER_RE.test(text)) return text.slice(0, 60);
    }
    return null;
  }

  // 記住最後看到的聯盟:書籤存的是與聯盟無關的 search id,不在搜尋頁時要有退路
  function rememberLeague() {
    const league = M.leagueFromHref(location.href);
    if (league && league !== state.settings.lastLeague) {
      state.settings.lastLeague = league;
      persistSettings();
    }
  }

  let lastHref = location.href;
  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    rememberLeague();
    adoptSearchId(); // ?q= 換成正式編號的那一刻,把編號寫回書籤
    scheduleHistory();
    if (state.open && (state.tab === 'bookmarks' || state.tab === 'history')) render();
  }
  if (globalThis.navigation?.addEventListener) {
    globalThis.navigation.addEventListener('navigatesuccess', onUrlMaybeChanged);
  }
  setInterval(onUrlMaybeChanged, 1000); // navigation API 之外的保險

  // ── 儲存 ──
  // 每個分頁一個實例 id,寫入時蓋章;onChanged 據此辨識「自己寫的」,
  // 避免自我寫入把 state.data 換成反序列化副本。
  const INSTANCE_ID = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let saveTimer = null;
  function persist() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      state.data._writer = INSTANCE_ID;
      chrome.storage.local.set({ bookmarkData: state.data });
    }, 300);
  }

  function persistSettings() {
    chrome.storage.local.set({ settings: state.settings });
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(state.settings));
    } catch (_) { /* MAIN world 下次重整讀到 */ }
  }

  // ── UI 基礎 ──
  let panel, toggleBtn;

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function applySide() {
    const left = state.settings.sidebarSide === 'left';
    toggleBtn.classList.toggle('pmz-left', left);
    panel.classList.toggle('pmz-left', left);
  }

  // 面板開啟時隱藏 ☰ 開關鈕(面板標頭已有 ✕ 可關),避免疊在面板內容上
  function setOpen(open) {
    state.open = open;
    panel.classList.toggle('pmz-open', open);
    toggleBtn.classList.toggle('pmz-hidden', open);
    if (open) render();
  }

  function applyTop() {
    const pct = Math.min(88, Math.max(3, Number(state.settings.sidebarTop) || 45));
    toggleBtn.style.top = `${pct}%`; // 面板為全高固定,只有開關鈕跟著拖曳
  }

  // 開關鈕可垂直拖曳(位移超過門檻視為拖曳,放開後不觸發開合)
  function enableDrag() {
    let drag = null;
    let suppressClick = false;
    toggleBtn.addEventListener('pointerdown', (e) => {
      drag = { startY: e.clientY, startPct: Number(state.settings.sidebarTop) || 45, moved: false };
      toggleBtn.setPointerCapture(e.pointerId);
    });
    toggleBtn.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      state.settings.sidebarTop = drag.startPct + (dy / window.innerHeight) * 100;
      applyTop();
    });
    toggleBtn.addEventListener('pointerup', () => {
      if (drag?.moved) {
        suppressClick = true;
        persistSettings();
      }
      drag = null;
    });
    toggleBtn.addEventListener('click', (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopImmediatePropagation();
      }
    }, true);
  }

  function buildShell() {
    toggleBtn = el('button', 'pmz-toggle', '☰');
    toggleBtn.title = 'Poe Market Zh(可拖曳調整位置)';
    toggleBtn.addEventListener('click', () => setOpen(!state.open));

    panel = el('div', 'pmz-panel');
    const header = el('div', 'pmz-header');
    const headText = el('div', 'pmz-header-text');
    headText.appendChild(el('div', 'pmz-header-title', 'Poe Market Zh'));
    headText.appendChild(el('div', 'pmz-header-sub', '交易站中文化'));
    header.appendChild(headText);
    const closeBtn = el('button', 'pmz-header-close', '✕');
    closeBtn.title = '收合側邊欄';
    closeBtn.addEventListener('click', () => setOpen(false));
    header.appendChild(closeBtn);
    panel.appendChild(header);
    const tabs = el('div', 'pmz-tabs');
    for (const [id, label] of [['bookmarks', '書籤'], ['history', '歷史'], ['prices', '物價'], ['settings', '⚙']]) {
      const tab = el('button', 'pmz-tab', label);
      tab.dataset.tab = id;
      tab.title = id === 'settings' ? '設定' : label;
      tab.addEventListener('click', () => {
        state.tab = id;
        state.dataMsg = null; // 匯出/匯入結果訊息只顯示到離開分頁為止
        state.historyPickId = null;
        render();
      });
      tabs.appendChild(tab);
    }
    panel.appendChild(tabs);
    panel.appendChild(el('div', 'pmz-body'));
    document.body.append(toggleBtn, panel);
    applySide();
    applyTop();
    enableDrag();
  }

  // ── 確認對話框 ──
  // 不用瀏覽器原生 confirm:它會凍住整個官網分頁,樣式也跟側邊欄格格不入。
  // 蓋在 panel 上而不是整頁,才不會擋住使用者正在看的搜尋結果。
  function confirmDialog({ title, message, okLabel = '繼續', onOk }) {
    const mask = el('div', 'pmz-modal-mask');
    const box = el('div', 'pmz-modal');
    box.appendChild(el('div', 'pmz-modal-title', title));
    box.appendChild(el('div', 'pmz-modal-q', '確定嗎?'));
    box.appendChild(el('div', 'pmz-modal-msg', message));
    const btns = el('div', 'pmz-modal-btns');
    const close = () => mask.remove();
    const cancel = el('button', 'pmz-modal-cancel', '取消');
    cancel.addEventListener('click', close);
    const ok = el('button', 'pmz-modal-ok', okLabel);
    ok.addEventListener('click', () => {
      close();
      onOk();
    });
    btns.append(cancel, ok);
    box.appendChild(btns);
    mask.appendChild(box);
    // 點遮罩或按 Esc 都當取消
    mask.addEventListener('click', (e) => {
      if (e.target === mask) close();
    });
    const onKey = (e) => {
      if (e.key !== 'Escape') return;
      e.stopPropagation();
      close();
      document.removeEventListener('keydown', onKey, true);
    };
    document.addEventListener('keydown', onKey, true);
    panel.appendChild(mask);
    ok.focus();
  }

  // ── 線條圖示(Lucide 風格,與 PoE Trade Extension 同一路數)──
  // 用 emoji 當按鈕在不同系統會長得完全不一樣(而且 📍/📌 特別醜),改成內嵌 SVG:
  // 尺寸、粗細、顏色都跟著 CSS 走,hover 才變亮。
  const ICON_PATHS = {
    pin: 'M12 17v5M9 10.76a2 2 0 0 1-1.11 1.79l-1.78.9A2 2 0 0 0 5 15.24V16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-.76a2 2 0 0 0-1.11-1.79l-1.78-.9A2 2 0 0 1 15 10.76V7a1 1 0 0 1 1-1 2 2 0 0 0 0-4H8a2 2 0 0 0 0 4 1 1 0 0 1 1 1z',
    pencil: 'M21.174 6.812a1 1 0 0 0-3.986-3.987L3.842 16.174a2 2 0 0 0-.5.83l-1.321 4.352a.5.5 0 0 0 .623.622l4.353-1.32a2 2 0 0 0 .83-.497z',
    trash: 'M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M10 11v6M14 11v6',
    plus: 'M5 12h14M12 5v14',
    check: 'M20 6 9 17l-5-5',
    star: 'M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z',
    x: 'M18 6 6 18M6 6l12 12',
  };

  function svgIcon(name, extraClass) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', `pmz-svg${extraClass ? ` ${extraClass}` : ''}`);
    const path = document.createElementNS(NS, 'path');
    path.setAttribute('d', ICON_PATHS[name] ?? ICON_PATHS.x);
    svg.appendChild(path);
    return svg;
  }

  // 圖示按鈕:平時是低調的灰線條,滑過去才亮起來(ghost button)
  function iconBtn(name, title, onClick, extraClass) {
    const btn = el('button', `pmz-iconact${extraClass ? ` ${extraClass}` : ''}`);
    btn.type = 'button';
    btn.title = title;
    btn.appendChild(svgIcon(name));
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  function actionBtn(label, title, onClick) {
    const btn = el('button', 'pmz-act', label);
    btn.title = title;
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onClick();
    });
    return btn;
  }

  // 圖示可以是 emoji 或遊戲圖像 URL(poecdn / poewiki)
  function renderIcon(icon, className) {
    if (typeof icon === 'string' && icon.startsWith('https://')) {
      const img = el('img', className);
      img.src = icon;
      img.alt = '';
      return img;
    }
    return el('span', className, icon || M.DEFAULT_ICON);
  }

  // 圖示選擇器:遊戲圖像分區(通貨/碎片/精髓…)+ emoji 備援列
  function iconPicker(selected, onPick) {
    const wrap = el('div', 'pmz-icon-pop');
    const markActive = (btn) => {
      wrap.querySelectorAll('.pmz-icon-btn').forEach((b) => b.classList.remove('pmz-icon-active'));
      btn.classList.add('pmz-icon-active');
    };
    const addBtn = (row, icon, title) => {
      const btn = el('button', 'pmz-icon-btn');
      btn.type = 'button';
      btn.title = title ?? '';
      // 改名中按圖示不能讓輸入框失焦(失焦=結束改名,選擇器就跟著消失)
      btn.addEventListener('mousedown', (e) => e.preventDefault());
      btn.appendChild(renderIcon(icon, 'pmz-icon-glyph'));
      if (icon === selected) btn.classList.add('pmz-icon-active');
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        markActive(btn);
        onPick(icon);
      });
      row.appendChild(btn);
    };
    for (const section of state.iconList) {
      wrap.appendChild(el('div', 'pmz-icon-section', section.label));
      const row = el('div', 'pmz-icon-row');
      for (const { name, url } of section.icons) addBtn(row, url, name);
      wrap.appendChild(row);
    }
    wrap.appendChild(el('div', 'pmz-icon-section', '符號'));
    const emojiRow = el('div', 'pmz-icon-row');
    for (const icon of FOLDER_ICONS) addBtn(emojiRow, icon, icon);
    wrap.appendChild(emojiRow);
    return wrap;
  }

  // 內聯改名:把標題文字就地換成輸入框,Enter/失焦儲存、Esc 取消
  function startInlineEdit(nameEl, initial, onSave) {
    // 編輯期間停用所在列的拖曳,避免選取文字時誤觸(結束後 render() 重建即還原)
    const dragHost = nameEl.closest('[draggable="true"]');
    if (dragHost) dragHost.draggable = false;
    const input = el('input', 'pmz-inline-input');
    input.value = initial;
    nameEl.replaceWith(input);
    input.focus();
    input.select();
    let finished = false;
    const done = (save) => {
      if (finished) return;
      finished = true;
      const v = input.value.trim();
      if (save && v && v !== initial) onSave(v);
      render();
    };
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') done(true);
      if (e.key === 'Escape') done(false);
    });
    input.addEventListener('blur', () => done(true));
  }

  // ── 拖放:規則在 bookmarks-model,互動在下面的 makeDraggable(長按才拖)──

  function findFolderById(id) {
    return state.data.folders.find((f) => f.id === id);
  }

  function moveBookmark(ctx, targetFolderId, beforeBookmarkId) {
    const src = findFolderById(ctx.folderId);
    const dst = findFolderById(targetFolderId);
    if (!src || !dst) return;
    const from = src.bookmarks.findIndex((b) => b.id === ctx.bookmarkId);
    if (from < 0) return;
    const [bm] = src.bookmarks.splice(from, 1);
    let at = beforeBookmarkId ? dst.bookmarks.findIndex((b) => b.id === beforeBookmarkId) : -1;
    if (at < 0) at = dst.bookmarks.length; // 丟到資料夾標題 → 移到末端
    dst.bookmarks.splice(at, 0, bm);
    dst.collapsed = false;
    persist();
    render();
  }

  // 資料夾拖放:規則與套用都在 bookmarks-model(純函式、可離線測),這裡只接結果
  function dropFolderOn(ctx, targetId, position) {
    const plan = M.planFolderDrop(state.data.folders, ctx.folderId, targetId, position);
    if (plan.error !== undefined) {
      if (plan.error) {
        state.dataMsg = { ok: false, text: plan.error };
        render();
      }
      return;
    }
    state.data.folders = M.applyFolderDrop(state.data.folders, ctx.folderId, plan);
    persist();
    render();
  }

  const DROP_CLASSES = ['pmz-drop-target', 'pmz-drop-before', 'pmz-drop-after'];
  function clearDropMarks() {
    panel.querySelectorAll(`.${DROP_CLASSES.join(', .')}`).forEach((n) => n.classList.remove(...DROP_CLASSES));
  }

  // ── 長按才拖曳 ──
  // 用 pointer 事件自己做,不用 HTML5 的 draggable:draggable 一開就是「按住就拖」,
  // 整塊沒辦法同時當按鈕用。改成按住 350ms 才進拖曳模式,在那之前手指/滑鼠移開
  // 或放開都算單純點擊 —— 這樣書籤整塊都能點開搜尋。
  const LONG_PRESS_MS = 350;
  const MOVE_CANCEL_PX = 8;
  // 這些子元素自己有動作,不該吃掉點擊或觸發拖曳
  const INTERACTIVE = '.pmz-iconact, .pmz-act, button, input, select, textarea, a';
  let drag = null; // { ctx, ghost, source }
  // ⚠ 不要用「一次性旗標」擋拖曳後的那一下點擊:拖到別的元素上時瀏覽器**根本不會**
  //   發 click,旗標就永遠留著,把下一次真正的點擊吃掉(2026-08-16 實測踩到)。
  //   改記時間點,過了就自動失效。
  let dragEndedAt = 0;
  const CLICK_GUARD_MS = 300;

  function endDrag(apply) {
    if (!drag) return;
    const { ghost, source, hit } = drag;
    ghost?.remove();
    source?.classList.remove('pmz-dragging');
    clearDropMarks();
    document.body.style.userSelect = '';
    const finished = drag;
    drag = null;
    if (apply && hit) finished.onDrop(finished.ctx, hit.node, hit.position);
  }

  // 游標底下可以放的目標(ghost 有 pointer-events:none,不會擋住 elementFromPoint)
  function hitTest(x, y, accepts) {
    const el0 = document.elementFromPoint(x, y);
    const node = el0?.closest('[data-pmz-drop]');
    if (!node || !panel.contains(node)) return null;
    const kind = node.dataset.pmzDrop;
    if (!accepts.includes(kind)) return null;
    const rect = node.getBoundingClientRect();
    // 資料夾之間才分上/中/下三段;書籤只有「插到它前面」一種
    const position = drag?.ctx.type === 'folder' && kind === 'folder'
      ? M.dropPosition(y - rect.top, rect.height)
      : 'inside';
    return { node, position };
  }

  function makeDraggable(node, ctx, onDrop, accepts, kind) {
    node.dataset.pmzDrop = kind;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
      const startX = e.clientX;
      const startY = e.clientY;
      let timer = setTimeout(() => {
        timer = null;
        // 進入拖曳:做一個半透明複本跟著游標走
        const rect = node.getBoundingClientRect();
        const ghost = node.cloneNode(true);
        ghost.className = `${node.className} pmz-drag-ghost`;
        ghost.style.width = `${rect.width}px`;
        ghost.style.left = `${rect.left}px`;
        ghost.style.top = `${rect.top}px`;
        document.body.appendChild(ghost);
        node.classList.add('pmz-dragging');
        document.body.style.userSelect = 'none';
        drag = { ctx, ghost, source: node, onDrop, accepts, offsetX: startX - rect.left, offsetY: startY - rect.top, hit: null };
      }, LONG_PRESS_MS);

      const onMove = (ev) => {
        if (timer) {
          // 還沒進拖曳模式:移動超過門檻就當使用者要捲動/選字,取消長按
          if (Math.hypot(ev.clientX - startX, ev.clientY - startY) > MOVE_CANCEL_PX) {
            clearTimeout(timer);
            timer = null;
            cleanup();
          }
          return;
        }
        if (!drag) return;
        drag.ghost.style.left = `${ev.clientX - drag.offsetX}px`;
        drag.ghost.style.top = `${ev.clientY - drag.offsetY}px`;
        clearDropMarks();
        drag.hit = hitTest(ev.clientX, ev.clientY, drag.accepts);
        if (drag.hit && drag.hit.node !== node) {
          const cls = drag.hit.position === 'before' ? 'pmz-drop-before'
            : drag.hit.position === 'after' ? 'pmz-drop-after' : 'pmz-drop-target';
          drag.hit.node.classList.add(cls);
        }
      };
      const onUp = () => {
        if (timer) clearTimeout(timer);
        if (drag) {
          dragEndedAt = Date.now(); // 拖完那一下不要又觸發「開啟書籤」
          endDrag(true);
        }
        cleanup();
      };
      const onCancel = () => {
        if (timer) clearTimeout(timer);
        endDrag(false);
        cleanup();
      };
      function cleanup() {
        document.removeEventListener('pointermove', onMove);
        document.removeEventListener('pointerup', onUp);
        document.removeEventListener('pointercancel', onCancel);
      }
      // ⚠ 掛 document 不掛 node:拖曳時游標一定會離開這一列,掛在 node 上就收不到
      //   後續的 move/up 了(setPointerCapture 也可以,但合成事件與某些觸控裝置上
      //   會丟 NotFoundError,不值得為它多一層 try/catch)。
      document.addEventListener('pointermove', onMove);
      document.addEventListener('pointerup', onUp);
      document.addEventListener('pointercancel', onCancel);
    });
  }

  // 整塊可點:點在自己有動作的子元素上不算,剛拖完的那一下也不算
  function onActivate(node, handler) {
    node.addEventListener('click', (e) => {
      if (Date.now() - dragEndedAt < CLICK_GUARD_MS) return;
      if (e.target.closest(INTERACTIVE)) return;
      handler(e);
    });
  }

  // ── 書籤分頁 ──
  function addFolder(parentId) {
    const folder = M.newFolder(parentId ? '新子資料夾' : '新資料夾', M.DEFAULT_ICON, parentId ?? null);
    if (parentId) {
      // 插在父的最後一個子資料夾之後,走訪序才會緊跟著父
      const kids = M.childFolders(state.data.folders, parentId);
      const anchor = kids.length ? kids[kids.length - 1].id : parentId;
      const at = state.data.folders.findIndex((f) => f.id === anchor);
      state.data.folders.splice(at + 1, 0, folder);
      const parent = findFolderById(parentId);
      if (parent) parent.collapsed = false;
    } else {
      state.data.folders.push(folder);
    }
    state.editingFolderId = folder.id; // 新資料夾直接進改名 + 選圖示
    persist();
    render();
  }

  function deleteFolder(folder) {
    const kids = M.childFolders(state.data.folders, folder.id);
    const total = folder.bookmarks.length + kids.reduce((n, f) => n + f.bookmarks.length, 0);
    const what = kids.length
      ? `「${folder.name}」底下還有 ${kids.length} 個子資料夾、${total} 個書籤,會一起刪掉。`
      : total
        ? `「${folder.name}」裡的 ${total} 個書籤會一起刪掉。`
        : `要刪除「${folder.name}」。`;
    // 一律確認:✕ 就在標題列上,和收合/改名擠在一起,誤觸的代價是刪掉整個資料夾
    confirmDialog({
      title: '刪除資料夾',
      message: `${what}\n此操作將永久刪除資料。`,
      onOk: () => {
        const doomed = new Set([folder.id, ...kids.map((f) => f.id)]);
        state.data.folders = state.data.folders.filter((f) => !doomed.has(f.id));
        persist();
        render();
      },
    });
  }

  function saveCurrentSearch(folder, cur, name) {
    // 預設存成「自動」(league = null):search id 與聯盟無關,換季後照樣搜得到。
    // 想釘在某一季就按書籤上的「自動/固定」鈕。
    const bm = M.sanitizeBookmark({
      name: name || guessSearchName() || cur.searchId,
      searchId: cur.searchId,
      league: null,
      type: cur.type,
      poeVersion: cur.poeVersion,
    });
    if (!bm) {
      state.dataMsg = { ok: false, text: '這個網址看不出搜尋編號,沒有存進書籤' };
      render();
      return;
    }
    folder.bookmarks.unshift(bm);
    folder.collapsed = false;
    persist();
    render();
  }

  function buildAddForm(cur) {
    const form = el('div', 'pmz-form');
    const nameInput = el('input', 'pmz-input');
    nameInput.placeholder = '書籤名稱';
    nameInput.value = guessSearchName() ?? cur.searchId;
    form.appendChild(nameInput);

    const folderSelect = el('select', 'pmz-select');
    for (const { folder, depth } of M.orderedFolders(state.data.folders)) {
      const opt = el('option', null, `${depth ? '　└ ' : ''}${typeof folder.icon === 'string' && folder.icon.startsWith('https://') ? '📁' : folder.icon} ${folder.name}`);
      opt.value = folder.id;
      folderSelect.appendChild(opt);
    }
    const optNew = el('option', null, '➕ 新資料夾…');
    optNew.value = '__new__';
    folderSelect.appendChild(optNew);
    form.appendChild(folderSelect);

    const newFolderArea = el('div', 'pmz-form-sub');
    newFolderArea.hidden = state.data.folders.length > 0;
    if (state.data.folders.length === 0) folderSelect.value = '__new__';
    const folderNameInput = el('input', 'pmz-input');
    folderNameInput.placeholder = '資料夾名稱';
    let pickedIcon = state.iconList[0]?.icons[0]?.url ?? FOLDER_ICONS[0];
    newFolderArea.appendChild(folderNameInput);
    newFolderArea.appendChild(iconPicker(pickedIcon, (i) => { pickedIcon = i; }));
    form.appendChild(newFolderArea);

    folderSelect.addEventListener('change', () => {
      newFolderArea.hidden = folderSelect.value !== '__new__';
    });

    const btnRow = el('div', 'pmz-form-btns');
    const okBtn = el('button', 'pmz-primary', '儲存書籤');
    okBtn.addEventListener('click', () => {
      let folder;
      if (folderSelect.value === '__new__') {
        folder = M.newFolder(folderNameInput.value.trim() || '新資料夾', pickedIcon, null);
        state.data.folders.push(folder);
      } else {
        folder = findFolderById(folderSelect.value);
      }
      if (!folder) return;
      state.addFormOpen = false;
      saveCurrentSearch(folder, cur, nameInput.value.trim());
    });
    const cancelBtn = el('button', 'pmz-act', '取消');
    cancelBtn.addEventListener('click', () => {
      state.addFormOpen = false;
      render();
    });
    btnRow.append(okBtn, cancelBtn);
    form.appendChild(btnRow);
    return form;
  }

  function renderBookmarkItem(folder, bm) {
    const item = el('div', 'pmz-item');
    item.dataset.pmzId = bm.id;
    item.dataset.pmzFolder = folder.id;
    // 長按才拖曳:放到另一個書籤上 = 插到它前面;放到資料夾標題 = 移到該資料夾
    makeDraggable(item, { type: 'bookmark', folderId: folder.id, bookmarkId: bm.id }, (ctx, node) => {
      const targetId = node.dataset.pmzId;
      const targetFolderId = node.dataset.pmzFolder;
      if (!targetId || ctx.bookmarkId === targetId) return;
      const target = findFolderById(targetFolderId)?.bookmarks.find((b) => b.id === targetId);
      let beforeId = targetId;
      const dragged = findFolderById(ctx.folderId)?.bookmarks.find((b) => b.id === ctx.bookmarkId);
      if (target?.pinned && dragged && !dragged.pinned) {
        // 未釘選項拖到釘選項上:釘選永遠浮頂,插在它前面沒有視覺意義,
        // 改視為「移到未釘選群組最前」讓結果可見
        beforeId = findFolderById(targetFolderId)?.bookmarks.find((b) => !b.pinned && b.id !== ctx.bookmarkId)?.id ?? null;
      }
      moveBookmark(ctx, targetFolderId, beforeId);
    }, ['bookmark'], 'bookmark');
    // 整塊都能點開搜尋(按鈕自己會擋掉冒泡,剛拖完的那一下也不算)
    onActivate(item, () => openBookmark(bm));
    // 兩行:上面整行給名稱(側邊欄窄,名稱不該和按鈕搶寬度),下面一行放操作鈕
    const nameRow = el('div', 'pmz-item-top');
    if (bm.pinned) nameRow.appendChild(svgIcon('pin', 'pmz-pinned-mark'));
    const name = el('span', 'pmz-item-name', (bm.type === 'exchange' ? '⇄ ' : '') + bm.name);
    name.title = `${bm.searchId ? bm.searchId : '自訂搜尋條件'}${bm.poeVersion === 'Poe2' ? ' / PoE2' : ''}`;
    nameRow.appendChild(name);
    item.appendChild(nameRow);

    const acts = el('div', 'pmz-item-acts');
    acts.appendChild(iconBtn('pin', bm.pinned ? '取消釘選' : '釘選置頂', () => {
      bm.pinned = !bm.pinned;
      persist();
      render();
    }, bm.pinned ? 'pmz-on' : ''));
    acts.appendChild(iconBtn('pencil', '重新命名(直接在標題編輯)', () => {
      startInlineEdit(name, bm.name, (v) => {
        bm.name = v;
        persist();
      });
    }));
    acts.appendChild(iconBtn('trash', '刪除', () => {
      confirmDialog({
        title: '刪除書籤',
        message: `要刪除「${bm.name}」。\n此操作將永久刪除資料。`,
        onOk: () => {
          folder.bookmarks = folder.bookmarks.filter((b) => b.id !== bm.id);
          persist();
          render();
        },
      });
    }, 'pmz-danger'));
    item.appendChild(acts);
    return item;
  }

  function renderFolder(entry, cur, body) {
    const { folder, depth, childCount } = entry;
    const wrap = el('div', depth ? 'pmz-folder pmz-folder-child' : 'pmz-folder');
    const head = el('div', 'pmz-folder-head');
    head.dataset.pmzId = folder.id;
    makeDraggable(head, { type: 'folder', folderId: folder.id }, (ctx, node, pos) => {
      const targetId = node.dataset.pmzId;
      if (!targetId) return;
      if (ctx.type === 'folder') dropFolderOn(ctx, targetId, pos);
      else moveBookmark(ctx, targetId, null);
    }, ['folder', 'bookmark'], 'folder');
    head.appendChild(el('span', 'pmz-caret', folder.collapsed ? '▸' : '▾'));
    // 圖示平時只是圖示:點下去跟點標題一樣是展開/收合。要換圖示請按 ✎(見下方)
    const iconWrap = el('span', 'pmz-folder-iconbtn');
    iconWrap.appendChild(renderIcon(folder.icon, 'pmz-folder-icon'));
    head.appendChild(iconWrap);
    const editing = state.editingFolderId === folder.id;
    const fname = el('span', 'pmz-folder-name', folder.name);
    if (editing) {
      // 改名中:名稱換成輸入框,同一時間下方會出現圖示選擇器
      const input = el('input', 'pmz-inline-input');
      input.value = folder.name;
      let finished = false;
      const done = (save) => {
        if (finished) return;
        finished = true;
        const v = input.value.trim();
        if (save && v && v !== folder.name) {
          folder.name = v;
          persist();
        }
        state.editingFolderId = null;
        render();
      };
      input.addEventListener('click', (e) => e.stopPropagation());
      input.addEventListener('keydown', (e) => {
        e.stopPropagation();
        if (e.key === 'Enter') done(true);
        if (e.key === 'Escape') done(false);
      });
      input.addEventListener('blur', () => done(true));
      head.appendChild(input);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    } else {
      head.appendChild(fname);
    }
    head.appendChild(el('span', 'pmz-folder-count', String(M.folderTotal(state.data.folders, folder))));
    if (!depth) {
      head.appendChild(iconBtn('plus', '在這個資料夾底下新增子資料夾', () => addFolder(folder.id)));
    }
    head.appendChild(iconBtn(editing ? 'check' : 'pencil', editing ? '完成' : '重新命名並更換圖示', () => {
      state.editingFolderId = editing ? null : folder.id;
      render();
    }, editing ? 'pmz-on' : ''));
    head.appendChild(iconBtn('trash', '刪除資料夾', () => deleteFolder(folder), 'pmz-danger'));
    onActivate(head, () => {
      if (state.editingFolderId === folder.id) return; // 改名中不要順手把資料夾收起來
      folder.collapsed = !folder.collapsed;
      persist();
      render();
    });
    wrap.appendChild(head);

    if (editing) {
      const pop = el('div', 'pmz-form');
      pop.appendChild(el('div', 'pmz-icon-title', '更改圖示'));
      // 選了圖示只換圖示,不重畫整個側邊欄 —— 重畫會把還沒按 Enter 的名稱吃掉
      pop.appendChild(iconPicker(folder.icon, (icon) => {
        folder.icon = icon;
        persist();
        const fresh = renderIcon(icon, 'pmz-folder-icon');
        iconWrap.textContent = '';
        iconWrap.appendChild(fresh);
      }));
      wrap.appendChild(pop);
    }

    if (!folder.collapsed) {
      const list = el('div', 'pmz-folder-body');
      // 手動拖曳順序為主,釘選的穩定浮到最上面(組內維持手動順序)
      const sorted = [...folder.bookmarks].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
      if (!sorted.length && !childCount) list.appendChild(el('div', 'pmz-empty', '(空)'));
      for (const bm of sorted) list.appendChild(renderBookmarkItem(folder, bm));
      const saveBtn = el('button', 'pmz-folder-save', '儲存目前搜尋');
      saveBtn.disabled = !cur;
      saveBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (cur) saveCurrentSearch(folder, cur, null);
      });
      list.appendChild(saveBtn);
      wrap.appendChild(list);
    }
    body.appendChild(wrap);
  }

  function renderBookmarks(body) {
    const cur = currentSearch();
    const addBtn = el('button', 'pmz-primary', cur ? '＋ 將目前搜尋加入書籤' : '(開啟一個搜尋後可加入書籤)');
    addBtn.disabled = !cur;
    addBtn.addEventListener('click', () => {
      state.addFormOpen = !state.addFormOpen;
      render();
    });
    body.appendChild(addBtn);
    if (state.addFormOpen && cur) body.appendChild(buildAddForm(cur));

    const newFolderBtn = el('button', 'pmz-secondary', '＋ 新資料夾');
    newFolderBtn.addEventListener('click', () => addFolder(null));
    body.appendChild(newFolderBtn);

    if (state.dataMsg) {
      body.appendChild(el('div', state.dataMsg.ok ? 'pmz-ok' : 'pmz-error', state.dataMsg.text));
    }

    if (!state.data.folders.length) {
      body.appendChild(el('div', 'pmz-empty', '尚無書籤 —— 可在 ⚙ 設定分頁貼上 PoE Trade Extension 的匯出碼匯入'));
      return;
    }

    // 走訪序:第一層照順序,子資料夾緊跟在父後面(父收合時整包收起)
    for (const entry of M.orderedFolders(state.data.folders, { skipCollapsed: true })) {
      renderFolder(entry, cur, body);
    }
  }

  // ── 歷史分頁 ──
  // 只記「有名字的」搜尋(使用者裁定):交易站每按一次搜尋就產生一個新編號,
  // 空搜尋與微調條件的連續搜尋若全記下來,清單會被幾乎一樣的紀錄塞滿。
  // 名稱要等官網把搜尋條件渲染出來才抓得到,所以延遲一下再抓。
  // ⚠ 改這個數字時 bookmarks-model.js 的 sanitizeHistory 預設值要一起改
  //   (verify-sidebar 有兩處一致的鎖)。
  const HISTORY_MAX = 20;
  const HISTORY_DELAY = 1500;
  let historyTimer = null;

  function scheduleHistory() {
    const cur = currentSearch();
    if (!cur?.searchId) return;
    clearTimeout(historyTimer);
    historyTimer = setTimeout(() => {
      const now = M.parseSearchUrl(location.href);
      if (!now || now.searchId !== cur.searchId) return; // 已經換去別的搜尋了
      const name = guessSearchName();
      if (!name) return; // 沒名字就不記
      recordHistory({ ...now, name });
    }, HISTORY_DELAY);
  }

  function recordHistory(entry) {
    const list = state.history.filter((h) => h.searchId !== entry.searchId);
    list.unshift({
      searchId: entry.searchId,
      league: entry.league,
      type: entry.type,
      poeVersion: entry.poeVersion,
      name: entry.name,
      at: Date.now(),
    });
    state.history = list.slice(0, HISTORY_MAX);
    chrome.storage.local.set({ searchHistory: state.history });
    if (state.open && state.tab === 'history') render();
  }

  function timeLabel(ts) {
    const d = new Date(ts);
    const diff = Date.now() - ts;
    if (diff < 60_000) return '剛剛';
    if (diff < 3_600_000) return `${Math.floor(diff / 60_000)} 分鐘前`;
    const hhmm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    if (new Date().toDateString() === d.toDateString()) return `今天 ${hhmm}`;
    return `${d.getMonth() + 1}/${d.getDate()} ${hhmm}`;
  }

  function renderHistory(body) {
    if (!state.history.length) {
      body.appendChild(el('div', 'pmz-hint', '開過的搜尋會記在這裡(只記搜尋框有填東西的那些)。'));
      body.appendChild(el('div', 'pmz-empty', '還沒有紀錄'));
      return;
    }
    const bar = el('div', 'pmz-btnrow');
    const clear = el('button', 'pmz-secondary', `清空全部(${state.history.length})`);
    clear.addEventListener('click', () => {
      confirmDialog({
        title: '清空搜尋紀錄',
        message: `會刪掉 ${state.history.length} 筆搜尋紀錄。\n此操作將永久刪除資料。`,
        onOk: () => {
          state.history = [];
          chrome.storage.local.set({ searchHistory: [] });
          render();
        },
      });
    });
    bar.appendChild(clear);
    body.appendChild(bar);

    for (const h of state.history) {
      const item = el('div', 'pmz-item');
      const top = el('div', 'pmz-item-top');
      const name = el('span', 'pmz-item-name', (h.type === 'exchange' ? '⇄ ' : '') + h.name);
      name.title = `${h.league} / ${h.searchId}`;
      top.appendChild(name);
      item.appendChild(top);
      onActivate(item, () => {
        location.href = M.buildTradeUrl(location.origin, { ...h, searchId: h.searchId }, h.league);
      });

      const acts = el('div', 'pmz-item-acts');
      acts.appendChild(el('span', 'pmz-history-time', timeLabel(h.at)));
      acts.appendChild(iconBtn('star', '加入書籤', () => {
        state.historyPickId = state.historyPickId === h.searchId ? null : h.searchId;
        render();
      }));
      acts.appendChild(iconBtn('trash', '從紀錄移除', () => {
        state.history = state.history.filter((x) => x.searchId !== h.searchId);
        chrome.storage.local.set({ searchHistory: state.history });
        render();
      }, 'pmz-danger'));
      item.appendChild(acts);

      // 加入書籤:就地展開資料夾選單,不用切回書籤分頁
      if (state.historyPickId === h.searchId) {
        const form = el('div', 'pmz-form');
        const sel = el('select', 'pmz-select');
        for (const { folder, depth } of M.orderedFolders(state.data.folders)) {
          const opt = el('option', null, `${depth ? '　└ ' : ''}${folder.name}`);
          opt.value = folder.id;
          sel.appendChild(opt);
        }
        const optNew = el('option', null, '➕ 新資料夾…');
        optNew.value = '__new__';
        sel.appendChild(optNew);
        form.appendChild(sel);
        const btns = el('div', 'pmz-form-btns');
        const ok = el('button', 'pmz-primary', '加入');
        ok.addEventListener('click', () => {
          let folder;
          if (sel.value === '__new__') {
            folder = M.newFolder('新資料夾', M.DEFAULT_ICON, null);
            state.data.folders.push(folder);
          } else {
            folder = findFolderById(sel.value);
          }
          if (!folder) return;
          const bm = M.sanitizeBookmark({
            name: h.name,
            searchId: h.searchId,
            league: null,
            type: h.type,
            poeVersion: h.poeVersion,
          });
          if (bm) folder.bookmarks.unshift(bm);
          folder.collapsed = false;
          state.historyPickId = null;
          state.dataMsg = { ok: true, text: `已把「${h.name}」加進「${folder.name}」` };
          persist();
          render();
        });
        const cancel = el('button', 'pmz-act', '取消');
        cancel.addEventListener('click', () => {
          state.historyPickId = null;
          render();
        });
        btns.append(ok, cancel);
        form.appendChild(btns);
        item.appendChild(form);
      }
      body.appendChild(item);
    }
    if (state.dataMsg) {
      body.appendChild(el('div', state.dataMsg.ok ? 'pmz-ok' : 'pmz-error', state.dataMsg.text));
    }
  }

  // ── 物價分頁(poe.ninja 經濟 API 快查)──
  // key 為 exchange API 回傳的 item.category
  const PRICE_CATEGORY_ZH = {
    Currency: '通貨',
    Fragments: '碎片與聖甲蟲',
    Oils: '聖油',
    Essences: '精髓',
    Delve: '化石與鑄新儀',
    DeliriumOrbs: '譫妄玉',
    Catalysts: '催化劑',
    Ancestor: '刺青與預兆',
    Keepers: '亡者通貨',
    Runegrafts: '符文刻印',
    SkillGem: '技能寶石',
    ImbuedGem: '灌注寶石',
  };

  function formatChaos(v) {
    if (v >= 100) return String(Math.round(v));
    if (v >= 1) return v.toFixed(1);
    return v.toFixed(2);
  }

  // 顯示規則:滿 1 divine 以 divine 計,不足以 chaos 計
  function formatPrice(value, divRate) {
    if (divRate && value >= divRate) {
      const d = value / divRate;
      return `${d >= 10 ? d.toFixed(1) : d.toFixed(2)} div`;
    }
    return `${formatChaos(value)} c`;
  }

  // 寶石帶站方 divineValue 就直接顯示(與 poe.ninja 一致);其餘走 chaos/匯率規則
  function priceText(item, divRate) {
    if (typeof item.div === 'number' && item.div >= 1) {
      return `${item.div >= 10 ? item.div.toFixed(1) : item.div.toFixed(2)} div`;
    }
    return formatPrice(item.value, divRate);
  }

  // poe.ninja 聯盟清單(bg 有 6 小時快取);失敗回 null,下次再試
  async function loadNinjaLeagues() {
    if (state.ninjaLeagues) return state.ninjaLeagues;
    try {
      const res = await chrome.runtime.sendMessage({ t: 'ninja:leagues' });
      if (res?.ok) state.ninjaLeagues = { leagues: res.leagues, latest: res.latest };
    } catch (_) { /* bg 未就緒等,下次再試 */ }
    return state.ninjaLeagues;
  }

  async function loadPrices(force = false) {
    // 設定手動指定 > poe.ninja 最新賽季 > Standard 保底
    const ninja = await loadNinjaLeagues();
    const league = state.settings.league || ninja?.latest || 'Standard';
    try {
      if (!state.itemMap) {
        const { itemMap } = await chrome.storage.local.get('itemMap');
        state.itemMap = itemMap ?? {};
      }
      const res = await chrome.runtime.sendMessage({ t: 'ninja:rates', league, force });
      if (res?.ok && Array.isArray(res.list)) {
        state.prices = { ...state.prices, league, list: res.list, at: Date.now(), error: null };
      } else {
        state.prices = { ...state.prices, league, error: res?.error ?? '取得失敗' };
      }
    } catch (err) {
      state.prices = { ...state.prices, league, error: String(err?.message ?? err) };
    }
    if (state.tab === 'prices') render();
  }

  function priceRow(item, divRate) {
    const zh = state.itemMap?.[item.name] ?? '';
    const row = el('div', 'pmz-item');
    row.style.cursor = 'default';
    if (item.image) {
      const img = el('img', 'pmz-price-icon');
      img.src = item.image;
      img.alt = '';
      row.appendChild(img);
    }
    const name = el('span', 'pmz-item-name', zh || item.name);
    name.title = item.variant ? `${item.name} · ${item.variant}` : item.name;
    row.appendChild(name);
    // 寶石等變體項目:名稱後附灰色小字標示(等級/品質/腐化或灌注名)
    if (item.variant) row.appendChild(el('span', 'pmz-price-variant', item.variant));
    // 中信心(樣本 5-9)標警示;低信心(<5)已在 bg 過濾
    if (typeof item.count === 'number' && item.count < 10) {
      const warn = el('span', 'pmz-conf', '⚠');
      warn.title = `樣本數 ${item.count},價格參考性較低`;
      row.appendChild(warn);
    }
    const val = el('span', 'pmz-price-val', priceText(item, divRate));
    val.title = `${formatChaos(item.value)} chaos`;
    row.appendChild(val);
    return row;
  }

  // 分類抽屜:預設展開通貨;搜尋時全部強制展開
  function renderPriceList(wrap) {
    wrap.textContent = '';
    const kw = state.prices.filter.trim().toLowerCase();
    const divRate = state.prices.list.find((i) => i.name === 'Divine Orb')?.value;
    const byCat = new Map();
    for (const item of state.prices.list) {
      const zh = state.itemMap?.[item.name] ?? '';
      if (kw && !item.name.toLowerCase().includes(kw) && !zh.toLowerCase().includes(kw)) continue;
      const cat = item.category ?? 'Other';
      if (!byCat.has(cat)) byCat.set(cat, []);
      byCat.get(cat).push(item);
    }
    if (!byCat.size) {
      wrap.appendChild(el('div', 'pmz-empty', '沒有符合的通貨'));
      return;
    }
    for (const [cat, items] of byCat) {
      const open = !!kw || state.prices.openCats.has(cat);
      const drawer = el('div', 'pmz-drawer');
      const head = el('div', 'pmz-drawer-head');
      head.appendChild(el('span', 'pmz-caret', open ? '▾' : '▸'));
      head.appendChild(el('span', 'pmz-drawer-name', PRICE_CATEGORY_ZH[cat] ?? cat));
      head.appendChild(el('span', 'pmz-folder-count', String(items.length)));
      head.addEventListener('click', () => {
        if (state.prices.openCats.has(cat)) state.prices.openCats.delete(cat);
        else state.prices.openCats.add(cat);
        renderPriceList(wrap);
      });
      drawer.appendChild(head);
      if (open) {
        const body = el('div', 'pmz-drawer-body');
        items.slice(0, 60).forEach((item) => body.appendChild(priceRow(item, divRate)));
        drawer.appendChild(body);
      }
      wrap.appendChild(drawer);
    }
  }

  // poe.ninja 是選用權限(理由見 background.js);content script 不能自己查,
  // 也不能自己要求授權 —— 授權按鈕只能放在 popup(需要使用者手勢)。
  async function checkNinjaPermission() {
    try {
      const res = await chrome.runtime.sendMessage({ t: 'perm:ninja' });
      state.ninjaPerm = res?.granted === true;
    } catch (_) {
      state.ninjaPerm = false;
    }
    return state.ninjaPerm;
  }

  function renderNinjaPermissionNotice(body) {
    body.appendChild(el('div', 'pmz-hint', '物價分頁要讀 poe.ninja 的公開匯率,預設沒有開啟。'));
    const ask = el('button', 'pmz-primary', '開啟物價查詢(需要授權 poe.ninja)');
    ask.addEventListener('click', async () => {
      await chrome.runtime.sendMessage({ t: 'perm:ninja-ask' }).catch(() => {});
      state.dataMsg = { ok: true, text: '已開啟授權頁,允許之後回到這裡按「我已開啟,重新檢查」' };
      render();
    });
    body.appendChild(ask);
    const retry = el('button', 'pmz-secondary', '我已開啟,重新檢查');
    retry.addEventListener('click', () => {
      state.ninjaPerm = null;
      render();
    });
    body.appendChild(retry);
    if (state.dataMsg) body.appendChild(el('div', state.dataMsg.ok ? 'pmz-ok' : 'pmz-error', state.dataMsg.text));
  }

  function renderPrices(body) {
    if (state.ninjaPerm === null) {
      body.appendChild(el('div', 'pmz-empty', '檢查權限中…'));
      checkNinjaPermission().then(() => {
        if (state.tab === 'prices') render();
      });
      return;
    }
    if (!state.ninjaPerm) {
      renderNinjaPermissionNotice(body);
      return;
    }
    const { league, list, filter, error } = state.prices;
    const bar = el('div', 'pmz-form-btns');
    const search = el('input', 'pmz-input');
    search.placeholder = '搜尋名稱(中/英)…';
    search.value = filter;
    search.addEventListener('input', () => {
      state.prices.filter = search.value;
      renderPriceList(listWrap);
    });
    const refresh = el('button', 'pmz-act', '↻');
    refresh.title = '重新抓取 poe.ninja 匯率';
    refresh.addEventListener('click', () => loadPrices(true));
    bar.append(search, refresh);
    body.appendChild(bar);
    body.appendChild(el('div', 'pmz-hint', `聯盟:${league ?? '—'}${state.settings.league ? '(手動設定)' : '(最新聯盟)'} · 單位:chaos(資料:poe.ninja,快取 15 分鐘)· 可在 ⚙ 設定切換聯盟`));
    if (error) body.appendChild(el('div', 'pmz-empty', `讀取失敗:${error}`));
    const listWrap = el('div');
    body.appendChild(listWrap);
    if (!list.length && !error) {
      body.appendChild(el('div', 'pmz-empty', '載入中…'));
      loadPrices();
      return;
    }
    renderPriceList(listWrap);
  }

  // ── 匯出/匯入(設定分頁使用)──
  // 匯出的是**完整備份**:設定 + 所有書籤 + 歷史紀錄,換一台電腦一個檔就還原得回來。
  function exportBackup() {
    const payload = M.makeBackup({
      settings: state.settings,
      folders: state.data.folders,
      history: state.history,
      appVersion: chrome.runtime.getManifest().version,
    });
    // 剔除 _ 開頭的內部欄位(如寫入者蓋章 _writer)
    const json = JSON.stringify(payload, (k, v) => (k.startsWith('_') ? undefined : v), 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = `pmz-backup-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    state.dataMsg = {
      ok: true,
      text: `已匯出備份:${M.countBookmarks(state.data.folders)} 個書籤、${state.history.length} 筆歷史,含目前設定`,
    };
    render();
  }

  // 匯入一律是「附加」:既有書籤不動,新的接在後面。
  // (取代式匯入太容易一鍵清空,而且 id 已在模型層重新產生,不會撞。)
  function applyImport(result, source) {
    if (!result.folders.length) {
      state.dataMsg = { ok: false, text: `${source}裡沒有可用的書籤` };
      render();
      return;
    }
    state.data.folders = state.data.folders.concat(result.folders);
    const r = result.report;
    const notes = [];
    if (r.droppedBookmarks.length) notes.push(`略過 ${r.droppedBookmarks.length} 筆壞掉的書籤`);
    if (r.orphanFolders) notes.push(`${r.orphanFolders} 個資料夾的上層不在匯出裡,已放到第一層`);
    if (r.flattened) notes.push(`${r.flattened} 個第三層資料夾已收到第二層`);
    if (r.unknownIcons.length) notes.push(`${r.unknownIcons.length} 種圖示沒有對應(${r.unknownIcons.slice(0, 4).join('、')}),已用預設`);
    state.dataMsg = {
      ok: true,
      text: `已從 ${source} 匯入 ${r.folders} 個資料夾、${r.bookmarks} 個書籤${notes.length ? `\n${notes.join(';')}` : ''}`,
    };
    if (r.droppedBookmarks.length) {
      dbg('[PTM] 匯入時略過的書籤:', r.droppedBookmarks);
    }
    persist();
    render();
  }

  async function importBackupFile(file) {
    try {
      const result = M.parseBackupFile(await file.text(), {
        iconIndex: state.iconIndex,
        settingsTemplate: DEFAULT_SETTINGS,
        historyMax: HISTORY_MAX,
      });
      // 只有 folders 的舊檔 = 單純匯入書籤(附加);完整備份 = 還原(取代)
      if (!result.isBackup) {
        applyImport(result, '檔案');
        return;
      }
      const when = result.exportedAt ? `(${result.exportedAt.slice(0, 10)} 匯出)` : '';
      confirmDialog({
        title: '還原備份',
        message: `備份${when}裡有 ${result.report.folders} 個資料夾、${result.report.bookmarks} 個書籤、`
          + `${result.history.length} 筆歷史。
`
          + `目前的 ${state.data.folders.length} 個資料夾、${M.countBookmarks(state.data.folders)} 個書籤與設定會被取代。
`
          + '此操作將永久刪除資料。',
        okLabel: '還原',
        onOk: () => {
          state.data = { version: M.VERSION, folders: result.folders };
          state.settings = { ...DEFAULT_SETTINGS, ...result.settings };
          state.history = result.history;
          chrome.storage.local.set({ searchHistory: state.history });
          persist();
          persistSettings();
          applySide();
          applyTop();
          applyPseudoHighlight();
          state.dataMsg = {
            ok: true,
            text: `已還原備份:${result.report.folders} 個資料夾、${result.report.bookmarks} 個書籤、${result.history.length} 筆歷史,設定也一併套用`,
          };
          render();
        },
      });
    } catch (err) {
      // 行內錯誤訊息,不用 alert 阻斷官網頁面
      state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      render();
    }
  }

  // ── 從 PoB code 匯入 ──
  // 一份流派 → 一個資料夾,底下依部位分五個子資料夾(使用者裁定的結構)。
  // 詞綴要對到官方詞綴代碼,得先拿到翻譯建置產生的 statIdMap。
  async function importPobCode(text) {
    const PB = globalThis.pmzPobImport;
    if (!PB) {
      state.dataMsg = { ok: false, text: 'PoB 匯入模組沒有載入' };
      render();
      return;
    }
    try {
      const { statIdMap } = await chrome.storage.local.get('statIdMap');
      if (!statIdMap || !Object.keys(statIdMap).length) {
        state.dataMsg = { ok: false, text: '詞綴對照表還沒建好(先在 popup 套用中文化),稀有裝備的條件會帶不出來' };
        render();
        return;
      }
      const xml = await PB.decodePobCode(text);
      const build = PB.parsePobBuild(xml);
      const plan = PB.buildBookmarkPlan(build, PB.buildStatIndex(statIdMap));
      if (!plan.groups.length) throw new Error('這份 PoB 存檔裡沒有裝備');

      const parent = M.newFolder(plan.buildName, state.iconIndex?.get('Chaos Orb') ?? M.DEFAULT_ICON, null);
      const added = [parent];
      for (const group of plan.groups) {
        const child = M.newFolder(group.category, M.DEFAULT_ICON, parent.id);
        for (const item of group.items) {
          const bm = M.sanitizeBookmark({ name: item.name, query: item.query, league: null, type: 'search' });
          if (bm) child.bookmarks.push(bm);
        }
        if (child.bookmarks.length) added.push(child);
      }
      state.data.folders = state.data.folders.concat(added);

      const r = plan.report;
      const notes = [];
      if (r.unmatchedMods.length) notes.push(`${r.unmatchedMods.length} 條詞綴沒有對應的官方代碼(星團珠寶與藥水的詞綴交易站本來就搜不到),那幾條沒有加進條件`);
      if (r.noBase.length) notes.push(`${r.noBase.length} 件魔法物品沒有基底名(通常是藥水),只帶詞綴`);
      state.dataMsg = {
        ok: true,
        text: `已匯入「${plan.buildName}」${added.length - 1} 個分類、${M.countBookmarks(added)} 件裝備${notes.length ? `\n${notes.join(';')}` : ''}`,
      };
      state.codeBoxOpen = null;
      dbg('[PTM] PoB 匯入:', plan.buildName, r);
      persist();
      render();
    } catch (err) {
      state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      render();
    }
  }

  function importExtensionCode(text) {
    try {
      applyImport(M.parseExtensionCode(text, { iconIndex: state.iconIndex }), 'PoE Trade Extension');
      state.codeBoxOpen = false;
    } catch (err) {
      state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      render();
    }
  }

  // 只清書籤樹:搜尋紀錄與設定刻意不動(使用者裁定)。想連設定一起歸零的人
  // 走「還原備份」,那條路本來就是取代式的。
  function clearAllBookmarks() {
    const folders = state.data.folders.length;
    const marks = M.countBookmarks(state.data.folders);
    confirmDialog({
      title: '清除所有書籤',
      message: `會刪掉 ${folders} 個資料夾、${marks} 個書籤。\n搜尋紀錄與設定不受影響。\n此操作將永久刪除資料。`,
      okLabel: '清除',
      onOk: () => {
        state.data = { version: M.VERSION, folders: [] };
        // 這三個都指著剛剛被刪掉的東西,不清會留著不存在的 id
        state.editingFolderId = null;
        state.addFormOpen = false;
        state.historyPickId = null;
        try { sessionStorage.removeItem(PENDING_KEY); } catch (_) { /* 無痕或配額問題:留著也只是個過期的 id */ }
        persist();
        state.dataMsg = { ok: true, text: `已清除 ${folders} 個資料夾、${marks} 個書籤` };
        render();
      },
    });
  }

  // ── 偽屬性(合計)詞綴高亮 ──
  // 官網把 pseudo 詞綴渲染成 .item-mod--pseudo,樣式全在 sidebar.css;
  // 這裡只切 body class,不碰 results.js(翻譯層)。
  function applyPseudoHighlight() {
    document.body.classList.toggle('pmz-hl-pseudo', state.settings.highlightPseudo !== false);
  }

  // ── 設定分頁 ──
  // [設定鍵, 說明, 是否需要重新整理頁面]
  const SETTING_ITEMS = [
    ['highlightPseudo', '結果列的偽屬性(合計)詞綴高亮', false],
    ['autoInstantBuyout', '開啟頁面自動將狀態設為「即刻購買」', true],
  ];

  function renderSettings(body) {
    body.appendChild(el('div', 'pmz-hint', '標示 ↻ 的項目需重新整理頁面後生效'));

    for (const [key, label, needReload] of SETTING_ITEMS) {
      const row = el('label', 'pmz-setting-row');
      const cb = el('input');
      cb.type = 'checkbox';
      cb.checked = state.settings[key] !== false; // state.settings 已與 DEFAULT_SETTINGS 合併,必有值
      cb.addEventListener('change', () => {
        state.settings[key] = cb.checked;
        persistSettings();
        if (key === 'highlightPseudo') applyPseudoHighlight(); // 即時生效,不必重整
      });
      row.appendChild(cb);
      row.appendChild(el('span', null, `${label}${needReload ? ' ↻' : ''}`));
      body.appendChild(row);
    }

    // 側邊欄位置
    const sideRow = el('div', 'pmz-setting-row');
    sideRow.appendChild(el('span', null, '側邊欄位置'));
    const sideSeg = el('div', 'pmz-seg');
    for (const [val, label] of [['left', '左'], ['right', '右']]) {
      const btn = el('button', 'pmz-seg-btn', label);
      if (state.settings.sidebarSide === val) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', () => {
        state.settings.sidebarSide = val;
        persistSettings();
        applySide();
        render();
      });
      sideSeg.appendChild(btn);
    }
    sideRow.appendChild(sideSeg);
    body.appendChild(sideRow);

    // 物價查詢(poe.ninja 選用權限):開 = 已授權。授權必須在擴充頁面按下(見 background.js),
    // 所以這裡點「開」是去開授權頁;點「關」則由 background 直接收回。
    const ninjaRow = el('div', 'pmz-setting-row');
    ninjaRow.appendChild(el('span', null, '物價查詢(poe.ninja)'));
    const ninjaSeg = el('div', 'pmz-seg');
    for (const [val, label] of [[true, '開'], [false, '關']]) {
      const btn = el('button', 'pmz-seg-btn', label);
      if (state.ninjaPerm === val) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', async () => {
        if (val === state.ninjaPerm) return;
        if (val) {
          await chrome.runtime.sendMessage({ t: 'perm:ninja-ask' }).catch(() => {});
          state.dataMsg = { ok: true, text: '已開啟授權頁,允許之後回到這裡按「重新檢查」' };
        } else {
          const res = await chrome.runtime.sendMessage({ t: 'perm:ninja-remove' }).catch(() => null);
          state.ninjaPerm = res?.granted === true;
          state.prices = { ...state.prices, list: [], at: 0, error: null };
        }
        render();
      });
      ninjaSeg.appendChild(btn);
    }
    const recheck = el('button', 'pmz-act', '重新檢查');
    recheck.addEventListener('click', async () => {
      await checkNinjaPermission();
      render();
    });
    ninjaSeg.appendChild(recheck);
    ninjaRow.appendChild(ninjaSeg);
    body.appendChild(ninjaRow);
    if (state.ninjaPerm === null) checkNinjaPermission().then(() => state.tab === 'settings' && render());

    // 聯盟:物價與書籤共用。空字串 = 自動(物價用 poe.ninja 最新、書籤用目前頁面)
    const leagueRow = el('div', 'pmz-setting-row');
    leagueRow.appendChild(el('span', null, '聯盟'));
    const leagueSel = el('select', 'pmz-select pmz-select-inline');
    const autoOpt = el('option', null, `自動(目前:${state.ninjaLeagues?.latest ?? (state.settings.lastLeague || '…')})`);
    autoOpt.value = '';
    leagueSel.appendChild(autoOpt);
    const manual = state.settings.league;
    // 沒授權 poe.ninja 時清單抓不到,至少把目前頁面的聯盟放進去可選
    const known = new Set([
      ...(manual ? [manual] : []),
      ...(state.ninjaLeagues?.leagues ?? []),
      ...(state.settings.lastLeague ? [state.settings.lastLeague] : []),
    ]);
    for (const name of known) {
      const opt = el('option', null, name);
      opt.value = name;
      leagueSel.appendChild(opt);
    }
    leagueSel.value = manual || '';
    leagueSel.addEventListener('change', () => {
      state.settings.league = leagueSel.value;
      persistSettings();
      // 清掉已載入的物價,下次開物價分頁以新聯盟重新載入
      state.prices = { ...state.prices, list: [], at: 0, league: null, error: null };
      render();
    });
    // 沒授權 poe.ninja 就不要白打請求(清單抓不到,下拉維持「自動」)
    if (!state.ninjaLeagues && state.ninjaPerm === true) {
      loadNinjaLeagues().then((leagues) => {
        if (leagues && state.tab === 'settings') render(); // 清單到位後補全選項
      });
    }
    leagueRow.appendChild(leagueSel);
    body.appendChild(leagueRow);

    // 中文化與雙語詞綴:與 popup 共用同一組 storage 鍵,兩邊改都算數。
    // ⚠ 一律從 state 畫,不要在這裡 `chrome.storage.local.get().then(…)` 再 append ——
    //   render 是「清空 body 再重畫」,非同步 append 會在兩次 render 交錯時畫出兩份
    //   (切一次中文化就會多一組「中文化 + 備份與匯入」;2026-08-16 使用者截圖回報)。
    body.appendChild(el('div', 'pmz-section-title', '中文化 ↻'));
    const langRow = el('div', 'pmz-setting-row');
    langRow.appendChild(el('span', null, '介面與詞綴中文化'));
    const langSeg = el('div', 'pmz-seg');
    for (const [val, label] of [['zh_tw', '開'], ['us', '關']]) {
      const btn = el('button', 'pmz-seg-btn', label);
      if (state.language === val) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', () => {
        state.language = val;
        chrome.storage.local.set({ language: val });
        if (val === 'zh_tw') chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
        render();
      });
      langSeg.appendChild(btn);
    }
    langRow.appendChild(langSeg);
    body.appendChild(langRow);

    const modeRow = el('div', 'pmz-setting-row');
    modeRow.appendChild(el('span', null, '結果列附英文原文'));
    const modeSeg = el('div', 'pmz-seg');
    for (const [val, label] of [[true, '開'], [false, '關']]) {
      const btn = el('button', 'pmz-seg-btn', label);
      if (state.bilingualMods === val) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', () => {
        state.bilingualMods = val;
        chrome.storage.local.set({ bilingualMods: val });
        render();
      });
      modeSeg.appendChild(btn);
    }
    modeRow.appendChild(modeSeg);
    body.appendChild(modeRow);

    // ── 書籤資料 ──
    body.appendChild(el('div', 'pmz-section-title', '備份與匯入'));
    body.appendChild(el('div', 'pmz-hint', '「匯出備份」會把設定、全部書籤與歷史紀錄存成一個檔;還原時會取代目前的內容。只有書籤的舊檔匯入則是附加。'));
    const dataRow = el('div', 'pmz-btnrow');
    const exportBtn = el('button', 'pmz-primary', '匯出備份');
    exportBtn.addEventListener('click', exportBackup);
    const importBtn = el('button', 'pmz-primary', '匯入備份 / 書籤檔');
    const importInput = el('input');
    importInput.type = 'file';
    importInput.accept = 'application/json';
    importInput.style.display = 'none'; // 行內樣式,避免官網 CSS 蓋掉 hidden 屬性
    importInput.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      e.target.value = '';
      if (file) importBackupFile(file);
    });
    importBtn.addEventListener('click', () => importInput.click());
    dataRow.append(exportBtn, importBtn, importInput);
    body.appendChild(dataRow);

    const CODE_SOURCES = [
      ['ext', '從 PoE Trade Extension 匯入…',
        '在 PoE Trade Extension 按「匯出設定」(匯出碼會複製到剪貼簿),貼進下面的框。只會讀取書籤,它的其他設定不會被讀取,也不會寫回去。',
        '在這裡貼上匯出碼…', importExtensionCode],
      ['pob', '從 Path of Building code 匯入…',
        '貼上 PoB code(pobb.in、poe.ninja 的 build 頁面都能複製)。會照部位建資料夾:傳奇用「傳奇名 + 基底」搜,稀有用「基底 + 全部詞綴」搜,到交易站再自己取消不要的條件。',
        '在這裡貼上 PoB code…', importPobCode],
    ];
    for (const [key, label] of CODE_SOURCES) {
      const btn = el('button', 'pmz-secondary', label);
      btn.addEventListener('click', () => {
        state.codeBoxOpen = state.codeBoxOpen === key ? null : key;
        render();
      });
      body.appendChild(btn);
    }

    const active = CODE_SOURCES.find(([key]) => key === state.codeBoxOpen);
    if (active) {
      const [, , hint, placeholder, handler] = active;
      const form = el('div', 'pmz-form');
      form.appendChild(el('div', 'pmz-hint', hint));
      const area = el('textarea', 'pmz-textarea');
      area.placeholder = placeholder;
      area.rows = 4;
      form.appendChild(area);
      const btns = el('div', 'pmz-form-btns');
      const okBtn = el('button', 'pmz-primary', '匯入');
      okBtn.addEventListener('click', () => handler(area.value));
      const cancelBtn = el('button', 'pmz-act', '取消');
      cancelBtn.addEventListener('click', () => {
        state.codeBoxOpen = null;
        render();
      });
      btns.append(okBtn, cancelBtn);
      form.appendChild(btns);
      body.appendChild(form);
    }

    // ── 清除資料 ──
    // 匯入三條路都是「附加」,沒有一鍵歸零的入口;匯入錯一次就得手動刪十幾個資料夾。
    body.appendChild(el('div', 'pmz-section-title', '清除資料'));
    body.appendChild(el('div', 'pmz-hint', '想留底請先按上面的「匯出備份」。搜尋紀錄與設定不受影響。'));
    const clearBtn = el('button', 'pmz-secondary pmz-danger', `清除所有書籤(${M.countBookmarks(state.data.folders)})`);
    clearBtn.disabled = !state.data.folders.length;
    clearBtn.addEventListener('click', clearAllBookmarks);
    body.appendChild(clearBtn);

    if (state.dataMsg) {
      body.appendChild(el('div', state.dataMsg.ok ? 'pmz-ok' : 'pmz-error', state.dataMsg.text));
    }

    body.appendChild(el('div', 'pmz-credit', '資料來源:GGG 官方 API、poe.ninja、cswzhang/Poe-trade-zh (Apache-2.0)、OpenCC (Apache-2.0)、poewiki.net'));

    // 低調的外部連結:與「資料來源」同一級的小字,刻意不做成按鈕
    const links = el('div', 'pmz-links');
    for (const [label, href] of [
      ['請我喝杯咖啡', 'https://buymeacoffee.com/hsiung'],
      ['Discord 社群', 'https://discord.gg/6VamPQb8nC'],
    ]) {
      const a = el('a', 'pmz-link', `${label} ↗`);
      a.href = href;
      a.target = '_blank';
      a.rel = 'noopener noreferrer'; // 開新分頁一律帶,不讓對方拿到 window.opener
      links.appendChild(a);
    }
    body.appendChild(links);
  }

  function render() {
    panel.querySelectorAll('.pmz-tab').forEach((t) => {
      t.classList.toggle('pmz-tab-active', t.dataset.tab === state.tab);
    });
    const body = panel.querySelector('.pmz-body');
    body.textContent = '';
    if (state.tab === 'bookmarks') renderBookmarks(body);
    else if (state.tab === 'history') renderHistory(body);
    else if (state.tab === 'prices') renderPrices(body);
    else renderSettings(body);
  }

  // ── 開頁自動把狀態設為「即刻購買」 ──
  // 原本住在 page/filter-actions.js(MAIN world),快捷篩選整組移除後搬來這裡:
  // 它只用 DOM 事件,不碰官網 Vue 的私有結構,在 isolated world 一樣有效
  // (DOM 事件會傳到 MAIN world 的監聽器)。
  const MULTISELECT_OPTION = '.multiselect__option';
  function maybeApplyInstantBuyout(attempt = 0) {
    if (state.settings.autoInstantBuyout !== true) return;
    // 以選項文字定位狀態下拉(中英模式皆可),排除「即刻購買和面交」
    const option = [...document.querySelectorAll(MULTISELECT_OPTION)].find((o) => {
      const t = o.textContent ?? '';
      return /instant buyout|即刻購買/i.test(t) && !/in person|面交/i.test(t);
    });
    const select = option?.closest('.multiselect');
    if (!select) {
      if (attempt < 10) setTimeout(() => maybeApplyInstantBuyout(attempt + 1), 500);
      else console.warn('[PTM] 找不到狀態下拉,略過自動即刻購買');
      return;
    }
    const current = select.querySelector('.multiselect__single')?.textContent ?? '';
    if (/instant buyout|即刻購買/i.test(current) && !/in person|面交/i.test(current)) return;
    select.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, view: window }));
    option.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window }));
  }

  // ── 啟動 ──
  async function init() {
    const { bookmarkData, settings, searchHistory, sidebarEnabled, language, bilingualMods } =
      await chrome.storage.local.get([
        'bookmarkData',
        'settings',
        'searchHistory',
        'sidebarEnabled',
        'language',
        'bilingualMods',
      ]);
    // 上限下修後,舊的超量紀錄在開頁時就裁掉(否則要等下一次搜尋才會生效);
    // 只在真的超量時才寫回,不要每次開頁都動 storage。
    const rawHistory = Array.isArray(searchHistory) ? searchHistory : [];
    state.history = rawHistory.slice(0, HISTORY_MAX);
    if (rawHistory.length > state.history.length) {
      chrome.storage.local.set({ searchHistory: state.history });
    }
    // 與 popup 共用的兩個鍵先讀進 state,設定分頁才能同步畫出來(見 renderSettings)
    state.language = language ?? 'zh_tw';
    state.bilingualMods = bilingualMods === true;
    state.data = M.migrate(bookmarkData);
    state.settings = { ...DEFAULT_SETTINGS, ...(settings ?? {}) };
    // 舊設定遷移:「物價聯盟」改名成共用的「聯盟」,快捷篩選整組移除。
    // 不遷移的話使用者原本設好的聯盟會靜靜消失,舊鍵也會一直留在設定裡。
    if (!state.settings.league && state.settings.priceLeague) state.settings.league = state.settings.priceLeague;
    for (const gone of ['priceLeague', 'quickFilters', 'presetPanel', 'autoTilde', 'priceNote', 'resultTranslate']) {
      delete state.settings[gone];
    }
    persistSettings(); // 把預設值同步給 MAIN world(filter-actions.js 讀 localStorage)
    // 遊戲圖像清單為內建檔,不依賴翻譯建置,離線也可用
    try {
      const res = await fetch(chrome.runtime.getURL('data/icons.json'));
      const icons = await res.json();
      if (Array.isArray(icons)) {
        state.iconList = icons;
        state.iconIndex = M.buildIconIndex(icons);
      }
    } catch (err) {
      console.warn('[PTM] 圖示清單載入失敗,僅提供符號圖示:', err);
    }
    // 這兩個不需要側邊欄的 UI,即使使用者把側邊欄關掉也照設定運作
    applyPseudoHighlight();
    maybeApplyInstantBuyout();
    if (sidebarEnabled === false) {
      dbg('[PTM] 側邊欄已在 popup 關閉,不建立面板');
      return;
    }

    buildShell();
    rememberLeague();
    adoptSearchId(); // 剛剛是從帶條件的書籤點進來的話,把官方編號記回去
    scheduleHistory();
    dbg(`[PTM] 側邊欄就緒:${state.data.folders.length} 個資料夾 / ${M.countBookmarks(state.data.folders)} 個書籤`);
    // 同步外部寫入(popup 匯入、其他分頁);自己寫的依 _writer 蓋章略過
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      // 語系與雙語顯示是與 popup 共用的鍵:popup 那邊改了,這裡的 state 要跟著更新。
      // ⚠ 先更新 state 再 render —— 按鈕狀態一律從 state 畫(見 renderSettings 的註解)。
      if (changes.language || changes.bilingualMods) {
        if (changes.language) state.language = changes.language.newValue ?? 'zh_tw';
        if (changes.bilingualMods) state.bilingualMods = changes.bilingualMods.newValue === true;
        if (state.open && state.tab === 'settings') render();
      }
      if (!changes.bookmarkData) return;
      const incoming = changes.bookmarkData.newValue;
      if (!incoming || incoming._writer === INSTANCE_ID) return;
      state.data = M.migrate(incoming);
      if (state.open) render();
    });
  }

  init().catch((err) => console.warn('[PTM] sidebar 初始化失敗:', err));
})();
