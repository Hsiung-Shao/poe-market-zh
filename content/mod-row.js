// document_end(isolated):結果卡詞綴列的「群組名中文化」與「加入篩選」按鈕。
//
// ── 資料全部來自官網原生 DOM,零額外網路請求 ──
// 2026-08-30 於活站(已登入)實測,一條 .item-mod 底下是三個 span:
//   <span class="s lc" data-field="stat.explicit.stat_1037193709">附加 15 至 30 冰冷傷害</span>
//   <span class="lc l pr">P9<span class="d">[12—17 to 26—30]</span></span>  ← 階級 + roll 範圍
//   <span class="lc r pr"><span class="d">Chilled (≥12)</span></span>       ← 群組名 + 等級要求
// 我們只動第三個:`Chilled` → 「冷凍的」。
// ⚠ **階級那一格(.lc.l)一個字都不碰。** 曾經做過 `P9` → 「前 T9」與「T 數階梯
//   浮層」,2026-08-30 由使用者裁定移除 —— 需要的只是「把這條詞綴丟進篩選區」。
//
// ⚠ **非破壞性**:結果列是官網 Vue 渲染的,清空重建或增刪既有節點會讓 virtual DOM
//   與實際 DOM 不符,重繪時 diff 中斷、整個結果區卡死(results.js 的 setModText
//   有同一條教訓)。這裡只改既有文字節點的**內容**,一個節點都不增刪;按鈕是
//   append 到尾端的新節點(官網不認得它,diff 不會踩到)。
//
// 掛載點是 results.js 的 processContainer(見該檔末尾的 __pmzModRow 呼叫)——
// 不另開一套 MutationObserver,結果列串流時每一列都會經過那裡,多一套只是多一份成本。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const GAME =
    globalThis.PMZ_GAME ??
    (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2', label: 'PoE2' } : { id: 'poe1', label: 'PoE1' });
  // 詞綴群組名字典目前只有 PoE1 有(PoE2 的 ggpk2.json 走另一支管線,沒有 Mods.Name)。
  // PoE2 拿到的是空表 → 群組名照原樣顯示英文,按鈕不受影響照畫。
  const K = GAME.id === 'poe2' ? 'modNames2' : 'modNames';

  // ── 官網 DOM 耦合點(改版時優先檢查這裡)──
  const SELECTORS = {
    mod: '.item-mod',
    name: '.lc.r', // 詞綴群組名 + 等級要求
    inner: '.d', // 群組名的實際文字包在這一層裡
    text: '.s.lc', // 詞綴文字本體;這件物品上的實際數值就在這裡面
  };
  const DONE_ATTR = 'pmzModRow'; // → data-pmz-mod-row,與 results.js 的 data-ptm-done 分開

  const state = { modNames: null, buttons: false };
  const stat = { name: 0, nameMiss: 0, btn: 0, missSamples: [] };

  // `Chilled (≥12)` → 「冷凍的 (≥12)」。等級那段原樣保留(它是數字,沒有翻的餘地)。
  // ⚠ 查不到就回 null → 整格保持英文。**不要猜**:同一個英文群組名對到多個官方
  //   中文是常態(`Chilled` 在箭袋是「結冰的」、其餘是「冷凍的」),產生器已經把
  //   235 個歧義的英文整批排除在字典之外(見 tools/gen-ggpk-data.mjs)。
  const LEVEL_RE = /\s*\(≥\s*\d+\)\s*$/;
  function modNameZh(text) {
    const raw = String(text ?? '').trim();
    if (!raw || !state.modNames) return null;
    const m = LEVEL_RE.exec(raw);
    const name = m ? raw.slice(0, m.index).trim() : raw;
    const level = m ? m[0].trim() : '';
    const zh = state.modNames[name];
    if (!zh) {
      if (name && stat.missSamples.length < 5) stat.missSamples.push(name);
      return null;
    }
    return level ? `${zh} ${level}` : zh;
  }

  // 只改第一個有內容的文字節點,不增刪節點(見檔頭的非破壞性說明)
  function setFirstText(el, text) {
    if (!el) return false;
    for (const n of el.childNodes) {
      if (n.nodeType === Node.TEXT_NODE && n.textContent.trim()) {
        n.textContent = text;
        return true;
      }
    }
    return false;
  }

  // ── 加入篩選 / 排除的按鈕 ──
  // 實際操作官網 Vue 的是 page/mod-filter.js(MAIN world,`window.app` 只有那邊
  // 看得到),這裡只負責畫按鈕與送訊息。
  const MSG = 'pmz:addStatFilter';
  const FIELD_PREFIX = 'stat.'; // data-field="stat.explicit.stat_123" → explicit.stat_123
  const STYLE_ID = 'pmz-mod-row-style';

  function ensureStyle() {
    if (document.getElementById(STYLE_ID)) return;
    const s = document.createElement('style');
    s.id = STYLE_ID;
    // 刻意做小、只在滑到那一列時才明顯 —— 結果卡本來就很擠,常駐的亮色按鈕
    // 會蓋過真正要看的詞綴文字
    // ── 按鈕固定在每一列的右側 ──
    // 官網把 .lc.l(階級/roll)與 .lc.r(群組名)做成 absolute 的左右側欄,而
    // **固定詞綴(item-mod--implicit)根本沒有 .lc.r** —— 早期版本因此把按鈕
    // 掛到左欄去,同一張卡上按鈕一下左一下右。改成自己定位,兩種詞綴都一樣。
    // ⚠ 這需要讓 .item-mod 成為定位基準。2026-08-30 於活站實測:對 .item-mod
    //   設 position:relative 之後,.lc.l / .lc.r 的 getBoundingClientRect
    //   **一個像素都沒變**(它們的 left/right 是相對同寬同左緣的容器算的),
    //   item-popup 的尺寸也沒變。不是推論,是量過的。
    // right:22px 是讓開 .lc.r 那 20px 的欄寬 —— 按鈕落在群組名左邊,
    // 與使用者提供的參考截圖同一個位置。
    s.textContent = `
.pmz-mod-host{position:relative}
.pmz-mod-btns{position:absolute;right:22px;top:50%;transform:translateY(-50%);
 display:inline-flex;gap:3px;z-index:3;opacity:.9;transition:opacity .12s}
.item-mod:hover .pmz-mod-btns{opacity:1}
.pmz-mod-btn{cursor:pointer;border:1px solid;background:#12100c;
 font:bold 13px/14px system-ui,sans-serif;width:17px;height:17px;padding:0;border-radius:3px;
 text-align:center;display:flex;align-items:center;justify-content:center;
 box-shadow:0 1px 2px rgba(0,0,0,.6)}
.pmz-mod-btn.pmz-add{color:#7fd67f;border-color:#4f8a4f}
.pmz-mod-btn.pmz-add:hover{background:#7fd67f;color:#0d1a0d;border-color:#9ae59a}
.pmz-mod-btn.pmz-plain{color:#e6c88c;border-color:#7a6a4a}
.pmz-mod-btn.pmz-plain:hover{background:#e6c88c;color:#1a1612;border-color:#f2d9a4}
.pmz-mod-btn.pmz-ex{color:#e87f7f;border-color:#8a4f4f}
.pmz-mod-btn.pmz-ex:hover{background:#e87f7f;color:#1a0d0d;border-color:#f59a9a}`;
    (document.head ?? document.documentElement).appendChild(s);
  }

  // MAIN world 那邊確認官網篩選群組真的找得到,才畫按鈕。
  // ⚠ 即時判定,不記憶上次結果 —— 閘門用快取旗標會讓修好之後還要多重整一次
  //   (agent-data error_vue2_methods_not_on_prototype 的教訓)。
  function filterReady() {
    try {
      window.dispatchEvent(new Event('pmz:checkFilterReady'));
      return document.documentElement.dataset.pmzFilterReady === '1';
    } catch (_) {
      return false;
    }
  }

  function statIdOf(mod) {
    const el = mod.querySelector('[data-field^="stat."]');
    const field = el?.getAttribute('data-field') ?? '';
    return field.startsWith(FIELD_PREFIX) ? field.slice(FIELD_PREFIX.length) : null;
  }

  // 這一條詞綴在這件物品上的實際數值,拿來當篩選的下限。
  // 取**第一個**數字:與 content/pob-import.js:322 的既有做法一致
  // (`if (values.length) filter.value = { min: values[0] }`),不另立一套規則。
  // 「附加 24 至 50 火焰傷害」→ 24(下限取低的那個才不會把物品濾掉);
  // 「+103 命中值」→ 103。負數要連負號一起吃(有 `-12% 最大抗性` 這種詞綴)。
  const NUM_RE = /-?\d+(?:\.\d+)?/;
  function modValue(mod) {
    const el = mod.querySelector(SELECTORS.text) ?? mod;
    const m = NUM_RE.exec(el.textContent ?? '');
    if (!m) return null;
    const n = Number(m[0]);
    return Number.isFinite(n) ? n : null;
  }

  function addButtons(mod) {
    const statId = statIdOf(mod);
    if (!statId || mod.querySelector('.pmz-mod-btns')) return;
    ensureStyle();
    const value = modValue(mod);
    const wrap = document.createElement('span');
    wrap.className = 'pmz-mod-btns';
    // 兩顆:加入 / 排除。
    // 抽得到數值就帶下限進去,抽不到就純加入 —— 同一顆按鈕、同一個位置。
    // ⚠ 2026-08-31 使用者裁定**移除中間那顆「純加入(不帶數值)」**:多一顆選擇
    //   讓每一列都要多想一次,而下限填錯了在篩選面板上改比較快。不要再加回來。
    const specs = [
      value != null
        ? ['+', false, 'pmz-add', `加入篩選並帶入下限 ${value}`, value]
        : ['+', false, 'pmz-plain', '加入篩選(這條沒有數值)', null],
      ['−', true, 'pmz-ex', '加入排除條件', null],
    ];
    for (const [label, exclude, cls, tip, min] of specs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pmz-mod-btn ${cls}`.trim();
      b.textContent = label;
      b.title = tip;
      b.addEventListener('click', (ev) => {
        // 結果卡整列都是可點的(會展開/選取),按鈕不能把事件漏下去
        ev.preventDefault();
        ev.stopPropagation();
        const msg = { t: MSG, statId, exclude };
        if (min != null) msg.min = min;
        window.postMessage(msg, location.origin);
      });
      wrap.appendChild(b);
    }
    // append 不動既有節點:官網 Vue 的 diff 只在「既有節點被增刪」時會錯亂,
    // 尾端加一個自己的節點是安全的(results.js 的雙語小字早就這樣做了)。
    mod.classList.add('pmz-mod-host'); // 讓這一列成為定位基準(見 ensureStyle 的實測說明)
    mod.appendChild(wrap);
  }

  function localizeMod(mod) {
    if (mod.dataset[DONE_ATTR]) return;
    // 群組名:.lc.r 的內容整段包在 .d 裡
    const nameEl = mod.querySelector(SELECTORS.name);
    const nameInner = nameEl?.querySelector(SELECTORS.inner) ?? nameEl;
    if (nameInner) {
      const raw = nameInner.textContent;
      const zh = modNameZh(raw);
      if (zh) {
        if (setFirstText(nameInner, zh)) {
          nameInner.title = raw.trim(); // 英文原文 hover 可查,與 results.js 的做法一致
          stat.name++;
        }
      } else if (raw.trim()) {
        stat.nameMiss++;
      }
    }
    // 按鈕一律固定在該列右側 —— 不依賴 .lc.r 是否存在(固定詞綴就沒有那一格)
    if (state.buttons) { addButtons(mod); stat.btn++; }
    mod.dataset[DONE_ATTR] = '1';
  }

  let loading = null;
  function ensureModNames() {
    if (loading) return loading;
    loading = chrome.storage.local
      .get(K)
      .then((got) => { state.modNames = got[K] ?? {}; })
      .catch((err) => { console.warn('[PTM] 詞綴群組名字典載入失敗:', err); state.modNames = {}; });
    return loading;
  }

  let reportTimer = null;
  function report() {
    if (reportTimer) return;
    reportTimer = setTimeout(() => {
      reportTimer = null;
      if (!stat.name && !stat.nameMiss && !stat.btn) return;
      dbg(`[PTM/${GAME.label}] 詞綴列:群組名譯出 ${stat.name} 條、查無 ${stat.nameMiss} 條` +
        `${stat.missSamples.length ? `(樣本 ${stat.missSamples.join('、')})` : ''};` +
        `篩選按鈕 ${state.buttons ? `${stat.btn} 條` : '未掛上(找不到官網篩選面板)'}`);
      // 字典整個是空的:代表 storage 裡沒有 modNames(擴充更新後尚未重建),
      // 不是「這些詞綴剛好都查不到」。這兩件事的處置完全不同,要講清楚。
      if (stat.nameMiss && !Object.keys(state.modNames ?? {}).length) {
        console.warn('[PTM] 詞綴群組名字典是空的,群組名全部顯示英文。' +
          '請在擴充選單按「繁體中文化(ZH_TW)」重建一次翻譯資料。');
      }
    }, 500);
  }

  // results.js 的 processContainer 會在翻完詞綴文字之後呼叫這支。
  // 它改的是 .lc.s,我們改 .lc.r,兩邊互不干擾。
  globalThis.__pmzModRow = async (root) => {
    const mods = root.querySelectorAll?.(SELECTORS.mod);
    if (!mods?.length) return;
    await ensureModNames();
    // 每一批都重新問一次官網篩選面板在不在(SPA 會整個重建畫面)。
    // 掛不上就只做中文化、不畫按鈕 —— 畫一顆按不動的按鈕比沒有按鈕更糟。
    state.buttons = filterReady();
    mods.forEach(localizeMod);
    report();
  };

  // 供離線驗證腳本呼叫真正的實作(不另外複製一份,避免測試與實機分歧)
  globalThis.__pmzModRowInternals = {
    SELECTORS, modNameZh, setFirstText, state, stat, modValue,
  };
})();
