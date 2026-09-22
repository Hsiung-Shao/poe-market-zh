// 書籤資料模型(純邏輯:不碰 chrome API、不碰 DOM)。
//   · 本擴充的格式 v3:資料夾最多兩層(parentId 指向第一層,不再往下)
//   · 匯入 PoE Trade Extension 的匯出碼(標準 base64 的 {"settings":{…}})
//   · 匯入 PoE Trade Mate 的 v1(扁平)/v2(單層)JSON 與本擴充自己的 v3 JSON
//   · 開啟書籤時的聯盟解析與交易站 URL 組法
//
// ⚠ 使用者裁定(2026-08-14):匯入 PoE Trade Extension 的碼時**只取書籤資料**,
//   它 settings 裡另外 43 個欄位(介面偏好、快捷鍵、監看清單…)一律不讀、不寫,
//   也不提供「匯出成 Extension 碼」——它的匯入是整包覆蓋,回送會清掉對方設定。
//
// 以 UMD 形式輸出:content script(isolated world)掛全域 pmzBookmarks;
// tools/verify-bookmarks.mjs 以 node:vm 載入這同一份出貨檔驗證,不另寫一份實作。
(function (root) {
  'use strict';

  const VERSION = 3;
  // 使用者看得到的字串走 PMZ_I18N(content script 有載 shared/i18n.js);
  // 離線驗證的 vm 沒有它 → 退回中文原文(與改動前逐字相同)。
  // ⚠ 預設名稱(未命名、我的書籤…)會**存進資料**,所以存的是建立當下的介面語言。
  // tools/verify-i18n.mjs 鎖住這裡的中文原文與 i18n 表的 zh 值逐字相同。
  const tr = (key, zh, vars) => {
    const I18N = root.PMZ_I18N;
    if (I18N) return I18N.t(key, vars);
    return vars ? zh.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : zh;
  };
  // 站別:書籤與歷史兩服共用一份(使用者 2026-09-21 裁定),網址用當下的網域組;
  // 但**聯盟名與官方搜尋編號是各服各自的**(台服聯盟是中文),所以要記得出身。
  const SITES = new Set(['intl', 'tw']);
  const scopeFields = (s) => (SITES.has(s?.site) && GAME_VERSIONS.has(s?.poeVersion)
    ? { site: s.site, poeVersion: s.poeVersion }
    : {});
  const siteOf = (origin) => (/(^|[/.])pathofexile\.tw(\/|:|$)/.test(String(origin ?? '')) ? 'tw' : 'intl');
  const DEFAULT_ICON = '📁';
  // 官方 search id 的字元集。3.29.3b 起官網**不再產生 10 碼短編號**,改成把整個查詢
  // gzip 之後以 **base64url** 編碼塞進網址(`H4sI…`,長度隨查詢複雜度變動),
  // 所以字元集必須含 `-` 與 `_`。
  // ⚠ 這一條沒放寬之前,含 `-`/`_` 的新網址存書籤、記歷史會**靜默失敗**,
  //   而且是間歇性的 —— 不含那兩個字元的碼照樣過得去。
  // ⚠ 舊的短編號**仍然開得起來**(官方 server 還認),所以放寬字元集就夠,
  //   不需要、也不可以把舊書籤判成不合法。
  const SEARCH_ID_RE = /^[A-Za-z0-9_-]+$/;
  // 新格式的碼一眼可辨:gzip 的 magic(1f 8b 08)加上空 mtime,
  // 讓 base64 的前四碼固定是 `H4sI`。
  const MODERN_ID_RE = /^H4sI/;
  // 主機版 realm 會在網址的聯盟之前多一段(PC 省略);PoE2 用的是 `poe2` 那一段。
  const PC_REALMS = new Set(['xbox', 'sony']);

  // 舊短編號只有 10 碼,拿來當書籤預設名稱還說得過去;新格式是整個查詢的
  // gzip,動輄一百多個字元 —— 直接當名字會把書籤列撠成一堆亂碼。
  function defaultName(searchId) {
    if (!searchId) return tr('bm.customSearch', '自訂搜尋');
    return searchId.length <= 24 ? searchId : tr('bm.searchQuery', '搜尋條件');
  }

  // 舊格式(官方短編號):還開得起來,但它的查詢內容只存在官方 server 上,
  // 一旦 GGG 清掉舊資料就**不可逆地遺失**(沒有任何 API 可以從編號反查查詢)。
  // 所以開過一次就把網址升級成新格式,把查詢內容搬到使用者自己手上。
  function isLegacySearchId(searchId) {
    return typeof searchId === 'string' && searchId !== '' && !MODERN_ID_RE.test(searchId);
  }
  const TYPES = new Set(['search', 'exchange']);
  const GAME_VERSIONS = new Set(['Poe1', 'Poe2']);
  // PoE Trade Extension 的 icon 欄位是列舉字串(不是圖檔位址)。這幾個列舉值指的是
  // 通貨圖示,對到 data/icons.json 的官方英文名;其餘(PoE1/TFT/各種 Stash)本擴充
  // 沒有對應圖,一律落預設符號並在匯入報告列出,不做沒有根據的猜測對映。
  const EXT_ICON_ALIAS = {
    Chaos1: 'Chaos Orb',
    Chaos2: 'Chaos Orb',
    Divine1: 'Divine Orb',
    Divine2: 'Divine Orb',
  };

  let seq = 0;
  function newId(prefix) {
    seq = (seq + 1) % 1e6;
    return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}-${Math.random().toString(36).slice(2, 6)}`;
  }

  // scope = { site, poeVersion }:這個資料夾是在哪個空間建的(國際服/台服 × PoE1/PoE2,
  // 使用者 2026-09-23 裁定四個空間互不相見)。只決定**空資料夾**顯示在哪;有書籤的資料夾
  // 跟著書籤走。沒給 = 不綁空間(匯入、舊資料),欄位就不寫,舊版讀到也不受影響。
  function newFolder(name, icon, parentId, scope) {
    return {
      id: newId('fd'),
      name: String(name ?? '').trim() || tr('bm.untitled', '未命名'),
      icon: icon || DEFAULT_ICON,
      parentId: parentId ?? null,
      collapsed: false,
      ...scopeFields(scope),
      bookmarks: [],
    };
  }

  // ── 單筆書籤的補齊與檢查 ──
  // searchId 是唯一不可缺的欄位(沒有它連網址都組不出來),缺或不合法就丟棄並回報。
  function sanitizeBookmark(raw) {
    if (!raw || typeof raw !== 'object') return null;
    const searchId = String(raw.searchId ?? raw.endpoint ?? '').trim();
    // 兩種書籤:存官方搜尋編號的,和存查詢條件的(PoB 匯入產生的,見 pob-import.js)。
    // 至少要有一個,不然連網址都組不出來。
    const query = raw.query && typeof raw.query === 'object' && raw.query.query ? raw.query : null;
    if (!SEARCH_ID_RE.test(searchId) && !query) return null;
    if (!SEARCH_ID_RE.test(searchId) && query) {
      // 帶條件的書籤第一次開啟時,官網會把 ?q= 換成一個官方搜尋編號;把它記下來,
      // 下次就不必再讓官網重建一次搜尋(那一趟往返就是「點下去很慢」的來源)。
      const cached = String(raw.cachedSearchId ?? '').trim();
      return {
        id: typeof raw.id === 'string' && raw.id ? raw.id : newId('bm'),
        name: String(raw.name ?? '').trim() || tr('bm.customSearch', '自訂搜尋'),
        searchId: '',
        query,
        cachedSearchId: SEARCH_ID_RE.test(cached) ? cached : '',
        cachedLeague: typeof raw.cachedLeague === 'string' ? raw.cachedLeague : '',
        // 快取的編號是在哪一服建的(另一服不認得那個編號)。舊資料沒有這欄 = 國際服
        cachedSite: SITES.has(raw.cachedSite) ? raw.cachedSite : 'intl',
        site: SITES.has(raw.site) ? raw.site : 'intl',
        league: typeof raw.league === 'string' && raw.league && raw.league !== 'Auto' ? raw.league : null,
        type: TYPES.has(raw.type) ? raw.type : 'search',
        poeVersion: GAME_VERSIONS.has(raw.poeVersion) ? raw.poeVersion : 'Poe1',
        pinned: raw.pinned === true,
        isDone: raw.isDone === true,
        createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
      };
    }
    const league = typeof raw.league === 'string' && raw.league && raw.league !== 'Auto' ? raw.league : null;
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : newId('bm'),
      name: String(raw.name ?? '').trim() || defaultName(searchId),
      searchId,
      league, // null = 開啟時才決定(Extension 的 "Auto")
      // 建立時所在的站。只影響「書籤自己存的聯盟」能不能用(見 resolveLeague);舊資料 = 國際服
      site: SITES.has(raw.site) ? raw.site : 'intl',
      realm: PC_REALMS.has(raw.realm) ? raw.realm : '',
      type: TYPES.has(raw.type) ? raw.type : 'search',
      poeVersion: GAME_VERSIONS.has(raw.poeVersion) ? raw.poeVersion : 'Poe1',
      pinned: raw.pinned === true,
      isDone: raw.isDone === true, // 只保存不顯示,免得匯入即丟資料
      createdAt: Number.isFinite(raw.createdAt) ? raw.createdAt : Date.now(),
    };
  }

  // ── 資料夾清單的正規化 ──
  // 保留既有 id(storage 讀回來時 id 不能變,否則拖曳/刪除會對錯目標)。
  // 三件事:補齊缺欄位、孤兒 parentId 提升為第一層、超過兩層的壓回第二層。
  function normalizeFolders(list) {
    const src = Array.isArray(list) ? list.filter((f) => f && typeof f === 'object') : [];
    const folders = src.map((f) => {
      const dropped = [];
      const bookmarks = [];
      for (const b of Array.isArray(f.bookmarks) ? f.bookmarks : []) {
        const clean = sanitizeBookmark(b);
        if (clean) bookmarks.push(clean);
        else dropped.push(b);
      }
      return {
        id: typeof f.id === 'string' && f.id ? f.id : newId('fd'),
        name: String(f.name ?? '').trim() || tr('bm.untitled', '未命名'),
        icon: f.icon || DEFAULT_ICON,
        parentId: typeof f.parentId === 'string' && f.parentId ? f.parentId : null,
        collapsed: f.collapsed === true,
        ...scopeFields(f),
        bookmarks,
        _dropped: dropped.length,
      };
    });

    const byId = new Map(folders.map((f) => [f.id, f]));
    for (const f of folders) {
      if (!f.parentId) continue;
      if (f.parentId === f.id || !byId.has(f.parentId)) {
        f.parentId = null; // 孤兒:父不存在(或指向自己)就提升為第一層
        continue;
      }
      // 兩層封頂:父自己還有父時,接到祖父那一層去。沿著鏈往上走,
      // 步數以資料夾總數為上限,壞資料形成的環也不會卡住。
      let guard = folders.length;
      while (guard-- > 0) {
        const parent = byId.get(f.parentId);
        if (!parent || !parent.parentId) break;
        if (parent.parentId === f.id) {
          f.parentId = null; // 互為父子的環:斷開
          break;
        }
        f.parentId = parent.parentId;
      }
    }
    for (const f of folders) delete f._dropped;
    return folders;
  }

  // 任何來源(storage、匯入檔)都先過這裡 → 一律得到 v3
  function migrate(data) {
    if (Array.isArray(data?.folders)) return { version: VERSION, folders: normalizeFolders(data.folders) };
    if (Array.isArray(data?.bookmarks)) {
      // PoE Trade Mate v1:扁平書籤清單,包成一個資料夾
      const folder = newFolder(tr('bm.myBookmarks', '我的書籤'), DEFAULT_ICON, null);
      folder.bookmarks = data.bookmarks.map(sanitizeBookmark).filter(Boolean);
      return { version: VERSION, folders: [folder] };
    }
    return { version: VERSION, folders: [] };
  }

  // ── 走訪序 ──
  // 第一層照陣列順序,每個第一層後面緊接它的子資料夾(同樣照陣列順序)。
  // ⚠ 刻意不讀 PoE Trade Extension 的 index / idx:實測那兩欄有重複也有跳號
  //   (23 個資料夾裡 index 22、24 各出現兩次;書籤 idx 出現 [21,36,42,42]),
  //   當成排序真值畫面順序會亂跳。
  function orderedFolders(folders, opts) {
    const skipCollapsed = opts?.skipCollapsed === true;
    const list = Array.isArray(folders) ? folders : [];
    const byId = new Map(list.map((f) => [f.id, f]));
    const children = new Map();
    const roots = [];
    for (const f of list) {
      if (f.parentId && byId.has(f.parentId)) {
        if (!children.has(f.parentId)) children.set(f.parentId, []);
        children.get(f.parentId).push(f);
      } else {
        roots.push(f);
      }
    }
    const out = [];
    for (const r of roots) {
      const kids = children.get(r.id) ?? [];
      out.push({ folder: r, depth: 0, childCount: kids.length });
      if (skipCollapsed && r.collapsed) continue;
      for (const c of kids) out.push({ folder: c, depth: 1, childCount: 0 });
    }
    return out;
  }

  function childFolders(folders, parentId) {
    return (Array.isArray(folders) ? folders : []).filter((f) => f.parentId === parentId);
  }

  // ── 資料夾拖放 ──
  // 放置位置由游標落在目標標題列的哪一段決定(與檔案總管、VS Code 同一套):
  //   上緣 → 插到目標前面(同一層)   中間 → 變成目標的子   下緣 → 插到目標後面(同一層)
  // 「拖到第一層資料夾的上/下緣」就等於把子資料夾移出來變獨立,不需要另外的放置區。
  function dropPosition(offsetY, height) {
    const h = Number(height) || 0;
    if (h <= 0) return 'inside';
    const r = Number(offsetY) / h;
    if (r < 0.28) return 'before';
    if (r > 0.72) return 'after';
    return 'inside';
  }

  // 拖曳預覽用的落點判定(2026-09-14 使用者回報「分不清是排到前後還是放進去」後改成讓位預覽)。
  // 只在「放得進去」時才有中段:
  //   目標是子資料夾 → 上半/下半 = 排在它前/後(成為同一個父的子);被拖的底下還有資料夾 → 'invalid'
  //   被拖的底下還有資料夾 → 不能變成子,上半/下半 = 前/後
  //   其餘 → 上緣 before / 中間 inside / 下緣 after;目標底下有展開的子資料夾時下緣也算 inside
  //   (它的「後面」在子資料夾清單的尾巴,游標停在標題上時放到那麼遠的地方反而看不懂;
  //    要排到整組後面,停在下一個資料夾的上緣即可)
  function folderDropZone(offsetY, height, opts) {
    const h = Number(height) || 0;
    const r = h > 0 ? Number(offsetY) / h : 0.5;
    if (opts?.targetIsChild) return opts?.movedHasKids ? 'invalid' : r < 0.5 ? 'before' : 'after';
    if (opts?.movedHasKids) return r < 0.5 ? 'before' : 'after';
    const p = dropPosition(offsetY, height);
    return p === 'after' && opts?.targetHasVisibleKids ? 'inside' : p;
  }

  // 算出「這樣放會變成什麼」,不動資料;不允許時回 { error }
  function planFolderDrop(folders, movedId, targetId, position) {
    const list = Array.isArray(folders) ? folders : [];
    const moved = list.find((f) => f.id === movedId);
    const target = list.find((f) => f.id === targetId);
    if (!moved || !target || moved.id === target.id) return { error: '' }; // 無動作,不必提示
    let parentId;
    if (position === 'inside') {
      // 兩層封頂:目標本身是子資料夾時,「放進去」降級成放在它後面(同一層)
      parentId = target.parentId ? target.parentId : target.id;
    } else {
      parentId = target.parentId ?? null;
    }
    if (parentId === moved.id) return { error: tr('bm.err.selfParent', '不能把資料夾放進自己底下') };
    if (parentId && childFolders(list, moved.id).length) {
      return { error: tr('bm.err.twoLevels', '「{name}」底下還有資料夾,不能再變成子資料夾(最多兩層)', { name: moved.name }) };
    }
    const beforeId = position === 'inside' && parentId === target.id ? null : target.id;
    const after = position === 'after' || (position === 'inside' && parentId === target.parentId);
    return { parentId, beforeId, after };
  }

  // 套用 plan:回傳新的 folders 陣列(不改原陣列)
  function applyFolderDrop(folders, movedId, plan) {
    const list = (Array.isArray(folders) ? folders : []).slice();
    const from = list.findIndex((f) => f.id === movedId);
    if (from < 0 || !plan || plan.error) return list;
    const [moved] = list.splice(from, 1);
    moved.parentId = plan.parentId ?? null;
    if (!plan.beforeId) {
      // 放進某個資料夾:排在它現有子資料夾的最後,走訪序才會緊跟著父
      const kids = list.filter((f) => f.parentId === moved.parentId);
      const anchor = kids.length ? kids[kids.length - 1].id : moved.parentId;
      const at = list.findIndex((f) => f.id === anchor);
      list.splice(at < 0 ? list.length : at + 1, 0, moved);
      return list;
    }
    const to = list.findIndex((f) => f.id === plan.beforeId);
    list.splice(to < 0 ? list.length : to + (plan.after ? 1 : 0), 0, moved);
    return list;
  }

  function countBookmarks(folders) {
    return (Array.isArray(folders) ? folders : []).reduce((n, f) => n + (f.bookmarks?.length ?? 0), 0);
  }

  // 分款計數。匯出/匯入的 UI 要先講清楚「這裡面有幾個 PoE1、幾個 PoE2」,
  // 使用者才不會在不知情的狀況下少匯出一半。
  function countByGame(folders) {
    const out = { Poe1: 0, Poe2: 0 };
    for (const f of Array.isArray(folders) ? folders : []) {
      for (const b of f.bookmarks ?? []) out[b?.poeVersion === 'Poe2' ? 'Poe2' : 'Poe1']++;
    }
    return out;
  }

  // 資料夾自己的書籤數 +(第一層時)子資料夾的書籤數
  function folderTotal(folders, folder) {
    const own = folder?.bookmarks?.length ?? 0;
    if (folder?.parentId) return own;
    return own + childFolders(folders, folder?.id).reduce((n, f) => n + (f.bookmarks?.length ?? 0), 0);
  }

  // ── 匯入 ──
  // 匯入一律重新產生 id:匯入是「附加到現有清單」,沿用來源 id 會和既有資料撞。
  function importFolders(list, opts) {
    const iconIndex = opts?.iconIndex ?? null;
    const src = Array.isArray(list) ? list.filter((f) => f && typeof f === 'object') : [];
    const report = { folders: 0, bookmarks: 0, droppedBookmarks: [], orphanFolders: 0, flattened: 0, unknownIcons: [] };
    const idMap = new Map();
    const folders = [];

    for (const f of src) {
      const folder = newFolder(f.name, DEFAULT_ICON, null);
      const rawIcon = typeof f.icon === 'string' ? f.icon : '';
      if (rawIcon) {
        const mapped = mapExtensionIcon(rawIcon, iconIndex);
        if (mapped) folder.icon = mapped;
        else if (!report.unknownIcons.includes(rawIcon)) report.unknownIcons.push(rawIcon);
      }
      folder.collapsed = f.isOpen === undefined ? f.collapsed === true : f.isOpen !== true;
      for (const b of Array.isArray(f.bookmarks) ? f.bookmarks : []) {
        const clean = sanitizeBookmark({ ...b, id: undefined });
        if (clean) folder.bookmarks.push(clean);
        else report.droppedBookmarks.push({ folder: folder.name, name: String(b?.name ?? tr('bm.noName', '(無名稱)')) });
      }
      if (typeof f.id === 'string' && f.id) idMap.set(f.id, folder.id);
      folders.push({ folder, srcParentId: typeof f.parentId === 'string' ? f.parentId : null });
    }

    for (const { folder, srcParentId } of folders) {
      if (!srcParentId) continue;
      const mapped = idMap.get(srcParentId);
      if (!mapped) {
        report.orphanFolders++; // 父不在這份匯出裡 → 留在第一層
        continue;
      }
      folder.parentId = mapped;
    }

    const out = normalizeFolders(folders.map((x) => x.folder));
    // normalizeFolders 會把孫層壓回第二層,壓了幾個要據實回報
    for (const { folder, srcParentId } of folders) {
      if (!srcParentId) continue;
      const before = idMap.get(srcParentId);
      const after = out.find((f) => f.id === folder.id)?.parentId ?? null;
      if (before && after && before !== after) report.flattened++;
    }
    report.folders = out.length;
    report.bookmarks = countBookmarks(out);
    return { folders: out, report };
  }

  function decodeBase64Utf8(text) {
    const cleaned = String(text ?? '').replace(/\s+/g, '');
    if (!cleaned) throw new Error(tr('bm.err.empty', '沒有內容'));
    // 同時接受標準 base64 與 url-safe 變體(貼上時可能經過網址列)
    const std = cleaned.replace(/-/g, '+').replace(/_/g, '/');
    const padded = std + '='.repeat((4 - (std.length % 4)) % 4);
    if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) throw new Error(tr('bm.err.notBase64', '這段文字不是匯出碼(不是 base64)'));
    const decode = root.atob;
    if (typeof decode !== 'function') throw new Error(tr('bm.err.noBase64', '環境不支援 base64 解碼'));
    const binary = decode(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return new root.TextDecoder('utf-8').decode(bytes);
  }

  // PoE Trade Extension 的「匯出設定」文字(剪貼簿內容)
  function parseExtensionCode(text, opts) {
    const json = decodeBase64Utf8(text);
    let data;
    try {
      data = JSON.parse(json);
    } catch (_) {
      throw new Error(tr('bm.err.codeNotJson', '這段文字不是匯出碼(內容不是 JSON)'));
    }
    const folders = Array.isArray(data?.settings?.folders)
      ? data.settings.folders
      : Array.isArray(data?.folders)
        ? data.folders
        : null;
    if (!folders) throw new Error(tr('bm.err.codeNoBookmarks', '這份匯出碼裡沒有書籤資料'));
    return importFolders(folders, opts);
  }

  // ── 依遊戲過濾(匯出/匯入的「只要某一款」)──
  // game 傳 null / 'all' = 不過濾。書籤沒有 poeVersion 的當 'Poe1'(舊資料的預設)。
  //
  // ⚠ 資料夾空了才丟,**但第一層若還有留下來的子資料夾就必須留著** ——
  //   父被丟掉後子的 parentId 會變孤兒,normalizeFolders 會把它提升到第一層,
  //   兩層結構就走樣了(而且是安靜地走樣)。
  const gameOfBookmark = (b) => (b?.poeVersion === 'Poe2' ? 'Poe2' : 'Poe1');

  function filterFoldersByGame(folders, game) {
    const list = Array.isArray(folders) ? folders : [];
    if (!game || game === 'all') return list.map((f) => ({ ...f, bookmarks: [...(f.bookmarks ?? [])] }));
    const kept = list.map((f) => ({
      ...f,
      bookmarks: (f.bookmarks ?? []).filter((b) => gameOfBookmark(b) === game),
    }));
    const nonEmpty = new Set(kept.filter((f) => f.bookmarks.length).map((f) => f.id));
    // 第二層留下來 → 它的第一層父也要留
    for (const f of kept) {
      if (f.parentId && nonEmpty.has(f.id)) nonEmpty.add(f.parentId);
    }
    return kept.filter((f) => nonEmpty.has(f.id));
  }

  function filterHistoryByGame(history, game) {
    const list = Array.isArray(history) ? history : [];
    if (!game || game === 'all') return [...list];
    return list.filter((h) => gameOfBookmark(h) === game);
  }

  // ── 完整備份 ──
  // 匯出的是「設定 + 書籤 + 歷史」整包,換電腦時一個檔就能還原。
  // 舊的、只有 folders 的檔仍然吃得下(那種是「匯入書籤」= 附加,不是還原)。
  const BACKUP_KIND = 'backup';
  // 分款匯出的檔。**刻意不是 backup** —— 匯入端看到 backup 會走「取代」,
  // 拿一個只有 PoE2 的檔去取代,PoE1 的書籤會整批消失。標成 bookmarks 就會落到
  // parseBookmarkFile 那條路(附加),語意才對。
  const BOOKMARKS_KIND = 'bookmarks';

  function makeBackup({ settings, folders, history, appVersion }) {
    return {
      app: 'poe-market-zh',
      kind: BACKUP_KIND,
      version: VERSION,
      scope: 'all',
      appVersion: appVersion ?? '',
      exportedAt: new Date().toISOString(),
      settings: settings ?? {},
      folders: Array.isArray(folders) ? folders : [],
      history: Array.isArray(history) ? history : [],
    };
  }

  // 只有某一款書籤的匯出檔。**不含設定、不含歷史**:
  // 設定(尤其聯盟)是每款一份的,把 PoE1 的設定塞進 PoE2 的檔只會製造混亂;
  // 歷史屬於「這台機器最近做了什麼」,不是要帶著走的東西。
  function makeBookmarkExport({ folders, game, appVersion }) {
    return {
      app: 'poe-market-zh',
      kind: BOOKMARKS_KIND,
      version: VERSION,
      scope: game === 'Poe2' ? 'Poe2' : 'Poe1',
      appVersion: appVersion ?? '',
      exportedAt: new Date().toISOString(),
      folders: filterFoldersByGame(folders, game),
    };
  }

  // 只收模板裡有、而且型別相符的鍵 —— 匯入的檔案可能是手改過或別版的
  function pickKnown(raw, template) {
    const out = {};
    if (!raw || typeof raw !== 'object') return out;
    for (const [k, v] of Object.entries(template ?? {})) {
      const got = raw[k];
      if (got !== undefined && typeof got === typeof v) out[k] = got;
    }
    return out;
  }

  function sanitizeHistory(list, max) {
    const seen = new Set();
    const out = [];
    for (const h of Array.isArray(list) ? list : []) {
      const searchId = String(h?.searchId ?? '').trim();
      if (!SEARCH_ID_RE.test(searchId) || seen.has(searchId)) continue;
      seen.add(searchId);
      out.push({
        searchId,
        league: typeof h.league === 'string' ? h.league : '',
        type: TYPES.has(h.type) ? h.type : 'search',
        poeVersion: GAME_VERSIONS.has(h.poeVersion) ? h.poeVersion : 'Poe1',
        site: SITES.has(h.site) ? h.site : 'intl',
        name: String(h.name ?? '').trim() || searchId,
        at: Number.isFinite(h.at) ? h.at : Date.now(),
      });
      // 呼叫端一律會傳(sidebar.js 的 HISTORY_MAX),這個預設值只是保險 ——
      // 但兩個數字不一致日後一定會有人踩,改一邊就要改另一邊。
      if (out.length >= (max ?? 20)) break;
    }
    return out;
  }

  // 回 { isBackup, folders, report, settings?, history? }
  function parseBackupFile(text, opts) {
    let data;
    try {
      data = JSON.parse(String(text ?? ''));
    } catch (_) {
      throw new Error(tr('bm.err.fileNotJson', '檔案內容不是 JSON'));
    }
    const isBackup = !!data && typeof data === 'object' && data.kind === BACKUP_KIND && Array.isArray(data.folders);
    if (!isBackup) return { isBackup: false, ...parseBookmarkFile(text, opts) };
    const { folders, report } = importFolders(data.folders, opts);
    return {
      isBackup: true,
      folders,
      report,
      settings: pickKnown(data.settings, opts?.settingsTemplate),
      history: sanitizeHistory(data.history, opts?.historyMax),
      exportedAt: typeof data.exportedAt === 'string' ? data.exportedAt : '',
    };
  }

  // 書籤 JSON 檔(本擴充 v3 / PoE Trade Mate v1、v2)
  function parseBookmarkFile(text, opts) {
    let data;
    try {
      data = JSON.parse(String(text ?? ''));
    } catch (_) {
      throw new Error(tr('bm.err.fileNotJson', '檔案內容不是 JSON'));
    }
    if (Array.isArray(data?.folders)) return importFolders(data.folders, opts);
    if (Array.isArray(data?.bookmarks)) {
      return importFolders([{ name: tr('bm.myBookmarks', '我的書籤'), bookmarks: data.bookmarks }], opts);
    }
    throw new Error(tr('bm.err.fileNoBookmarks', '這個檔案裡沒有書籤資料'));
  }

  // ── 圖示 ──
  // data/icons.json 的名稱有兩種寫法:「中文 (English)」(職業)與純英文(通貨等)。
  // 一律以英文為鍵(語言無關的對接鍵),不用位置對位。
  function buildIconIndex(iconList) {
    const index = new Map();
    for (const section of Array.isArray(iconList) ? iconList : []) {
      for (const item of Array.isArray(section?.icons) ? section.icons : []) {
        const name = String(item?.name ?? '').trim();
        const url = item?.url;
        if (!name || typeof url !== 'string' || !url) continue;
        // ⚠ 只有「中文 (English)」這種才抽括號內的英文;純英文名稱要整個當鍵,
        //   否則「Map (Tier 16)」會被索引成「Tier 16」(2026-08-14 實際踩到)。
        const paren = /[一-鿿]/.test(name) ? name.match(/\(([^()]+)\)\s*$/) : null;
        const key = (paren ? paren[1] : name).trim();
        if (key && !index.has(key)) index.set(key, url); // 同名以先出現的分區為準
      }
    }
    return index;
  }

  function mapExtensionIcon(iconName, iconIndex) {
    const name = String(iconName ?? '').trim();
    if (!name) return null;
    if (/^https?:\/\//.test(name)) return name; // 已經是圖檔位址(本擴充自己的資料)
    // Extension 的 icon 列舉一律是純英數字(Assassin/Chaos1/TFT…);其餘形態
    // (emoji、符號)是 PoE Trade Mate 或本擴充的圖示,本來就能直接顯示,原樣留著。
    if (!/^[A-Za-z0-9]+$/.test(name)) return name;
    const key = EXT_ICON_ALIAS[name] ?? name;
    const url = iconIndex?.get?.(key);
    return typeof url === 'string' && url ? url : null;
  }

  // ── 網址 ──
  // `/trade[2]/{search|exchange}[/{realm}]/{league}[/{code}][/live]`
  // ⚠ realm 段只在**非 PC** 時出現(官網:`"pc" !== realm ? "/" + realm : ""`)。
  //   以前這裡只認 `poe2`,Xbox / Sony 的網址會把 realm 當成聯盟、
  //   聯盟當成 search id,整組錯位 —— 書籤開出來是別的聯盟的空搜尋。
  const TRADE_PATH_RE = /^\/trade(2)?\/(search|exchange)(?:\/(poe2|xbox|sony))?\/([^/]+)(?:\/([^/]+))?/;

  function leagueFromHref(href) {
    try {
      const m = new URL(href).pathname.match(TRADE_PATH_RE);
      return m ? decodeURIComponent(m[4]) : null;
    } catch (_) {
      return null;
    }
  }

  // 目前頁面正開著一個搜尋時,回它的 {league, searchId, type, poeVersion}
  function parseSearchUrl(href) {
    let m = null;
    try {
      m = new URL(href).pathname.match(TRADE_PATH_RE);
    } catch (_) {
      return null;
    }
    if (!m || !m[5]) return null;
    const searchId = decodeURIComponent(m[5]);
    if (!SEARCH_ID_RE.test(searchId)) return null; // 例如 /live 之類的尾段
    const realmSeg = m[3] ?? '';
    return {
      league: decodeURIComponent(m[4]),
      searchId,
      type: m[2],
      // ⚠ `m[3]` 現在也可能是 xbox / sony(PoE1 的主機版),不可以再當成 PoE2 的訊號
      poeVersion: m[1] || realmSeg === 'poe2' ? 'Poe2' : 'Poe1',
      realm: PC_REALMS.has(realmSeg) ? realmSeg : '',
    };
  }

  // ── 以目前的搜尋取代某個書籤的內容 ──
  // 使用者的情境:同一個「找六鏈胸甲」的書籤,條件調過之後想直接蓋回去,
  // 而不是刪掉重存(重存會失去名稱、釘選與在資料夾裡的位置)。
  //
  // 只換「這個書籤指到哪個搜尋」:searchId / type / realm,以及帶條件書籤的
  // query 與 cachedSearchId。**名稱、釘選、id、createdAt、league 一律保留**
  // (使用者裁定 2026-09-19:書籤名稱是自己取的,換搜尋不該連名字一起換)。
  //
  // ⚠ 回傳新物件而不是就地改:呼叫端要能在寫進去之前先確認「真的換得成」。
  //   cur 不合法(沒有 search id)時回 null,呼叫端維持原狀並報錯。
  // ⚠ 跨遊戲不換 —— 在 PoE1 頁面把 PoE2 書籤蓋成 PoE1 的搜尋,那個書籤就再也
  //   開不出東西了。poeVersion 不同時直接回 null,由呼叫端在 UI 上先擋掉。
  function replaceBookmarkSearch(bookmark, cur) {
    if (!bookmark || !cur || !SEARCH_ID_RE.test(String(cur.searchId ?? ''))) return null;
    if ((bookmark.poeVersion ?? 'Poe1') !== (cur.poeVersion ?? 'Poe1')) return null;
    const next = sanitizeBookmark({
      ...bookmark,
      searchId: cur.searchId,
      type: cur.type,
      realm: cur.realm,
      // 帶條件的書籤換成官方搜尋編號之後,那兩個欄位就沒有意義了(留著會讓
      // buildTradeUrl 繼續走 ?q= 那條路,等於沒換)
      query: null,
      cachedSearchId: '',
      cachedLeague: '',
    });
    // 名稱有可能是 sanitizeBookmark 依 searchId 補的預設值;原本有名字就留原本的
    if (next && bookmark.name) next.name = bookmark.name;
    return next;
  }

  // 書籤存的是與聯盟無關的 search id,所以換季後舊書籤照樣能開。
  // 順序:**設定的聯盟** → 書籤自己存的 → 目前頁面 → 上次看到的 → Standard
  // 設定的聯盟排最前面是使用者裁定的(2026-08-14):書籤的聯盟由「聯盟」設定
  // 統一決定,書籤列不再有「自動/固定」切換鈕。書籤自己的 league 仍然保存
  // (從 PoE Trade Extension 匯入的固定聯盟不會被丟掉),只在設定為「自動」時才用。
  //
  // ⚠ 跨服(2026-09-21):書籤兩服共用,但**聯盟名是各服各自的**(台服是中文「亡焰咒海」)。
  //   書籤自己存的聯盟只在「書籤出身的站 === 現在的站」時才採用,否則國際服的書籤到
  //   台服會開到一個不存在的聯盟、而且完全無聲。settingLeague / lastLeague 由呼叫端
  //   給**現在這個站**的那一份。`opts.site` 沒給 = 國際服(舊呼叫端的行為不變)。
  function resolveLeague(bookmark, href, opts) {
    const o = typeof opts === 'string' ? { lastLeague: opts } : (opts ?? {});
    const here = SITES.has(o.site) ? o.site : 'intl';
    const own = bookmark?.league && (bookmark.site ?? 'intl') === here ? bookmark.league : null;
    return o.settingLeague || own || leagueFromHref(href) || o.lastLeague || 'Standard';
  }

  function buildTradeUrl(origin, bookmark, league) {
    const type = TYPES.has(bookmark?.type) ? bookmark.type : 'search';
    const lg = encodeURIComponent(league || 'Standard');
    // 主機版 realm 要原樣還原,否則 Xbox / Sony 的書籤會開到 PC 的市場。
    const realm = PC_REALMS.has(bookmark?.realm) ? `/${bookmark.realm}` : '';
    const base = bookmark?.poeVersion === 'Poe2'
      ? `${origin}/trade2/${type}/poe2/${lg}`
      : `${origin}/trade/${type}${realm}/${lg}`;
    // 存查詢條件的書籤:官網吃 ?q=<url-encoded JSON>,會自己建立搜尋並換上 search id
    if (!bookmark?.searchId && bookmark?.query) {
      // 上次開過而且還是同一個聯盟 → 直接用記下來的編號,省掉「重建搜尋」那一趟
      // ⚠ 編號是某一服建的,另一服不認得 → 站不同就退回 ?q= 重建
      if (bookmark.cachedSearchId && bookmark.cachedLeague === (league || 'Standard')
        && (bookmark.cachedSite ?? 'intl') === siteOf(origin)) {
        return `${base}/${encodeURIComponent(bookmark.cachedSearchId)}`;
      }
      return `${base}?q=${encodeURIComponent(JSON.stringify(bookmark.query))}`;
    }
    return `${base}/${encodeURIComponent(String(bookmark?.searchId ?? ''))}`;
  }

  // 開啟書籤之後,官網把網址換成正式編號的那一刻,要對這筆書籤做什麼?
  //
  // 抽成純函式的理由:這是**會改寫使用者資料**的判斷(舊編號一蓋掉就回不去),
  // 而 sidebar.js 那一層混著 DOM 與 chrome API,離線測不到。判斷放這裡,
  // sidebar 只負責把結果寫回去。
  //
  // 回 null = 什麼都不做;否則回
  //   { kind: 'cache',   searchId, league, site }  帶條件的書籤:記下官網建好的編號(與建在哪一服)
  //   { kind: 'upgrade', searchId, name   }  舊短編號:換成新格式網址
  //   { kind: 'wait' }                        官網還沒把網址換成新格式,這一轪先別動
  //
  // ⚠⚠ `wait` 不是裝飾用的。呼叫端把 `null` 當成「處理完了」而把 pending 清掉,
  //   而升級靠的就是 pending —— 在官網 replaceState **之前**跑的那一次如果回 null,
  //   pending 就死在那裡,等網址真的換成新格式時已經沒東西可以對應,
  //   升級永遠不會發生(329.5.1 就是這樣壞的)。
  // `site` = 現在這一頁的站(沒給 = 國際服)。
  function planSearchIdAdoption(bookmark, currentSearchId, pendingLeague, site) {
    const cur = String(currentSearchId ?? '').trim();
    if (!bookmark || !SEARCH_ID_RE.test(cur)) return null;
    const here = SITES.has(site) ? site : 'intl';

    if (!bookmark.searchId && bookmark.query) {
      // 帶條件的書籤:把官網建好的編號記起來,省掉下次那一段往返。
      // 已經是同一個編號、同一個聯盟、同一服就不必再寫一次。
      if (bookmark.cachedSearchId === cur && bookmark.cachedLeague === pendingLeague
        && (bookmark.cachedSite ?? 'intl') === here) return null;
      return { kind: 'cache', searchId: cur, league: pendingLeague ?? '', site: here };
    }

    if (isLegacySearchId(bookmark.searchId) && isLegacySearchId(cur)) {
      // 書籤是舊編號,而當下的網址也還是舊編號 = 官網還沒跑到 replaceState。
      return { kind: 'wait' };
    }

    if (isLegacySearchId(bookmark.searchId) && !isLegacySearchId(cur)) {
      // 舊短編號:官網已經把網址換成新格式(查詢內容就寫在網址裡),收下來。
      // ⚠ 兩個方向都要守:舊→新才升級,新→舊絕不能反向寫回去。
      return {
        kind: 'upgrade',
        searchId: cur,
        // 名字就是舊編號(沒取名字的書籤)的話,留著一串已經不存在的編號只會讓人困惑
        name: bookmark.name === bookmark.searchId ? defaultName(cur) : bookmark.name,
      };
    }

    return null;
  }
  // ── 舊短編號 → 新格式(3.29.3b)──
  // 3.29.3b 之後的網址把整個查詢 gzip 後寫在網址裡,不再依賴官方的短編號。
  // 舊書籤還開得起來(server 還認舊編號),但那份查詢只存在官方主機上:
  // 沒有任何 API 能從編號反查查詢(`GET /api/trade/search/<league>/<id>` 回 404),
  // GGG 哪天清掉舊資料就是**不可逆的資料遺失**。所以要趁還讀得到的時候
  // 把查詢內容搬回使用者自己手上。

  // 交易站的 HTML 裡,server 會把解好的搜尋條件以 `"state":{…}` 注入 inline script。
  // 這裡只做字串層的括號平衡掃描(不用 DOMParser),才能在 node 裡離線驗證。
  // 拿不到就回 null —— 寧可不轉,絕不能拿一個猜的條件去蓋掉使用者的書籤。
  function extractSearchState(html) {
    const s = typeof html === 'string' ? html : '';
    const re = /"state"\s*:\s*\{/g;
    let m;
    while ((m = re.exec(s))) {
      const start = s.indexOf('{', m.index);
      let depth = 0;
      let inStr = null;
      let esc = false;
      for (let i = start; i < s.length; i++) {
        const c = s[i];
        if (inStr) {
          if (esc) esc = false;
          else if (c === '\\') esc = true;
          else if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'") { inStr = c; continue; }
        if (c === '{') depth++;
        else if (c === '}') {
          depth--;
          if (depth > 0) continue;
          try {
            const parsed = JSON.parse(s.slice(start, i + 1));
            if (parsed && typeof parsed === 'object') return parsed;
          } catch (_) { /* 這一段不是我們要的,換下一個 */ }
          break;
        }
      }
    }
    return null;
  }

  // 搜尋條件 → 新格式的編碼。與官網 `stateUrl()` **逐字同一套做法**:
  //   gzip → base64 → `+`→`-`、`/`→`_`、拆掉 `=`。
  // 差一個字元就是一個開不起來的網址,不要自己發明寫法。
  async function encodeSearchQuery(query) {
    const bytes = new TextEncoder().encode(JSON.stringify(query));
    const cs = new CompressionStream('gzip');
    const writer = cs.writable.getWriter();
    writer.write(bytes);
    writer.close();
    const chunks = [];
    const reader = cs.readable.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
    }
    const all = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
    let at = 0;
    for (const c of chunks) { all.set(c, at); at += c.length; }
    // ⚠ 不用 `String.fromCharCode(...all)`:展開幾萬個引數會爆掉呼叫堆疊。
    let bin = '';
    for (const b of all) bin += String.fromCharCode(b);
    return btoa(bin)
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=/g, '');
  }
  // ── Better PathOfExile Trading(fhlinfpmdlijegjlpgedcmglkakaghnk,1.9.2)的備份 / 資料夾匯出碼 ──
  // 格式從該擴充原始碼 services/bookmarks/{export,backup} 逐字確認(2026-09-08):
  //   備份檔 = active 資料夾各一行 + "\n--------------------\n" + archived 資料夾各一行(可空)
  //   資料夾字串:v3 "3:" + base64(UTF-8 JSON);v2 "2:" + base64;v1 無前綴、btoa(Latin1)
  //   JSON { icn: 圖示 slug, tit: 資料夾名, ver: '1'|'2'(v3 才有), trs: [{ tit, loc }] }
  //   loc:v3 "version:type:slug";v1/v2 "type:slug"(version 取資料夾 ver,缺省 '1')
  //   version '1' = PoE1、'2' = PoE2(它組網址時 trade2);type = search / exchange;
  //   slug = 官方搜尋碼(舊短碼或新 gzip 碼,與官網網址那一段一致)。**沒有聯盟、沒有 realm**。
  // 對到本擴充:league null(Auto)、realm ''、poeVersion 由 version 決定。
  const BT_SECTION = '--------------------';
  const BT_LINE_RE = /^(?:[23]:)?[A-Za-z0-9+/=]+$/;
  // 它的圖示 slug → data/icons.json 的英文鍵(iconIndex 的鍵)。icons.json 的 PoE2 分區以
  // 「中文 (PoE2 · English)」命名,鍵就是「PoE2 · English」。
  // 2026-09-23 起那一區的圖改用官方 CDN(通貨)與 poe2wiki(昇華,23 個),由 tools/gen-poe2-icons.mjs 產生;
  // 原本取自 Better Trading(MIT)的 35 張本機檔仍留在 icons/folder/ —— 舊書籤存的是那個路徑。
  // PoE1 的 exalt / mirror / essence / 職業等本擴充沒有對應圖,落預設並列在 unknownIcons,不猜。
  const BT_ICON_MAP = {
    chaos: 'Chaos Orb', divine: 'Divine Orb', map: 'Map (Tier 16)',
    'poe2-acolyte-of-chayula': 'PoE2 · Acolyte of Chayula', 'poe2-amazon': 'PoE2 · Amazon',
    'poe2-blood-mage': 'PoE2 · Blood Mage', 'poe2-chronomancer': 'PoE2 · Chronomancer',
    'poe2-deadeye': 'PoE2 · Deadeye', 'poe2-gemling-legionnaire': 'PoE2 · Gemling Legionnaire',
    'poe2-infernalist': 'PoE2 · Infernalist', 'poe2-invoker': 'PoE2 · Invoker', 'poe2-lich': 'PoE2 · Lich',
    'poe2-pathfinder': 'PoE2 · Pathfinder', 'poe2-ritualist': 'PoE2 · Ritualist',
    'poe2-smith-of-kitava': 'PoE2 · Smith of Kitava', 'poe2-stormweaver': 'PoE2 · Stormweaver',
    'poe2-tactician': 'PoE2 · Tactician', 'poe2-titan': 'PoE2 · Titan', 'poe2-warbringer': 'PoE2 · Warbringer',
    'poe2-witch-hunter': 'PoE2 · Witchhunter',
    'poe2-alchemy': 'PoE2 · Orb of Alchemy', 'poe2-annul': 'PoE2 · Orb of Annulment',
    'poe2-artificer': "PoE2 · Artificer's Orb", 'poe2-augment': 'PoE2 · Orb of Augmentation',
    'poe2-chance': 'PoE2 · Orb of Chance', 'poe2-chaos': 'PoE2 · Chaos Orb', 'poe2-divine': 'PoE2 · Divine Orb',
    'poe2-essence': 'PoE2 · Essence', 'poe2-exalt': 'PoE2 · Exalted Orb', 'poe2-gemcutter': "PoE2 · Gemcutter's Prism",
    'poe2-glassblower': "PoE2 · Glassblower's Bauble", 'poe2-mirror': 'PoE2 · Mirror of Kalandra',
    'poe2-regal': 'PoE2 · Regal Orb', 'poe2-rune': 'PoE2 · Rune', 'poe2-transmute': 'PoE2 · Orb of Transmutation',
    'poe2-vaal': 'PoE2 · Vaal Orb', 'poe2-waystone': 'PoE2 · Waystone', 'poe2-wisdom': 'PoE2 · Scroll of Wisdom',
  };

  // ⚠ 不走 mapExtensionIcon:它把「非純英數」的名稱原樣當成 emoji 圖示回傳,
  //   而 BT 的 slug 帶連字號(poe2-ritualist)、對照後的鍵帶空白(Chaos Orb),
  //   都會被原樣塞進 icon 欄位變成一串文字。這裡只認 iconIndex 查得到的圖檔位址。
  function mapBetterTradingIcon(slug, iconIndex) {
    const s = String(slug ?? '').trim().toLowerCase();
    if (!s) return null;
    const key = BT_ICON_MAP[s] ?? (/^[a-z]+$/.test(s) ? s.charAt(0).toUpperCase() + s.slice(1) : s);
    const url = iconIndex?.get?.(key);
    return typeof url === 'string' && url ? url : null;
  }

  function decodeBetterTradingFolder(line) {
    const text = String(line ?? '').trim();
    const m = /^([23]):(.*)$/.exec(text);
    const version = m ? Number(m[1]) : 1;
    const body = m ? m[2] : text;
    let json;
    try {
      json = decodeBase64Utf8(body);
    } catch (err) {
      if (version !== 1 || typeof root.atob !== 'function') throw err;
      json = root.atob(body.replace(/\s+/g, '')); // v1 是 btoa(Latin1)
    }
    let data;
    try {
      data = JSON.parse(json);
    } catch (_) {
      throw new Error(tr('bm.err.btNotJson', '不是 Better PathOfExile Trading 的資料夾匯出碼(內容不是 JSON)'));
    }
    if (!data || typeof data !== 'object' || !Array.isArray(data.trs)) {
      throw new Error(tr('bm.err.btNoTrs', '不是 Better PathOfExile Trading 的資料夾匯出碼(沒有 trs)'));
    }
    return { version, data };
  }

  // 只看形狀不看內容:任一非空行是「可選 2:/3: 前綴 + base64」且解得出帶 trs 的 JSON。
  function looksLikeBetterTrading(text) {
    const lines = String(text ?? '').split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    if (!lines.length) return false;
    const cand = lines.find((l) => l !== BT_SECTION && BT_LINE_RE.test(l));
    if (!cand) return false;
    try {
      decodeBetterTradingFolder(cand);
      return true;
    } catch (_) {
      return false;
    }
  }

  function betterTradingFolderToRaw({ version, data }, archived, iconIndex, report) {
    const folderVer = String(data.ver ?? '1');
    const bookmarks = [];
    for (const t of data.trs) {
      const loc = String(t?.loc ?? '');
      const parts = loc.split(':');
      let ver, type, slug;
      if (version >= 3 && parts.length >= 3) [ver, type, slug] = [parts[0], parts[1], parts.slice(2).join(':')];
      else [ver, type, slug] = [folderVer, parts[0], parts.slice(1).join(':')];
      bookmarks.push({
        name: String(t?.tit ?? '').trim(),
        searchId: String(slug ?? '').trim(),
        league: null,
        realm: '',
        type: TYPES.has(type) ? type : 'search',
        poeVersion: String(ver) === '2' ? 'Poe2' : 'Poe1',
      });
    }
    const name = String(data.tit ?? '').trim() || tr('bm.untitled', '未命名');
    const rawIcon = String(data.icn ?? '').trim();
    const raw = {
      name: archived ? tr('bm.archived', '{name}(封存)', { name }) : name,
      icon: '',
      collapsed: archived,
      bookmarks,
    };
    if (rawIcon) {
      const mapped = mapBetterTradingIcon(rawIcon, iconIndex);
      if (mapped) raw.icon = mapped;
      else if (!report.unknownIcons.includes(rawIcon)) report.unknownIcons.push(rawIcon);
    }
    return raw;
  }

  /**
   * 解析 Better PathOfExile Trading 的整份備份或單一資料夾匯出碼。
   * 壞掉的行記進 report.badLines 不中止;archived 段的資料夾名加「(封存)」並收合。
   */
  function parseBetterTradingBackup(text, opts) {
    const iconIndex = opts?.iconIndex ?? null;
    const src = String(text ?? '').replace(/\r\n/g, '\n');
    if (!src.trim()) throw new Error(tr('bm.err.empty', '沒有內容'));
    const [activePart, ...rest] = src.split(`\n${BT_SECTION}\n`);
    const archivedPart = rest.join(`\n${BT_SECTION}\n`);
    const pre = { unknownIcons: [] };
    const rawFolders = [];
    const badLines = [];
    let archivedFolders = 0;
    const eat = (part, archived) => {
      part.split('\n').forEach((line, i) => {
        const l = line.trim();
        if (!l || l === BT_SECTION) return;
        try {
          rawFolders.push(betterTradingFolderToRaw(decodeBetterTradingFolder(l), archived, iconIndex, pre));
          if (archived) archivedFolders++;
        } catch (err) {
          badLines.push({ line: i + 1, archived, error: String(err?.message ?? err) });
        }
      });
    };
    eat(activePart, false);
    eat(archivedPart, true);
    if (!rawFolders.length) {
      throw new Error(badLines.length
        ? tr('bm.err.btBad', '這段文字不是 Better PathOfExile Trading 的匯出({error})', { error: badLines[0].error })
        : tr('bm.err.exportNoBookmarks', '這份匯出裡沒有書籤資料'));
    }
    // 圖示已經在上面對照成圖檔位址(或留空),importFolders 對空字串不再處理
    const { folders, report } = importFolders(rawFolders, { iconIndex });
    report.unknownIcons = [...new Set([...pre.unknownIcons, ...report.unknownIcons])];
    report.archivedFolders = archivedFolders;
    report.badLines = badLines;
    return { folders, report };
  }

  const api = {
    VERSION,
    DEFAULT_ICON,
    newId,
    newFolder,
    sanitizeBookmark,
    normalizeFolders,
    migrate,
    orderedFolders,
    childFolders,
    dropPosition,
    folderDropZone,
    planFolderDrop,
    applyFolderDrop,
    countBookmarks,
    countByGame,
    filterFoldersByGame,
    filterHistoryByGame,
    folderTotal,
    importFolders,
    parseExtensionCode,
    parseBetterTradingBackup,
    looksLikeBetterTrading,
    parseBookmarkFile,
    parseBackupFile,
    makeBackup,
    makeBookmarkExport,
    pickKnown,
    sanitizeHistory,
    buildIconIndex,
    mapExtensionIcon,
    leagueFromHref,
    parseSearchUrl,
    replaceBookmarkSearch,
    isLegacySearchId,
    planSearchIdAdoption,
    extractSearchState,
    encodeSearchQuery,
    defaultName,
    siteOf,
    resolveLeague,
    buildTradeUrl,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.pmzBookmarks = api;
})(globalThis);
