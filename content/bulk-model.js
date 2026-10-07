// 「大量賣家」分頁的資料模型(純邏輯:不碰 chrome API、不碰 DOM)。
//
// 把目前搜尋結果裡**同一個賣家有 2 筆以上上架**的物品分組,方便一次向同一個人買多件。
// 資料只來自頁面已經載入的結果(page/fetch-tap.js 旁路送來的 { id, item, listing })。
// 2026-10-05 原本裁定「不翻後續頁」;2026-10-07 使用者改為:分頁開著時自動載入到前 50 / 100 筆
// —— 由官網自己的「載入下一批」發請求(page/mod-filter.js 呼叫 fetchNext),這裡只做判斷:
// 讀官方限流標頭(parseRate)、算還要等多久(loadWait)、下一步做什麼(planStep)。
//
// 價格**不彙總**:同一賣家的標價常是不同通貨(chaos / divine 混著),加總要換匯率,
// 換錯比不換更糟 —— 每筆照官方 JSON 原樣列出。
//
// 以 UMD 形式輸出:content script(isolated world)掛全域 pmzBulk;
// tools/verify-bulk.mjs 以 node:vm 載入這同一份出貨檔驗證,不另寫一份實作。
(function (root) {
  'use strict';

  const MIN_GROUP = 2; // 一個賣家至少幾筆才成組

  const str = (v) => (typeof v === 'string' ? v : '');

  // 一筆上架 → 分頁要畫的欄位(只取需要的,不把整份物品 JSON 帶進畫面層)
  function entryOf(e) {
    const item = e.item ?? {};
    const p = e.listing?.price;
    const price = p && p.amount != null && p.currency != null ? { amount: p.amount, currency: p.currency } : null;
    return {
      id: e.id,
      name: str(item.name).trim(),
      typeLine: str(item.typeLine).trim(),
      price,
      online: !!e.listing?.account?.online,
    };
  }

  // 排序用的物品名:傳奇 / 稀有有自己的名字,其餘看基底
  const sortName = (x) => x.name || x.typeLine;

  // entries: [{ id, item, listing }] → [{ seller, online, items: [...] }]
  //   · 鍵 = listing.account.name(缺就略過那一筆)
  //   · ≥ 2 筆才成組;組依筆數降冪、同筆數依賣家名
  //   · 組內依物品名排序;同一個 id 重複出現只算一次
  function groupBySeller(entries) {
    const groups = new Map();
    const seen = new Set();
    for (const e of Array.isArray(entries) ? entries : []) {
      if (!e || !e.id || seen.has(e.id)) continue;
      const seller = str(e.listing?.account?.name);
      if (!seller) continue;
      seen.add(e.id);
      let g = groups.get(seller);
      if (!g) groups.set(seller, (g = []));
      g.push(entryOf(e));
    }
    const out = [];
    for (const [seller, items] of groups) {
      if (items.length < MIN_GROUP) continue;
      items.sort((a, b) => sortName(a).localeCompare(sortName(b)));
      out.push({ seller, online: items.some((x) => x.online), items });
    }
    out.sort((a, b) => b.items.length - a.items.length || a.seller.localeCompare(b.seller));
    return out;
  }

  // ── 自動載入(2026-10-07)──
  // 目標筆數:0 = 關、50、100;其他值(舊設定、手改的備份檔)一律當 50
  const LOAD_TARGETS = [0, 50, 100];
  const normLoad = (v) => (v === 0 || v === 100 ? v : 50);

  // "12:4:10,16:12:300" → [[12, 4, 10], [16, 12, 300]];任一段格式不對就整串作廢(回空陣列)
  function triples(s) {
    if (typeof s !== 'string' || !s.trim()) return [];
    const out = [];
    for (const part of s.split(',')) {
      const n = part.trim().split(':').map(Number);
      if (n.length !== 3 || !n.every((x) => Number.isFinite(x) && x >= 0)) return [];
      out.push(n);
    }
    return out;
  }

  // fetch-tap 送來的 { at, status, policy, rules, limits:{rule:'上限:視窗秒:封鎖秒,…'}, states:{rule:'次數:視窗秒:剩餘封鎖秒,…'}, retryAfter }
  //   → { at, status, policy, retryAfter, windows: [{ rule, max, period, penalty, hits, restricted }] }
  // ⚠ 任一條規則的 State 缺了或對不上視窗 → 回 null(不知道用了多少,就當沒有資訊,不自動載入)。
  //   沒有限流標頭的回應(Cloudflare 錯誤頁等)fetch-tap 根本不送,這裡再擋一次。
  function parseRate(msg) {
    if (!msg || typeof msg.rules !== 'string' || !Number.isFinite(msg.at)) return null;
    const windows = [];
    for (const rule of msg.rules.split(',').map((r) => r.trim().toLowerCase()).filter(Boolean)) {
      const lim = triples(msg.limits?.[rule]);
      const st = triples(msg.states?.[rule]);
      if (!lim.length) return null;
      for (const [max, period, penalty] of lim) {
        const s = st.find((x) => x[1] === period);
        if (!s) return null;
        windows.push({ rule, max, period, penalty, hits: s[0], restricted: s[2] });
      }
    }
    if (!windows.length) return null;
    const ra = Number(msg.retryAfter);
    return {
      at: msg.at,
      status: Number(msg.status) || 0,
      policy: typeof msg.policy === 'string' ? msg.policy : '',
      retryAfter: Number.isFinite(ra) && ra > 0 ? ra : 0,
      windows,
    };
  }

  // 每個視窗留給使用者自己(往下捲、再搜尋、其他分頁 / 工具)的餘裕。夾到 max − 1:額度再小也至少能在視窗清空後發一次。
  // 超過就封很久(≥ 60 秒)的視窗**留一半**:自動載入先把額度用掉,封鎖卻落在使用者自己之後的搜尋上。
  //   2026-10-07 用 tools/verify-bulk.mjs G 段的限流模擬器比過:留 1/4 時使用者每 10~12 秒搜尋一次、
  //   連續 5 分鐘就會撞 429;留 3/8 仍會;留 1/2 時所有節奏(含搜尋上限每 10 秒一次)都 0 次。
  //   實測匿名規則 12:4:10 → 2、16:12:300 → 8、50:300:300 → 25、1000:21600:1800 → 500
  function reserveOf(w) {
    const r = w.penalty >= 60 ? Math.max(3, Math.ceil(w.max * 0.5)) : Math.max(2, Math.ceil(w.max * 0.1));
    return Math.min(r, w.max - 1);
  }

  // 現在要再發一次 fetch,還得等幾毫秒(0 = 可以發;Infinity = 規則不允許任何請求)。
  // 保守、不留歷史:最近一次回應(at)回報的次數,一律當作要到「at + 視窗長度」才全部過期
  // (所以超量時就等到那個時間點;過了那個時間點 until ≤ now,自然回 0)。
  // ⚠ 所有截止時間都錨在 at,不從 now 起算 —— 等待期間不會有新回應,從 now 算會永遠等不完。
  //   保證:回傳 t > 0 時,在 now + t 這個時間點再算一次必定回 0。
  function loadWait(rate, now) {
    if (!rate || !Array.isArray(rate.windows) || !rate.windows.length) return Infinity;
    let until = 0;
    if (rate.retryAfter > 0) until = Math.max(until, rate.at + rate.retryAfter * 1000);
    for (const w of rate.windows) {
      if (!(w.max >= 1)) return Infinity;
      if (w.restricted > 0) until = Math.max(until, rate.at + w.restricted * 1000);
      if (w.hits + 1 + reserveOf(w) > w.max) until = Math.max(until, rate.at + w.period * 1000);
    }
    return Math.max(0, until - now);
  }

  // 官網一批(一次 fetch)載入幾筆。page/mod-filter.js 在另一個 world,同一個數字在那邊另寫一次(有註解)
  const PAGE = 10;
  // 一次搜尋最多觸發幾次「載入下一批」:目標筆數 / 一批 再多 1 次容錯(某批抓失敗)
  const stepCap = (target) => Math.ceil(target / PAGE) + 1;

  // page/mod-filter.js 回報的結果列狀態 → 下一步
  //   info: { ok, why?, loaded, total, done, fetching }(why:noApp / noResults / ambiguous / live / error)
  //   'live' 即時搜尋 | 'none' 頁面上沒有一般搜尋結果 | 'unavailable' 找不到官網的結果元件
  //   'done' 已達目標 | 'full' 官方給的結果已全部載入 | 'cap' 觸發次數用完
  //   'first' 第一批還沒到(官網自己正在抓,不重複抓) | 'busy' 官網正在抓下一批 | 'ready' 可以觸發
  function planStep(info, target, steps) {
    if (!info) return 'unavailable';
    if (!info.ok) return info.why === 'live' ? 'live' : info.why === 'noResults' ? 'none' : 'unavailable';
    if (info.loaded >= target) return 'done';
    if (info.done) return 'full';
    if (steps >= stepCap(target)) return 'cap';
    if (info.loaded < Math.min(PAGE, info.total)) return 'first';
    if (info.fetching) return 'busy';
    return 'ready';
  }

  // 節奏(毫秒):兩次觸發至少相隔 gap;回應到了再等 afterResp(官網回應後 400ms 才放開 fetching);
  // 詢問 page/mod-filter.js 逾時 rpcTimeout,連續 rpcMaxFails 次才放棄、每次多等 rpcBackoff;
  // 第一批未到 / 官網忙碌每 retry 重試,最多 retryMax 次(約 10 秒);
  // 排下一次時多留 waitSlack / gapSlack,免得計時器剛好早幾毫秒醒來又得再排一次
  const TIMING = { gap: 1500, afterResp: 600, rpcTimeout: 1500, rpcMaxFails: 3, rpcBackoff: 1000, retry: 500, retryMax: 20, waitSlack: 50, gapSlack: 20 };

  // 一次詢問的回覆 → 下一步(側邊欄照做;抽出來是為了能離線把整套節奏跑一遍)
  //   o: { reply, target, fire(這次有沒有要求觸發), wait(loadWait), gap(距離可觸發還差幾毫秒),
  //        stopped(收過 429), hasRate, newSearch(這次回覆換了搜尋), steps, retries }
  //   → { phase, next(下次詢問的延遲;-1 = 不排,等事件), steps, retries }
  function afterStep(o) {
    const { reply, target, fire, wait, gap, stopped, hasRate, newSearch } = o;
    const { steps, retries } = o;
    const keep = (phase, next = -1) => ({ phase, next, steps, retries });
    if (reply?.fired === true) return { phase: 'loading', next: TIMING.gap + TIMING.rpcTimeout, steps: steps + 1, retries: 0 }; // 備援;回應到了會先觸發
    const retry = () => (retries + 1 > TIMING.retryMax
      ? { phase: 'unavailable', next: -1, steps, retries: retries + 1 }
      : { phase: 'loading', next: TIMING.retry, steps, retries: retries + 1 });
    const plan = planStep(reply, target, steps);
    if (plan === 'first' || plan === 'busy') return retry();
    if (plan !== 'ready') return keep(plan); // done / full / cap / live / none / unavailable
    if (fire && !newSearch) return retry(); // 條件都成立卻沒觸發:官網自己擋下來了
    if (stopped) return keep('stopped');
    if (!hasRate) return keep('noRate'); // 等額度訊息到了再動
    if (wait > 0 && !Number.isFinite(wait)) return keep('policy');
    if (wait > 0) return keep('waiting', wait + TIMING.waitSlack);
    return keep('loading', Math.max(gap, 0) + TIMING.gapSlack);
  }

  const api = { MIN_GROUP, groupBySeller, LOAD_TARGETS, normLoad, parseRate, reserveOf, loadWait, stepCap, planStep, TIMING, afterStep };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.pmzBulk = api;
})(globalThis);
