// document_end(isolated,國際服 + 台服、PoE1 + PoE2):結果列每條詞綴的階級徽章。
//
// 每條搜尋到的詞綴旁邊標出官方階級與數值在該階級範圍內的高低,例:「T2 高」/「T2 HIGH」。
// 篩選列選過目標階級時(階段二,`<html data-pmz-tier-targets>`)再加 ✓(達到)/ ▼(未達)。
//
// ── 資料全部來自官方結果 JSON,零額外請求 ──
// 官網的 fetch 回應裡每條詞綴本來就帶
//   { description, domain, hash:"stat.explicit.stat_N",
//     mods:[{ name, tier:"P6"|"S9", level, magnitudes:[{min,max}, …] }] }
// (PoE1 / PoE2 同形,tools/.itemtext-corpus*.json 實證)。JSON 由 page/fetch-tap.js
// 的唯讀旁路送過來;**數值取自 JSON 的英文說明,不讀畫面文字**(畫面是我們翻過的)。
//
// ── 對接 ──
// 畫面:`.row[data-id]` 底下每條 `.item-mod` 的 `[data-field="stat.explicit.stat_N"]`。
// JSON:`item.*Mods[].hash`。兩邊都去掉 `stat.` 前綴後以 stat id 對接(語言無關),
// 同一件物品同 id 出現多次時依出現順序對(語料裡沒有,但不能假設)。
// 只做 explicit / fractured / desecrated:crafted 也混在 explicitMods 裡,但工藝詞綴
// 沒有隨機階級的意義;implicit / enchant / rune / pseudo 一律不標。
//
// ── 先到後到都要處理 ──
// 結果列可能比 JSON 先畫好(那時還無從標起),也可能 JSON 先到。兩條入口都冪等:
//   1. results.js 的 processContainer 呼叫 __pmzTierBadge(root)(與 mod-row.js 同一時機)
//   2. 收到 {__pmz:'items'} 時把畫面上對得到的列補標一次
// 判斷「標過了」看這一列有沒有我們的徽章節點,不只看旗標 —— 官網重繪換掉節點時要能再標。
//
// ⚠ 非破壞性:結果列是官網 Vue 渲染的,Vue 管的節點(尤其 `.lc.s`)一個都不增刪,
//   徽章放進我們自己 append 到 `.item-mod` 尾端的 `.pmz-mod-tail`(官網不認得它,diff 不會踩到)。
//
// ── 位置:每條詞綴的最右側,徽章在前、＋/− 在後(2026-10-01 使用者裁定,同日第三版)──
//   P4          +8 點護甲           蠑螈之 (≥12) [T4 中 ][＋][−]
//   S8      1.2 每秒生命回復                     [T8 高 ][＋][−]
// 官方右欄群組名(平時隱藏、滑過才出現)由 CSS 往左挪到尾巴左邊,不再被蓋住;徽章固定寬,
// 整張卡的徽章 / ＋ / − 各自對齊。與 content/mod-row.js 的按鈕共用一個 `.pmz-mod-tail`:
// 誰先跑誰建(ensureTail 兩支同名同形),徽章一律插在 tail 最前面,所以不論哪支先跑、
// 哪支被關掉,順序都是「徽章 → ＋ → −」。版面規則全部在 content/sidebar.css(純 CSS,不量測)。
(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  // ── 官網 DOM 耦合點 ──
  const SEL = {
    row: '.row[data-id]',
    mod: '.item-mod',
    field: '[data-field^="stat."]',
  };
  const BADGE_CLASS = 'pmz-tier-badge';
  const NO_DATA = 'pmzTierNone'; // → data-pmz-tier-none:JSON 到了但這條沒有階級(不再重算)
  const HIDE_CLASS = 'pmz-hide-tier-badges'; // <html> 上:使用者關掉徽章
  const EN_CLASS = 'pmz-tier-en'; // <html> 上:徽章用英文(固定寬較寬)
  const TARGET_ATTR = 'data-pmz-tier-targets'; // <html> 上:階段二寫入的目標階級 {statId: n}
  const FIELD_PREFIX = 'stat.';
  // 只標這幾種詞綴領域(stat id 的第一段)
  const DOMAINS = new Set(['explicit', 'fractured', 'desecrated']);
  // 品質閾值:與 tierfill(MIT)相同
  const HIGH = 0.66;
  const LOW = 0.34;

  // ── 純計算(離線驗證直接呼叫這幾支)──

  // `[Armour|Armour]` → `Armour`、`[Physical]` → `Physical`(PoE2 說明文字的標記)
  const stripMarkup = (s) => String(s ?? '').replace(/\[([^\]|]*)\|([^\]]*)\]/g, '$2').replace(/\[([^\]]*)\]/g, '$1');

  // `P6` → { kind:'P', n:6 };其他形狀回 null(不猜)
  function parseTier(t) {
    const m = /^([A-Za-z]*)(\d+)$/.exec(String(t ?? '').trim());
    return m ? { raw: m[0], kind: m[1].toUpperCase(), n: Number(m[2]) } : null;
  }

  // 一條 magnitude → 以「數值大小」表示的範圍 [lo, hi]。
  // 「減少」類(兩端都 ≤ 0,如 18% reduced Attribute Requirements → -18)以絕對值看:
  // 減越多 = 擲得越高。兩端異號(-2 ~ 2 這種)才保留正負號比。
  function magRange(g) {
    const a = Number(g?.min);
    const b = Number(g?.max);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
    const signed = (a < 0) !== (b < 0) && a !== 0 && b !== 0;
    const x = signed ? a : Math.abs(a);
    const y = signed ? b : Math.abs(b);
    return { lo: Math.min(x, y), hi: Math.max(x, y), signed };
  }

  // 同一行由多條詞綴合計(例:Dragonfly's + Spectre's 的 % 閃避):範圍逐格相加。
  // 各條的 magnitude 數不同就沒辦法加 → null(只標階級)。
  function sumRanges(mods) {
    let out = null;
    for (const m of mods) {
      const rs = (m.magnitudes ?? []).map(magRange);
      if (!rs.length || rs.some((r) => !r)) return null;
      if (!out) { out = rs.map((r) => ({ ...r })); continue; }
      if (out.length !== rs.length) return null;
      rs.forEach((r, i) => { out[i].lo += r.lo; out[i].hi += r.hi; out[i].signed ||= r.signed; });
    }
    return out;
  }

  // 說明文字裡的數字(含負號、小數)。`+` 號忽略。
  const NUM_RE = /-?\d+(?:\.\d+)?/g;
  // 顯示值四捨五入過(126.9、0.1),比對容許一點誤差
  const EPS = 0.051;
  const inRange = (v, r) => v >= r.lo - EPS && v <= r.hi + EPS;

  // 依序為每個範圍挑一個落在範圍內的數字:說明文字常夾字面數字
  // (for 4 seconds、every 3 seconds、per 10 Intelligence),不能照位置取。
  // 挑不齊 → null(值不在範圍內,可能還有別的效果疊加,只標階級)。
  function pickValues(description, ranges) {
    const nums = (stripMarkup(description).match(NUM_RE) ?? []).map(Number);
    const vals = [];
    let from = 0;
    for (const r of ranges) {
      let hit = -1;
      for (let i = from; i < nums.length; i++) {
        const v = r.signed ? nums[i] : Math.abs(nums[i]);
        if (inRange(v, r)) { hit = i; vals.push(v); break; }
      }
      if (hit < 0) return null;
      from = hit + 1;
    }
    return vals;
  }

  // 一行 JSON → 徽章要的全部資料;沒有階級回 null(不標)
  function gradeLine(line) {
    const mods = Array.isArray(line?.mods) ? line.mods : [];
    const tiers = mods.map((m) => parseTier(m?.tier));
    if (!mods.length || tiers.some((t) => !t)) return null;
    const best = tiers.reduce((a, b) => (b.n < a.n ? b : a));
    const info = { tiers, best, multi: mods.length > 1, ranges: null, values: null, pos: null, quality: null, fixed: false };
    const ranges = sumRanges(mods);
    if (!ranges) return info;
    info.ranges = ranges;
    const lo = ranges.reduce((s, r) => s + r.lo, 0) / ranges.length;
    const hi = ranges.reduce((s, r) => s + r.hi, 0) / ranges.length;
    if (hi - lo < 1e-9) { info.fixed = true; return info; }
    const values = pickValues(line.description, ranges);
    if (!values) return info;
    info.values = values;
    const v = values.reduce((s, x) => s + x, 0) / values.length; // Adds # to #:兩值平均對兩範圍平均
    const pos = Math.min(1, Math.max(0, (v - lo) / (hi - lo)));
    info.pos = pos;
    info.quality = pos >= HIGH ? 'high' : pos <= LOW ? 'low' : 'mid';
    return info;
  }

  // 一件物品 → stat id → 依出現順序的行
  function indexItem(item) {
    const idx = new Map();
    for (const [k, arr] of Object.entries(item ?? {})) {
      if (!/Mods$/.test(k) || !Array.isArray(arr)) continue;
      for (const line of arr) {
        if (!line || typeof line !== 'object' || typeof line.hash !== 'string') continue;
        const key = line.hash.startsWith(FIELD_PREFIX) ? line.hash.slice(FIELD_PREFIX.length) : line.hash;
        if (!idx.has(key)) idx.set(key, []);
        idx.get(key).push(line);
      }
    }
    return idx;
  }

  // ── 顯示 ──
  const state = { lang: 'zh', targets: {} };
  const stat = { badged: 0, none: 0 };

  // 字串表在 shared/i18n.js;語言依本擴充自己的介面語言(uiLang),台服站也一樣
  function tr(key, vars) {
    const tables = globalThis.PMZ_I18N?.tables;
    let out = tables?.[state.lang]?.[key] ?? tables?.zh?.[key] ?? key;
    if (vars) out = out.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return out;
  }

  // 目標階級:階段二由篩選列寫入。先找完整 id(explicit.stat_N),再找只有雜湊段(stat_N,跨領域共用)
  function targetFor(key) {
    const t = state.targets[key] ?? state.targets[key.slice(key.indexOf('.') + 1)];
    const n = Number(t);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // 徽章 → { info, key }(換語言 / 目標時就地重畫,不必再對一次 JSON)
  const badgeData = new WeakMap();

  const fmt = (x) => String(Math.round(x * 100) / 100);

  function render(badge) {
    const d = badgeData.get(badge);
    if (!d) return;
    const { info, key } = d;
    // 多條合計時最佳階級排最前(T4/T5),目標比對也用最佳那條
    const tierText = info.tiers.length > 1
      ? [...info.tiers].sort((a, b) => a.n - b.n).map((t) => `T${t.n}`).join('/')
      : `T${info.best.n}`;
    const target = targetFor(key);
    const meets = target != null ? info.best.n <= target : null;
    const mark = meets == null ? '' : meets ? '✓ ' : '▼ ';
    badge.textContent = `${mark}${tierText}${info.quality ? ` ${tr(`tier.q.${info.quality}`)}` : ''}`;
    badge.className = [
      BADGE_CLASS,
      info.quality ? `pmz-tier-q-${info.quality}` : '',
      meets == null ? '' : meets ? 'pmz-tier-meets' : 'pmz-tier-below',
    ].filter(Boolean).join(' ');

    // 提示:階級、範圍、數值位置、目標
    const lines = [];
    for (const t of info.tiers) {
      const kind = t.kind === 'P' ? tr('tier.prefix') : t.kind === 'S' ? tr('tier.suffix') : '';
      lines.push(kind ? tr('tier.tip.tier', { n: t.n, kind, raw: t.raw }) : tr('tier.tip.tierRaw', { n: t.n, raw: t.raw }));
    }
    if (info.multi) lines.push(tr('tier.tip.multi', { count: info.tiers.length }));
    if (info.ranges) {
      lines.push(tr('tier.tip.range', { range: info.ranges.map((r) => (r.hi === r.lo ? fmt(r.lo) : `${fmt(r.lo)}–${fmt(r.hi)}`)).join(' / ') }));
      if (info.fixed) lines.push(tr('tier.tip.fixed'));
      else if (info.pos != null) lines.push(tr('tier.tip.roll', { value: info.values.map(fmt).join(' / '), pct: Math.round(info.pos * 100) }));
      else lines.push(tr('tier.tip.noRoll'));
    }
    if (meets != null) lines.push(tr(meets ? 'tier.tip.meets' : 'tier.tip.below', { target }));
    lines.push(tr('tier.tip.order'));
    badge.title = lines.join('\n');
  }

  // ── 物品 JSON ──
  const items = new Map(); // id → 索引(stat id → 行[])

  function statKeyOf(mod) {
    const el = mod.querySelector(SEL.field);
    const field = el?.getAttribute('data-field') ?? '';
    return field.startsWith(FIELD_PREFIX) ? field.slice(FIELD_PREFIX.length) : null;
  }

  // ── 詞綴列尾巴:徽章 + ＋/− 共用的外框 ──
  // ⚠ 與 content/mod-row.js 的 ensureTail **同名同形**(class 名一字不差):誰先跑誰建,
  //   另一支找到就沿用。只看 .item-mod 的直接子節點(官網重繪換掉節點時 tail 跟著消失,下次再建)。
  const TAIL_CLASS = 'pmz-mod-tail';
  function ensureTail(mod) {
    for (const c of mod.childNodes) if (c.nodeType === 1 && c.classList?.contains(TAIL_CLASS)) return c;
    const tail = document.createElement('span');
    tail.className = TAIL_CLASS;
    mod.classList.add('pmz-mod-host'); // 標記「這一列有我們的尾巴」(sidebar.css 不靠它定位)
    mod.appendChild(tail);
    return tail;
  }

  // 標一整列;JSON 還沒到就什麼都不做(也不蓋章,等 JSON 到了再來)
  function badgeRow(row) {
    const idx = items.get(row?.dataset?.id);
    if (!idx) return 0;
    const seen = new Map();
    let n = 0;
    for (const mod of row.querySelectorAll(SEL.mod)) {
      const key = statKeyOf(mod);
      if (!key || !DOMAINS.has(key.slice(0, key.indexOf('.')))) continue;
      const nth = seen.get(key) ?? 0; // 同一件物品同 id 出現多次:依出現順序對
      seen.set(key, nth + 1);
      if (mod.dataset[NO_DATA] || mod.querySelector(`.${BADGE_CLASS}`)) continue;
      const info = gradeLine(idx.get(key)?.[nth]);
      if (!info) { mod.dataset[NO_DATA] = '1'; stat.none++; continue; }
      const badge = document.createElement('span');
      badgeData.set(badge, { info, key });
      render(badge);
      const tail = ensureTail(mod);
      tail.insertBefore(badge, tail.firstChild); // 徽章永遠在 ＋/− 前面(按鈕可能先畫好了)
      stat.badged++;
      n++;
    }
    return n;
  }

  // root 可能是整個結果容器、一列、或一列裡面的節點
  function rowsIn(root) {
    if (!root) return [];
    if (root.matches?.(SEL.row)) return [root];
    const up = root.closest?.(SEL.row);
    if (up) return [up];
    return [...(root.querySelectorAll?.(SEL.row) ?? [])];
  }

  let reportTimer = null;
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      dbg(`[PTM] 詞綴階級徽章:已標 ${stat.badged} 條、無階級 ${stat.none} 條(物品 JSON ${items.size} 筆)`);
    }, 500);
  }

  function scan(root) {
    let n = 0;
    for (const row of rowsIn(root)) n += badgeRow(row);
    if (n) report();
    return n;
  }

  function refreshAll() {
    for (const b of document.querySelectorAll(`.${BADGE_CLASS}`)) render(b);
  }

  window.addEventListener('message', (e) => {
    // 只收自己這個視窗、自己這個來源送出的訊息(頁面上的 iframe / 第三方腳本都能 postMessage)
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__pmz !== 'items' || !Array.isArray(d.items)) return;
    for (const r of d.items) if (r?.id && r.item) items.set(r.id, indexItem(r.item));
    scan(document);
    // JSON 剛到時列可能還沒畫完(官網拿到回應後才渲染),稍後再補掃一次;冪等
    setTimeout(() => scan(document), 500);
  });

  // ── 目標階級(階段二寫入)──
  function readTargets() {
    try {
      const raw = document.documentElement.getAttribute(TARGET_ATTR);
      const t = raw ? JSON.parse(raw) : {};
      state.targets = t && typeof t === 'object' ? t : {};
    } catch (_) {
      state.targets = {}; // 壞資料當作沒選
    }
  }
  readTargets();
  try {
    new MutationObserver(() => { readTargets(); refreshAll(); })
      .observe(document.documentElement, { attributes: true, attributeFilter: [TARGET_ATTR] });
  } catch (_) { /* 離線驗證殼沒有 MutationObserver */ }

  // ── 使用者開關(settings.tierBadges,預設開)與介面語言 ──
  // 關掉時徽章照畫但用 CSS 藏起來(切換不必重畫結果列),storage 一變就即時生效。
  function applySetting(settings) {
    document.documentElement.classList.toggle(HIDE_CLASS, settings?.tierBadges === false);
  }
  function applyLang(uiLang, language) {
    const ui = globalThis.PMZ_I18N?.effectiveUiLang?.(uiLang, language);
    state.lang = ui === 'en' ? 'en' : 'zh';
    // 徽章固定寬依語言不同(英文「T10 HIGH」較寬),寬度寫在 content/sidebar.css 的 --pmz-badge-w
    document.documentElement.classList.toggle(EN_CLASS, state.lang === 'en');
  }
  let lastLang = { uiLang: undefined, language: undefined };
  try {
    chrome.storage.local.get(['settings', 'uiLang', 'language']).then((got) => {
      applySetting(got?.settings);
      lastLang = { uiLang: got?.uiLang, language: got?.language };
      applyLang(lastLang.uiLang, lastLang.language);
      refreshAll();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) applySetting(changes.settings.newValue);
      if (changes.uiLang || changes.language) {
        if (changes.uiLang) lastLang.uiLang = changes.uiLang.newValue;
        if (changes.language) lastLang.language = changes.language.newValue;
        applyLang(lastLang.uiLang, lastLang.language);
        refreshAll();
      }
    });
  } catch (_) { /* 沒有 chrome.storage(離線驗證殼)就維持顯示、中文 */ }

  // results.js 的 processContainer 在處理完一批結果列後呼叫這支(翻譯開或關都會呼叫)
  globalThis.__pmzTierBadge = (root) => scan(root);

  // 比 page/fetch-tap.js 晚掛上監聽時,請它把已經送過的物品再送一次
  try { window.postMessage({ __pmz: 'itemsReplay' }, location.origin); } catch (_) { /* 忽略 */ }

  // 供離線驗證腳本呼叫真正的實作(不另外複製一份,避免測試與實機分歧)
  globalThis.__pmzTierBadgeInternals = {
    stripMarkup, parseTier, magRange, sumRanges, pickValues, gradeLine, indexItem,
    items, state, stat, scan, refreshAll, HIGH, LOW, DOMAINS, ensureTail, TAIL_CLASS,
  };
})();
