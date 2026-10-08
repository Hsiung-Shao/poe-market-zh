// document_end(isolated,國際服 + 台服、PoE1 + PoE2):篩選列的詞綴階級選單。
//
// 每條詞綴篩選列 MIN 欄左側放一個「≈T▾」,選 T1…Tn 就把該階級的數值填進 MIN
// (「越小越好」的詞綴填 MAX),**不觸發搜尋**。選過的階級寫到 `<html data-pmz-tier-targets>`
// (stat id → 階級),結果列的階級徽章(content/tier-badge.js)據此加上 ✓ / ▼。
//
// ── 資料 ──
// 階級表 `dict:tierladders1.json` / `dict:tierladders2.json`(遠端 dict 分支,bg/tiers.js 依遊戲抓;
// 格式見 tools/gen-tier-ladders.mjs 檔頭)。只有 stat id 與數值,與介面語言、我們的翻譯無關。
//
// ── 與 Vue 的分工 ──
// 看不到 Vue 的是這裡,看得到的是 page/mod-filter.js(MAIN world):它把每一列的 stat id、
// 群組 / 列索引寫成 DOM 屬性(data-pmz-stat-id / -gi / -fi / -gtype),物品類別、基底寫在 <html>;
// 填值則由這裡 postMessage `pmz:setFilterValue` 請它呼叫官網自己的 updateFilter。
// **計算與填值不讀篩選標題文字**(那是我們翻過的中文,關掉翻譯又變英文)—— 全程用 stat id;
// 唯一讀標題的是階級面板的顯示文字(titleOf / tierText,把 # 換成該階範圍),讀不到或對不上只影響顯示。
//
// ── 計算規則(沿用 tierfill 的 compute.mjs 包含模式,github.com/Sknoww/tierfill,MIT License)──
//   一律填該階級的最低數值:MIN = 該階級下限;`Adds # to #` 取兩個下限的平均((loMin+hiMin)/2)
//   反向(inv:越小越好,搜尋值為負):對稱地填 MAX = 該階級上限
//   ⚠ 使用者 2026-10-09 裁定移除「嚴格」模式與「填值方式」設定(舊設定值 tierPickerMode 留在 storage 無害,不再讀)。
//
// ── 不放選單的(寧缺勿錯,尚未實站驗證)──
//   sgn:-1(交易站文字是 negate 變體,搜尋值與階梯值正負相反)、
//   meta.textOnly 裡的 stat(以文字對接,不是 trade_stats 直接給的 id)—— 已用官方語料驗證過的 1 條除外。
//
// ⚠ 非破壞性:控制項插在 `.filter-body` 裡 MIN 前那個 `.sep` 之前(display:table-cell,與官網的
//   `.sep` 同型 —— 實測用 float 會把 MIN/MAX 擠到下一行),Vue 管的節點一個都不增刪。
//   面板裡有選單時,沒有選單的列在同一位置補一格同寬空格(`.pmz-tier-pick-ph`),標題與 MIN/MAX
//   才會上下對齊;功能關掉時選單與空格全部拿掉 —— 見 placeRow / ensurePlaceholder。
(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  // 遊戲別:document_end 可以讀 bootstrap 的 PMZ_GAME,但一定要有自算備援(CLAUDE.md「鍵的分組」)
  const IS_POE2 = (() => {
    const g = globalThis.PMZ_GAME?.id;
    if (g === 'poe2' || g === 'poe1') return g === 'poe2';
    const p = location.pathname;
    return /^\/trade2(\/|$)/.test(p) || /^\/trade\/[^/]+\/poe2(\/|$)/.test(p);
  })();
  const GAME = IS_POE2 ? 'poe2' : 'poe1';
  const CACHE_KEY = `dict:${IS_POE2 ? 'tierladders2.json' : 'tierladders1.json'}`;

  const ATTR = {
    stat: 'data-pmz-stat-id', gi: 'data-pmz-gi', fi: 'data-pmz-fi', gtype: 'data-pmz-gtype',
    cat: 'data-pmz-item-cat', type: 'data-pmz-item-type', cats: 'data-pmz-item-cats',
  };
  const TARGET_ATTR = 'data-pmz-tier-targets'; // 與 content/tier-badge.js 同一個
  const CTRL = 'pmz-tier-pick';
  const HIDE_CLASS = 'pmz-hide-tier-picker'; // <html> 上:使用者關掉選單
  const PANEL_SEL = '.search-advanced-items';
  // meta.textOnly 裡已用官方語料逐條驗證過、可以放選單的 stat
  const VERIFIED_TEXT_ONLY = new Set(['explicit.stat_1509134228']);
  const ATTRS = ['str', 'dex', 'int'];

  // ── 純計算(離線驗證直接呼叫這幾支)──

  const isInt = (x) => Math.abs(x - Math.round(x)) < 1e-9;
  const round2 = (x) => Math.round(x * 100) / 100;
  const fmt = (x) => String(round2(x));

  // 一階 → { lvl, lo, hi, avg, ints, range };lo / hi 是「搜尋值」空間的下限 / 上限
  function tierInfo(t) {
    if (t.length >= 5) {
      const [lvl, a, b, c, d] = t;
      return {
        lvl,
        lo: (Math.min(a, b) + Math.min(c, d)) / 2,
        hi: (Math.max(a, b) + Math.max(c, d)) / 2,
        avg: true,
        ints: [a, b, c, d].every(isInt),
        range: `${fmt(a)}–${fmt(b)} / ${fmt(c)}–${fmt(d)}`,
      };
    }
    const [lvl, a, b] = t;
    return { lvl, lo: Math.min(a, b), hi: Math.max(a, b), avg: false, ints: isInt(a) && isInt(b), range: a === b ? fmt(a) : `${fmt(a)}–${fmt(b)}` };
  }

  // 第 i 階(0 = T1)要填的值 → { bound:'min'|'max', value }:一律該階級的最低數值
  // (一般 = 下限填 MIN;inv 越小越好 = 上限填 MAX)
  function computeValue(tiers, i, inv) {
    const t = tiers?.[i];
    if (!t) return null;
    const me = tierInfo(t);
    return inv ? { bound: 'max', value: round2(me.hi) } : { bound: 'min', value: round2(me.lo) };
  }

  // 不放選單的原因;可以放回 null
  function excludedReason(ladders, statId) {
    const e = ladders?.stats?.[statId];
    if (!e || !Array.isArray(e.fam) || !e.fam.length) return 'none';
    if (e.sgn === -1) return 'sgn';
    if ((ladders.meta?.textOnly ?? []).includes(statId) && !VERIFIED_TEXT_ONLY.has(statId)) return 'textOnly';
    return null;
  }

  // 目前類別下適用的家族(同前後綴 + 同階梯的合併),預設的排第一。
  //   cat:葉類別(armour.chest)→ 只看它;群組類別(armour)→ meta.groups 展開;沒選 → 全部
  //   baseName:搜尋列的基底英文名;葉類別有變體(PoE2 胸甲 / 盾)時用來挑出它那個變體的家族
  // 排序:涵蓋目前範圍內較多葉類別的在前,同數依檔案順序(產生器已依涵蓋基底數排好)
  //   PoE2 職業詞綴家族(f.i = marksman…,要裝符文才會出)一律排在原生家族之後,也不與原生合併
  function familiesFor(ladders, statId, cat, baseName) {
    const entry = ladders?.stats?.[statId];
    if (!entry) return [];
    const meta = ladders.meta ?? {};
    let leaves = null;
    let leaf = null;
    if (cat) {
      if (Array.isArray(meta.groups?.[cat])) leaves = meta.groups[cat];
      else { leaves = [cat]; leaf = cat; }
    }
    let cands = entry.fam
      .map((f, idx) => ({ f, idx, cats: leaves ? f.c.filter((c) => leaves.includes(c)) : f.c.slice() }))
      .filter((x) => x.cats.length);
    if (leaf && baseName) {
      const vmap = meta.variants?.[leaf];
      const keys = vmap ? Object.keys(vmap).filter((k) => (vmap[k] ?? []).includes(baseName)) : [];
      if (keys.length === 1) {
        const hit = cands.filter((x) => !x.f.v?.[leaf] || x.f.v[leaf].includes(keys[0]));
        if (hit.length) cands = hit;
      }
    }
    const merged = [];
    for (const x of cands) {
      const sig = `${x.f.i ? x.f.i + ':' : ''}${x.f.g}${JSON.stringify(x.f.t)}`;
      const vk = leaf ? x.f.v?.[leaf] : null;
      let m = merged.find((y) => y.sig === sig);
      if (!m) {
        m = { sig, g: x.f.g, i: x.f.i ?? null, t: x.f.t, nm: x.f.nm ?? null, cats: [], vkeys: [], anyVariant: false, order: x.idx };
        merged.push(m);
      }
      for (const c of x.cats) if (!m.cats.includes(c)) m.cats.push(c);
      if (leaf) {
        if (!vk) m.anyVariant = true;
        else for (const k of vk) if (!m.vkeys.includes(k)) m.vkeys.push(k);
      }
    }
    merged.sort((a, b) => (a.i ? 1 : 0) - (b.i ? 1 : 0) || b.cats.length - a.cats.length || a.order - b.order);
    return merged;
  }

  // 該類別只有部分基底會出這條(召喚物戒指、PoE2 珠寶…)→ 提示用
  function isPartial(ladders, statId, cat) {
    const meta = ladders?.meta ?? {};
    const leaves = cat ? (Array.isArray(meta.groups?.[cat]) ? meta.groups[cat] : [cat]) : [];
    return leaves.some((l) => (meta.partial?.[l] ?? []).includes(statId));
  }

  // ── 文字 ──
  const state = { lang: 'zh', enabled: true, ladders: null, laddersText: null, bilingual: false }; // bilingual = 交易站「雙語顯示」(面板詞綴名附英文)

  // 字串表在 shared/i18n.js;語言依本擴充自己的介面語言(uiLang),台服站也一樣
  function tr(key, vars) {
    const tables = globalThis.PMZ_I18N?.tables;
    let out = tables?.[state.lang]?.[key] ?? tables?.zh?.[key] ?? key;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return out;
  }

  function variantLabel(key) {
    if (key === '*') return tr('tierpick.var.other');
    const attrs = String(key).split('+')[0].split('_').filter((x) => ATTRS.includes(x));
    return attrs.length ? attrs.map((a) => tr(`tierpick.attr.${a}`)).join('/') : String(key);
  }

  // 家族標籤:只寫出彼此不同的那一項(前後綴 / 類別 / 變體),都一樣就編號;
  // 職業詞綴家族一律在最前面標「射手詞綴」等(不論是否與其他家族不同)
  function familyLabels(fams, catNames = {}) {
    const diffG = new Set(fams.map((f) => f.g)).size > 1;
    const diffC = new Set(fams.map((f) => [...f.cats].sort().join())).size > 1;
    const diffV = new Set(fams.map((f) => (f.anyVariant ? '*all' : [...f.vkeys].sort().join()))).size > 1;
    const sep = tr('tierpick.sep');
    return fams.map((f, i) => {
      const parts = [];
      if (f.i) parts.push(tr(`tierpick.infl.${f.i}`));
      if (diffG) parts.push(tr(f.g === 'S' ? 'tierpick.suffix' : 'tierpick.prefix'));
      if (diffC) {
        const names = f.cats.map((c) => catNames[c] ?? c);
        parts.push(names.length > 3 ? tr('tierpick.more', { list: names.slice(0, 3).join(sep), count: names.length - 3 }) : names.join(sep));
      }
      if (diffV && !f.anyVariant && f.vkeys.length) parts.push([...new Set(f.vkeys.map(variantLabel))].join(sep));
      return parts.join(' · ') || `#${i + 1}`;
    });
  }

  // ── 目標階級(結果列徽章讀)──
  const targets = new Map(); // stat id → { n, sig }(sig = 選的是哪個家族)

  function writeTargets() {
    const html = document.documentElement;
    if (!targets.size) { html.removeAttribute(TARGET_ATTR); return; }
    const obj = {};
    for (const [k, v] of targets) obj[k] = v.n;
    html.setAttribute(TARGET_ATTR, JSON.stringify(obj));
  }

  // ── 填值(請 page/mod-filter.js 代辦)──
  let reqSeq = 0;
  const pending = new Map();
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.t !== 'pmz:setFilterValueDone' || !pending.has(d.reqId)) return;
    pending.get(d.reqId)(d);
    pending.delete(d.reqId);
  });
  function postSet(payload) {
    const reqId = `tp${++reqSeq}`;
    return new Promise((resolve) => {
      const timer = setTimeout(() => { pending.delete(reqId); resolve({ ok: false, why: 'timeout' }); }, 2000);
      pending.set(reqId, (d) => { clearTimeout(timer); resolve(d); });
      window.postMessage({ t: 'pmz:setFilterValue', reqId, ...payload }, location.origin);
    });
  }

  // ── DOM ──
  const ctrlData = new WeakMap(); // 控制項 → { sig, statId, fams, inv }
  let catNamesRaw = '';
  let catNames = {};
  const stat = { inserted: 0, set: 0 };

  function readCatNames() {
    const raw = document.documentElement.getAttribute(ATTR.cats) ?? '';
    if (raw === catNamesRaw) return;
    catNamesRaw = raw;
    try { catNames = raw ? JSON.parse(raw) : {}; } catch (_) { catNames = {}; }
  }

  function buildControl() {
    const ctrl = document.createElement('span');
    ctrl.className = CTRL;
    const label = document.createElement('span');
    label.className = `${CTRL}-label`;
    const sel = document.createElement('select');
    sel.className = `${CTRL}-select`;
    sel.addEventListener('change', () => onPick(ctrl));
    // 點下去不開瀏覽器原生清單,改開階級面板(select 仍是值的來源:面板選一列 = 設 select.value + change)
    sel.addEventListener('mousedown', (e) => { e.preventDefault(); togglePanel(ctrl); });
    sel.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ' || (e.altKey && e.key === 'ArrowDown')) { e.preventDefault(); togglePanel(ctrl); }
    });
    ctrl.append(label, sel);
    return ctrl;
  }

  // ── 階級面板(使用者 2026-10-09 要求:像 poedb 一樣一階一列「T7 敏捷的 2 增加 (4—8)% 閃避值」)──
  // 掛在 document.body(官網 Vue 樹之外)、position:fixed 貼著控制項;T 大的在上、T1 在最下(同 poedb)。
  // 詞綴名稱來自階級表的 nm(GGPK Mods.Name);沒有 nm 的舊階級表就不顯示名稱欄。
  // 完整詞綴文字 = 篩選列標題(只用於顯示,填值仍只靠 stat id 與階級表)把 # 依序換成該階範圍;
  // # 的數目對不上就只顯示範圍,不硬湊。
  const PANEL = `${CTRL}-panel`;
  let openPanel = null; // { el, ctrl }

  // 篩選列標題的純文字。實站(2026-10-09 e2e):
  //   <div class="filter-title"><i class="mutate-type …">隨機屬性</i> <span>+# 最大生命 (+# to maximum Life)</span></div>
  // → 只取 <span>(不要前面的詞綴類型標記),拿掉我們自己掛的節點,再去掉翻譯附的「 (英文原文)」
  function titleOf(row) {
    const t = row?.querySelector(':scope > .filter-body > .filter-title') ?? row?.querySelector('.filter-title');
    if (!t) return '';
    const src = t.querySelector('span') ?? t;
    const c = src.cloneNode(true);
    for (const el of c.querySelectorAll('[class*="ptm-"], [class*="pmz-"], .mutate-type')) el.remove();
    let s = c.textContent.replace(/\s+/g, ' ').trim();
    const m = /^(.*[㐀-鿿].*?) \(([^()㐀-鿿]*[A-Za-z][^()㐀-鿿]*)\)$/.exec(s);
    if (m) s = m[1];
    return s;
  }
  const rangeText = (a, b) => (a === b ? fmt(a) : `(${fmt(a)}—${fmt(b)})`);
  // 一階的完整詞綴文字;title 的 # 數與該階的數值段數相同才換,否則回 null(呼叫端改顯示範圍)
  function tierText(title, t) {
    const segs = t.length >= 5 ? [rangeText(t[1], t[2]), rangeText(t[3], t[4])] : [rangeText(t[1], t[2])];
    const holes = (String(title).match(/#/g) ?? []).length;
    if (!title || holes !== segs.length) return null;
    let i = 0;
    return title.replace(/#/g, () => segs[i++]);
  }

  function closePanel() {
    if (!openPanel) return;
    openPanel.el.remove();
    openPanel = null;
    document.removeEventListener('mousedown', onDocDown, true);
    document.removeEventListener('keydown', onDocKey, true);
    window.removeEventListener('resize', closePanel);
    window.removeEventListener('scroll', onScroll, true);
  }
  const onDocDown = (e) => {
    if (!openPanel) return;
    if (openPanel.el.contains(e.target) || openPanel.ctrl.contains(e.target)) return;
    closePanel();
  };
  const onDocKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); closePanel(); } };
  const onScroll = (e) => { if (openPanel && !openPanel.el.contains(e.target)) closePanel(); };

  function togglePanel(ctrl) {
    if (openPanel?.ctrl === ctrl) { closePanel(); return; }
    closePanel();
    const d = ctrlData.get(ctrl);
    const sel = ctrl.querySelector('select');
    if (!d || !sel) return;
    const title = titleOf(ctrl.closest(`[${ATTR.stat}]`));
    const el = document.createElement('div');
    el.className = PANEL;
    el.setAttribute('role', 'listbox');
    const head = document.createElement('div');
    head.className = `${PANEL}-head`;
    const ht = document.createElement('span');
    ht.textContent = title || tr('tierpick.panel.title');
    const x = document.createElement('button');
    x.type = 'button';
    x.className = `${PANEL}-close`;
    x.textContent = '×';
    x.title = tr('tierpick.panel.close');
    x.addEventListener('click', closePanel);
    head.append(ht, x);
    el.appendChild(head);
    const choose = (value) => {
      closePanel();
      if (sel.value === value) return;
      sel.value = value;
      sel.dispatchEvent(new Event('change'));
    };
    const addRow = (value, cells, cls = '') => {
      const r = document.createElement('div');
      r.className = `${PANEL}-row${cls}${sel.value === value ? ` ${PANEL}-on` : ''}`;
      r.setAttribute('role', 'option');
      r.setAttribute('data-value', value);
      for (const [c, content] of cells) {
        const s = document.createElement('span');
        s.className = `${PANEL}-${c}`;
        if (Array.isArray(content)) s.append(...content); else s.textContent = content;
        r.appendChild(s);
      }
      r.addEventListener('click', () => choose(value));
      el.appendChild(r);
    };
    addRow('', [['none', tr('tierpick.none')]], ` ${PANEL}-none-row`);
    const labels = familyLabels(d.fams, catNames);
    d.fams.forEach((f, fi) => {
      if (d.fams.length > 1) {
        const g = document.createElement('div');
        g.className = `${PANEL}-group`;
        g.textContent = labels[fi];
        el.appendChild(g);
      }
      // T 大的在上、T1 在最下(poedb 同序)
      for (let ti = f.t.length - 1; ti >= 0; ti--) {
        const t = f.t[ti];
        const nm = f.nm?.[ti];
        const name = [];
        if (nm) {
          const zh = document.createElement('span');
          zh.textContent = (state.lang === 'en' ? nm[0] : nm[1] ?? nm[0]) ?? '';
          name.push(zh);
          if (state.lang !== 'en' && state.bilingual && nm[1]) {
            const en = document.createElement('span');
            en.className = `${PANEL}-en`;
            en.textContent = nm[0];
            name.push(en);
          }
        }
        addRow(`${fi}:${ti}`, [
          ['t', `T${ti + 1}`],
          ...(d.fams.some((ff) => ff.nm) ? [['name', name]] : []),
          ['lvl', String(t[0])],
          ['text', tierText(title, t) ?? tierInfo(t).range],
        ]);
      }
    });
    document.body.appendChild(el);
    openPanel = { el, ctrl };
    // 位置:控制項下方靠左對齊;放不下就往上 / 往左收
    const r = ctrl.getBoundingClientRect?.() ?? { left: 0, bottom: 0, top: 0 };
    const vw = window.innerWidth || 1280;
    const vh = window.innerHeight || 800;
    const w = Math.min(560, vw - 16);
    el.style.width = `${w}px`;
    el.style.left = `${Math.max(8, Math.min(r.left, vw - w - 8))}px`;
    const below = vh - r.bottom - 8;
    if (below >= 220 || below >= r.top) { el.style.top = `${r.bottom + 2}px`; el.style.maxHeight = `${Math.max(160, below)}px`; }
    else { el.style.bottom = `${vh - r.top + 2}px`; el.style.maxHeight = `${Math.max(160, r.top - 8)}px`; }
    el.querySelector(`.${PANEL}-on`)?.scrollIntoView?.({ block: 'nearest' });
    document.addEventListener('mousedown', onDocDown, true);
    document.addEventListener('keydown', onDocKey, true);
    window.addEventListener('resize', closePanel);
    window.addEventListener('scroll', onScroll, true);
  }

  function fillControl(ctrl, d) {
    const sel = ctrl.querySelector('select');
    sel.textContent = '';
    const none = document.createElement('option');
    none.value = '';
    none.textContent = tr('tierpick.none');
    sel.appendChild(none);
    const labels = familyLabels(d.fams, catNames);
    d.fams.forEach((f, fi) => {
      let parent = sel;
      if (d.fams.length > 1) {
        parent = document.createElement('optgroup');
        parent.label = labels[fi];
        sel.appendChild(parent);
      }
      f.t.forEach((t, ti) => {
        const r = computeValue(f.t, ti, d.inv);
        const info = tierInfo(t);
        const o = document.createElement('option');
        o.value = `${fi}:${ti}`;
        o.textContent = tr(d.inv ? 'tierpick.opt.max' : 'tierpick.opt.min', { n: ti + 1, value: fmt(r.value), range: info.range, lvl: info.lvl });
        parent.appendChild(o);
      });
    });
  }

  // 收合時的字與提示、選中的項目(不動清單本身)
  function syncControl(ctrl) {
    const d = ctrlData.get(ctrl);
    if (!d) return;
    const sel = ctrl.querySelector('select');
    const label = ctrl.querySelector(`.${CTRL}-label`);
    const tg = targets.get(d.statId);
    const fi = tg ? d.fams.findIndex((f) => f.sig === tg.sig) : -1;
    const val = fi >= 0 && tg.n <= d.fams[fi].t.length ? `${fi}:${tg.n - 1}` : '';
    if (sel.value !== val) sel.value = val;
    const text = val ? `T${tg.n}▾` : `${tr('tierpick.label')}▾`;
    if (label.textContent !== text) label.textContent = text;
    ctrl.classList.toggle(`${CTRL}-set`, !!val);
    const lines = [tr('tierpick.tip.title'), tr(d.inv ? 'tierpick.tip.fillMax' : 'tierpick.tip.fillMin')];
    if (d.fams.length > 1) lines.push(tr('tierpick.tip.families', { count: d.fams.length }));
    if (d.partial) lines.push(tr('tierpick.tip.partial'));
    if (val) lines.push(tr('tierpick.tip.target', { n: tg.n }));
    if (d.failed) lines.push(tr('tierpick.tip.failed'));
    const title = lines.join('\n');
    if (sel.title !== title) sel.title = title;
  }

  async function onPick(ctrl) {
    const d = ctrlData.get(ctrl);
    const row = ctrl.closest(`[${ATTR.stat}]`);
    if (!d || !row) return;
    const sel = ctrl.querySelector('select');
    const v = sel.value;
    d.failed = false;
    if (!v) {
      // 「不指定」:只拿掉目標,數值保留使用者看到的樣子
      targets.delete(d.statId);
      writeTargets();
      syncControl(ctrl);
      return;
    }
    const [fi, ti] = v.split(':').map(Number);
    const fam = d.fams[fi];
    const r = fam && computeValue(fam.t, ti, d.inv);
    const gi = Number(row.getAttribute(ATTR.gi));
    const rfi = Number(row.getAttribute(ATTR.fi));
    if (!r || !Number.isInteger(gi) || !Number.isInteger(rfi)) { d.failed = true; syncControl(ctrl); return; }
    const res = await postSet({ statId: d.statId, gi, fi: rfi, [r.bound]: r.value });
    if (res?.ok) {
      targets.set(d.statId, { n: ti + 1, sig: fam.sig });
      writeTargets();
      stat.set++;
    } else {
      d.failed = true;
    }
    syncControl(ctrl);
  }

  function renderRow(row, ctx) {
    const statId = row.getAttribute(ATTR.stat);
    const body = row.querySelector(':scope > .filter-body');
    const existing = body?.querySelector(`:scope > .${CTRL}`) ?? null;
    const drop = () => { if (existing) { if (openPanel?.ctrl === existing) closePanel(); existing.remove(); } return null; };
    if (!statId || !body) return drop();
    if (row.getAttribute(ATTR.gtype) === 'not') return drop(); // 排除群組不需要數值
    if (excludedReason(state.ladders, statId)) return drop();
    const fams = familiesFor(state.ladders, statId, ctx.cat, ctx.type);
    if (!fams.length) return drop(); // 這個類別不會出這條詞綴
    const min = body.querySelector(':scope > input.minmax');
    if (!min) return drop();
    const anchor = min.previousElementSibling?.classList.contains('sep') ? min.previousElementSibling : min;
    const inv = state.ladders.stats[statId].inv === 1;
    const partial = isPartial(state.ladders, statId, ctx.cat);
    const sig = JSON.stringify([statId, fams.map((f) => [f.sig, f.cats, f.vkeys, f.anyVariant]), state.lang, catNamesRaw, inv]);
    let ctrl = existing;
    if (!ctrl) { ctrl = buildControl(); stat.inserted++; }
    if (ctrl.nextElementSibling !== anchor) body.insertBefore(ctrl, anchor);
    const old = ctrlData.get(ctrl);
    if (!old || old.sig !== sig) {
      const d = { sig, statId, fams, inv, partial, failed: false };
      ctrlData.set(ctrl, d);
      fillControl(ctrl, d);
    } else {
      // 簽章只看階梯本身(清單要不要重建);階級表換新版但階梯不變(例:加了詞綴名稱 nm)時,面板仍要用新資料
      old.fams = fams;
      old.partial = partial;
    }
    syncControl(ctrl);
    return ctrl;
  }

  // ── 對齊用的空格(2026-10-01 使用者回報:「出現了詞墜上下不一樣」)──
  // 選單是 .filter-body(display:table)裡多出來的一格,標題吃剩下的寬度 → 有選單的列標題變窄,
  // MIN/MAX 與沒有選單的列對不齊。面板裡只要有任何一列放了選單,其餘「有 MIN 欄的詞綴篩選列」
  // (not / count / weight / if 各群組、偽屬性、沒有階梯的、被排除的…)都在同一個位置補一格同寬的空格
  // (aria-hidden、不能點);整個面板一列選單都沒有、或功能關掉時一格都不留 → 官方原樣。
  // 插入點與選單相同(MIN 前那個 .sep 之前),Vue 管的節點一個都不增刪。
  const PH = `${CTRL}-ph`;
  function placeRow(row) {
    const body = row.querySelector(':scope > .filter-body');
    const min = body?.querySelector(':scope > input.minmax');
    if (!min) return null;
    return { body, anchor: min.previousElementSibling?.classList.contains('sep') ? min.previousElementSibling : min };
  }
  function ensurePlaceholder(row) {
    const at = placeRow(row);
    const existing = at?.body.querySelector(`:scope > .${PH}`) ?? null;
    if (!at) { if (existing) existing.remove(); return null; }
    let ph = existing;
    if (!ph) {
      ph = document.createElement('span');
      ph.className = PH;
      ph.setAttribute('aria-hidden', 'true');
    }
    if (ph.nextElementSibling !== at.anchor) at.body.insertBefore(ph, at.anchor);
    return ph;
  }
  function dropPlaceholder(row) {
    const ph = row.querySelector(':scope > .filter-body')?.querySelector(`:scope > .${PH}`);
    if (ph) ph.remove();
  }
  // 功能關掉:選單與空格全部拿掉(只動我們自己插的節點)
  function clearAll(root) {
    closePanel();
    for (const el of [...root.querySelectorAll(`.${CTRL}`), ...root.querySelectorAll(`.${PH}`)]) el.remove();
  }

  let panelEl = null;
  const panel = () => {
    if (!panelEl || !panelEl.isConnected) panelEl = document.querySelector(PANEL_SEL);
    return panelEl;
  };

  let observer = null;
  let reportTimer = null;
  function rescan() {
    // 沒有搜尋面板(大宗通貨 / 歷史分頁、官網還沒掛上)就沒有篩選列:不必請 MAIN 走一遍元件樹
    const root = panel();
    if (!state.enabled || !state.ladders) {
      if (root && !state.enabled) {
        clearAll(root);
        observer?.takeRecords?.();
      }
      return 0;
    }
    if (!root) return 0;
    // 請 MAIN world 把列的屬性標到最新(同步派送,回來時已經寫好)
    try { window.dispatchEvent(new CustomEvent('pmz:annotateFilters')); } catch (_) { /* 離線殼 */ }
    readCatNames();
    const html = document.documentElement;
    const ctx = { cat: html.getAttribute(ATTR.cat) ?? '', type: html.getAttribute(ATTR.type) ?? '' };
    const rows = root.querySelectorAll(`[${ATTR.stat}]`);
    const seen = new Set();
    let n = 0;
    const bare = []; // 沒放選單的列
    for (const row of rows) {
      if (renderRow(row, ctx)) { n++; seen.add(row.getAttribute(ATTR.stat)); dropPlaceholder(row); }
      else bare.push(row);
    }
    // 有任何一列放了選單 → 其餘列補同寬空格;一列都沒有 → 空格全部拿掉(官方原樣)
    for (const row of bare) if (n) ensurePlaceholder(row); else dropPlaceholder(row);
    // 篩選列被刪掉的詞綴就不再是目標(只在搜尋面板還在時判斷 —— 切到歷史分頁不算刪)
    let changed = false;
    for (const k of [...targets.keys()]) if (!seen.has(k)) { targets.delete(k); changed = true; }
    if (changed) writeTargets();
    // 自己這一輪造成的變動(MAIN 寫屬性、插控制項)不必再觸發一次
    observer?.takeRecords?.();
    if (n && !reportTimer) {
      reportTimer = setTimeout(() => {
        reportTimer = null;
        dbg(`[PTM] 詞綴階級選單:${n} 列(累計插入 ${stat.inserted}、填值 ${stat.set};${GAME}${ctx.cat ? `,類別 ${ctx.cat}` : ''})`);
      }, 500);
    }
    return n;
  }

  let scanTimer = null;
  function scheduleScan() {
    if (scanTimer) return;
    scanTimer = setTimeout(() => { scanTimer = null; rescan(); }, 40);
  }

  const inCtrl = (node) => {
    const el = node?.nodeType === 1 ? node : node?.parentElement;
    return !!el?.closest?.(`.${CTRL}`);
  };
  function onMutations(muts) {
    if (!state.enabled || !state.ladders) return;
    const p = panelEl?.isConnected ? panelEl : null;
    for (const m of muts) {
      if (inCtrl(m.target)) continue;
      // 屬性:列的標記或 <html> 的類別 / 基底變了
      // 子節點:面板還沒找到時任何變動都可能是官網剛掛上面板;找到後只看面板裡面(結果列串流不必理)
      if (m.type === 'attributes' || !p || p.contains(m.target)) { scheduleScan(); return; }
    }
  }
  try {
    observer = new MutationObserver(onMutations);
    observer.observe(document.documentElement, {
      subtree: true, childList: true, attributes: true,
      attributeFilter: [ATTR.stat, ATTR.gi, ATTR.fi, ATTR.gtype, ATTR.cat, ATTR.type, ATTR.cats],
    });
  } catch (_) { /* 離線驗證殼沒有 MutationObserver */ }

  // 已插的控制項就地重畫(換語言 / 換類別名稱;rescan 會依 sig 判斷要不要重建清單)
  function refreshAll() { rescan(); }

  // ── 階級表 ──
  function useLadders(text) {
    if (typeof text !== 'string' || text === state.laddersText) return;
    try {
      const j = JSON.parse(text);
      if (!j?.stats || typeof j.stats !== 'object') return;
      state.ladders = j;
      state.laddersText = text;
      rescan();
    } catch (_) { /* 壞資料當作沒有 */ }
  }
  let requested = false;
  function loadLadders() {
    if (!state.enabled) return;
    try {
      chrome.storage.local.get(CACHE_KEY).then((got) => useLadders(got?.[CACHE_KEY]?.text)).catch(() => {});
      // 每頁問一次背景(6 小時內有快取就直接回);下載完寫進快取 → 下面的 onChanged 接手
      if (!requested) {
        requested = true;
        chrome.runtime.sendMessage({ t: 'tiers:ladders', game: GAME }).catch(() => {});
      }
    } catch (_) { /* 沒有 chrome.*(離線驗證殼) */ }
  }

  // ── 使用者開關(settings.tierPicker,預設開)與介面語言 ──
  function applySetting(settings) {
    const was = state.enabled;
    state.enabled = settings?.tierPicker !== false;
    document.documentElement.classList.toggle(HIDE_CLASS, !state.enabled);
    if (!state.enabled && targets.size) { targets.clear(); writeTargets(); } // 關掉選單 = 徽章不再比目標
    if (state.enabled && !was) loadLadders();
    rescan();
  }
  function applyLang(uiLang, language) {
    const ui = globalThis.PMZ_I18N?.effectiveUiLang?.(uiLang, language);
    state.lang = ui === 'en' ? 'en' : 'zh';
  }
  let lastLang = { uiLang: undefined, language: undefined };
  try {
    chrome.storage.local.get(['settings', 'uiLang', 'language', 'bilingualMods']).then((got) => {
      state.bilingual = got?.bilingualMods === true;
      lastLang = { uiLang: got?.uiLang, language: got?.language };
      applyLang(lastLang.uiLang, lastLang.language);
      state.enabled = false; // 讓 applySetting 把「開」當成剛打開,觸發載入
      applySetting(got?.settings);
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes[CACHE_KEY]) useLadders(changes[CACHE_KEY].newValue?.text);
      if (changes.bilingualMods) state.bilingual = changes.bilingualMods.newValue === true; // 下次開面板生效
      if (changes.uiLang || changes.language) {
        if (changes.uiLang) lastLang.uiLang = changes.uiLang.newValue;
        if (changes.language) lastLang.language = changes.language.newValue;
        applyLang(lastLang.uiLang, lastLang.language);
        refreshAll();
      }
      if (changes.settings) applySetting(changes.settings.newValue);
    });
  } catch (_) { /* 沒有 chrome.storage(離線驗證殼)就維持預設:開、中文 */ }

  // 供離線驗證腳本呼叫真正的實作(不另外複製一份,避免測試與實機分歧)
  globalThis.__pmzTierPickerInternals = {
    tierInfo, computeValue, excludedReason, familiesFor, familyLabels, isPartial, variantLabel,
    renderRow, rescan, useLadders, applySetting, applyLang, state, targets, stat, GAME, CACHE_KEY, VERIFIED_TEXT_ONLY, PH,
    tierText, titleOf, togglePanel, closePanel, PANEL,
  };
})();
