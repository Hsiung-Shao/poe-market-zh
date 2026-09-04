// MAIN world / document_start:攔截官網對四份 trade data API 的 fetch,
// 把回應換成中文化過的內容。這是下拉選單、篩選面板、詞綴清單的中文化注入點。
//
// ── 為什麼從 lscache 改成 fetch(3.29.3b) ──
// 3.29.3b 之前,官網把 `/api/trade/data/{items,stats,static,filters}` 的回應存進
// localStorage 的 lscache,開頁時**直接讀快取**渲染 —— 所以中文化只要把那四個鍵
// 覆寫掉就成立(content/bootstrap.js 至今仍在做這件事)。3.29.3b 起官網改成
// **每次開頁都重新 fetch**,lscache 只剩下 `reload` 旗標與 settings/state:
//
//     u.setBucket(f.basePath.substring(1)); u.setExpiryMilliseconds(1e3); u.flushExpired();
//     const T = u.get("reload") ? "reload" : "default";
//     Promise.all([fetch(n("data/items"), {cache:T}).then(r => r.json()), ...])
//
// 我們寫進 lscache 的中文從此**沒有人讀**,下拉、篩選面板、詞綴清單整批回英文;
// 而結果列(content/results.js 的 DOM 層)與介面字串(page/ui-strings.js 的 `__`
// 掛勾)走另外兩條路徑,那時仍是中文 —— 症狀就是一頁中英夾雜,很容易誤判成
// 「翻譯資料壞了」。實際上資料是好的,只是注入點被繞過。
// → 注入點改成 `window.fetch`:官網要什麼我們就給什麼,不再依賴它怎麼快取。
//
// ⚠ **lscache 的那四個鍵仍然是資料來源**,只是意義變了:從「借官網的快取槽」
//   變成「我們自己的資料槽」。bootstrap.js 照舊寫、這裡照舊讀,兩邊鍵名不變 ——
//   官網哪天改回讀快取也自動相容。官網的 `flushExpired()` 只刪有
//   `<key>-cacheexpiration` 的鍵,而我們刻意不寫那個鍵,不會被掃掉。
//
// ⚠ **零頂層宣告**:content script 的同一個 world 跨檔共享頂層 lexical scope,
//   與 page/ui-strings.js 的 `const __` 撞名會讓後載入的那支**整支不執行**,
//   而且靜態檢查與離線驗證都看不出來。整支包在 IIFE 裡。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  // `/api/trade/data/stats`、`/api/trade2/data/filters` —— basePath 只有這兩種,
  // realm 不進 API 路徑(官網的 apiUrl 是 `/api${basePath}/${path}`)。
  const DATA_RE = /^\/api\/(trade2?)\/data\/(items|stats|static|filters)$/;
  const UI_MODE_KEY = 'ptm-ui-mode';

  const origFetch = window.fetch;
  if (typeof origFetch !== 'function') return;

  // fetch 的第一個參數可以是字串、URL 或 Request
  function urlOf(input) {
    try {
      if (typeof input === 'string') return new URL(input, location.href);
      if (input instanceof URL) return input;
      if (input && typeof input.url === 'string') return new URL(input.url, location.href);
    } catch (_) { /* 解析不了就不是我們要攔的 */ }
    return null;
  }

  // 回傳中文化後的 JSON 字串,拿不到就回 null(呼叫端放行原始請求)。
  //
  // ⚠ 刻意**不 parse**:stats 那份光是 PoE1 就 2.4 MB,parse 再 stringify 是
  //   純浪費,而且發生在開頁的關鍵路徑上。存進去的是端點回應的 `result` 陣列,
  //   外面補一層 `{"result": …}` 就是官網要的形狀,字串拼接即可。
  function localizedBody(base, kind) {
    let raw;
    try {
      raw = localStorage.getItem(`lscache-${base}${kind}`);
    } catch (_) {
      return null; // 隱私模式等情境讀不到 localStorage
    }
    // 形狀先驗:必須是 JSON 陣列。壞資料寧可放行英文,也不要餵官網一個
    // 它解析到一半才炸掉的東西(那會讓整個交易站白畫面)。
    if (!raw || raw[0] !== '[') return null;
    return `{"result":${raw}}`;
  }

  window.fetch = function (input, init) {
    const url = urlOf(input);
    const m = url && DATA_RE.exec(url.pathname);
    if (!m) return origFetch.apply(this, arguments);

    // 語系開關由 popup 寫在 localStorage(bootstrap.js 同步),切回英文時
    // 一律放行 —— 這條路徑要與「清掉 lscache 覆寫」是同一個判準。
    let mode;
    try {
      mode = localStorage.getItem(UI_MODE_KEY);
    } catch (_) {
      mode = null;
    }
    if (mode !== 'zh') return origFetch.apply(this, arguments);

    const body = localizedBody(m[1], m[2]);
    if (!body) {
      // 尚未建置(全新安裝的第一次開頁)或資料壞掉:放行英文,
      // 背景建好後下次重新整理就會是中文 —— 與 lscache 時代的體驗相同。
      dbg(`[PTM] ${m[1]}/${m[2]}:沒有可用的中文資料,本次維持官方原文`);
      return origFetch.apply(this, arguments);
    }

    dbg(`[PTM] ${m[1]}/${m[2]}:已改用中文化資料(${Math.round(body.length / 1024)} KB)`);
    return Promise.resolve(
      new Response(body, {
        status: 200,
        statusText: 'OK',
        headers: { 'Content-Type': 'application/json' },
      })
    );
  };
})();
