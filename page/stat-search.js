// MAIN world / document_start:下拉搜尋增強。
// 官網 multiselect 下拉(詞綴篩選、物品搜尋等)的內建過濾是「整段連續
// 子字串」比對,兩種常見輸入完全零命中:
//   「移速」「火抗」「最生」  —— 中文簡稱(官方是「增加 #% 移動速度」)
//   「mvspd」「incphys」      —— 英文縮寫
// 本模組在官網原生結果**後面**補上兩種比對:
//   1. token AND —— 含空白的多關鍵字,每個各自命中即可(不限順序連續)
//   2. 子序列模糊 —— 查詢字元依序出現即可,依「命中緊湊度」排序
// 官網原生命中永遠排最前且順序不變,補充項另立群組標籤,不干擾既有習慣。
//
// 作法:focusin 時對 .multiselect 的元件實例做一次性 patch ——
// Vue 2 改寫 _computedWatchers.filteredOptions 的 getter;Vue 3(官網 2026-10 起)
// 改寫內部實例 ctx 上的 filteredOptions getter(見 patchVue3)。同時把每列開頭的
// 類型前綴「(pseudo)」換成中文(translateTypePrefix)。官網改版導致結構不符時
// 兩條路都找不到就靜默不啟用,任何例外都退回原生過濾,不影響其他功能。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const PATCHED = Symbol('ptmTokenAnd');
  // 0.3.x 的「同類詞綴合併選單」曾在這裡加一層摺疊顯示,已隨該功能一併移除
  // (見 CHANGELOG 0.4.0)。

  // 模糊補充的數量上限。實測「ele」這類短查詢會子序列命中 11,785 條,
  // 不設限清單會爆掉;已依分數排序,取前段即可。
  const FUZZY_LIMIT = 60;
  // 補充群組的標題跟著下拉本身的語言:content/bootstrap.js 在 document_start 寫入
  // 'ptm-ui-mode'(交易站中文化開著 = 'zh',English 介面或關掉中文化 = 'en')。
  // 每次組清單時才讀,切換語言重新整理後即生效。
  const extraGroupLabel = () => {
    try {
      return localStorage.getItem('ptm-ui-mode') === 'zh' ? '模糊比對' : 'Fuzzy matches';
    } catch (_) {
      return 'Fuzzy matches';
    }
  };

  // 評分權重。經 17,727 條真實資料網格搜尋得出,改動前務必重跑
  // tools/verify-fuzzy.mjs —— 尤其「起點位置」的權重必須維持 0:中文詞綴
  // 的關鍵字通常在句尾(「增加 #% 移動速度」),fzf 慣用的「起點越前面
  // 越好」在這裡是負作用,加上去會讓「暴率」的正解從第 1 名掉到第 9 名。
  const W_TIGHT = 100;
  const W_LEN = 100;
  const LEN_SAT = 25;

  const CJK_RE = /[㐀-䶿一-鿿豈-﫿]/;

  // 詞綴下拉每列開頭的類型前綴:官網 Vue 3 版的 addStatFilterLabel 直接串英文 type
  // (「(pseudo) …」),不查 `__` 字典,這裡改查。只換開頭那一組括號,英文段的括號不動。
  // ⚠ 只認字典的自有字串屬性:`__.constructor` 之類的原型成員不能被當成譯名。
  function translateTypePrefix(label) {
    if (typeof label !== 'string') return label;
    let dict;
    try {
      if (localStorage.getItem('ptm-ui-mode') !== 'zh') return label;
      dict = window.__;
    } catch (_) {
      return label;
    }
    if (!dict || typeof dict !== 'object') return label;
    return label.replace(/^\(([a-z_]+)\) /, (m, type) =>
      Object.hasOwn(dict, type) && typeof dict[type] === 'string' && dict[type] ? `(${dict[type]}) ` : m);
  }

  function labelOf(ms, opt) {
    if (opt == null) return '';
    if (typeof opt === 'string') return opt;
    try {
      if (typeof ms.customLabel === 'function') return String(ms.customLabel(opt, ms.label) ?? '');
    } catch (_) { /* 官網自訂 label 失敗就退回欄位取值 */ }
    return String(ms.label ? opt[ms.label] ?? '' : opt);
  }

  // 補充層比對用的標籤:畫面上是中文前綴(「偽屬性 冰冷」要找得到),但打英文類型字
  // (「pseudo 冰冷」)也要找得到,所以 full 另外附上原本的英文前綴(官網原生比對的就是英文)
  function segOf(ms, opt) {
    const raw = labelOf(ms, opt);
    const shown = translateTypePrefix(raw);
    const seg = splitLabel(shown);
    if (shown !== raw) seg.full += ` ${raw.slice(0, raw.indexOf(') ') + 1).toLowerCase()}`;
    return seg;
  }

  // label 形如「中文 (English)」(bg/translation.js 的 bilingual())。
  // 中文段與英文段要分開比對:不分段的話中文簡稱會跨到英文段湊出假命中。
  function splitLabel(label) {
    const lc = label.toLowerCase();
    if (!label.endsWith(')')) return { full: lc, zh: '', en: lc };
    // 從尾端做括號配對再切,單純用正則會被巢狀括號打敗 ——
    // 物品下拉真的有「占卜寶珠(致命岩灘) (Scrying Orb (Strand))」這種組合條目
    let depth = 0;
    for (let i = label.length - 1; i >= 0; i--) {
      const c = label[i];
      if (c === ')') { depth++; continue; }
      if (c !== '(') continue;
      if (--depth > 0) continue;
      const zh = i > 1 && label[i - 1] === ' ' ? label.slice(0, i - 1) : '';
      if (zh && CJK_RE.test(zh)) return { full: lc, zh, en: label.slice(i + 1, -1).toLowerCase() };
      break;
    }
    return { full: lc, zh: '', en: lc };
  }

  // labelOf 會呼叫官網的 customLabel,全量掃描要跑上萬次 —— 依 options
  // 陣列身分快取,官網換掉 options(切換下拉種類)時自動失效。
  const segCache = new WeakMap();
  function segsOf(ms, opt) {
    const opts = ms.options;
    if (!opts || typeof opts !== 'object') return segOf(ms, opt);
    let m = segCache.get(opts);
    if (!m) segCache.set(opts, (m = new Map()));
    let seg = m.get(opt);
    if (!seg) m.set(opt, (seg = segOf(ms, opt)));
    return seg;
  }

  // 最緊湊的子序列窗口:forward 求最早的可行結束位置,再 backward 把
  // 起點收緊。單純貪婪 forward 會高估跨距,讓「命中很集中」的條目吃虧。
  // 回傳跨距(越接近查詢長度越好),-1 表示不是子序列。
  function tightMatch(text, q) {
    if (!q) return -1;
    let i = 0;
    let end = -1;
    for (let n = 0; n < q.length; n++) {
      const k = text.indexOf(q[n], i);
      if (k < 0) return -1;
      i = k + 1;
      end = k;
    }
    let j = end;
    let start = end;
    for (let n = q.length - 1; n >= 0; n--) {
      const k = text.lastIndexOf(q[n], j);
      j = k - 1;
      start = k;
    }
    return end - start + 1;
  }

  function fuzzyScore(text, q) {
    if (!text || !q) return null;
    const span = tightMatch(text, q);
    if (span < 0) return null;
    return W_TIGHT * (q.length / span) - W_LEN * Math.min(1, (text.length - q.length) / LEN_SAT);
  }

  // 太短的查詢不啟動模糊:單一字母會子序列命中 17,491/17,727 條,沒有資訊量。
  function qualifies(raw) {
    const s = raw.replace(/\s+/g, '');
    if (!s) return false;
    let cjk = 0;
    for (const ch of s) if (CJK_RE.test(ch)) cjk++;
    return cjk >= 2 || s.length >= 3;
  }

  // 走訪 options(group 與 flat 兩種形狀),對每個選項呼叫 fn
  function eachOption(ms, fn) {
    const opts = ms.options ?? [];
    if (ms.groupValues && ms.groupLabel) {
      for (const g of opts) {
        if (!g || typeof g !== 'object') continue;
        for (const o of g[ms.groupValues] ?? []) fn(o);
      }
      return;
    }
    for (const o of opts) fn(o);
  }

  // 多關鍵字:每個 token 各自是連續子字串即可,不限順序
  function tokenAndPick(ms, tokens) {
    const out = [];
    eachOption(ms, (o) => {
      const seg = segsOf(ms, o);
      if (tokens.every((k) => seg.full.includes(k))) out.push(o);
    });
    return out;
  }

  // 子序列模糊:中文段與英文段各自評分後取較高者,依分數排序後限量
  function fuzzyPick(ms, raw) {
    const q = raw.replace(/\s+/g, '');
    const ql = q.toLowerCase();
    // 含中文的查詢不必掃英文段(英文段不含中文字元,必定不命中),省一半掃描。
    // 反向不成立:中文段裡有 #、%、數字,純 ASCII 查詢仍可能命中中文段。
    const skipEn = CJK_RE.test(q);
    const scored = [];
    eachOption(ms, (o) => {
      const seg = segsOf(ms, o);
      const sZh = seg.zh ? fuzzyScore(seg.zh, q) : null;
      // 只有確定拆成雙語時才敢跳過英文段:沒拆成功的 en 是整條 label,可能含中文
      const sEn = skipEn && seg.zh ? null : fuzzyScore(seg.en, ql);
      if (sZh == null && sEn == null) return;
      scored.push({ o, s: Math.max(sZh ?? -Infinity, sEn ?? -Infinity) });
    });
    scored.sort((a, b) => b.s - a.s);
    return scored.slice(0, FUZZY_LIMIT).map((x) => x.o);
  }

  // 原生結果原封不動排最前,補充項去重後接在尾端的獨立群組下
  function merge(ms, native, extra) {
    const seen = new Set();
    for (const x of native) if (x && !x.$isLabel) seen.add(x);
    const add = [];
    for (const o of extra) {
      if (seen.has(o)) continue;
      seen.add(o);
      add.push(o);
      if (add.length >= FUZZY_LIMIT) break;
    }
    if (!add.length) return native;
    if (ms.groupValues && ms.groupLabel) {
      return [...native, { $groupLabel: extraGroupLabel(), $isLabel: true }, ...add];
    }
    return [...native, ...add];
  }

  // 原生結果後面補上多關鍵字與模糊比對的命中
  function augment(self, native) {
    try {
      const raw = String(self.search ?? '').trim();
      if (!raw) return native;
      const extra = [];
      const tokens = raw.toLowerCase().split(/\s+/).filter(Boolean);
      if (tokens.length >= 2) extra.push(...tokenAndPick(self, tokens));
      if (qualifies(raw)) extra.push(...fuzzyPick(self, raw));
      if (!extra.length) return native;
      const merged = merge(self, native, extra);
      if (merged.length !== native.length) {
        const grouped = !!(self.groupValues && self.groupLabel);
        const added = merged.length - native.length - (grouped ? 1 : 0);
        dbg(`[PTM] 下拉「${raw}」:原生 ${native.length} + 補充 ${added}`);
      }
      return merged;
    } catch (_) {
      return native; // 任何意外退回原生過濾
    }
  }

  // 下拉每列與已選值的顯示文字(vue-multiselect 的 getOptionLabel)套類型前綴中文化
  function wrapOptionLabel(host) {
    const orig = host?.getOptionLabel;
    if (typeof orig !== 'function') return;
    host.getOptionLabel = function (...args) {
      return translateTypePrefix(orig.apply(this, args));
    };
  }

  // Vue 2:改寫 computed watcher 的 getter(Vue 內部以 getter.call(vm, vm) 求值,自帶快取)
  function patchVue2(ms) {
    const w = ms._computedWatchers?.filteredOptions;
    if (!w || typeof w.getter !== 'function') return false;
    const orig = w.getter;
    w.getter = function (vm) {
      const self = vm ?? this;
      return augment(self, orig.call(self, self)); // 原生失敗就照原本行為往外拋
    };
    wrapOptionLabel(ms);
    return true;
  }

  // Vue 3(官網 2026-10 起,實測 3.5.34):computed 定義在內部實例的 ctx 上
  // (`Object.defineProperty(ctx, key, { get })`,configurable),render 經 proxy 讀它。
  // 換掉這個 getter 就等於換掉 filteredOptions;方法(getOptionLabel)同樣掛在 ctx 上。
  // ⚠ 一次渲染會讀 filteredOptions 十幾次(實測 16 次),原生 computed 有快取、我們的補充沒有,
  //   所以以「搜尋字串 + 原生結果陣列」為鍵快取,否則每次讀都重掃上萬條。
  function patchVue3(ms) {
    const ctx = ms.$?.ctx;
    const d = ctx && Object.getOwnPropertyDescriptor(ctx, 'filteredOptions');
    if (!d || typeof d.get !== 'function' || !d.configurable) return false;
    let memo = null;
    Object.defineProperty(ctx, 'filteredOptions', {
      configurable: true,
      enumerable: d.enumerable,
      get() {
        const native = d.get.call(ctx); // 原生失敗就照原本行為往外拋
        const q = String(ms.search ?? '');
        if (memo && memo.native === native && memo.q === q) return memo.out;
        const out = augment(ms, native);
        memo = { native, q, out };
        return out;
      },
      set: d.set,
    });
    wrapOptionLabel(ctx);
    return true;
  }

  function patch(ms) {
    if (!ms || ms[PATCHED]) return;
    if (!patchVue2(ms) && !patchVue3(ms)) return; // 結構不符:靜默不啟用
    ms[PATCHED] = true;
    dbg('[PTM] 下拉:已掛上 filteredOptions(多關鍵字 + 模糊比對)');
    warmLabelCache(ms);
  }

  // .multiselect 元素 → 它的元件實例。Vue 2 有 el.__vue__;Vue 3 production 不在元素上掛反向參照,
  // 改從 window.app 的元件樹找 $el 相同的那個(compat 模式下 $children 仍可用)。
  const vmByEl = new WeakMap();
  function vmOf(root) {
    if (!root) return null;
    if (root.__vue__) return root.__vue__;
    if (vmByEl.has(root)) return vmByEl.get(root);
    let hit = null;
    const seen = new Set();
    const walk = (v, depth) => {
      if (hit || !v || seen.has(v) || depth > 40) return;
      seen.add(v);
      if (v.$el === root) { hit = v; return; }
      for (const c of v.$children ?? []) walk(c, depth + 1);
    };
    try { walk(window.app, 0); } catch (_) { /* 結構不符就當找不到 */ }
    if (hit) vmByEl.set(root, hit);
    return hit;
  }

  // label cache 預熱。
  // segsOf 要呼叫官網自己的 customLabel,全量跑一次 17,727 條要 19–45 ms ——
  // 以前那一次落在**使用者打第一個字的當下**,正好是最不該卡的時機。
  // patch 是在 focusin 掛的(使用者才剛點進輸入框、還沒開始打),趁這個空檔
  // 在閒置時把 cache 建起來,打字時就只剩比對成本。
  // ⚠ 只是預熱,不改變任何行為:cache 沒建好也只是回到原本的當場計算。
  function warmLabelCache(ms) {
    const warm = () => {
      try {
        eachOption(ms, (o) => segsOf(ms, o));
      } catch (_) { /* 預熱失敗不影響搜尋,當場算就是了 */ }
    };
    // ⚠ **排程本身也要包 try**:預熱純粹是優化,不該有任何機會影響 patch 的成敗。
    //   (離線 fixture 的沙箱就沒有 setTimeout —— 那不是測試的問題,是這裡本來
    //    就不該假設宿主環境提供什麼。)
    try {
      if (typeof requestIdleCallback === 'function') requestIdleCallback(warm, { timeout: 2000 });
      else if (typeof setTimeout === 'function') setTimeout(warm, 0);
    } catch (_) { /* 排不進去就當場算,行為不變 */ }
  }

  document.addEventListener(
    'focusin',
    (e) => {
      const input = e.target;
      if (!(input instanceof HTMLElement) || !input.classList.contains('multiselect__input')) return;
      patch(vmOf(input.closest('.multiselect')));
    },
    true
  );

  // 離線驗證用(tools/verify-fuzzy.mjs);不影響官網行為
  if (typeof window !== 'undefined') {
    window.__ptmSearch = { tightMatch, fuzzyScore, qualifies, splitLabel, merge, patch, FUZZY_LIMIT, translateTypePrefix };
  }
})();
