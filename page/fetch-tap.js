// MAIN world / document_start(國際服 + 台服、PoE1 + PoE2):結果列物品 JSON 的唯讀旁路。
//
// 官網每抓一頁結果就打一次 `/api/trade/fetch/…`(PoE2 是 `/api/trade2/fetch/…`),
// 回應裡有每件物品的結構化 JSON。這裡**只複製一份送給 isolated world**,
// 不改內容、不多發請求、不吃限流額度。用到它的有兩支:
//   - content/copy-item.js:PoE2 的「複製物品」鈕(畫面上的文字已被我們翻成中文,
//     回推只會複製出中文,PoB 解析不了 —— 必須拿官方 JSON 組)
//   - content/tier-badge.js:結果列每條詞綴的階級徽章(`mods[].tier` 與 `magnitudes`
//     只在 JSON 裡,畫面上沒有)
//   - content/sidebar.js:「大量賣家」分頁要賣家帳號與標價,所以 payload 另帶 `listing`
//     (`{ id, item, listing }`;只讀 `.item` 的消費者不受影響)
//   - content/result-links.js:結果列 poedb / wiki 快捷鈕(只讀 `.item` 的稀有度與名稱)
//
// 另外讀**回應標頭**裡的官方限流額度(X-Rate-Limit-*,2026-10-07),送 `{ __pmz:'rate', … }`
// 給大量賣家的自動載入判斷「還能不能再載一批」。同樣只讀,不多發任何請求。
//
// ── 為什麼從 page/trade-data.js 拆出來(2026-10-01)──
// trade-data.js 是**翻譯注入點**,只掛國際服(台服頁面本身就是中文,使用者裁定不載
// 任何翻譯)。徽章兩站都要,所以把旁路拆成獨立一支、兩站都掛;攔截結果的地方
// 仍然只有這一處,不會有兩份旁路各送一次。
//
// ⚠ **零頂層宣告**:同一個 world 的 content script 跨檔共享頂層 lexical scope
//   (與 page/ui-strings.js 的 `const __` 等撞名會讓後載入的那支整支不執行,
//   而且靜態檢查與離線驗證都看不出來)。整支包在 IIFE 裡。
// ⚠ MAIN world 沒有 chrome.* API,也不需要。
(() => {
  // 只攔取結果:搜尋請求(/search/)與四份 data API 一律不碰
  const FETCH_RE = /^\/api\/trade2?\/fetch\//;
  // isolated world 可能晚於第一批結果才掛上監聽(document_end vs 官網自己的 fetch),
  // 所以留最近一批物品,對方開口要(itemsReplay)時再送一次。上限只為了不無限長大:
  // 一頁 10 筆,300 筆 ≈ 往下載入 30 頁,足夠涵蓋畫面上還留著的列。
  const KEEP_MAX = 300;

  const origFetch = window.fetch;
  if (typeof origFetch !== 'function') return;

  const kept = new Map(); // id → { item, listing }(Map 保留插入順序,超量時從最舊的刪)

  // fetch 的第一個參數可以是字串、URL 或 Request
  function urlOf(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href);
      if (input instanceof URL) return input;
      if (input && typeof input.url === 'string') return new URL(input.url, location.href);
    } catch (_) { /* 解析不了就不是我們要攔的 */ }
    return null;
  }

  // MAIN world → isolated world 的 postMessage。失敗一律吞掉:
  // 這條路徑壞掉只該讓徽章 / 複製鈕不出現,不可以影響官網自己的結果列。
  function post(items) {
    try {
      window.postMessage({ __pmz: 'items', items }, location.origin);
    } catch (_) { /* 物品 JSON 無法結構化複製之類:放棄這一批 */ }
  }

  function keep(items) {
    for (const r of items) {
      kept.delete(r.id); // 重新插到最後,讓「最近看過」的留得最久
      kept.set(r.id, { item: r.item, listing: r.listing });
    }
    while (kept.size > KEEP_MAX) kept.delete(kept.keys().next().value);
  }

  // 回應本體(已 parse 的 JSON)→ 留存 + 送出
  function deliver(j) {
    const items = (j?.result ?? [])
      .filter((r) => r?.item?.id)
      .map((r) => ({ id: r.item.id, item: r.item, listing: r.listing }));
    if (!items.length) return;
    keep(items);
    post(items);
  }

  // ── 限流額度(回應標頭)──
  // 每個回應都送(含 429 與其他非 ok),但**沒有限流標頭就不送**:Cloudflare 錯誤頁之類的回應
  // 會把已知的額度洗成「沒有限制」。最後一份留著,側邊欄晚掛監聽時開口要(rateReplay)再送一次;
  // seq 讓對方分得出重送的是不是同一份。
  let rateSeq = 0;
  let lastRate = null;
  function rateOf(res) {
    const h = res?.headers;
    const rules = typeof h?.get === 'function' ? h.get('x-rate-limit-rules') : null;
    if (!rules) return null;
    const limits = {};
    const states = {};
    for (const r of rules.split(',').map((x) => x.trim().toLowerCase()).filter(Boolean)) {
      limits[r] = h.get(`x-rate-limit-${r}`) ?? '';
      states[r] = h.get(`x-rate-limit-${r}-state`) ?? '';
    }
    return {
      __pmz: 'rate',
      seq: ++rateSeq,
      at: Date.now(),
      status: res.status,
      policy: h.get('x-rate-limit-policy') ?? '',
      rules,
      limits,
      states,
      retryAfter: h.get('retry-after') ?? '',
    };
  }
  function postRate(msg) {
    try {
      window.postMessage(msg, location.origin);
    } catch (_) { /* 同 post():放棄這一份 */ }
  }

  function tap(promise) {
    promise.then((res) => {
      const rate = rateOf(res);
      if (rate) {
        lastRate = rate;
        postRate(rate);
      }
      if (!res?.ok) return;
      return res.clone().json().then(deliver);
    }).catch(() => {});
  }

  // isolated world 開口要已經送過的物品 / 最後一份額度(它比第一批結果晚掛上監聽時)。
  // 只收自己這個視窗、自己這個來源的訊息 —— 頁面上的 iframe 或第三方腳本都能 postMessage。
  window.addEventListener('message', (e) => {
    if (e.source !== window || e.origin !== location.origin) return;
    const kind = e.data?.__pmz;
    if (kind === 'rateReplay') {
      if (lastRate) postRate(lastRate);
      return;
    }
    if (kind !== 'itemsReplay' || !kept.size) return;
    post([...kept].map(([id, k]) => ({ id, item: k.item, listing: k.listing })));
  });

  window.fetch = function (input, init) {
    const p = origFetch.apply(this, arguments);
    const url = urlOf(input);
    if (url && FETCH_RE.test(url.pathname)) tap(p);
    return p;
  };
})();
