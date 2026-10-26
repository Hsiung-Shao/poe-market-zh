// isolated world / document_end:結果列的固定英文介面字串中文化。
//
// 官網結果列是另一套 Vue 3 前端(2026-10-08 起),用官網自己的多語系類別取字串,
// 語言是英文時直接回原文、不查 page/ui-strings.js 的 `__` 字典,所以「Exact Price:」
// 「Direct Whisper」這些字只能在畫面上換。
// 只換「整段完全相符」的固定標籤與幾個帶數字的樣式:物品名、詞綴、玩家名都對不上而不動;
// 我們自己畫的元素與保留的英文原文另外排除。官網重繪改字(例:按下密語後變「Sent!」)時,
// 監聽到文字變動再換一次。只在交易站中文化開著(ptm-ui-mode = 'zh')時動作。
(() => {
  const EXACT = {
    Verified: '已驗證',
    'Exact Price:': '定價:',
    'Asking Price:': '要價:',
    'Negotiable Price:': '可議價:',
    'IGN:': '角色名稱:',
    'Direct Whisper': '直接密語',
    'Sent!': '已送出!',
    'Ignore Player': '忽略玩家',
    AFK: '暫離',
    Online: '線上',
    Offline: '離線',
    'Load More': '載入更多',
    // 物品卡的等級與需求行,實機是拆開的節點:<span>Item Level</span>: <span>84</span>、Requires <span>Level</span> 67
    'Item Level': '物品等級',
    Requires: '需求',
    Level: '等級',
  };
  const UNITS = { second: '秒', minute: '分鐘', hour: '小時', day: '天', week: '週', month: '個月', year: '年' };
  const PHRASES = { yesterday: '昨天', 'last week': '上週', 'last month': '上個月', 'last year': '去年', 'just now': '剛剛' };
  const PATTERNS = [
    [/^Showing ([\d,]+) results? \(([\d,]+) matched\)$/, (m, shown, total) => `顯示 ${shown} 筆結果(共 ${total} 筆符合)`],
    [/^Item Level: (\d+)$/, (m, n) => `物品等級: ${n}`],
    [/^Requires Level (\d+)(.*)$/, (m, n, rest) => `需求等級 ${n}${rest}`],
    [/^listed (\d+|an?) (second|minute|hour|day|week|month|year)s? ago$/,
      (m, n, unit) => `${/^an?$/.test(n) ? 1 : n} ${UNITS[unit]}前上架`],
    [/^listed (yesterday|last week|last month|last year|just now)$/, (m, p) => `${PHRASES[p]}上架`],
  ];
  // 詞綴、物品名、我們保留的英文原文、我們自己畫的元素
  const SKIP = '.item-mod, .itemName, .typeLine, .ptm-orig, [class*="pmz-"]';
  // ⚠ <body> 也會帶我們的 class(偽屬性醒目的 pmz-hl-pseudo),命中 body / html 不算「我們畫的元素」,
  //   否則整頁都被排除、一個字都不換(2026-10-26 實機)
  const skipped = (node) => {
    const hit = node.parentElement?.closest?.(SKIP);
    return !!hit && hit.tagName !== 'BODY' && hit.tagName !== 'HTML';
  };

  function translateText(text) {
    if (typeof text !== 'string' || !text) return null;
    if (Object.hasOwn(EXACT, text)) return EXACT[text];
    for (const [re, fn] of PATTERNS) {
      const m = re.exec(text);
      if (m) return fn(...m);
    }
    return null;
  }

  // 每次才讀:切換語言重新整理後即生效,離線驗證也靠這點逐段切換
  const zhMode = () => {
    try {
      return localStorage.getItem('ptm-ui-mode') === 'zh';
    } catch (_) {
      return false;
    }
  };

  function fixNode(node) {
    const raw = node.nodeValue;
    const text = raw?.trim();
    if (!text) return;
    const zh = translateText(text); // 先比對(便宜),對上了才查祖先
    if (zh == null || skipped(node)) return;
    const at = raw.indexOf(text);
    node.nodeValue = raw.slice(0, at) + zh + raw.slice(at + text.length);
  }

  function applyTo(root) {
    if (!root || !zhMode()) return;
    if (root.nodeType === 3) {
      fixNode(root);
      return;
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) fixNode(n);
  }

  globalThis.__pmzResultUi = { translateText, applyTo };

  // 結果列串流、按「載入更多」、官網改字都會進來;合併成一批再處理
  function watch() {
    const pending = new Set();
    let timer = null;
    const flush = () => {
      timer = null;
      for (const n of pending) if (n.isConnected !== false) applyTo(n);
      pending.clear();
    };
    const queue = (n) => {
      if (!n) return;
      pending.add(n);
      if (!timer) timer = setTimeout(flush, 50);
    };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        if (m.type === 'characterData') queue(m.target);
        else for (const n of m.addedNodes) queue(n);
      }
    }).observe(document.body, { childList: true, subtree: true, characterData: true });
    applyTo(document.body);
  }
  if (zhMode() && document.body) watch();
})();
