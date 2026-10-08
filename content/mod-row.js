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
// ⚠ **＋/− 都不帶數值**(2026-10-09 使用者裁定):＋ 只加入那條詞綴、MIN / MAX 留空;
//   曾帶「這件物品的數值當下限」(2026-08-30 起)與「所屬階級下限」(2026-10-09 試做),都已移除。
//
// ⚠ **非破壞性**:結果列是官網 Vue 渲染的,清空重建或增刪既有節點會讓 virtual DOM
//   與實際 DOM 不符,重繪時 diff 中斷、整個結果區卡死(results.js 的 setModText
//   有同一條教訓)。這裡只改既有文字節點的**內容**,一個節點都不增刪;按鈕放進
//   我們自己 append 到 .item-mod 尾端的 `.pmz-mod-tail`(官網不認得它,diff 不會踩到)。
//
// ── 位置:每條詞綴的最右側(2026-10-01 使用者裁定,同日第三版)──
//   P4          +8 點護甲           蠑螈之 (≥12) [T4 中 ][＋][−]
//   S8      1.2 每秒生命回復                     [T8 高 ][＋][−]
// 以前按鈕 absolute 在右側(right:22px)會蓋住官方右欄的群組名(「蠑螈之」),很多人要看那一欄;
// 第一版改成緊接文字後面又參差不齊、還把置中的文字往左推。現在徽章與按鈕共用一個
// `.pmz-mod-tail`(徽章在前、＋− 在後),absolute 在最右側,官方右欄由 CSS 往左挪到尾巴左邊。
// 誰先跑誰建 tail(ensureTail),另一支找到就沿用 —— 見 content/tier-badge.js 的同名函式。
// 版面規則全部在 content/sidebar.css(純 CSS,不量測、不寫官方節點)。
//
// 掛載點是 results.js 的 processContainer(見該檔末尾的 __pmzModRow 呼叫)——
// 不另開一套 MutationObserver,結果列串流時每一列都會經過那裡,多一套只是多一份成本。

(() => {
  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const GAME =
    globalThis.PMZ_GAME ??
    (/^\/trade2(\/|$)/.test(location.pathname) ? { id: 'poe2', label: 'PoE2' } : { id: 'poe1', label: 'PoE1' });
  // 詞綴群組名字典兩款都有(PoE1 ggpk.json / PoE2 ggpk2.json 的 modNames,2026-09-08 起
  // PoE2 也產出)。拿到空表 → 群組名照原樣顯示英文,按鈕不受影響照畫。
  const K = GAME.id === 'poe2' ? 'modNames2' : 'modNames';

  // ── 官網 DOM 耦合點(改版時優先檢查這裡)──
  const SELECTORS = {
    mod: '.item-mod',
    name: '.lc.r', // 詞綴群組名 + 等級要求
    inner: '.d', // 群組名的實際文字包在這一層裡
    text: '.s.lc', // 詞綴文字本體(＋ 不讀它的數值:2026-10-09 起 ＋ 不帶值)
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
    // 刻意做小 —— 結果卡本來就很擠,大顆亮色按鈕會蓋過真正要看的詞綴文字。
    // ── 按鈕放在 .pmz-mod-tail 裡(每條詞綴最右側),自己不定位 ──
    // 官網把 .lc.l(階級/roll)與 .lc.r(群組名)做成 absolute 的左右側欄;
    // **固定詞綴(item-mod--implicit)根本沒有 .lc.r**。尾巴的位置兩種詞綴都一樣。
    // ⚠ 不加 opacity / transform / z-index:尾巴已經把官方右欄挪開、不與官方欄位重疊,
    //   不需要也不該自成堆疊層(官方精簡模式的階級欄 z-index:1 要維持在最上層)。
    // ⚠ 滑過時只換顏色,不改尺寸/邊框寬度 —— 使用者回報過滑過時整列抖動。
    // 外框 .pmz-mod-tail 的版面(最右側定位、官方右欄位移、開關收合)寫在 content/sidebar.css。
    s.textContent = `
.pmz-mod-btns{display:inline-flex;gap:3px;vertical-align:middle}
.pmz-hide-mod-btns .pmz-mod-btns{display:none}
.pmz-mod-btn{cursor:pointer;border:1px solid;background:#12100c;
 font:bold 13px/14px system-ui,sans-serif;width:17px;height:17px;padding:0;border-radius:3px;
 text-align:center;display:flex;align-items:center;justify-content:center;
 box-shadow:0 1px 2px rgba(0,0,0,.6)}
.pmz-mod-btn.pmz-add{color:#7fd67f;border-color:#4f8a4f}
.pmz-mod-btn.pmz-add:hover{background:#7fd67f;color:#0d1a0d;border-color:#9ae59a}
.pmz-mod-btn.pmz-ex{color:#e87f7f;border-color:#8a4f4f}
.pmz-mod-btn.pmz-ex:hover{background:#e87f7f;color:#1a0d0d;border-color:#f59a9a}`;
    (document.head ?? document.documentElement).appendChild(s);
  }

  // ── 使用者開關:設定分頁「結果列的詞綴篩選按鈕(＋/−)」(settings.modFilterButtons)──
  // 關掉時按鈕照畫但用 CSS 藏起來(切換不必重畫結果列),storage 一變就即時生效。
  function applyButtonsSetting(settings) {
    const hide = settings?.modFilterButtons === false;
    document.documentElement.classList.toggle('pmz-hide-mod-btns', hide);
  }
  try {
    chrome.storage.local.get('settings').then((got) => applyButtonsSetting(got?.settings)).catch(() => {});
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'local' && changes.settings) applyButtonsSetting(changes.settings.newValue);
    });
  } catch (_) { /* 沒有 chrome.storage(離線驗證殼)就維持顯示 */ }

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

  function addButtons(mod) {
    const statId = statIdOf(mod);
    if (!statId || mod.querySelector('.pmz-mod-btns')) return;
    ensureStyle();
    const wrap = document.createElement('span');
    wrap.className = 'pmz-mod-btns';
    // 兩顆:加入 / 排除,**兩顆都不帶任何數值**(MIN / MAX 都留空,值由使用者在篩選面板自己填)。
    // ⚠ 2026-10-09 使用者裁定:＋ 只加入那條詞綴、不帶數值 —— 取代舊的「帶這件物品的數值當下限」
    //   與同日稍早試做的「帶所屬階級下限 + 同步階級選單」。要哪一階請用篩選列的階級選單(≈T▾)。
    // ⚠ 2026-08-31 使用者裁定移除過中間那顆「純加入(不帶數值)」第三顆鈕;現在是 ＋ 本身就是純加入,
    //   按鈕仍只有 ＋/− 兩顆。不要再加第三顆,也不要讓 ＋ 帶回數值。
    const t = (k, v) => globalThis.PMZ_I18N?.t(k, v) ?? k;
    const specs = [
      ['+', false, 'pmz-add', t('modrow.addPlain')],
      ['−', true, 'pmz-ex', t('modrow.exclude')],
    ];
    for (const [label, exclude, cls, tip] of specs) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = `pmz-mod-btn ${cls}`.trim();
      b.textContent = label;
      b.title = tip;
      b.addEventListener('click', (ev) => {
        // 結果卡整列都是可點的(會展開/選取),按鈕不能把事件漏下去
        ev.preventDefault();
        ev.stopPropagation();
        window.postMessage({ t: MSG, statId, exclude }, location.origin);
      });
      wrap.appendChild(b);
    }
    // 放進我們自己的 tail(徽章在前、按鈕在後),不動官網的任何節點
    ensureTail(mod).appendChild(wrap);
  }

  // ── 詞綴列尾巴:徽章 + ＋/− 共用的外框 ──
  // ⚠ 與 content/tier-badge.js 的 ensureTail **同名同形**(class 名一字不差):兩支腳本誰先跑
  //   誰建,另一支找到就沿用;任一支被關掉(或閘門沒開不畫按鈕)另一支照常運作。
  // append 不動既有節點:官網 Vue 的 diff 只在「既有節點被增刪」時會錯亂,
  // 尾端加一個自己的節點是安全的(results.js 的雙語小字早就這樣做了)。
  // 只看 .item-mod 的**直接子節點**:官網重繪換掉節點時 tail 跟著消失,下次再建。
  const TAIL_CLASS = 'pmz-mod-tail';
  function ensureTail(mod) {
    for (const c of mod.childNodes) if (c.nodeType === 1 && c.classList?.contains(TAIL_CLASS)) return c;
    const tail = document.createElement('span');
    tail.className = TAIL_CLASS;
    mod.classList.add('pmz-mod-host'); // 標記「這一列有我們的尾巴」(sidebar.css 不靠它定位)
    mod.appendChild(tail);
    return tail;
  }

  function localizeMod(mod) {
    if (mod.dataset[DONE_ATTR]) return;
    // 群組名:.lc.r 的內容整段包在 .d 裡
    const nameEl = mod.querySelector(SELECTORS.name);
    const nameInner = nameEl?.querySelector(SELECTORS.inner) ?? nameEl;
    if (nameInner && state.translate !== false) {
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
    // 按鈕一律接在詞綴文字後面 —— 不依賴 .lc.r 是否存在(固定詞綴就沒有那一格)
    if (state.buttons) { addButtons(mod); stat.btn++; }
    mod.dataset[DONE_ATTR] = '1';
  }

  let loading = null;
  function ensureModNames(translate) {
    // 不翻譯(English 介面、關閉翻譯、台服站)→ 群組名字典一個字都不讀,只畫按鈕
    if (!translate) { state.modNames ??= {}; return Promise.resolve(); }
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
      if (state.translate && stat.nameMiss && !Object.keys(state.modNames ?? {}).length) {
        console.warn(`[PTM/${GAME.label}] 詞綴群組名字典是空的,群組名全部顯示英文。` +
          '請在擴充選單按「清除快取」再按「繁體中文化(ZH_TW)」重建一次翻譯資料;' +
          '若重建後仍是空的,代表手上的字典檔沒有這款遊戲的群組名(等遠端字典更新)。');
      }
    }, 500);
  }

  // results.js 的 processContainer 會在翻完詞綴文字之後呼叫這支。
  // 它改的是 .lc.s,我們改 .lc.r,兩邊互不干擾。
  // `translate: false` = 只畫篩選按鈕、不動群組名(English 介面 / 關閉翻譯 / 台服站)。
  // 沒帶參數視同要翻(舊呼叫端與離線驗證腳本的行為不變)。
  globalThis.__pmzModRow = async (root, { translate = true } = {}) => {
    const mods = root.querySelectorAll?.(SELECTORS.mod);
    if (!mods?.length) return;
    state.translate = translate;
    await ensureModNames(translate);
    // 每一批都重新問一次官網篩選面板在不在(SPA 會整個重建畫面)。
    // 掛不上就只做中文化、不畫按鈕 —— 畫一顆按不動的按鈕比沒有按鈕更糟。
    state.buttons = filterReady();
    mods.forEach(localizeMod);
    report();
  };

  // 供離線驗證腳本呼叫真正的實作(不另外複製一份,避免測試與實機分歧)
  globalThis.__pmzModRowInternals = {
    SELECTORS, modNameZh, setFirstText, state, stat, ensureTail, TAIL_CLASS, applyButtonsSetting,
  };
})();
