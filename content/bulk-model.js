// 「大量賣家」分頁的資料模型(純邏輯:不碰 chrome API、不碰 DOM)。
//
// 把目前搜尋結果裡**同一個賣家有 2 筆以上上架**的物品分組,方便一次向同一個人買多件。
// 資料只來自頁面已經載入的結果(page/fetch-tap.js 旁路送來的 { id, item, listing }),
// 不打任何 API、不翻後續頁(使用者 2026-10-05 裁定)。
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

  const api = { MIN_GROUP, groupBySeller };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.pmzBulk = api;
})(globalThis);
