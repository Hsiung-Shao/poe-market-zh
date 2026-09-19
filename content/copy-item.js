// document_end(isolated):PoE2 結果列的「複製物品」鈕。
//
// ── 這顆鈕官網本來就有,只是 PoE2 用不了 ──
// PoE1 的結果列每一筆左側都有 `button.copy`(縮圖上方,放大鏡旁邊),按下去把
// 物品的遊戲文字放進剪貼簿,貼進 PoB 就能匯入。那份文字來自 API 的
// `item.extended.text`(base64 的遊戲 Ctrl+C 文字)。
// **PoE2 的 trade2 API 沒有那個欄位**(2026-09-19 對 live API 實測),所以官網把
// 同一顆按鈕渲染出來之後直接隱藏 —— DOM 裡真的有 `button.copy.hidden`。
//
// 所以這裡不自己畫一顆鈕,而是**把官網那顆放出來自己接手**:圖示、位置、
// tooltip 全部與 PoE1 一模一樣,官網哪天自己補上 text 也不會變成兩顆。
//
// 物品文字由 content/item-text.js 從結構化 JSON 組(逐字元對過 PoE1 的官方正解,
// 見 tools/verify-item-text.mjs);JSON 由 page/trade-data.js 的唯讀旁路送過來。
//
// ⚠ 只在 PoE2 動手。PoE1 那顆是官網自己的,能正常運作,碰它只會製造回歸。
(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const GAME =
    globalThis.PMZ_GAME ??
    (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2' } : { id: 'poe1' });
  if (GAME.id !== 'poe2') return;

  const IT = globalThis.pmzItemText;
  if (!IT) { console.warn('[PTM] item-text.js 沒載入,PoE2 複製物品鈕不啟用'); return; }

  // ── 官網 DOM 耦合點 ──
  const SEL = {
    row: '.resultset .row[data-id]',
    copyBtn: 'button.copy',
  };
  const READY_CLASS = 'pmz-copy-on'; // 我們自己的旗標,CSS 靠它把鈕放出來

  // 物品 JSON:id → item。官網每抓一頁就送一批過來(page/trade-data.js)。
  const items = new Map();

  window.addEventListener('message', (e) => {
    // 只收自己這個視窗、自己這個來源送出的訊息 —— 頁面上任何 iframe 或第三方
    // 腳本都能 postMessage,不驗來源等於讓外人決定我們複製什麼進剪貼簿。
    if (e.source !== window || e.origin !== location.origin) return;
    const d = e.data;
    if (!d || d.__pmz !== 'items' || !Array.isArray(d.items)) return;
    for (const row of d.items) if (row?.id && row.item) items.set(row.id, row.item);
    scan();
  });

  let flashTimer = 0;
  function flash(btn, text) {
    const old = btn.dataset.pmzTitle ?? btn.title;
    btn.dataset.pmzTitle = old;
    btn.title = text;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(() => { btn.title = btn.dataset.pmzTitle ?? old; }, 1500);
  }

  function onClick(e) {
    const btn = e.currentTarget;
    const id = btn.closest(SEL.row)?.dataset?.id;
    const item = id && items.get(id);
    if (!item) return; // 還沒拿到 JSON:什麼都不做,不要清掉使用者的剪貼簿
    // 官網自己對這顆鈕沒有可用的處理(PoE2 沒有 extended.text),但仍然攔下來,
    // 免得哪天官網補上之後同一下點擊被處理兩次
    e.preventDefault();
    e.stopPropagation();
    const text = IT.itemTextFor(item);
    if (!text) return;
    navigator.clipboard.writeText(text).then(
      () => flash(btn, '已複製物品文字(可貼進 Path of Building)'),
      (err) => { console.warn('[PTM] 複製失敗:', err); flash(btn, '複製失敗'); }
    );
  }

  function scan() {
    let n = 0;
    for (const row of document.querySelectorAll(SEL.row)) {
      const btn = row.querySelector(SEL.copyBtn);
      if (!btn || !items.has(row.dataset.id)) continue;
      if (btn.dataset.pmzCopy) continue;
      btn.dataset.pmzCopy = '1';
      // ⚠ 捕獲階段:官網自己也綁在這顆鈕上,冒泡階段接手會晚一步
      btn.addEventListener('click', onClick, true);
      btn.classList.remove('hidden'); // 官網用 class 藏,CSS 那邊還要再壓一次
      btn.classList.add(READY_CLASS);
      n++;
    }
    if (n) dbg(`[PTM/PoE2] 複製物品:${n} 筆結果已接上`);
  }

  // 結果列是 SPA 重繪的:換頁、載入更多、重新搜尋都會換掉整批節點,
  // 所以不能只掃一次。整份文件觀察,只在有節點增減時重掃(掃描本身很便宜)。
  const mo = new MutationObserver(() => scan());
  mo.observe(document.documentElement, { childList: true, subtree: true });
  scan();
})();
