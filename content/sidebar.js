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
  // 側邊 rail 上的兩個外部連結(贊助 / Discord)。以前住在設定分頁底部,2026-09-08 搬上 rail。
  const RAIL_LINKS = {
    coffee: 'https://buymeacoffee.com/hsiung',
    discord: 'https://discord.gg/6VamPQb8nC',
  };
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
  // 本頁是哪一款遊戲。bootstrap.js(document_start)已經算好掛在 globalThis;
  // 這裡是 document_end,跨檔讀 globalThis 是可靠的(壞掉的只有 document_start
  // 那一刻,見 bootstrap.js 的警語)。仍留一條自己算的備援。
  const GAME = globalThis.PMZ_GAME
    ?? (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2', label: 'PoE2' } : { id: 'poe1', label: 'PoE1' });
  const IS_POE2 = GAME.id === 'poe2';
  const POE_VER = IS_POE2 ? 'Poe2' : 'Poe1'; // 書籤/歷史的 poeVersion 欄位用的字面值

  const DEFAULT_SETTINGS = {
    autoInstantBuyout: false, // 開頁自動把狀態設為「即刻購買」
    highlightPseudo: true, // 結果列的偽屬性(合計)詞綴高亮
    modFilterButtons: true, // 結果列每條詞綴右側的 ＋/− 篩選按鈕(content/mod-row.js 讀同一個鍵)
    // ⚠ 兩款的聯盟名不同(PoE1「Allflame」/ PoE2「Runes of Aldur」),**一定要分開存**
    //   —— 共用一個欄位會讓 PoE2 書籤套上 PoE1 的聯盟,開出空搜尋而且完全無聲。
    //   `league` / `lastLeague` **維持是 PoE1 的**(不做 migration,現有設定原封不動),
    //   PoE2 另立 `league2` / `lastLeague2`。
    league: '', // PoE1 聯盟:物價與書籤共用;空字串 = 自動(poe.ninja 最新 / 目前頁面)
    league2: '', // PoE2 聯盟
    sidebarSide: 'right',
    sidebarTop: 45, // 開關鈕垂直位置(vh 百分比,可拖曳調整)
    keepPanelOpen: true, // 常駐維持展開:換頁後照上次的開/關與分頁還原(狀態本身存在 sidebarUi)
    dragHintDismissed: false, // 書籤分頁頂部「怎麼拖曳」提示條按過「知道了」
    lastLeague: '', // PoE1 最後看到的聯盟,設定為「自動」時當退路
    lastLeague2: '', // PoE2 同上
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
    // 書籤/歷史頂部的遊戲分頁:'Poe1' | 'Poe2'。
    // 預設跟著目前頁面的遊戲,換頁(SPA 導航)時自動切過去;使用者手動點過之後
    // 維持到下一次換頁。這是「現在在看哪一款」,不是偏好,所以不進 settings。
    gameTab: POE_VER,
    // 匯入時先解析檔案再問要匯入什麼(檔案裡有什麼,開之前根本不知道)
    pendingImport: null, // { folders, report, isBackup, settings, history, exportedAt, counts, name }
  };

  // ── URL 解析與 SPA 導航偵測 ──
  function currentSearch() {
    return M.parseSearchUrl(location.href);
  }

  // 聯盟設定是 per-game 的,而且要看**書籤自己的**遊戲,不是目前頁面的 ——
  // 在 PoE1 頁面點一個 PoE2 書籤,套 PoE1 的聯盟就會開出空搜尋。
  function leagueOptsFor(poeVersion) {
    return poeVersion === 'Poe2'
      ? { settingLeague: state.settings.league2, lastLeague: state.settings.lastLeague2 }
      : { settingLeague: state.settings.league, lastLeague: state.settings.lastLeague };
  }

  function leagueFor(bm) {
    // ⚠ resolveLeague 的第三順位是「目前頁面的聯盟」。書籤與本頁不同款時那個值是
    //   **另一款的聯盟**,不能用 —— 傳 null 讓它跳過這一順位。
    const sameGame = (bm?.poeVersion ?? 'Poe1') === POE_VER;
    return M.resolveLeague(bm, sameGame ? location.href : null, leagueOptsFor(bm?.poeVersion));
  }

  function urlFor(bm) {
    return M.buildTradeUrl(location.origin, bm, leagueFor(bm));
  }

  // 書籤/歷史是否屬於**目前選中的分頁**(不是目前頁面 —— 使用者可以手動切過去看)
  function inCurrentGame(entry) {
    return (entry?.poeVersion ?? 'Poe1') === state.gameTab;
  }

  // ── 資料夾也依分頁過濾(使用者 2026-09-08 回報:PoE2 分頁看得到整排 PoE1 資料夾)──
  // 規則:有這一款的書籤才出現;**完全空的資料夾照樣出現**(剛按「新資料夾」建的,
  // 不出現會像是建失敗);子資料夾留下時父也要留。計數只算這一款。
  // ⚠ 回傳的是 state.data.folders 裡的**同一批物件**(不是複本)——改名、拖曳、刪除
  //   都直接改這些物件,給複本會讓操作寫到空氣裡。
  // game 預設是書籤分頁目前選的那款;「加入書籤」的資料夾下拉要用**書籤本身**那款
  // (目前頁面 POE_VER、歷史紀錄的 poeVersion),與分頁無關。
  function gameCountOf(folder, game = state.gameTab) {
    return (folder?.bookmarks ?? []).filter((b) => (b?.poeVersion ?? 'Poe1') === game).length;
  }
  function folderGameTotal(folder, game = state.gameTab) {
    let n = gameCountOf(folder, game);
    if (!folder?.parentId) for (const c of M.childFolders(state.data.folders, folder.id)) n += gameCountOf(c, game);
    return n;
  }
  function visibleFolders(game = state.gameTab) {
    const all = state.data.folders;
    const keep = new Set();
    for (const f of all) {
      if (gameCountOf(f, game) > 0 || M.folderTotal(all, f) === 0) keep.add(f.id);
    }
    for (const f of all) if (f.parentId && keep.has(f.id)) keep.add(f.parentId);
    return all.filter((f) => keep.has(f.id));
  }

  // ── 帶條件的書籤:開過一次就把官方搜尋編號記起來 ──
  // 這種書籤存的是查詢條件,每次開都要讓官網重新建立一次搜尋(所以「點下去很慢」)。
  // 開啟前先把「我正在開哪一個書籤」寫進 sessionStorage(點下去會整頁重載,記憶體留不住),
  // 頁面回來後看到網址已經變成 /search/<聯盟>/<編號> 就寫回書籤,下次直接開那個編號。
  const PENDING_KEY = 'pmz-pending-open';

  function openBookmark(bm) {
    const league = leagueFor(bm);
    // 兩種情況要記下「我正在開哪一個書籤」:
    //   ① 帶條件的書籤 —— 官網會把 `?q=` 換成正式編號,記下來下次直接開
    //   ② 舊短編號的書籤 —— 官網載完會 replaceState 成新格式,那一刻就是
    //     把查詢內容搬回使用者手上的機會(見 bookmarks-model 的 isLegacySearchId)
    if ((!bm.searchId && bm.query) || M.isLegacySearchId(bm.searchId)) {
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
      if (!bm) continue;
      // ⚠ 判斷一律走 planSearchIdAdoption(純函式、有離線鎖)——
      //   這裡只負責把結果寫回去。不要把判斷搬回這一層。
      const plan = M.planSearchIdAdoption(bm, cur.searchId, pending.league);
      // 官網還沒把網址換成新格式:**保留 pending**,等下一次網址變化。
      // 這一行不能拿掉 —— init() 那一次常常就跑在 replaceState 之前。
      if (plan?.kind === 'wait') return;
      if (plan?.kind === 'cache') {
        bm.cachedSearchId = plan.searchId;
        bm.cachedLeague = plan.league;
        persist();
        dbg(`[PTM] 書籤「${bm.name}」記下搜尋編號 ${plan.searchId}(${plan.league}),下次直接開`);
      } else if (plan?.kind === 'upgrade') {
        const legacy = bm.searchId;
        bm.searchId = plan.searchId;
        bm.name = plan.name;
        persist();
        dbg(`[PTM] 書籤「${bm.name}」的舊編號 ${legacy} 已升級成新格式網址`);
      }
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
    const key = IS_POE2 ? 'lastLeague2' : 'lastLeague';
    if (league && league !== state.settings[key]) {
      state.settings[key] = league;
      persistSettings();
    }
  }

  // 網址換到另一款時,書籤/歷史的分頁自動跟著切過去(使用者要求「依 URL 自動辨別」)。
  // ⚠ 只有**真的換款**才動:同一款內換聯盟/換搜尋不該把使用者手動切過去的分頁拉回來。
  function syncGameTab() {
    const now = /^\/trade2(\/|$)/.test(location.pathname)
      || /^\/trade\/[^/]+\/poe2(\/|$)/.test(location.pathname) ? 'Poe2' : 'Poe1';
    if (state.gameTab === now) return false;
    state.gameTab = now;
    return true;
  }

  let lastHref = location.href;
  function onUrlMaybeChanged() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    syncGameTab();
    rememberLeague();
    adoptSearchId(); // ?q= 換成正式編號的那一刻,把編號寫回書籤
    scheduleHistory();
    if (state.open && (state.tab === 'bookmarks' || state.tab === 'history')) render();
  }
  // navigation API 有就用它,沒有才退回輪詢。
  // ⚠ 以前是兩條無條件並行 —— 現代 Chrome 兩條都在跑,每秒醒來一次純粹是白費。
  //   輪詢那條不能刪:Firefox 147 才有 navigation API,而 Firefox 版最低支援 140。
  if (globalThis.navigation?.addEventListener) {
    globalThis.navigation.addEventListener('navigatesuccess', onUrlMaybeChanged);
  } else {
    setInterval(onUrlMaybeChanged, 1000);
  }

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
  // rail = 面板同側邊緣的直立圖示欄(書籤 / 設定 / 贊助 / Discord),取代原本單顆 ☰ 開關鈕。
  // railBtns 只放「會隨面板狀態高亮」的兩顆(書籤、設定),外部連結不需要。
  let panel, rail;
  const railBtns = {};

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = text;
    return node;
  }

  function applySide() {
    const left = state.settings.sidebarSide === 'left';
    rail.classList.toggle('pmz-left', left);
    panel.classList.toggle('pmz-left', left);
    applyPageSqueeze();
  }

  // 面板開啟時把官網內容縮窄讓開,而不是蓋在頁面上(PoE Trade Extension 的做法:
  // 對 `.container-fluid .content` 設 float + width,收合時把兩個 inline 屬性拿掉)。
  // 面板本身仍是 position:fixed,這裡只動官網那一格。
  // ⚠ 464 = 面板 420 + 全高 rail 44,與 sidebar.css 的 .pmz-panel width / .pmz-open 偏移同步。
  // 找不到 .content(官網改版或還沒渲染)就靜靜略過,不可拋 —— 側邊欄其他功能不該因此掛掉。
  const PAGE_SQUEEZE_PX = 464;
  function applyPageSqueeze() {
    const content = document.querySelector('.container-fluid .content');
    if (!content) return;
    if (state.open) {
      content.style.float = state.settings.sidebarSide === 'left' ? 'right' : 'left';
      content.style.width = `calc(100% - ${PAGE_SQUEEZE_PX}px)`;
    } else {
      content.style.removeProperty('float');
      content.style.removeProperty('width');
    }
  }

  // rail 常駐不隱藏。兩種型態(PoE Trade Extension 的擺法):
  //   收合:小塊、停在 sidebarTop、可拖曳;只有 書籤/設定/贊助/Discord。
  //   開啟:貼螢幕邊的全高直立欄(.pmz-rail-full),面板停靠在它內側不重疊;
  //         多出 收合✕/歷史/物價,分頁鈕依 state.tab 高亮,不可拖曳。
  // 按鈕一次建好,這裡只切 class 與 hidden(⚠ .pmz-rail-btn 是 display:flex,
  // CSS 要有 [hidden]{display:none} 才真的藏得住)。
  const RAIL_OPEN_ONLY = ['close', 'history', 'prices'];
  function updateRail() {
    const open = !!state.open;
    rail.classList.toggle('pmz-rail-full', open);
    rail.title = open ? '' : '可拖曳調整位置';
    for (const k of RAIL_OPEN_ONLY) if (railBtns[k]) railBtns[k].hidden = !open;
    for (const tab of ['bookmarks', 'history', 'prices', 'settings']) {
      railBtns[tab]?.classList.toggle('pmz-rail-active', open && state.tab === tab);
    }
    applyTop();
  }

  // ── 面板開/關與所在分頁:跨頁面保留 ──
  // 點書籤、換搜尋都是整頁重載,以前每換一頁面板就收起來(2026-09-14 使用者要求維持)。
  // ⚠ 不放進 settings:settings 會進備份檔,而且 mod-row.js 監聽 settings 的每一次變動;
  //   開關面板是很頻繁的動作,另立一個鍵。其他分頁改了**不即時同步**,下次載入才套用
  //   —— 同時開兩個交易站分頁時,一邊收合不該把另一邊也收起來。
  const UI_KEY = 'sidebarUi';
  const PANEL_TABS = IS_POE2
    ? [['bookmarks', '書籤'], ['history', '歷史'], ['settings', '⚙']]
    : [['bookmarks', '書籤'], ['history', '歷史'], ['prices', '物價'], ['settings', '⚙']];

  function persistUi() {
    chrome.storage.local.set({ [UI_KEY]: { open: !!state.open, tab: state.tab } });
  }

  // 存下來的狀態可能來自另一款遊戲的頁面(PoE1 的「物價」在 PoE2 沒有)或舊資料,不合法就退回書籤
  function restoredTab(saved) {
    return PANEL_TABS.some(([id]) => id === saved?.tab) ? saved.tab : 'bookmarks';
  }

  function setOpen(open, { save = true } = {}) {
    state.open = open;
    panel.classList.toggle('pmz-open', open);
    updateRail();
    applyPageSqueeze();
    if (save) persistUi();
    if (open) render();
  }

  function applyTop() {
    if (state.open) { rail.style.top = ''; return; } // 開啟時 rail 全高(top/bottom 由 CSS 定),不吃 sidebarTop
    const pct = Math.min(88, Math.max(3, Number(state.settings.sidebarTop) || 45));
    rail.style.top = `${pct}%`; // 面板為全高固定,只有 rail 跟著拖曳
  }

  // 整條 rail 可垂直拖曳(位移超過門檻視為拖曳,放開後不觸發子按鈕的 click)。
  // 只在收合狀態有效:開啟時 rail 是全高欄,沒有「位置」可拖。
  // ⚠ pointer capture 要設在 e.target(被按到的那顆按鈕)而不是 rail 本身:
  //   Chrome 會把 click 派給「持有 capture 的元素」,設在 rail 上子按鈕就永遠收不到 click。
  //   設在按鈕上,pointermove/up 仍會冒泡到 rail,這裡的監聽照常收得到。
  function enableDrag() {
    let drag = null;
    let suppressClick = false;
    rail.addEventListener('pointerdown', (e) => {
      if (state.open) return;
      drag = { startY: e.clientY, startPct: Number(state.settings.sidebarTop) || 45, moved: false };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) { /* 非 Element 目標:不 capture 也能拖 */ }
    });
    rail.addEventListener('pointermove', (e) => {
      if (!drag) return;
      const dy = e.clientY - drag.startY;
      if (Math.abs(dy) > 5) drag.moved = true;
      if (!drag.moved) return;
      state.settings.sidebarTop = drag.startPct + (dy / window.innerHeight) * 100;
      applyTop();
    });
    rail.addEventListener('pointerup', () => {
      if (drag?.moved) {
        suppressClick = true;
        persistSettings();
      }
      drag = null;
    });
    // capture 階段掛在 rail:子按鈕的 click 監聽是 target 階段,這裡先攔就能整顆吞掉
    rail.addEventListener('click', (e) => {
      if (suppressClick) {
        suppressClick = false;
        e.stopImmediatePropagation();
      }
    }, true);
  }

  // ── rail 圖示:全部自繪(24×24 viewBox,線條風格,顏色跟 currentColor)──
  // 不用 emoji(跨系統長相不一)、不抄任何第三方擴充的圖;每個圖示是一組 path d。
  const RAIL_ICON_PATHS = {
    // 收合 ✕:兩條斜線
    close: ['M6 6l12 12M18 6L6 18'],
    // 歷史:時鐘(圓 + 指針)
    history: ['M12 3a9 9 0 1 1 0 18 9 9 0 0 1 0-18z', 'M12 7v5l3 2'],
    // 物價:三枚疊起的錢幣
    prices: [
      'M12 3c4.4 0 8 1.3 8 3s-3.6 3-8 3-8-1.3-8-3 3.6-3 8-3z',
      'M4 6v6c0 1.7 3.6 3 8 3s8-1.3 8-3V6',
      'M4 12v6c0 1.7 3.6 3 8 3s8-1.3 8-3v-6',
    ],
    // 書籤旗標
    bookmark: ['M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1z'],
    // 八齒齒輪 + 中心圓
    gear: [
      'M19.45 10.49L21.92 10.7L21.92 13.3L19.45 13.51L18.33 16.2L19.93 18.09L18.09 19.93L16.2 18.33L13.51 19.45L13.3 21.92L10.7 21.92L10.49 19.45L7.8 18.33L5.91 19.93L4.07 18.09L5.67 16.2L4.55 13.51L2.08 13.3L2.08 10.7L4.55 10.49L5.67 7.8L4.07 5.91L5.91 4.07L7.8 5.67L10.49 4.55L10.7 2.08L13.3 2.08L13.51 4.55L16.2 5.67L18.09 4.07L19.93 5.91L18.33 7.8z',
      'M12 9a3 3 0 1 0 0 6 3 3 0 0 0 0-6z',
    ],
    // 咖啡杯:杯身、把手、兩縷蒸氣、杯墊
    coffee: [
      'M4 9h12v6a4 4 0 0 1-4 4H8a4 4 0 0 1-4-4z',
      'M16 11h1.5a2.5 2.5 0 0 1 0 5H16',
      'M7.5 3.5c0 1.2 1 1.3 1 2.5s-1 1-1 2.5M10.5 3.5c0 1.2 1 1.3 1 2.5s-1 1-1 2.5',
      'M3 21h14',
    ],
    // Discord:對話泡狀的手把 + 兩顆眼睛
    discord: [
      'M8 5.5A16 16 0 0 1 12 5a16 16 0 0 1 4 .5l1 2.5a12 12 0 0 1 3 8l-3.5 2.5-1-2a10 10 0 0 1-7 0l-1 2L4 16a12 12 0 0 1 3-8z',
      'M9.5 12.5h.01M14.5 12.5h.01',
    ],
  };

  function railIcon(name) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('class', 'pmz-rail-svg');
    for (const d of RAIL_ICON_PATHS[name] ?? []) {
      const path = document.createElementNS(NS, 'path');
      path.setAttribute('d', d);
      svg.appendChild(path);
    }
    return svg;
  }

  function railBtn(icon, title, onClick) {
    const btn = el('button', 'pmz-rail-btn');
    btn.type = 'button';
    btn.title = title;
    btn.appendChild(railIcon(icon));
    btn.addEventListener('click', onClick);
    return btn;
  }

  // 面板開/關與分頁切換的共用入口(rail 的書籤/設定鈕都走這裡)
  function showTab(tab) {
    state.tab = tab;
    state.dataMsg = null; // 匯出/匯入結果訊息只顯示到離開分頁為止
    state.historyPickId = null;
    if (state.open) {
      persistUi();
      render();
    } else {
      setOpen(true);
    }
  }

  function buildRail() {
    rail = el('div', 'pmz-rail');
    rail.title = '可拖曳調整位置';
    // 收合 ✕(只在開啟時顯示;對應標頭那顆 ✕,開啟時標頭的會被 CSS 藏起來)
    railBtns.close = railBtn('close', '收合側邊欄', () => setOpen(false));
    // 書籤:關著 → 開到書籤;開著且在書籤 → 收合;開著在別頁 → 切到書籤
    railBtns.bookmarks = railBtn('bookmark', '書籤', () => {
      if (state.open && state.tab === 'bookmarks') setOpen(false);
      else showTab('bookmarks');
    });
    railBtns.history = railBtn('history', '歷史', () => showTab('history'));
    // ⚠ 物價只有 PoE1(bg/ninja.js 打的是 poe.ninja/poe1),與面板內的分頁列同一條判斷
    if (!IS_POE2) railBtns.prices = railBtn('prices', '物價', () => showTab('prices'));
    // 設定:開到設定;已在設定 → 收合
    railBtns.settings = railBtn('gear', '設定', () => {
      if (state.open && state.tab === 'settings') setOpen(false);
      else showTab('settings');
    });
    rail.append(railBtns.close, railBtns.bookmarks, railBtns.history);
    if (railBtns.prices) rail.appendChild(railBtns.prices);
    // 分隔線只在收合時看得到;開啟(全高)時改由 spacer 把贊助/Discord 推到底部
    rail.append(railBtns.settings, el('div', 'pmz-rail-sep'), el('div', 'pmz-rail-spacer'));
    for (const [icon, title, href] of [
      ['coffee', '請我喝杯咖啡', RAIL_LINKS.coffee],
      ['discord', 'Discord 社群', RAIL_LINKS.discord],
    ]) {
      // 開新分頁一律帶 noopener,不讓對方拿到 window.opener
      rail.appendChild(railBtn(icon, title, () => window.open(href, '_blank', 'noopener')));
    }
    return rail;
  }

  function buildShell() {
    buildRail();

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
    // ⚠ 物價只有 PoE1(PANEL_TABS):bg/ninja.js 打的是 `poe.ninja/poe1/api/...`。
    //   在 PoE2 頁面顯示一個永遠載不出東西的分頁,比沒有這個分頁更糟。
    for (const [id, label] of PANEL_TABS) {
      const tab = el('button', 'pmz-tab', label);
      tab.dataset.tab = id;
      tab.title = id === 'settings' ? '設定' : label;
      tab.addEventListener('click', () => showTab(id)); // 分頁列只在面板開著時看得到
      tabs.appendChild(tab);
    }
    panel.appendChild(tabs);
    panel.appendChild(el('div', 'pmz-body'));
    document.body.append(rail, panel);
    applySide();
    applyTop();
    enableDrag();
    updateRail();
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
    // 拖曳把手:兩排三點(點的粗細由 .pmz-grip 的 stroke-width 決定)
    grip: 'M9 5h.01M9 12h.01M9 19h.01M15 5h.01M15 12h.01M15 19h.01',
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

  // 拖曳把手:讓人一眼看出「這一列可以拖」。整列本來就能拖,把手是看得見的入口;
  // 觸控從把手按下去不必長按(見 makeDraggable 的 fromHandle),點把手也不會觸發整列的點擊。
  // ⚠ 不可加進 INTERACTIVE:那份清單裡的元素連 pointerdown 都會被略過,把手就拖不動了。
  function gripHandle(title) {
    const grip = el('span', 'pmz-grip');
    grip.title = title;
    grip.appendChild(svgIcon('grip'));
    return grip;
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

  // 圖示可以是 emoji、遊戲圖像 URL(poecdn / poewiki)或擴充包內的相對路徑
  // (`icons/folder/poe2-xxx.png`,經 web_accessible_resources 出貨)。
  // ⚠ 書籤資料裡存的仍是相對路徑:未封裝與商店版的擴充 id 不同,
  //   把 chrome-extension://<id>/ 寫進 storage 會在換版後全部失效。轉成可載入的
  //   位址只在塞進 img.src 那一刻做(iconSrc)。
  const RELATIVE_ICON_RE = /^(?!https?:\/\/)(?!data:)[^\s]*\/[^\s]*\.(?:png|webp|svg)$/i;
  function isImageIcon(icon) {
    return typeof icon === 'string' && (/^https?:\/\//.test(icon) || icon.startsWith('data:') || RELATIVE_ICON_RE.test(icon));
  }
  function iconSrc(icon) {
    if (typeof icon !== 'string') return '';
    if (/^https?:\/\//.test(icon) || icon.startsWith('data:')) return icon;
    if (RELATIVE_ICON_RE.test(icon)) return chrome.runtime.getURL(icon);
    return icon;
  }
  function renderIcon(icon, className) {
    if (isImageIcon(icon)) {
      const img = el('img', className);
      img.src = iconSrc(icon);
      img.alt = '';
      return img;
    }
    return el('span', className, icon || M.DEFAULT_ICON);
  }

  // 圖示分區依目前頁面的遊戲過濾(使用者 2026-09-08 裁定):PoE2 頁只給「PoE2」分區,
  // PoE1 頁只給其餘分區。分區 id 是語言無關鍵('PoE2'),不看 label。
  function iconSectionsForGame() {
    return (state.iconList ?? []).filter((s) => (s?.id === 'PoE2') === IS_POE2);
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
    for (const section of iconSectionsForGame()) {
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
    // 放開後書籤又展開回來,剛放下的資料夾可能被推到畫面外
    panel.querySelector(`.pmz-folder-head[data-pmz-id="${ctx.folderId}"]`)?.scrollIntoView({ block: 'nearest' });
  }

  // 書籤拖曳的落點框(資料夾拖曳改用下面的讓位預覽,不用這個)
  function clearDropMarks() {
    panel.querySelectorAll('.pmz-drop-target').forEach((n) => n.classList.remove('pmz-drop-target'));
  }

  // ── 資料夾拖曳:讓位預覽 ──
  // 2026-09-14 使用者回報:第一層資料夾拖到另一個資料夾上,分不清是「排到它前後」還是「放進去」
  // (以前只靠標題上下緣一條細線與中間的虛線框區分)。改成使用者選定的做法:
  //   ① 拖曳期間所有資料夾的書籤暫時收起,清單只剩資料夾標題
  //   ② 被拖的資料夾(連同子資料夾)從清單拿掉,在「放開後會出現的位置」插一格空位
  //   ③ 只有停在放得進去的資料夾標題中間,空位才縮排到它底下、標題加金框、文字改成「放進「B」成為子資料夾」
  // 排序語意是「插入」不是「互換」(使用者裁定)。判定走 M.folderDropZone、套用走 M.planFolderDrop。
  // ⚠ 判定用的是**當下畫面上**的位置(空位插進去後其他標題會移動)。游標蓋在空位上時維持上一個結果
  //   (KEEP_HIT),位置一移動就不會在兩種結果之間來回跳 —— 測試頁有逐 2px 掃描的鎖。
  // ⚠ 「放進去」也用同一格空位表示(只是縮排、換字),**不要**改回在標題下方另插提示條:
  //   第一版就是那樣,提示條與空位高度不同,切換時下一個資料夾會跳到游標底下,
  //   稍微快一點拖就跳過「排在它前面」直接變成「放進它」(測試頁 G5 實際抓到)。
  //   現在「放進 B」「排在 B 後面」「排在下一個前面」是同一個 DOM 位置,切換時清單完全不動。
  const KEEP_HIT = Symbol('keep-hit');

  function folderDragPreview(movedId) {
    let slot = null;
    let markedHead = null;
    let spacer = null;
    let spacerAtTop = false;
    const bodyEl = () => panel.querySelector('.pmz-body');
    const nameOf = (id) => findFolderById(id)?.name ?? '';

    function clear() {
      slot?.remove();
      markedHead?.classList.remove('pmz-drop-into', 'pmz-drop-invalid');
      slot = markedHead = null;
    }
    function makeSlot(childLevel, variant = '', text = `「${nameOf(movedId)}」會放在這裡`) {
      const node = el('div', `pmz-drop-slot${childLevel ? ' pmz-drop-slot-child' : ''}${variant ? ` pmz-drop-slot-${variant}` : ''}`, text);
      node.title = text; // 名稱太長時空位只顯示一行(高度固定才不會影響判定),完整文字放 title
      return node;
    }
    // 第一層資料夾的子資料夾 wrap 緊跟在它後面(renderFolder 的走訪序);「排到它後面」要排在整組後面
    function lastWrapOfBlock(wrap) {
      let last = wrap;
      for (let n = wrap.nextElementSibling; n?.dataset.pmzParent === wrap.dataset.pmzWrap; n = n.nextElementSibling) {
        if (!n.hidden) last = n;
      }
      return last;
    }

    return {
      begin() {
        const wrap = panel.querySelector(`.pmz-folder[data-pmz-wrap="${movedId}"]`);
        const headTop = wrap?.querySelector('.pmz-folder-head')?.getBoundingClientRect().top;
        panel.classList.add('pmz-folder-dragging');
        for (const w of panel.querySelectorAll(`.pmz-folder[data-pmz-wrap="${movedId}"], .pmz-folder[data-pmz-parent="${movedId}"]`)) {
          w.hidden = true;
        }
        if (!wrap) return;
        // 原位先放一格空位:沒拖到別處就放開 = 不動
        slot = makeSlot(!!findFolderById(movedId)?.parentId);
        wrap.before(slot);
        // 書籤收起來清單會縮短,空位要回到游標底下 —— 不然一按下去整個清單就跳走,
        // 游標落在清單下方的空白,預覽直接變成「移到最後」(測試頁 F1 實際抓到)。
        // 先用捲動補;捲到底/頂還補不完就墊一段空白:
        //   清單本來就在最上面 → 空位跑到游標上方 → 第一個資料夾前面墊高
        //   清單原本捲到最下面 → 內容變短、捲動位置被瀏覽器夾回去,空位反而在游標下方
        //   → 清單尾巴墊高再往下捲(測試頁 F10 實際抓到)
        const body = bodyEl();
        const shift = slot.getBoundingClientRect().top - headTop;
        const scrollBefore = body.scrollTop;
        body.scrollTop += shift;
        const unabsorbed = shift - (body.scrollTop - scrollBefore);
        if (Math.abs(unabsorbed) > 1) {
          spacer = el('div', 'pmz-drag-spacer');
          spacer.style.height = `${Math.abs(unabsorbed)}px`;
          spacerAtTop = unabsorbed < 0;
          if (spacerAtTop) {
            body.querySelector('.pmz-folder, .pmz-drop-slot')?.before(spacer);
          } else {
            body.appendChild(spacer);
            body.scrollTop += unabsorbed;
          }
        }
      },
      hitAt(x, y) {
        const body = bodyEl();
        let under = document.elementFromPoint(x, y);
        // 游標往上走進墊高的空白 = 想去清單最上面:把空白縮到清單第一格剛好迎到游標,
        // 不然那段空白是死區,使用者得在一片空白裡找不到東西放
        if (spacer && spacerAtTop && under === spacer) {
          let first = spacer.nextElementSibling;
          while (first?.hidden) first = first.nextElementSibling;
          const gap = first ? first.getBoundingClientRect().top - y : spacer.offsetHeight;
          const rest = spacer.offsetHeight - gap - 4;
          if (rest > 0) {
            spacer.style.height = `${rest}px`;
          } else {
            spacer.remove();
            spacer = null;
          }
          under = document.elementFromPoint(x, y);
        }
        if (!under || !body.contains(under)) return null; // 離開清單:放開不動
        if (under.closest('.pmz-drop-slot')) return KEEP_HIT;
        const head = under.closest('.pmz-folder-head');
        const movedHasKids = M.childFolders(state.data.folders, movedId).length > 0;
        if (!head) {
          // 最後一個資料夾下面的空白 = 移到最後(排在最後一個第一層資料夾那整組後面)
          const wraps = [...body.querySelectorAll('.pmz-folder')].filter((w) => !w.hidden);
          const lastTop = wraps.filter((w) => !w.dataset.pmzParent).pop();
          if (lastTop && y > wraps[wraps.length - 1].getBoundingClientRect().bottom) {
            return { kind: 'after', position: 'after', targetId: lastTop.dataset.pmzWrap, node: lastTop.querySelector('.pmz-folder-head') };
          }
          return KEEP_HIT;
        }
        const target = findFolderById(head.dataset.pmzId);
        if (!target || target.id === movedId) return KEEP_HIT;
        const rect = head.getBoundingClientRect();
        const zone = M.folderDropZone(y - rect.top, rect.height, {
          targetIsChild: !!target.parentId,
          movedHasKids,
          targetHasVisibleKids: !target.parentId && !!panel.querySelector(`.pmz-folder[data-pmz-parent="${target.id}"]:not([hidden])`),
        });
        if (zone === 'invalid') {
          // 上半/下半一樣分前後,空位畫在「本來會去的位置」只是變紅,切換時清單才不會跳
          const r = (y - rect.top) / (rect.height || 1);
          return { kind: 'invalid', side: r < 0.5 ? 'before' : 'after', targetId: target.id, node: head };
        }
        return { kind: zone, position: zone, targetId: target.id, node: head };
      },
      show(hit) {
        clear();
        if (!hit) return;
        const target = findFolderById(hit.targetId);
        const wrap = hit.node.closest('.pmz-folder');
        const side = hit.kind === 'invalid' ? hit.side : hit.kind;
        if (hit.kind === 'inside') {
          slot = makeSlot(true, 'into', `放進「${nameOf(hit.targetId)}」成為子資料夾`);
        } else if (hit.kind === 'invalid') {
          slot = makeSlot(true, 'invalid', `「${nameOf(movedId)}」底下還有資料夾,不能放進子層`);
        } else {
          slot = makeSlot(!!target?.parentId);
        }
        slot.dataset.pmzTarget = hit.targetId;
        if (hit.kind === 'inside' || hit.kind === 'invalid') {
          markedHead = hit.node;
          markedHead.classList.add(hit.kind === 'inside' ? 'pmz-drop-into' : 'pmz-drop-invalid');
        }
        // 前面 = 目標那一格之前;其餘(後面/放進去)= 子資料夾接在自己後面、第一層接在整組後面
        if (side === 'before') wrap.before(slot);
        else (target?.parentId ? wrap : lastWrapOfBlock(wrap)).after(slot);
      },
      end() {
        clear();
        spacer?.remove();
        spacer = null;
        panel.classList.remove('pmz-folder-dragging');
        for (const w of panel.querySelectorAll('.pmz-folder[hidden]')) w.hidden = false;
      },
    };
  }

  // ── 拖曳 ──
  // 用 pointer 事件自己做,不用 HTML5 的 draggable:draggable 一開就是「按住就拖」,
  // 整塊沒辦法同時當按鈕用。什麼時候算開始拖,依輸入裝置分開:
  //   滑鼠/觸控筆:按住後移動超過 DRAG_START_PX 就開始拖,不必長按。滑鼠按著移動不會
  //     捲動頁面,沒有要讓給誰。⚠ 以前滑鼠也要長按 350ms,直接按住拖會被當成取消,
  //     看起來就是「資料夾拖不動」(2026-09-14 使用者回報)。按住不動 350ms 照樣進入。
  //   觸控:維持長按 350ms,在那之前移動超過 MOVE_CANCEL_PX 就當成捲動,取消長按。
  // 沒移動就放開都算單純點擊 —— 書籤整塊照樣能點開搜尋。
  const LONG_PRESS_MS = 350;
  const MOVE_CANCEL_PX = 8;
  const DRAG_START_PX = 5;
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
    const { ghost, source, hit, preview } = drag;
    clearInterval(drag.scrollTimer);
    ghost?.remove();
    source?.classList.remove('pmz-dragging');
    clearDropMarks();
    preview?.end(); // 先把清單還原,onDrop 沒有 render 的路徑(放回原位)才不會留著空位
    document.body.style.userSelect = '';
    const finished = drag;
    drag = null;
    if (apply && hit && hit.kind !== 'invalid') finished.onDrop(finished.ctx, hit.node, hit.position, hit);
  }

  // 書籤拖曳:游標底下可以放的目標(ghost 有 pointer-events:none,不會擋住 elementFromPoint)。
  // 放到書籤 = 插到它前面、放到資料夾標題 = 移進去,都只有一種放法。
  function hitTest(x, y, accepts) {
    const el0 = document.elementFromPoint(x, y);
    const node = el0?.closest('[data-pmz-drop]');
    if (!node || !panel.contains(node)) return null;
    if (!accepts.includes(node.dataset.pmzDrop)) return null;
    return { node, position: 'inside' };
  }

  function updateHit(x, y) {
    if (drag.preview) {
      const hit = drag.preview.hitAt(x, y);
      if (hit === KEEP_HIT) return;
      drag.hit = hit;
      drag.preview.show(hit);
      return;
    }
    clearDropMarks();
    drag.hit = hitTest(x, y, drag.accepts);
    if (drag.hit && drag.hit.node !== drag.source) drag.hit.node.classList.add('pmz-drop-target');
  }

  // 拖到清單上下緣自動捲動:書籤一多,放的位置常常不在同一個畫面裡。
  // ⚠ 用 setInterval 不用 requestAnimationFrame:沒在合成畫面的分頁不跑 rAF(見面板還原那段)
  const AUTOSCROLL_EDGE_PX = 40;
  const AUTOSCROLL_STEP_PX = 14;
  function updateAutoScroll(y) {
    const body = panel.querySelector('.pmz-body');
    const rect = body.getBoundingClientRect();
    const dir = y < rect.top + AUTOSCROLL_EDGE_PX ? -1 : y > rect.bottom - AUTOSCROLL_EDGE_PX ? 1 : 0;
    // 從貼著上下緣的那一列開始拖時,游標一開始就在邊緣區 —— 要先離開一次再進去才捲,
    // 否則一按下去清單就自己跑(測試頁 F10 實際抓到)
    if (!drag.scrollArmed) {
      if (dir === 0) drag.scrollArmed = true;
      return;
    }
    if (dir === drag.scrollDir) return;
    clearInterval(drag.scrollTimer);
    drag.scrollDir = dir;
    drag.scrollTimer = dir ? setInterval(() => {
      if (!drag) return;
      body.scrollTop += dir * AUTOSCROLL_STEP_PX;
      updateHit(drag.lastX, drag.lastY); // 清單在游標底下動了,落點要跟著重算
    }, 16) : null;
  }

  // preview(可省):資料夾拖曳的讓位預覽,見 folderDragPreview
  function makeDraggable(node, ctx, onDrop, accepts, kind, preview) {
    node.dataset.pmzDrop = kind;
    // 瀏覽器原生的拖曳(資料夾圖示是 <img>、或按在已選取的文字上)一啟動就會發
    // pointercancel,把我們的拖曳整個取消掉 —— 一律擋掉,拖曳只走下面這套。
    node.addEventListener('dragstart', (e) => e.preventDefault());
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || e.target.closest(INTERACTIVE)) return;
      const startX = e.clientX;
      const startY = e.clientY;
      // 從把手按下去就是明確要拖(把手是 touch-action:none,不會變成捲動),觸控也不必長按
      const fromHandle = !!e.target.closest('.pmz-grip');
      const byTouch = e.pointerType === 'touch' && !fromHandle;
      const beginDrag = () => {
        timer = null;
        // 按下去那一刻若有輸入框失焦,render() 會把這一列換掉;舊節點不在畫面上就不拖
        if (!node.isConnected) {
          cleanup();
          return;
        }
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
        window.getSelection()?.removeAllRanges(); // 滑鼠按著移動的那幾 px 可能已經選到字
        drag = {
          ctx, ghost, source: node, onDrop, accepts, preview: preview ?? null,
          offsetX: startX - rect.left, offsetY: startY - rect.top, hit: null,
          lastX: startX, lastY: startY, scrollDir: 0, scrollTimer: null, scrollArmed: false,
        };
        drag.preview?.begin();
      };
      let timer = setTimeout(beginDrag, LONG_PRESS_MS);

      const onMove = (ev) => {
        if (timer) {
          const dist = Math.hypot(ev.clientX - startX, ev.clientY - startY);
          if (byTouch) {
            // 觸控還沒長按到:移動超過門檻就當使用者要捲動,取消長按
            if (dist > MOVE_CANCEL_PX) {
              clearTimeout(timer);
              timer = null;
              cleanup();
            }
            return;
          }
          // 滑鼠:移動超過門檻就直接開始拖,接著照常更新位置與落點
          if (dist <= DRAG_START_PX) return;
          clearTimeout(timer);
          beginDrag();
        }
        if (!drag) return;
        drag.lastX = ev.clientX;
        drag.lastY = ev.clientY;
        drag.ghost.style.left = `${ev.clientX - drag.offsetX}px`;
        drag.ghost.style.top = `${ev.clientY - drag.offsetY}px`;
        updateHit(ev.clientX, ev.clientY);
        updateAutoScroll(ev.clientY);
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

  // 整塊可點:點在自己有動作的子元素上不算,剛拖完的那一下也不算;
  // 點把手也不算(想拖卻沒拖動就放開,不該打開書籤或收合資料夾)
  function onActivate(node, handler) {
    node.addEventListener('click', (e) => {
      if (Date.now() - dragEndedAt < CLICK_GUARD_MS) return;
      if (e.target.closest(INTERACTIVE) || e.target.closest('.pmz-grip')) return;
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

    // 下拉只列這一款(目前頁面那款)的資料夾與空資料夾 —— 使用者 2026-09-08 回報
    // PoE2 頁面的下拉整排是 PoE1 資料夾
    const folderChoices = visibleFolders(POE_VER);
    const folderSelect = el('select', 'pmz-select');
    for (const { folder, depth } of M.orderedFolders(folderChoices)) {
      const opt = el('option', null, `${depth ? '　└ ' : ''}${isImageIcon(folder.icon) ? '📁' : folder.icon} ${folder.name}`);
      opt.value = folder.id;
      folderSelect.appendChild(opt);
    }
    const optNew = el('option', null, '➕ 新資料夾…');
    optNew.value = '__new__';
    folderSelect.appendChild(optNew);
    form.appendChild(folderSelect);

    const newFolderArea = el('div', 'pmz-form-sub');
    newFolderArea.hidden = folderChoices.length > 0;
    if (folderChoices.length === 0) folderSelect.value = '__new__';
    const folderNameInput = el('input', 'pmz-input');
    folderNameInput.placeholder = '資料夾名稱';
    let pickedIcon = iconSectionsForGame()[0]?.icons[0]?.url ?? FOLDER_ICONS[0];
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
    // 拖曳:放到另一個書籤上 = 插到它前面;放到資料夾標題 = 移到該資料夾末端
    // (空的、收合的資料夾沒有書籤可以對準,只能靠標題 —— 所以 accepts 一定要有 'folder')
    makeDraggable(item, { type: 'bookmark', folderId: folder.id, bookmarkId: bm.id }, (ctx, node) => {
      if (node.dataset.pmzDrop === 'folder') {
        if (node.dataset.pmzId) moveBookmark(ctx, node.dataset.pmzId, null);
        return;
      }
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
    }, ['bookmark', 'folder'], 'bookmark');
    // 整塊都能點開搜尋(按鈕自己會擋掉冒泡,剛拖完的那一下也不算)
    onActivate(item, () => openBookmark(bm));
    // 兩行:上面整行給名稱(側邊欄窄,名稱不該和按鈕搶寬度),下面一行放操作鈕
    const nameRow = el('div', 'pmz-item-top');
    nameRow.appendChild(gripHandle('拖曳調整順序;拖到資料夾標題上可移進該資料夾'));
    if (bm.pinned) nameRow.appendChild(svgIcon('pin', 'pmz-pinned-mark'));
    const name = el('span', 'pmz-item-name', (bm.type === 'exchange' ? '⇄ ' : '') + bm.name);
    name.title = `${bm.searchId ? bm.searchId : '自訂搜尋條件'} / ${bm.poeVersion === 'Poe2' ? 'PoE2' : 'PoE1'}`;
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
    // 讓位預覽靠這兩個屬性找「這個資料夾那一整組」(自己 + 緊跟在後的子資料夾)
    wrap.dataset.pmzWrap = folder.id;
    if (folder.parentId) wrap.dataset.pmzParent = folder.parentId;
    const head = el('div', 'pmz-folder-head');
    head.dataset.pmzId = folder.id;
    // ⚠ onDrop 是**被拖的那一個**的回呼(見 endDrag),accepts 是它能放到哪些目標。
    //   資料夾拖曳的落點由 folderDragPreview 算(hit 帶 targetId),accepts 只剩書籤拖曳在用。
    //   書籤拖到資料夾標題的處理在 renderBookmarkItem。
    makeDraggable(head, { type: 'folder', folderId: folder.id }, (ctx, node, pos, hit) => {
      if (hit?.targetId) dropFolderOn(ctx, hit.targetId, pos);
    }, ['folder'], 'folder', folderDragPreview(folder.id));
    head.appendChild(gripHandle('拖曳調整順序;拖到其他資料夾標題的中間可變成它的子資料夾'));
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
    head.appendChild(el('span', 'pmz-folder-count', String(folderGameTotal(folder)))); // 只算目前分頁那一款
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
      // 依頂部選中的遊戲分頁過濾。數量已經標在分頁標籤上,這裡不必再補說明。
      const visible = folder.bookmarks.filter(inCurrentGame);
      // 手動拖曳順序為主,釘選的穩定浮到最上面(組內維持手動順序)
      const sorted = [...visible].sort((a, b) => (b.pinned ? 1 : 0) - (a.pinned ? 1 : 0));
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

  // 書籤/歷史共用的遊戲分頁列。數量直接標在標籤上 —— 使用者一眼就知道另一款
  // 有沒有東西,不必再靠「另有 N 個」那種事後補說明。
  function renderGameTabs(body, counts) {
    const seg = el('div', 'pmz-seg pmz-gametabs');
    for (const [val, label] of [['Poe1', 'PoE1'], ['Poe2', 'PoE2']]) {
      const n = counts[val] ?? 0;
      const btn = el('button', 'pmz-seg-btn', `${label} (${n})`);
      if (state.gameTab === val) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', () => {
        state.gameTab = val;
        state.historyPickId = null;
        render();
      });
      seg.appendChild(btn);
    }
    body.appendChild(seg);
  }

  function renderBookmarks(body) {
    renderGameTabs(body, M.countByGame(state.data.folders));
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

    // 走訪序:第一層照順序,子資料夾緊跟在父後面(父收合時整包收起);只列目前分頁那一款
    const shown = visibleFolders();
    if (!shown.length) {
      body.appendChild(el('div', 'pmz-empty', `${state.gameTab === 'Poe2' ? 'PoE2' : 'PoE1'} 目前沒有書籤`));
      return;
    }
    if (state.settings.dragHintDismissed !== true) body.appendChild(buildDragHint());
    for (const entry of M.orderedFolders(shown, { skipCollapsed: true })) {
      renderFolder(entry, cur, body);
    }
  }

  // 書籤樹頂部的操作提示(2026-09-14 使用者要求「UI 上要有明顯的地方讓使用者知道怎麼調整」)。
  // 按「知道了」之後不再出現;每一列左側的把手與它的 title 常駐,關掉提示也還看得出能拖。
  // 只在有資料夾可拖時出現(空狀態有自己的說明)。
  function buildDragHint() {
    const tip = el('div', 'pmz-tip');
    tip.appendChild(svgIcon('grip', 'pmz-tip-icon'));
    const text = el('div', 'pmz-tip-text');
    text.appendChild(el('div', 'pmz-tip-title', '拖曳左側把手即可調整順序'));
    text.appendChild(el('div', null, '書籤拖到資料夾標題上會移進去;資料夾拖到另一個資料夾標題的中間會變成子資料夾'));
    tip.appendChild(text);
    const ok = el('button', 'pmz-act', '知道了');
    ok.type = 'button';
    ok.addEventListener('click', () => {
      state.settings.dragHintDismissed = true;
      persistSettings();
      render();
    });
    tip.appendChild(ok);
    return tip;
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
    const counts = { Poe1: 0, Poe2: 0 };
    for (const h of state.history) counts[h?.poeVersion === 'Poe2' ? 'Poe2' : 'Poe1']++;
    renderGameTabs(body, counts);
    // 與書籤同一條規則:依頂部選中的分頁過濾
    const shown = state.history.filter(inCurrentGame);
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
    if (!shown.length) body.appendChild(el('div', 'pmz-empty', '這一款還沒有紀錄'));

    for (const h of shown) {
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
        // 只列這筆紀錄那一款的資料夾(與加入書籤的下拉同一條規則)
        for (const { folder, depth } of M.orderedFolders(visibleFolders(h.poeVersion ?? 'Poe1'))) {
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
      img.src = iconSrc(item.image);
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
      // ⚠ sendMessage 必須是點擊後的第一個非同步動作:background 靠這個手勢直接跳權限對話框
      const res = await chrome.runtime.sendMessage({ t: 'perm:ninja-ask' }).catch(() => null);
      applyNinjaAskResult(res);
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

  // perm:ninja-ask 的回應:direct=true 代表 Chrome 已當場跳出對話框(granted 就是結果);
  // direct=false 代表手勢沒帶到,background 改開授權頁。
  function applyNinjaAskResult(res) {
    if (res?.direct) {
      state.ninjaPerm = res.granted === true;
      state.dataMsg = res.granted
        ? { ok: true, text: '已開啟物價查詢' }
        : { ok: false, text: '你在對話框按了拒絕,物價查詢維持關閉' };
      if (res.granted) state.prices = { ...state.prices, list: [], at: 0, error: null };
    } else {
      state.dataMsg = { ok: true, text: '已開啟授權頁,允許之後回到這裡按「重新檢查」' };
    }
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
  // scope='all' → 完整備份(設定 + 全部書籤 + 歷史),匯入時是「取代」。
  // scope='Poe1'/'Poe2' → 只有那一款的書籤,**不含設定與歷史**,匯入時是「附加」。
  // ⚠ 分款檔刻意標成 kind:'bookmarks' 而不是 'backup' —— 標成 backup 的話,拿一個
  //   只有 PoE2 的檔去還原會把 PoE1 的書籤整批刪光(取代語意),而且完全無聲。
  function exportBackup(scope) {
    const version = chrome.runtime.getManifest().version;
    const all = scope === 'all';
    const payload = all
      ? M.makeBackup({
        settings: state.settings,
        folders: state.data.folders,
        history: state.history,
        appVersion: version,
      })
      : M.makeBookmarkExport({ folders: state.data.folders, game: scope, appVersion: version });
    // 剔除 _ 開頭的內部欄位(如寫入者蓋章 _writer)
    const json = JSON.stringify(payload, (k, v) => (k.startsWith('_') ? undefined : v), 2);
    const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }));
    const a = document.createElement('a');
    const day = new Date().toISOString().slice(0, 10);
    a.href = url;
    a.download = all ? `pmz-backup-${day}.json` : `pmz-bookmarks-${scope.toLowerCase()}-${day}.json`;
    a.click();
    URL.revokeObjectURL(url);
    const n = M.countBookmarks(payload.folders);
    state.dataMsg = {
      ok: true,
      text: all
        ? `已匯出完整備份:${n} 個書籤、${state.history.length} 筆歷史,含目前設定`
        : `已匯出 ${scope === 'Poe2' ? 'PoE2' : 'PoE1'} 書籤 ${n} 個(不含設定與歷史;匯入時是附加)`,
    };
    if (!all && !n) {
      state.dataMsg = { ok: false, text: `目前沒有 ${scope === 'Poe2' ? 'PoE2' : 'PoE1'} 的書籤可以匯出` };
    }
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

  // 只加入某一款(一律附加)。
  // ⚠ 不能走「完整備份 = 取代」那條路:取代會把檔案裡沒有的另一款整批刪光,
  //   而且完全無聲(對話框只說「會取代目前內容」,沒人會想到少了另一款)。
  function importOneGame(result, game) {
    const label = game === 'Poe2' ? 'PoE2' : 'PoE1';
    const picked = M.filterFoldersByGame(result.folders, game);
    const n = M.countBookmarks(picked);
    state.pendingImport = null;
    if (!n) {
      state.dataMsg = { ok: false, text: `這個檔裡沒有 ${label} 的書籤` };
      render();
      return;
    }
    applyImport(
      { folders: picked, report: { ...result.report, folders: picked.length, bookmarks: n } },
      `檔案的 ${label} 部分`
    );
  }

  // 完整備份的「還原」:取代目前內容(含設定與歷史)
  function restoreBackup(result) {
    const inFile = M.countByGame(result.folders);
    const when = result.exportedAt ? `(${result.exportedAt.slice(0, 10)} 匯出)` : '';
    confirmDialog({
      title: '還原備份',
      message: `備份${when}裡有 ${result.report.folders} 個資料夾、${result.report.bookmarks} 個書籤`
        + `(PoE1 ${inFile.Poe1}、PoE2 ${inFile.Poe2})、${result.history.length} 筆歷史。\n`
        + `目前的 ${state.data.folders.length} 個資料夾、${M.countBookmarks(state.data.folders)} 個書籤與設定會被取代。\n`
        + '此操作將永久刪除資料。',
      okLabel: '還原',
      onOk: () => {
        state.data = { version: M.VERSION, folders: result.folders };
        state.settings = { ...DEFAULT_SETTINGS, ...result.settings };
        state.history = result.history;
        state.pendingImport = null;
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
  }

  // 匯入的第一步:**先解析,把檔案裡有什麼攤開來**,再讓使用者按對應的鈕。
  // ⚠ 舊做法是「匯入前先選範圍」,那不直觀 —— 開檔之前根本不知道檔案裡有什麼,
  //   只能瞎猜。現在是看著「PoE1 12 個、PoE2 5 個」再決定。
  async function importBackupFile(file) {
    const text = await file.text();
    // Better PathOfExile Trading 的備份是純文字(每行一個資料夾),不是 JSON:
    // 認得出來就走它的解析,一樣進「先攤開再選要加入哪一款」的流程(附加,不取代)
    if (M.looksLikeBetterTrading(text)) {
      try {
        const bt = M.parseBetterTradingBackup(text, { iconIndex: state.iconIndex });
        state.pendingImport = {
          folders: bt.folders,
          report: bt.report,
          isBackup: false,
          exportedAt: '',
          history: [],
          settings: {},
          counts: M.countByGame(bt.folders),
          name: `${file.name}(Better PathOfExile Trading)`,
        };
        state.dataMsg = null;
      } catch (err) {
        state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      }
      render();
      return;
    }
    try {
      const result = M.parseBackupFile(text, {
        iconIndex: state.iconIndex,
        settingsTemplate: DEFAULT_SETTINGS,
        historyMax: HISTORY_MAX,
      });
      if (!result.folders.length) {
        state.dataMsg = { ok: false, text: '這個檔案裡沒有可用的書籤' };
        render();
        return;
      }
      state.pendingImport = {
        ...result,
        counts: M.countByGame(result.folders),
        name: file.name,
      };
      state.dataMsg = null;
      render();
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
    // 貼錯框也沒關係:Better PathOfExile Trading 的碼一眼可辨(每行 3:/2: 前綴 + base64),
    // 認得出來就直接改走它的解析
    if (M.looksLikeBetterTrading(text)) return importBetterTradingCode(text);
    try {
      applyImport(M.parseExtensionCode(text, { iconIndex: state.iconIndex }), 'PoE Trade Extension');
      state.codeBoxOpen = false;
    } catch (err) {
      state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      render();
    }
  }

  // ── 從 Better PathOfExile Trading 匯入 ──
  // 沒有獨立入口(使用者 2026-09-08 裁定:多餘):它的備份走「選擇備份 / 書籤檔」選 .txt,
  // 或貼進 PoE Trade Extension 那個框由 importExtensionCode 自動辨認後轉進來。
  // 格式與對應規則全在 bookmarks-model.js 的 parseBetterTradingBackup。它的書籤沒有聯盟
  // (開啟時用當前聯盟),封存段的資料夾會加「(封存)」並收合。
  function importBetterTradingCode(text) {
    try {
      const result = M.parseBetterTradingBackup(text, { iconIndex: state.iconIndex });
      applyImport(result, 'Better PathOfExile Trading');
      const extra = [];
      if (result.report.archivedFolders) extra.push(`含封存資料夾 ${result.report.archivedFolders} 個(已收合)`);
      if (result.report.badLines.length) extra.push(`略過 ${result.report.badLines.length} 行解不開的內容`);
      if (extra.length && state.dataMsg?.ok) state.dataMsg.text += `\n${extra.join(';')}`;
      state.codeBoxOpen = false;
      render();
    } catch (err) {
      state.dataMsg = { ok: false, text: `匯入失敗:${String(err?.message ?? err)}` };
      render();
    }
  }

  // ── 還是舊短編號的書籤 ──
  // 開過一次就會自己升級(見 adoptSearchId);這裡只把「還有幾個沒開過」
  // 數出來,在設定分頁講一聲。
  //
  // ⚠⚠ **不要改成用 fetch 抓 HTML 來批次轉換。** 2026-09-05 實測:
  //   Cloudflare 對 `Sec-Fetch-Dest: empty` 的 HTML 文件請求一律回
  //   `cf-mitigated: challenge`(403 + 6 KB 的 challenge 頁,裡面沒有 state)——
  //   `fetch` 與 `sandbox="allow-same-origin"` 的 iframe **兩種都被擋**
  //   (sandbox 不執行 JS,過不了 challenge),而且被標記之後不會馬上恢復。
  //   最危險的是它**看起來像「這個編號失效了」** —— 拿 challenge 頁去判定
  //   就會把還好好的舊書籤蓋掉,而舊編號一蓋掉就回不去了。
  //   API 那條路也不通:`GET /api/trade/search/<league>/<id>` 對舊短碼與
  //   新編碼一律 404(端點已移除),沒有任何 API 可以從編號反查查詢。
  //   要批次轉換只剩「真正的頂層導覽」一條路。
  function legacyBookmarks() {
    const out = [];
    for (const folder of state.data.folders) {
      for (const bm of folder.bookmarks) if (M.isLegacySearchId(bm.searchId)) out.push(bm);
    }
    return out;
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
  // 五組(側邊欄 / 顯示 / 資料來源 / 備份與匯入 / 進階),每一列都是「標籤 + 兩段鈕」同款,
  // 不再混用 checkbox(2026-09-08 使用者核准的版面)。
  // 一列兩段鈕:isActive(val) 決定哪一段亮,onPick(val) 負責寫回與副作用。
  // 回傳 seg 容器,讓呼叫端可以在後面再塞按鈕(poe.ninja 的「重新檢查」)。
  function segRow(body, label, options, isActive, onPick) {
    const row = el('div', 'pmz-setting-row');
    row.appendChild(el('span', null, label));
    const seg = el('div', 'pmz-seg');
    for (const [val, text] of options) {
      const btn = el('button', 'pmz-seg-btn', text);
      if (isActive(val)) btn.classList.add('pmz-seg-active');
      btn.addEventListener('click', () => onPick(val));
      seg.appendChild(btn);
    }
    row.appendChild(seg);
    body.appendChild(row);
    return seg;
  }
  const ON_OFF = [[true, '開'], [false, '關']];

  // settings 裡的布林鍵:state.settings 已與 DEFAULT_SETTINGS 合併,必有值;
  // 寫回同一個鍵、同樣 persist,after 是即時生效的副作用(可省)。
  function settingToggle(body, key, label, after) {
    segRow(body, label, ON_OFF,
      (val) => (state.settings[key] !== false) === val,
      (val) => {
        state.settings[key] = val;
        persistSettings();
        after?.();
        render();
      });
  }

  function renderSettings(body) {
    body.appendChild(el('div', 'pmz-hint', '標示 ↻ 的項目需重新整理頁面後生效'));

    // ── 1. 側邊欄 ──
    body.appendChild(el('div', 'pmz-section-title', '側邊欄'));
    segRow(body, '位置', [['left', '左'], ['right', '右']],
      (val) => state.settings.sidebarSide === val,
      (val) => {
        state.settings.sidebarSide = val;
        persistSettings();
        applySide();
        render();
      });
    // 關掉 = 回到舊行為:每次開頁面板都是收合的。開關本身存 settings(偏好),
    // 「上次是開是關」存 sidebarUi(狀態)—— 兩者分開,關掉再打開也不會遺失上次的狀態。
    settingToggle(body, 'keepPanelOpen', '常駐維持展開(換頁後不自動收合)');
    settingToggle(body, 'autoInstantBuyout', '開啟頁面自動將狀態設為「即刻購買」 ↻');

    // ── 2. 顯示 ──
    // 中文化與雙語詞綴:與 popup 共用同一組 storage 鍵,兩邊改都算數。
    // ⚠ 一律從 state 畫,不要在這裡 `chrome.storage.local.get().then(…)` 再 append ——
    //   render 是「清空 body 再重畫」,非同步 append 會在兩次 render 交錯時畫出兩份
    //   (切一次中文化就會多一組「中文化 + 備份與匯入」;2026-08-16 使用者截圖回報)。
    body.appendChild(el('div', 'pmz-section-title', '顯示'));
    segRow(body, '介面與詞綴中文化 ↻', [['zh_tw', '開'], ['us', '關']],
      (val) => state.language === val,
      (val) => {
        state.language = val;
        chrome.storage.local.set({ language: val });
        if (val === 'zh_tw') chrome.runtime.sendMessage({ t: 'translation:build' }).catch(() => {});
        render();
      });
    segRow(body, '結果列附英文原文', ON_OFF,
      (val) => state.bilingualMods === val,
      (val) => {
        state.bilingualMods = val;
        chrome.storage.local.set({ bilingualMods: val });
        render();
      });
    settingToggle(body, 'highlightPseudo', '結果列的偽屬性(合計)詞綴高亮', applyPseudoHighlight); // 即時生效,不必重整
    // 詞綴 ＋/− 按鈕的顯示由 mod-row.js 監聽 storage 的 settings 即時切換,這裡只負責存
    settingToggle(body, 'modFilterButtons', '結果列的詞綴篩選按鈕(＋/−)');

    // ── 3. 資料來源 ──
    body.appendChild(el('div', 'pmz-section-title', '資料來源'));

    // ⚠ 書籤/歷史的遊戲切換已改成**分頁頂部的 PoE1/PoE2 標籤**(依網址自動切),
    //   這裡不再有那個設定 —— 同一件事有兩個入口只會讓人不知道哪個說了算。

    // 聯盟:物價與書籤共用。空字串 = 自動(物價用 poe.ninja 最新、書籤用目前頁面)
    // ⚠ **每款一份**:兩款的聯盟名不同,共用一個欄位會讓另一款開出空搜尋。
    //   這個下拉改的是**目前頁面那一款**的設定,標題也寫清楚是哪一款。
    const LKEY = IS_POE2 ? 'league2' : 'league';
    const LLAST = IS_POE2 ? 'lastLeague2' : 'lastLeague';
    const leagueRow = el('div', 'pmz-setting-row');
    leagueRow.appendChild(el('span', null, `聯盟(${GAME.label})`));
    const leagueSel = el('select', 'pmz-select pmz-select-inline');
    const autoOpt = el('option', null, `自動(目前:${(IS_POE2 ? null : state.ninjaLeagues?.latest) ?? (state.settings[LLAST] || '…')})`);
    autoOpt.value = '';
    leagueSel.appendChild(autoOpt);
    const manual = state.settings[LKEY];
    // 沒授權 poe.ninja 時清單抓不到,至少把目前頁面的聯盟放進去可選。
    // ⚠ poe.ninja 的聯盟清單是 PoE1 的,不要餵給 PoE2 的下拉。
    const known = new Set([
      ...(manual ? [manual] : []),
      ...(IS_POE2 ? [] : (state.ninjaLeagues?.leagues ?? [])),
      ...(state.settings[LLAST] ? [state.settings[LLAST]] : []),
    ]);
    for (const name of known) {
      const opt = el('option', null, name);
      opt.value = name;
      leagueSel.appendChild(opt);
    }
    leagueSel.value = manual || '';
    leagueSel.addEventListener('change', () => {
      state.settings[LKEY] = leagueSel.value;
      persistSettings();
      // 清掉已載入的物價,下次開物價分頁以新聯盟重新載入
      state.prices = { ...state.prices, list: [], at: 0, league: null, error: null };
      render();
    });
    // 沒授權 poe.ninja 就不要白打請求(清單抓不到,下拉維持「自動」)。
    // PoE2 頁面根本不用它的清單,更不必打。
    if (!IS_POE2 && !state.ninjaLeagues && state.ninjaPerm === true) {
      loadNinjaLeagues().then((leagues) => {
        if (leagues && state.tab === 'settings') render(); // 清單到位後補全選項
      });
    }
    leagueRow.appendChild(leagueSel);
    body.appendChild(leagueRow);

    // 物價查詢(poe.ninja 選用權限):開 = 已授權。授權必須在擴充頁面按下(見 background.js),
    // 所以這裡點「開」是去開授權頁;點「關」則由 background 直接收回。
    // ⚠ 只有 PoE1:bg/ninja.js 打的是 `poe.ninja/poe1/api/...`,PoE2 頁面連物價分頁都沒有。
    if (!IS_POE2) {
      const ninjaSeg = segRow(body, '物價查詢(poe.ninja)', ON_OFF,
        (val) => state.ninjaPerm === val,
        async (val) => {
          if (val === state.ninjaPerm) return;
          if (val) {
            // ⚠ 必須是點擊後第一個非同步動作(見 background.js 的 perm:ninja-ask)
            const res = await chrome.runtime.sendMessage({ t: 'perm:ninja-ask' }).catch(() => null);
            applyNinjaAskResult(res);
          } else {
            const res = await chrome.runtime.sendMessage({ t: 'perm:ninja-remove' }).catch(() => null);
            state.ninjaPerm = res?.granted === true;
            state.prices = { ...state.prices, list: [], at: 0, error: null };
          }
          render();
        });
      const recheck = el('button', 'pmz-act', '重新檢查');
      recheck.addEventListener('click', async () => {
        await checkNinjaPermission();
        render();
      });
      ninjaSeg.appendChild(recheck);
      if (state.ninjaPerm === null) checkNinjaPermission().then(() => state.tab === 'settings' && render());
    }

    // ── 4. 備份與匯入 ──
    // ⚠ 直觀優先:匯出是**三顆各自寫清楚做什麼的鈕**(不必先選再按);
    //   匯入是**先開檔、把裡面有什麼攤出來**,再按對應的鈕(開檔前根本不知道有什麼)。
    body.appendChild(el('div', 'pmz-section-title', '備份與匯入'));
    const have = M.countByGame(state.data.folders);

    body.appendChild(el('div', 'pmz-sub-title', '匯出'));
    const expFull = el('button', 'pmz-primary', '完整備份(設定 + 全部書籤 + 歷史)');
    expFull.addEventListener('click', () => exportBackup('all'));
    body.appendChild(expFull);
    const expRow = el('div', 'pmz-btnrow');
    for (const [game, label] of [['Poe1', 'PoE1'], ['Poe2', 'PoE2']]) {
      const n = have[game];
      const btn = el('button', 'pmz-secondary', `只匯出 ${label} 書籤(${n})`);
      btn.disabled = !n;
      btn.addEventListener('click', () => exportBackup(game));
      expRow.appendChild(btn);
    }
    body.appendChild(expRow);
    body.appendChild(el('div', 'pmz-hint',
      // ⚠ 這是 DOM 文字不是 markdown,不要寫 ** ** —— 會原樣顯示成星號
      '完整備份還原時會「取代」目前內容;單款檔只有書籤(不含設定與歷史),匯入時是「附加」。'));

    body.appendChild(el('div', 'pmz-sub-title', '匯入'));
    const pend = state.pendingImport;
    if (pend) {
      // 檔案已經解析好:把內容攤開,讓使用者看著數字決定
      const card = el('div', 'pmz-import-card');
      card.appendChild(el('div', 'pmz-import-name', pend.name));
      const when = pend.exportedAt ? `,${pend.exportedAt.slice(0, 10)} 匯出` : '';
      card.appendChild(el('div', 'pmz-hint',
        `${pend.isBackup ? '完整備份' : '書籤檔'}${when}:`
        + `PoE1 ${pend.counts.Poe1} 個、PoE2 ${pend.counts.Poe2} 個書籤`
        + (pend.isBackup ? `、${pend.history.length} 筆歷史` : '')));
      const acts = el('div', 'pmz-btnrow');
      for (const [game, label] of [['Poe1', 'PoE1'], ['Poe2', 'PoE2']]) {
        const btn = el('button', 'pmz-primary', `只加入 ${label}(${pend.counts[game]})`);
        btn.disabled = !pend.counts[game];
        btn.addEventListener('click', () => importOneGame(pend, game));
        acts.appendChild(btn);
      }
      card.appendChild(acts);
      const acts2 = el('div', 'pmz-btnrow');
      const addAll = el('button', 'pmz-secondary', '兩款都加入(附加)');
      addAll.addEventListener('click', () => {
        const r = pend;
        state.pendingImport = null;
        applyImport({ folders: r.folders, report: r.report }, '檔案');
      });
      acts2.appendChild(addAll);
      if (pend.isBackup) {
        // 只有完整備份才給「還原」—— 單款檔拿去取代會把另一款刪光,那條路不開
        const restore = el('button', 'pmz-secondary pmz-danger', '還原備份(取代目前內容)');
        restore.addEventListener('click', () => restoreBackup(pend));
        acts2.appendChild(restore);
      }
      const cancel = el('button', 'pmz-secondary', '取消');
      cancel.addEventListener('click', () => {
        state.pendingImport = null;
        render();
      });
      acts2.appendChild(cancel);
      card.appendChild(acts2);
      body.appendChild(card);
    } else {
      const importBtn = el('button', 'pmz-primary', '選擇備份 / 書籤檔…');
      const importInput = el('input');
      importInput.type = 'file';
      importInput.accept = 'application/json,.json,.txt'; // .txt = Better PathOfExile Trading 的備份
      importInput.style.display = 'none'; // 行內樣式,避免官網 CSS 蓋掉 hidden 屬性
      importInput.addEventListener('change', (e) => {
        const file = e.target.files?.[0];
        e.target.value = '';
        if (file) importBackupFile(file);
      });
      importBtn.addEventListener('click', () => importInput.click());
      body.append(importBtn, importInput);
      body.appendChild(el('div', 'pmz-hint', '選好檔案後會先顯示裡面有什麼,再決定要匯入哪些。'));
    }

    // ⚠ **PoB code 匯入是 PoE1 專屬,PoE2 不顯示**(使用者 2026-08-26 裁定)。
    //   它靠 `statIdMap` 反查英文模板拿官方詞綴代碼,還要靠 POB `Data/Mod*.lua` 的
    //   `tradeHashes` + `weightKey` 判 local/global —— PoE2 沒有任何一份對應資料,
    //   硬給只會產出查不到東西的搜尋(而且是 0 筆那種無聲的失敗)。
    const CODE_SOURCES = [
      ['ext', '從 PoE Trade Extension 匯入…',
        '在 PoE Trade Extension 按「匯出設定」(匯出碼會複製到剪貼簿),貼進下面的框。只會讀取書籤,它的其他設定不會被讀取,也不會寫回去。',
        '在這裡貼上匯出碼…', importExtensionCode],
      ['pob', '從 Path of Building code 匯入…',
        '貼上 PoB code(pobb.in、poe.ninja 的 build 頁面都能複製)。會照部位建資料夾:傳奇用「傳奇名 + 基底」搜,稀有用「基底 + 全部詞綴」搜,到交易站再自己取消不要的條件。',
        '在這裡貼上 PoB code…', importPobCode],
    ].filter(([key]) => !(IS_POE2 && key === 'pob'));
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

    // ── 5. 進階 ──
    body.appendChild(el('div', 'pmz-section-title', '進階'));
    // 舊網址(只在真的有舊書籤時才出現)
    const legacy = legacyBookmarks();
    if (legacy.length) {
      body.appendChild(el(
        'div',
        'pmz-hint',
        `還有 ${legacy.length} 個書籤存的是舊的搜尋編號。官網已經不再產生那種編號,` +
          '新網址改把搜尋條件直接寫在裡面。舊書籤目前還開得起來,' +
          '開一次就會自動換成新網址,不用重新存一遍。'
      ));
    }
    // 清除資料:匯入三條路都是「附加」,沒有一鍵歸零的入口;匯入錯一次就得手動刪十幾個資料夾。
    body.appendChild(el('div', 'pmz-hint', '想留底請先按上面的「匯出備份」。搜尋紀錄與設定不受影響。'));
    const clearBtn = el('button', 'pmz-secondary pmz-danger', `清除所有書籤(${M.countBookmarks(state.data.folders)})`);
    clearBtn.disabled = !state.data.folders.length;
    clearBtn.addEventListener('click', clearAllBookmarks);
    body.appendChild(clearBtn);

    if (state.dataMsg) {
      body.appendChild(el('div', state.dataMsg.ok ? 'pmz-ok' : 'pmz-error', state.dataMsg.text));
    }

    // 頁尾只留資料來源;贊助 / Discord 連結已搬到 rail 上(2026-09-08)
    body.appendChild(el('div', 'pmz-credit', '資料來源:GGG 官方 API 與遊戲檔、poe.ninja、poewiki.net'));
  }

  function render() {
    panel.querySelectorAll('.pmz-tab').forEach((t) => {
      t.classList.toggle('pmz-tab-active', t.dataset.tab === state.tab);
    });
    updateRail(); // 面板內切分頁時 rail 的高亮也要跟著走
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
    const { bookmarkData, settings, searchHistory, sidebarEnabled, language, bilingualMods, [UI_KEY]: savedUi } =
      await chrome.storage.local.get([
        'bookmarkData',
        'settings',
        'searchHistory',
        'sidebarEnabled',
        'language',
        'bilingualMods',
        UI_KEY,
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
    // 「常駐維持展開」關掉時完全照舊:收合、書籤分頁
    const keepOpen = state.settings.keepPanelOpen !== false;
    if (keepOpen) state.tab = restoredTab(savedUi);
    rememberLeague();
    adoptSearchId(); // 剛剛是從帶條件的書籤點進來的話,把官方編號記回去(要在第一次 render 之前)
    if (keepOpen && savedUi?.open === true) {
      // 上一頁離開時面板是開的:直接出現在開啟位置,不要每換一頁就滑進來一次。
      // 讀回來的狀態不必再寫回去(save: false),每次開頁都寫一次 storage 是白費。
      panel.classList.add('pmz-no-anim');
      setOpen(true, { save: false });
      // 強制算一次樣式,讓「已開啟」在沒有 transition 的狀態下定案,拿掉 class 後才不會補播。
      // ⚠ 不用 requestAnimationFrame:背景分頁不跑 rAF,class 會一直留著,之後開關都沒動畫。
      void panel.offsetWidth;
      panel.classList.remove('pmz-no-anim');
    }
    // 面板一開始就是開的話,官網內容也要先讓開(setOpen 已套一次);document_end 時官網的
    // .content 可能還沒渲染(Vue 掛載晚於 DOM 解析),仿 PTE 在 window load 再套一次。
    if (document.readyState !== 'complete') {
      window.addEventListener('load', () => applyPageSqueeze(), { once: true });
    }
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
