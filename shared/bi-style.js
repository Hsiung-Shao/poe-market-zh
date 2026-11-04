// 雙語小字的外觀設定(2026-11-04 使用者要求):字級(交易市集 + pobb.in / poe.ninja 共用)與
// pobb.in / poe.ninja 的顏色(交易市集維持灰褐)。storage 頂層兩個鍵,與 bilingualMods 同層:
//   bilingualFontSize  整數 px,10–25,預設 11(與原本寫死的大小相同)
//   bilingualColor     #rrggbb,預設 #6ee7a8(10-08 為 pobb.in 深色底選的亮綠)
// 純 script、不用 import:側邊欄、結果列(content script)與 site-zh(動態註冊)共用同一份。
// 讀到的值一律先過 normSize / normColor:壞值不能讓字變 0、爆大或看不見。
(() => {
  const g = globalThis;
  if (g.PMZ_BISTYLE) return;
  const DEFAULT_COLOR = '#6ee7a8';
  const DEFAULT_SIZE = 11;
  const MIN = 10;
  const MAX = 25;
  g.PMZ_BISTYLE = {
    DEFAULT_COLOR,
    DEFAULT_SIZE,
    MIN,
    MAX,
    normSize(v) {
      const n = typeof v === 'number' ? v : NaN;
      return Number.isFinite(n) ? Math.min(MAX, Math.max(MIN, Math.round(n))) : DEFAULT_SIZE;
    },
    normColor(v) {
      return typeof v === 'string' && /^#[0-9a-f]{6}$/i.test(v) ? v.toLowerCase() : DEFAULT_COLOR;
    },
  };
})();
