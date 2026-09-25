// pobb.in / poe.ninja 中文化(isolated world,document_idle)。
//
// ⚠ 這支**不在 manifest 的 content_scripts 裡**:兩個網站都是選用權限
//   (optional_host_permissions),寫進 manifest 等於新增 host 權限 —— Chrome 會在
//   擴充更新後把整個擴充停用、等使用者手動重新授權。改由 bg/sites.js 在使用者於
//   popup 打開開關並授權後,用 chrome.scripting.registerContentScripts 動態註冊。
//
// 做法:兩站都是前端框架渲染(pobb.in = SolidJS、poe.ninja = React),沒有交易站那種
// data-field 可以拿官方 stat id,只能**以畫面上的英文逐行查表**:
//   1. 名稱(整行完全相同才換):天賦 / 昇華 / 職業 / 角色面板用詞(data/sitenames.json,GGPK)、
//      物品 / 寶石 / 傳奇名(交易站建置好的 itemMap / uniqueMap)、少量網站介面字(SITE_UI)
//   2. 詞綴行:statMap 模板(數值→# 後查表,與 content/results.js 同一套規則)
//   查不到就保留英文(寧缺勿錯);**同一個英文在兩個來源對到不同中文的一律不換**。
//
// 寫回一律「只改既有文字節點的內容、不增刪節點」(與 results.js 同一原則):兩個框架都靠
// 自己的虛擬 DOM 追蹤節點,增刪節點會讓它們的比對錯亂。框架之後把文字改回英文時會觸發
// characterData 變動,這裡再翻一次。關掉開關會把改過的節點逐一還原成原文。

(() => {
  if (globalThis.__pmzSiteZh) return; // 動態註冊 + 重新整理前的舊實例:只跑一次
  globalThis.__pmzSiteZh = true;

  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const HOST = typeof location === 'undefined' ? '' : location.hostname; // 離線測試沒有 location
  const SITE = /(^|\.)pobb\.in$/.test(HOST) ? 'pobbin' : /(^|\.)poe\.ninja$/.test(HOST) ? 'ninja' : null;

  // ── 遊戲別 ──
  // poe.ninja:網址一定帶 /poe1/ 或 /poe2/(兩款的頁面是兩套路由)。
  // pobb.in:同一個網址格式兩款共用,判別靠頁面自己宣告的版本 —— 標題尾巴的 `[3.29]` / `[0.3]`
  //   (PoB 匯出碼的 targetVersion;PoE2 的玩家端版本是 0.x),其次是圖片 CDN 路徑
  //   `assets.pobb.in/1/…`、`/2/…`。兩個訊號都沒有就不翻(不猜)。
  function detectGame(doc = document, loc = location) {
    if (SITE === 'ninja' || /(^|\.)poe\.ninja$/.test(loc.hostname)) {
      const m = /^\/(poe[12])(\/|$)/.exec(loc.pathname);
      return m ? m[1] : null;
    }
    const v = /\[(\d+)\.\d+[^\]]*\]\s*$/.exec(doc.title ?? '');
    if (v) return v[1] === '0' ? 'poe2' : 'poe1';
    const img = doc.querySelector?.('img[src*="assets.pobb.in/"]')?.getAttribute('src') ?? '';
    const a = /assets\.pobb\.in\/([12])\//.exec(img);
    return a ? (a[1] === '2' ? 'poe2' : 'poe1') : null;
  }

  // ── 網站介面字(非遊戲資料)──
  // 只收兩站頁面框架上固定出現、而且**遊戲客戶端有同一個詞**的字;
  // 每一條後面註明 GGPK 出處(clientstrings / characterpaneltabs / itemclasses 的 Id)。
  // 遊戲裡找不到對應詞的一律不收(保留英文),不自己翻。
  const SITE_UI = {
    Equipment: '裝備', // clientstrings.AncestralTrialInventoryTitle
    Gear: '裝備', // clientstrings.AncestralTrialItemTypeGear(英文為 Gear)
    Skills: '技能', // clientstrings.PassiveTreePanelTitle
    Jewels: '珠寶', // clientstrings.PassiveSkillTreePlannerJewelTitle
    Flasks: '藥劑', // clientstrings.TutorialPanelFlasks
    Level: '等級', // clientstrings.Level
    Offence: '攻擊屬性', // characterpaneltabs.Offence
    Defence: '防禦屬性', // characterpaneltabs.Defence
    Resistances: '抗性', // characterpaneltabs.GamepadResistances
    Charges: '充能球', // characterpaneltabs.Charges
    Pantheon: '眾神殿', // clientstrings.PatheonTabName
    Keystones: '關鍵天賦', // clientstrings.PassiveSkillTreePlannerKeystoneTitle
    Quality: '品質', // clientstrings.Quality
    'Item Level': '物品等級', // clientstrings.ItemDisplayStringItemLevel
    'Item Rarity': '物品稀有度', // clientstrings.ItemDisplayMapRarityIncrease
    Corrupted: '已汙染', // clientstrings.ItemPopupCorrupted
    Mirrored: '已複製', // clientstrings.ItemPopupMirrored
    Unidentified: '未鑑定', // clientstrings.ItemPopupUnidentified
    Strength: '力量', // clientstrings.Strength
    Dexterity: '敏捷', // clientstrings.Dexterity
    Intelligence: '智慧', // clientstrings.Intelligence
    'Chance to Block': '格擋率', // clientstrings.ItemDisplayShieldBlockChance
    Currency: '通貨', // itemclasscategories.Currency
    'Divination Cards': '命運卡', // itemclasses.DivinationCard
    Scarabs: '聖甲蟲', // clientstrings.TradeMarketScarabCategory
    Essences: '精髓', // clientstrings.TutorialPanelEssences
    Incubators: '培育器', // itemclasses.Incubator
    'Skill Gems': '技能寶石', // itemclasses.Active Skill Gem
    'Support Gems': '輔助寶石', // itemclasses.Support Skill Gem
    'Unique Flasks': '傳奇藥劑', // clientstrings.FlaskStashFilterUnique
  };

  // ── 翻譯核心(純函式,tools/verify-site-zh.mjs 離線測)──

  const NUM_RE = /\d+(?:\.\d+)?/g;
  const SIGNED_NUM_RE = /-?\d+(?:\.\d+)?/g;
  const CJK_RE = /[㐀-鿿]/;
  const MAX_LEN = 240; // 超過這個長度的一定不是單條詞綴或名稱(備註、說明文)

  // 物品表的值多為「中文 (English)」(交易站下拉用的雙語格式),網站上直接換成純中文
  const stripBilingual = (en, zh) => {
    const s = String(zh ?? '');
    const suffix = ` (${en})`;
    return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
  };

  // sources: { siteNames:{passives,ascendancies,classes,panel}, itemMap, uniqueMap, statMap }
  // 回傳 { names: Map, lower: Map, gems: Map, statMap, conflicts: [] }
  function buildSiteDict(sources) {
    const names = new Map();
    const conflicts = [];
    const dropped = new Set();
    const add = (en, zh, src) => {
      if (!en || !zh || en === zh || dropped.has(en)) return;
      const prev = names.get(en);
      if (prev === undefined) { names.set(en, { zh, src }); return; }
      if (prev.zh === zh) return;
      // 同一個英文、兩個來源兩種中文 → 畫面上分不出是哪一個,不換
      names.delete(en);
      dropped.add(en);
      conflicts.push({ en, a: `${prev.src}:${prev.zh}`, b: `${src}:${zh}` });
    };
    const sn = sources.siteNames ?? {};
    for (const [en, zh] of Object.entries(sn.ascendancies ?? {})) add(en, zh, 'ascendancy');
    for (const [en, zh] of Object.entries(sn.classes ?? {})) add(en, zh, 'class');
    for (const [en, zh] of Object.entries(sn.passives ?? {})) add(en, zh, 'passive');
    for (const [en, zh] of Object.entries(sources.uniqueMap ?? {})) add(en, stripBilingual(en, zh), 'unique');
    const gems = new Map();
    for (const [en, zh] of Object.entries(sources.itemMap ?? {})) {
      const z = stripBilingual(en, zh);
      add(en, z, 'item');
      if (/ Support$/.test(en)) gems.set(en, z);
    }
    // 面板用詞與介面字:大小寫不同也算(poe.ninja 寫 `Energy shield`、遊戲寫 `Energy Shield`)。
    // 只有這兩類放寬,物品與天賦名一律大小寫完全相同才換。
    const lower = new Map();
    const lowerDropped = new Set();
    const addLower = (en, zh) => {
      const k = en.toLowerCase();
      if (lowerDropped.has(k)) return;
      const prev = lower.get(k);
      if (prev !== undefined && prev !== zh) { lower.delete(k); lowerDropped.add(k); return; }
      lower.set(k, zh);
    };
    for (const [en, zh] of Object.entries(sn.panel ?? {})) if (en !== zh) addLower(en, zh);
    // 介面字是人工核對過出處的,優先於面板用詞(同詞不同譯時以它為準)
    for (const [en, zh] of Object.entries(SITE_UI)) { lower.set(en.toLowerCase(), zh); lowerDropped.delete(en.toLowerCase()); }
    const flat = new Map([...names].map(([en, v]) => [en, v.zh]));
    // 職業 / 昇華名(給「Level 100 Warden」這種標題用)。這個位置一定是職業,所以直接取
    // ascendancy / characters 兩張表,不受天賦撞名影響(`Warden` 昇華「守林人」vs 同名天賦「守護者」,
    // 單獨出現時分不出來而不換,放在「Level N」後面就只可能是職業)。兩張表彼此撞名才不收。
    const classNames = new Map();
    for (const [en, zh] of [...Object.entries(sn.ascendancies ?? {}), ...Object.entries(sn.classes ?? {})]) {
      if (classNames.has(en) && classNames.get(en) !== zh) classNames.set(en, null);
      else if (!classNames.has(en)) classNames.set(en, zh);
    }
    for (const [en, zh] of classNames) if (!zh) classNames.delete(en);
    return { names: flat, lower, gems, classNames, statMap: sources.statMap ?? null, statTpl: sn.stats ?? null, conflicts };
  }

  function fillTemplate(zhTpl, nums) {
    let i = 0;
    return zhTpl.replace(/#/g, () => nums[i++] ?? '#');
  }
  const hashCount = (s) => (s.match(/#/g) ?? []).length;

  // 模板裡的「(部分)」是交易站篩選清單的消歧義後綴,物品那一行本來就不印(見 results.js)
  const stripLocalZh = (s) => String(s).replace(/\s*[(（]部分[)）]\s*$/, '');

  // 把一行裡的數字逐一決定「當佔位符(#)還是保留原樣」,列出所有組合。
  // 回傳 [{ key, vals }],vals = 換成 # 的那些數字(依英文順序)。數字太多(> 5)不試。
  function maskedKeys(text) {
    const nums = [...text.matchAll(NUM_RE)];
    if (nums.length > 5) return [];
    const out = [];
    for (let mask = (1 << nums.length) - 1; mask >= 0; mask--) {
      let key = '';
      let last = 0;
      const vals = [];
      nums.forEach((m, i) => {
        const hole = (mask >> i) & 1;
        key += text.slice(last, m.index) + (hole ? '#' : m[0]);
        if (hole) vals.push(m[0]);
        last = m.index + m[0].length;
      });
      out.push({ key: key + text.slice(last), vals });
    }
    return out;
  }

  // ① GGPK 原始模板(data/sitenames.json 的 stats):中文佔位符寫成 {n},n = 英文裡第幾個 #。
  //   只收「多個佔位符」或「含寫死數字」的模板 —— 正是只有 # 的字典會填錯位置的那些。
  function renderOrdered(text, tpl) {
    if (!tpl) return null;
    for (const { key, vals } of maskedKeys(text)) {
      if (!vals.length) continue;
      const zh = tpl[key];
      if (typeof zh === 'string') return zh.replace(/\{(\d+)\}/g, (_m, k) => vals[Number(k)] ?? '');
    }
    return null;
  }

  // ② 交易站 statMap(只有 #,中文照順序填):**只拿來翻 0~1 個數值的行**。
  //   兩個以上的 # 無從得知中文的填入順序(`若你至少配置 # 生命專精,有 #%` 就會把 10 與 6 填反),
  //   那種行只信 ①,① 沒有就保留英文。
  function renderSingle(text, map) {
    for (const re of [NUM_RE, SIGNED_NUM_RE]) {
      const key = text.replace(re, '#');
      if (hashCount(key) > 1) continue;
      const tpl = map[key] ?? map[`${key} (Local)`];
      if (typeof tpl === 'string' && hashCount(tpl) === hashCount(key)) return fillTemplate(stripLocalZh(tpl), text.match(re) ?? []);
    }
    // 多個數字、但只有其中一個是佔位符(其他是寫死的):逐一試保留字面數的鍵
    for (const { key, vals } of maskedKeys(text)) {
      if (vals.length !== 1) continue;
      const tpl = map[key];
      if (typeof tpl === 'string' && hashCount(tpl) === 1) return fillTemplate(stripLocalZh(tpl), vals);
    }
    return null;
  }

  function renderStat(text, map, tpl) {
    const ordered = renderOrdered(text, tpl);
    if (ordered) return ordered;
    if (!map) return null;
    // 整句原樣就是鍵(數字全是寫死的)
    if (typeof map[text] === 'string' && !map[text].includes('#')) return map[text];
    return renderSingle(text, map);
  }

  // 一段文字 → 中文(保留前後空白);查不到回 null
  function translateText(raw, D) {
    const s = String(raw ?? '');
    const t = s.trim().replace(/\s+/g, ' ');
    if (!t || t.length > MAX_LEN || !/[A-Za-z]{2}/.test(t) || CJK_RE.test(t)) return null;
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    const one = (x) => {
      let zh = D.names.get(x) ?? D.lower.get(x.toLowerCase());
      // pobb.in 的寶石列省略「 Support」(`Burning Damage` = 燃燒傷害輔助)。
      // 只從寶石表補,不拿其他來源湊;名稱表本身查得到的優先(同名的主動技能)
      if (!zh) zh = D.gems.get(`${x} Support`);
      if (!zh) zh = renderStat(x, D.statMap, D.statTpl);
      return zh ?? null;
    };
    let zh = one(t);
    // 標籤尾巴的冒號(`Evasion Rating:`)
    if (!zh && /[^:]:$/.test(t)) {
      const z = one(t.slice(0, -1));
      if (z) zh = `${z}:`;
    }
    // 角色標題「Level 100 Chieftain」:後半必須是職業 / 昇華名(不是任意名稱)
    if (!zh) {
      const m = /^Level (\d+) (.+)$/.exec(t);
      const cls = m && D.classNames?.get(m[2]);
      if (cls) zh = `${D.lower.get('level') ?? 'Level'} ${m[1]} ${cls}`;
    }
    // poe.ninja 把幾樣東西用「, 」接成一行:精通的多條效果、物價頁的「傳奇名, 變體, 基底」。
    // 整行查不到才拆;**每一段都要各自查得到**(名稱或完整詞綴;只有數字符號的段落原樣保留,如 `6L`),
    // 缺一段就整行保留英文(不湊半中半英)
    if (!zh && t.includes(', ')) {
      const parts = t.split(', ').map((p) => (/[A-Za-z]{2}/.test(p) ? one(p) : p));
      if (parts.length > 1 && parts.every(Boolean)) zh = parts.join(',');
    }
    return zh ? lead + zh + trail : null;
  }

  globalThis.__pmzSiteZhCore = { detectGame, buildSiteDict, translateText, renderStat, stripBilingual, SITE_UI };
  // 離線測試載入時沒有 chrome / document:只匯出純函式
  if (typeof chrome === 'undefined' || !chrome.storage || !SITE || typeof document === 'undefined') return;

  // ── DOM ──

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION', 'CODE', 'PRE', 'TEMPLATE']);
  const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'FONT', 'U', 'SUP', 'SUB', 'LABEL', 'MARK']);

  const original = new WeakMap(); // 文字節點 → 原文
  const written = new WeakMap(); // 文字節點 → 我們寫進去的字(用來分辨框架改回英文 vs 自己的寫入)
  const touched = []; // WeakRef<Text>,關掉開關時逐一還原
  const titled = []; // WeakRef<Element>,我們加的 title
  let dict = null;
  let dictGame = null;
  let enabled = false;
  const stat = { lines: 0, nodes: 0, restored: 0 };

  function skipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName) || el.isContentEditable) return true;
      if (el.dataset?.pmzNoZh !== undefined) return true;
    }
    return false;
  }

  // 整個元素是不是「一行」:底下只有文字與行內元素、字數不長
  function isLine(el) {
    if (!el || (el.textContent ?? '').length > MAX_LEN) return false;
    for (const c of el.querySelectorAll('*')) if (!INLINE.has(c.tagName)) return false;
    return true;
  }

  // 文字節點所屬的「行」:往上爬到最外層仍是一行的元素(詞綴常被拆成好幾個 span)
  function lineOf(textNode) {
    let el = textNode.parentElement;
    if (!el || !isLine(el)) return null;
    while (INLINE.has(el.tagName) && el.parentElement && isLine(el.parentElement)) el = el.parentElement;
    return el;
  }

  function textNodesIn(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }

  function setText(node, value) {
    if (!original.has(node)) { original.set(node, node.data); touched.push(new WeakRef(node)); }
    written.set(node, value);
    node.data = value;
  }

  function addTitle(el, en) {
    if (!el || el.hasAttribute('title')) return;
    el.setAttribute('title', en);
    el.dataset.pmzZhTitle = '1';
    titled.push(new WeakRef(el));
  }

  // 目前這個節點的「英文原文」:我們寫過的就拿原文,框架改過的就拿現在的
  const englishOf = (n) => (written.get(n) === n.data ? original.get(n) : n.data);

  function translateLine(el) {
    const nodes = textNodesIn(el);
    if (nodes.length < 2) return false; // 單一文字節點走下面逐節點那條即可
    const en = nodes.map(englishOf).join('');
    const zh = translateText(en, dict);
    if (!zh) return false;
    const first = nodes.findIndex((n) => englishOf(n).trim());
    nodes.forEach((n, i) => setText(n, i === first ? zh.trim() : ''));
    addTitle(el, en.trim());
    stat.lines++;
    return true;
  }

  // 這個文字節點所在的「視覺行」裡,除了它自己以外還有沒有別的英文字。
  // 視覺行 = 往上爬出行內元素後,前後兄弟直到遇到區塊元素或 <br> 為止。
  // 有的話就不換這一段:`<span>Cold</span> taken as` 只換 Cold 會變成「冰冷 taken as」,
  // 半中半英比整行英文更難讀(鐵則:不湊半中半英)。旁邊只有數字與符號(`Evasion Rating:` + `103`)照換。
  const isBreak = (n) => n.nodeType === Node.ELEMENT_NODE && !INLINE.has(n.tagName);
  function hasOtherWords(node) {
    let el = node;
    while (el.parentElement && INLINE.has(el.parentElement.tagName)) el = el.parentElement;
    let start = el;
    let end = el;
    while (start.previousSibling && !isBreak(start.previousSibling)) start = start.previousSibling;
    while (end.nextSibling && !isBreak(end.nextSibling)) end = end.nextSibling;
    for (let n = start; n; n = n.nextSibling) {
      if (n !== el) {
        const text = n.nodeType === Node.TEXT_NODE ? englishOf(n) : n.textContent;
        if (/[A-Za-z]{2}/.test(text ?? '')) return true;
      } else if (el !== node) {
        // 同一個行內元素底下的其他文字節點
        for (const t of textNodesIn(el)) if (t !== node && /[A-Za-z]{2}/.test(englishOf(t) ?? '')) return true;
      }
      if (n === end) break;
    }
    return false;
  }

  function translateNode(node) {
    const en = englishOf(node);
    if (written.get(node) === node.data) return; // 已是我們的譯文
    if (hasOtherWords(node)) return;
    const zh = translateText(en, dict);
    if (!zh) return;
    setText(node, zh);
    addTitle(node.parentElement, en.trim());
    stat.nodes++;
  }

  function processTextNodes(nodes) {
    const doneLines = new Set();
    for (const n of nodes) {
      if (!n.isConnected || skipped(n)) continue;
      if (written.get(n) === n.data) continue;
      const line = lineOf(n);
      if (line && !doneLines.has(line)) {
        doneLines.add(line);
        if (translateLine(line)) continue;
      }
      translateNode(n);
    }
  }

  function collectText(root, out) {
    if (root.nodeType === Node.TEXT_NODE) { out.push(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  }

  // ── 批次排程:框架一次塞進一大批節點,合併後才處理 ──
  const pending = new Set();
  let timer = null;
  function schedule(node) {
    pending.add(node);
    if (!timer) timer = setTimeout(flush, 60);
  }
  async function flush() {
    timer = null;
    if (!enabled) { pending.clear(); return; }
    const game = detectGame();
    if (game !== dictGame) {
      // SPA 內切換 PoE1 / PoE2(poe.ninja 頂欄那顆),或 pobb.in 的標題剛渲染出來
      await loadDict(game);
      pending.clear();
      if (dict) { const all = []; collectText(document.body, all); processTextNodes(all); }
      return;
    }
    if (!dict) { pending.clear(); return; }
    const nodes = [];
    for (const p of pending) collectText(p, nodes);
    pending.clear();
    processTextNodes(nodes);
  }

  const observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === 'characterData') {
        // 自己的寫入不理;框架把字改回英文才再翻
        if (written.get(m.target) !== m.target.data) schedule(m.target);
      } else {
        for (const n of m.addedNodes) schedule(n);
      }
    }
  });

  // ── 字典 ──
  const KEYS = {
    poe1: { statMap: 'statMap', itemMap: 'itemMap', uniqueMap: 'uniqueMap' },
    poe2: { statMap: 'statMap2', itemMap: 'itemMap2', uniqueMap: 'uniqueMap2' },
  };
  let buildAsked = false;

  async function loadDict(game) {
    dictGame = game;
    dict = null;
    if (!game) return;
    const K = KEYS[game];
    const got = await chrome.storage.local.get([K.statMap, K.itemMap, K.uniqueMap, 'siteNames']);
    let siteNames = got.siteNames;
    if (!siteNames?.[game]) {
      // 名稱表由背景從擴充內建的 data/sitenames.json 寫進 storage(開關打開時就會做,這裡是保底)
      await chrome.runtime.sendMessage({ t: 'sites:names' }).catch(() => {});
      siteNames = (await chrome.storage.local.get('siteNames')).siteNames;
    }
    if (!got[K.itemMap] && !buildAsked) {
      // 從沒開過這一款的交易站 → 物品與詞綴表還沒建。請背景建一次,建好後 onChanged 會重翻。
      buildAsked = true;
      chrome.runtime.sendMessage({ t: 'translation:build', game }).catch(() => {});
    }
    dict = buildSiteDict({
      siteNames: siteNames?.[game],
      itemMap: got[K.itemMap],
      uniqueMap: got[K.uniqueMap],
      statMap: got[K.statMap],
    });
    dbg(`[PMZ/site] ${SITE} ${game}:名稱 ${dict.names.size}、介面/面板 ${dict.lower.size}、` +
      `詞綴模板 ${Object.keys(dict.statMap ?? {}).length}、同名不同譯不換 ${dict.conflicts.length}`);
  }

  function restoreAll() {
    for (const ref of touched) {
      const n = ref.deref();
      if (!n || !original.has(n)) continue;
      if (written.get(n) === n.data) { n.data = original.get(n); stat.restored++; }
      original.delete(n);
      written.delete(n);
    }
    touched.length = 0;
    for (const ref of titled) {
      const el = ref.deref();
      if (el?.dataset.pmzZhTitle) { el.removeAttribute('title'); delete el.dataset.pmzZhTitle; }
    }
    titled.length = 0;
  }

  async function start() {
    if (enabled) return;
    enabled = true;
    dictGame = undefined; // 強制 flush 重載字典並整頁掃一次
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule(document.body);
  }

  function stop() {
    if (!enabled) return;
    enabled = false;
    observer.disconnect();
    restoreAll();
    dict = null;
    dictGame = null;
  }

  // 開關開著,而且擴充是中文介面 + 翻譯開著(與交易站同一條規則,見 bg/translation.js chineseDataAllowed)
  async function shouldRun() {
    const { siteZh, language, uiLang } = await chrome.storage.local.get(['siteZh', 'language', 'uiLang']);
    const ui = uiLang === 'zh' || uiLang === 'en' ? uiLang : language !== undefined ? 'zh' : undefined;
    return siteZh?.[SITE] === true && ui === 'zh' && (language ?? 'zh_tw') === 'zh_tw';
  }
  const apply = () => shouldRun().then((on) => (on ? start() : stop()))
    .catch((err) => console.warn('[PMZ] 網站中文化初始化失敗:', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.siteZh || changes.language || changes.uiLang) { apply(); return; }
    // 交易站資料建好 / 更新了 → 重載字典再翻一次(已翻的節點會被略過)
    const K = dictGame && KEYS[dictGame];
    if (enabled && K && (changes[K.itemMap] || changes[K.statMap] || changes.siteNames)) {
      dictGame = undefined;
      schedule(document.body);
    }
  });

  window.__pmzSiteZh = () => ({ site: SITE, game: dictGame, ...stat, conflicts: dict?.conflicts ?? [] });

  apply();
})();
