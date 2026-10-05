// document_end(isolated,只掛國際服):結果列的 poedb / PoE Wiki 快捷鈕。
//
// 傳奇與寶石的結果列,在官方 refresh / copy / searchBy 那一欄(`.left`)末端加兩顆小鈕:
//   W  → PoE Wiki(PoE1 poewiki.net / PoE2 poe2wiki.net)
//   Db → poedb(PoE1 poedb.tw / PoE2 poe2db.tw;語系跟著使用者選的語言:中文 → /tw/、英文 → /us/)
// 以物品英文名組網址、新分頁開啟。**不 fetch、不加任何權限**(只是 window.open)。
//
// ── 使用者裁定(2026-10-05)──
//   · 只掛傳奇(frameType 3)與寶石(frameType 4):其他物品名組不出有意義的頁面。
//   · 只掛國際服:台服物品名是中文,組不出 wiki / poedb 的英文網址。
//   · 預設關(settings.resultLinks);開了也只有滑過那一列才出現(與官方 refresh / searchBy 一致)。
//
// ── 資料來源 ──
//   1. page/fetch-tap.js 旁路送來的官方 JSON(`{__pmz:'items'}`):`item.frameType` / `item.rarity`
//      判種類、`item.name || item.typeLine` 當名稱 —— **永遠是英文**,不受畫面中文化影響。
//   2. JSON 還沒到時退回 DOM:卡片 BEM 修飾字(`.item-popup--unique` / `--gem`)判種類,名稱取
//      `.item-popup__header-line` 第一行;那一行被 results.js 翻成中文時,英文原文在它的 title。
//      按下去的當下才組網址,所以 JSON 晚到也會用 JSON 的名字。
//
// ── 掛載 ──
//   results.js 的 processContainer 呼叫 __pmzResultLinks(root)(與 __pmzTierBadge 同一時機,
//   不另開 MutationObserver);收到 JSON 時再補掃一次。兩條入口都冪等:看這一列有沒有我們的
//   `.pmz-wiki-links` 節點,不只看旗標 —— 官網重繪換掉節點時要能再補(同 content/tier-badge.js)。
//
// ⚠ 同一個 isolated world 的 content script 共享頂層 lexical scope,整支包在 IIFE 裡。
(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  // 站別:台服直接不做(物品名是中文)
  const SITE = (globalThis.PMZ_SITE
    ?? (/(^|\.)pathofexile\.tw$/.test(location.hostname) ? 'tw' : 'intl')) === 'tw' ? 'tw' : 'intl';
  if (SITE === 'tw') return;

  const GAME =
    globalThis.PMZ_GAME ??
    (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2' } : { id: 'poe1' });
  const IS_POE2 = GAME.id === 'poe2';

  const t = (k, v) => globalThis.PMZ_I18N?.t(k, v) ?? k;

  // ── 官網 DOM 耦合點(改版時優先檢查)──
  const SEL = {
    row: '.resultset .row[data-id]',
    cell: '.left', // 官方 refresh / copy / searchBy 鈕那一欄
    unique: '.item-popup--unique, .item-popup__header--unique',
    gem: '.item-popup--gem, .item-popup__header--gem',
    nameLine: '.item-popup__header-line',
  };
  const WRAP_CLASS = 'pmz-wiki-links';
  const ON_CLASS = 'pmz-result-links-on'; // <html> 上:設定開著(CSS 靠它決定滑過時顯示)
  const KIND_BY_FRAME = { 3: 'unique', 4: 'gem' };
  let poedbLang = 'us'; // 'tw' | 'us',由下方 applyLang() 依使用者語言設定更新

  // ── 網址(純函式)──
  // wiki:空白 → 底線,其餘照 encodeURIComponent;撇號 encodeURIComponent 不編,另外補 %27
  //   (Kaom's Heart → Kaom%27s_Heart)。
  // poedb:撇號整個拿掉、空白 → 底線(Kaom's Heart → Kaoms_Heart)。
  function wikiUrl(name, poe2 = IS_POE2) {
    const base = poe2 ? 'https://www.poe2wiki.net/wiki/' : 'https://www.poewiki.net/wiki/';
    return base + encodeURIComponent(name.replace(/\s+/g, '_')).replace(/'/g, '%27');
  }
  //   lang:'tw' = 中文頁、'us' = 英文頁;兩邊的 slug 都是英文名,只差路徑上的語系段。
  function poedbUrl(name, poe2 = IS_POE2, lang = poedbLang) {
    const base = `https://${poe2 ? 'poe2db' : 'poedb'}.tw/${lang === 'tw' ? 'tw' : 'us'}/`;
    return base + encodeURIComponent(name.replace(/['’]/g, '').replace(/\s+/g, '_'));
  }

  // 官方 JSON → { kind, name } | null
  function infoFromItem(item) {
    if (!item) return null;
    let kind = KIND_BY_FRAME[item.frameType] ?? null;
    if (!kind && item.rarity === 'Unique') kind = 'unique';
    if (!kind) return null;
    const name = (typeof item.name === 'string' && item.name.trim())
      || (typeof item.typeLine === 'string' && item.typeLine.trim()) || '';
    return name ? { kind, name } : null;
  }

  const CJK_RE = /[㐀-鿿豈-﫿]/;
  // DOM 退路:卡片修飾字判種類,第一行名稱(被翻成中文時取 title 裡的英文原文)
  function infoFromDom(row) {
    const kind = row.querySelector(SEL.unique) ? 'unique' : row.querySelector(SEL.gem) ? 'gem' : null;
    if (!kind) return null;
    const line = row.querySelector(SEL.nameLine);
    if (!line) return null;
    const text = (line.textContent ?? '').trim();
    const name = CJK_RE.test(text) ? (line.title ?? '').trim() : text;
    return name && !CJK_RE.test(name) ? { kind, name } : null;
  }

  const items = new Map(); // id → { kind, name } | null(null = JSON 說不是傳奇 / 寶石)
  function infoFor(row) {
    const id = row?.dataset?.id;
    if (id && items.has(id)) return items.get(id);
    return infoFromDom(row);
  }

  function openLink(row, which) {
    const info = infoFor(row);
    if (!info) return;
    const url = which === 'wiki' ? wikiUrl(info.name) : poedbUrl(info.name);
    // 開新分頁一律帶 noopener / noreferrer,不讓對方拿到 window.opener
    window.open(url, '_blank', 'noopener,noreferrer');
  }

  function linkBtn(row, which) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = `pmz-link pmz-link-${which === 'wiki' ? 'wiki' : 'db'}`;
    btn.textContent = which === 'wiki' ? 'W' : 'Db';
    btn.title = t(which === 'wiki' ? 'links.wiki' : 'links.poedb');
    btn.addEventListener('click', (e) => {
      // 不讓官網把這一下當成點到結果列
      e.preventDefault();
      e.stopPropagation();
      openLink(row, which);
    });
    return btn;
  }

  // 補一列;不是傳奇 / 寶石、或找不到插入點就什麼都不做(JSON 晚到時會再來一次)
  function linkRow(row) {
    if (row.querySelector(`.${WRAP_CLASS}`)) return 0; // 節點還在 = 補過了(官網重繪換掉節點就會再補)
    if (!infoFor(row)) return 0;
    const cell = row.querySelector(SEL.cell);
    if (!cell) return 0;
    const wrap = document.createElement('span');
    wrap.className = WRAP_CLASS;
    wrap.appendChild(linkBtn(row, 'wiki'));
    wrap.appendChild(linkBtn(row, 'db'));
    cell.appendChild(wrap);
    row.dataset.pmzLinks = '1';
    return 1;
  }

  // root 可能是整個結果容器、一列、或一列裡面的節點
  function rowsIn(root) {
    if (!root) return [];
    if (root.matches?.(SEL.row)) return [root];
    const up = root.closest?.(SEL.row);
    if (up) return [up];
    return [...(root.querySelectorAll?.(SEL.row) ?? [])];
  }

  let total = 0;
  let reportTimer = null;
  function scan(root) {
    let n = 0;
    for (const row of rowsIn(root)) n += linkRow(row);
    if (n) {
      total += n;
      if (!reportTimer) {
        reportTimer = setTimeout(() => {
          reportTimer = null;
          dbg(`[PTM] 結果列快捷鈕:已掛 ${total} 列(物品 JSON ${items.size} 筆)`);
        }, 500);
      }
    }
    return n;
  }

  window.addEventListener('message', (e) => {
    // 只收自己這個視窗、自己這個來源送出的訊息(頁面上的 iframe / 第三方腳本都能 postMessage)
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__pmz !== 'items' || !Array.isArray(d.items)) return;
    for (const r of d.items) if (r?.id && r.item) items.set(r.id, infoFromItem(r.item));
    scan(document);
    // JSON 剛到時列可能還沒畫完(官網拿到回應後才渲染),稍後再補掃一次;冪等
    setTimeout(() => scan(document), 500);
  });

  // ── 使用者開關(settings.resultLinks,預設關)──
  // 鈕照掛,關著時 CSS 不顯示;storage 一變就即時生效(不必重畫結果列)
  function applySetting(settings) {
    document.documentElement.classList.toggle(ON_CLASS, settings?.resultLinks === true);
  }
  // poedb 語系跟著使用者選的語言走(使用者 2026-10-05 要求):判定與 results.js 決定要不要
  // 翻交易站同一條 —— 介面中文且 language = zh_tw → /tw/,其餘(選英文)→ /us/。
  const lang = { uiLang: undefined, language: undefined };
  function applyLang() {
    const ui = globalThis.PMZ_I18N?.effectiveUiLang(lang.uiLang, lang.language)
      ?? (lang.uiLang === 'zh' || lang.uiLang === 'en' ? lang.uiLang : lang.language !== undefined ? 'zh' : undefined);
    poedbLang = ui === 'zh' && lang.language === 'zh_tw' ? 'tw' : 'us';
  }
  try {
    chrome.storage.local.get(['settings', 'uiLang', 'language']).then((got) => {
      applySetting(got?.settings);
      lang.uiLang = got?.uiLang; lang.language = got?.language; applyLang();
    }).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.settings) applySetting(changes.settings.newValue);
      if (changes.uiLang || changes.language) {
        if (changes.uiLang) lang.uiLang = changes.uiLang.newValue;
        if (changes.language) lang.language = changes.language.newValue;
        applyLang();
      }
    });
  } catch (_) { /* 沒有 chrome.storage(離線驗證殼):維持關閉 */ }

  // results.js 的 processContainer 在處理完一批結果列後呼叫這支(翻譯開或關都會呼叫)
  globalThis.__pmzResultLinks = (root) => scan(root);

  // 比 page/fetch-tap.js 晚掛上監聽時,請它把已經送過的物品再送一次
  try { window.postMessage({ __pmz: 'itemsReplay' }, location.origin); } catch (_) { /* 忽略 */ }

  // 供離線驗證腳本呼叫真正的實作(不另外複製一份,避免測試與實機分歧)
  globalThis.__pmzResultLinksInternals = { wikiUrl, poedbUrl, infoFromItem, infoFromDom, items, scan, IS_POE2, ON_CLASS };
})();
