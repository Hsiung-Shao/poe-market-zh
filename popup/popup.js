// 擴充頁(不再是工具列的 popup):2026-11-04 起點擴充圖示直接打開交易站側邊欄的 ⚙ 設定(使用者裁定),
// 設定畫面全部在側邊欄。這一頁只剩三種用途,都由背景開成分頁:
//   ?ask=lang   全新安裝選語言,選完接著問一次物價權限(background.js onInstalled)
//   ?ask=ninja  poe.ninja 授權退路(物價查詢 / poe.ninja 雙語;Firefox 不能在背景直接跳授權對話框,bg/perms.js)
//   ?ask=pobbin pobb.in 授權退路(pobb.in 中文化,同上)
// 沒帶 ask 打開時直接請背景打開交易站設定。
//
// 介面語言(uiLang,2026-09-21):中文 / English。English = 交易站不翻、不載任何中文資料。字串表在 shared/i18n.js。

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const I18N = globalThis.PMZ_I18N;
const t = (k, v) => I18N.t(k, v);
const ASK = new URLSearchParams(location.search).get('ask');

I18N.register({
  zh: {
    'pop.uiLang': '介面語言 / Language',
    'pop.tagline': 'PoE 交易站、pobb.in、poe.ninja 的中文輔助工具',
    'pop.ninja': '允許存取 poe.ninja',
    'pop.pobbin': '允許存取 pobb.in',
    'pop.openSettings': '開啟交易站設定',
    'pop.ninjaAsk': '側邊欄的「物價」分頁與 poe.ninja 雙語要讀 poe.ninja。\n要用的話請按上面的按鈕允許存取;不需要就直接關掉這一頁。',
    'pop.ninjaOn': '已允許存取 poe.ninja,回交易頁的側邊欄即可使用物價查詢',
    'pop.ninjaOff': '沒有取得 poe.ninja 的存取權限',
    'pop.pobbinAsk': 'pobb.in 中文化要讀 pobb.in 的頁面。\n要用的話請按上面的按鈕允許存取,再回側邊欄的 設定 →「中文化與網站」打開。',
    'pop.pobbinOn': '已允許存取 pobb.in,回側邊欄的 設定 →「中文化與網站」打開 pobb.in 中文化',
    'pop.pobbinOff': '沒有取得 pobb.in 的存取權限',
    'pop.applying': '已套用中文化,建置翻譯資料中…',
    'pop.unknownErr': '未知錯誤',
    'pop.fail': '✗ {msg}',
    'pop.listSep': '、',
    'pop.langDone': '設定好了。開交易站時側邊欄就在畫面邊緣;之後點瀏覽器工具列的擴充圖示,可以直接打開設定。',
    'pop.uiSwitched': '介面語言已切換,已清除下載的中文資料;重新整理交易頁生效',
    'pop.chooseLang': '請先選擇介面語言 / Please choose your language',
    'pop.chooseLangOption': '— 請選擇 / Choose —',
  },
  en: {
    'pop.uiLang': 'Language',
    'pop.tagline': 'Bookmarks and price check for the PoE trade site, plus Chinese for pobb.in and bilingual poe.ninja',
    'pop.ninja': 'Allow access to poe.ninja',
    'pop.pobbin': 'Allow access to pobb.in',
    'pop.openSettings': 'Open trade site settings',
    'pop.ninjaAsk': 'The sidebar "Prices" tab and poe.ninja bilingual read from poe.ninja.\nTo use them, click the button above and allow access. Otherwise just close this page.',
    'pop.ninjaOn': 'Access to poe.ninja granted. Price check is ready in the sidebar on the trade page',
    'pop.ninjaOff': 'Access to poe.ninja was not granted',
    'pop.pobbinAsk': 'Chinese on pobb.in needs to read pobb.in pages.\nClick the button above to allow access, then turn it on in the sidebar: Settings → "Language & sites".',
    'pop.pobbinOn': 'Access to pobb.in granted. Turn it on in the sidebar: Settings → "Language & sites"',
    'pop.pobbinOff': 'Access to pobb.in was not granted',
    'pop.applying': 'Chinese enabled, building translation data…',
    'pop.unknownErr': 'unknown error',
    'pop.fail': '✗ {msg}',
    'pop.listSep': ', ',
    'pop.langDone': 'All set. The sidebar sits at the edge of the trade site; click the extension icon in the browser toolbar to open its settings any time.',
    'pop.uiSwitched': 'Language changed. Downloaded Chinese data was removed. Reload the trade page to apply',
    'pop.chooseLang': 'Please choose your language',
    'pop.chooseLangOption': '— Choose —',
  },
});

const ORIGINS = { ninja: 'https://poe.ninja/*', pobbin: 'https://pobb.in/*' };

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

let uiLang = 'zh';
let uiLangChosen = false;

function applyUiLang(lang) {
  uiLangChosen = I18N.isChosen(lang);
  uiLang = I18N.normalize(lang);
  I18N.setLang(uiLang);
  document.documentElement.lang = I18N.langInfo(uiLang).html;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  renderLangSelect();
}

// 語言下拉:選項一律由語言清單長出來(加語言不必動這裡)。語言名是 endonym,
// 還沒選時多一個「請選擇」佔位項,選過就拿掉(不能選回「未選」)。
function renderLangSelect() {
  const sel = $('#uiLangSel');
  sel.textContent = '';
  if (!uiLangChosen) {
    const ph = document.createElement('option');
    ph.value = '';
    ph.textContent = t('pop.chooseLangOption');
    ph.disabled = true;
    sel.append(ph);
  }
  for (const l of I18N.langs()) {
    const opt = document.createElement('option');
    opt.value = l.id;
    opt.textContent = l.name;
    sel.append(opt);
  }
  sel.value = uiLangChosen ? uiLang : '';
}

// init 裡任何一步丟例外都會讓這頁停在半成品,所以權限查詢自己吞掉錯誤,查不到就當作沒開
async function granted(site) {
  try {
    return await chrome.permissions.contains({ origins: [ORIGINS[site]] });
  } catch (_) {
    return false;
  }
}

// 授權鈕:⚠ permissions.request 必須是 click handler 裡的**第一個** await
// (Firefox 只承認使用者輸入處理器裡第一個呼叫的手勢,await 過後 request 會被拒)
function bindAsk(site, btnSel, onKey, offKey) {
  $(btnSel).addEventListener('click', async () => {
    const ok = await chrome.permissions.request({ origins: [ORIGINS[site]] }).catch(() => false);
    $(btnSel).classList.toggle('armed', !ok);
    showStatus(t(ok ? onKey : offKey), !ok);
  });
}
bindAsk('ninja', '#ninjaToggle', 'pop.ninjaOn', 'pop.ninjaOff');
bindAsk('pobbin', '#pobbinToggle', 'pop.pobbinOn', 'pop.pobbinOff');

function showAsk(site) {
  const btn = $(site === 'ninja' ? '#ninjaToggle' : '#pobbinToggle');
  btn.hidden = false;
  btn.classList.add('armed');
  showStatus(t(site === 'ninja' ? 'pop.ninjaAsk' : 'pop.pobbinAsk'));
}

// 「套用中文化」要重建**使用者實際用過的每一款**,不是只有 PoE1
async function buildSeenGames() {
  showStatus(t('pop.applying'));
  const { gamesSeen } = await chrome.storage.local.get('gamesSeen');
  const games = Object.keys(gamesSeen ?? {});
  try {
    const failed = [];
    for (const game of games.length ? games : ['poe1']) {
      const res = await chrome.runtime.sendMessage({ t: 'translation:build', game });
      if (!res?.ok) failed.push(`${game}:${res?.error ?? t('pop.unknownErr')}`);
    }
    if (failed.length) showStatus(t('pop.fail', { msg: failed.join(t('pop.listSep')) }), true);
  } catch (err) {
    showStatus(t('pop.fail', { msg: err.message }), true);
  }
}

// ── 介面語言(全新安裝的語言選擇頁)──
// 不翻交易站的語言(English…):不載中文資料(背景會清掉已下載的)。
// 翻交易站的語言(中文):同時套用中文化並建置 —— 選中文的人要的就是中文的交易站。
$('#uiLangSel').addEventListener('change', async () => {
  const lang = I18N.langs().find((l) => l.id === $('#uiLangSel').value);
  if (!lang) return;
  const language = lang.translatesSite ? 'zh_tw' : 'us';
  await chrome.storage.local.set({ uiLang: lang.id, language });
  applyUiLang(lang.id);
  if (lang.translatesSite) await buildSeenGames();
  showStatus(t(lang.translatesSite ? 'pop.langDone' : 'pop.uiSwitched'));
  $('#openSettings').hidden = false;
  // 選完語言接著問一次物價權限(background.js 在全新安裝時只開這一頁,不另開 ?ask=ninja)
  await chrome.storage.local.set({ ninjaAsked: true });
  if (!(await granted('ninja'))) showAsk('ninja');
});

$('#openSettings').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'ui:open-settings' }).catch(() => {});
  window.close();
});

async function init() {
  $('#version').textContent = chrome.runtime.getManifest().version;
  const { language, uiLang: stored } = await chrome.storage.local.get(['language', 'uiLang']);
  // 沒有 uiLang 但有 language = 舊使用者 → 中文
  applyUiLang(I18N.effectiveUiLang(stored, language));
  if (ASK === 'lang') {
    $('#langCard').hidden = false;
    if (!uiLangChosen) showStatus(t('pop.chooseLang'));
    else $('#openSettings').hidden = false;
    return;
  }
  if (ASK === 'ninja' || ASK === 'pobbin') {
    if (await granted(ASK)) showStatus(t(ASK === 'ninja' ? 'pop.ninjaOn' : 'pop.pobbinOn'));
    else showAsk(ASK);
    return;
  }
  // 沒帶 ask:舊書籤 / 從擴充管理頁打開 → 直接轉去交易站設定
  await chrome.runtime.sendMessage({ t: 'ui:open-settings' }).catch(() => {});
  window.close();
}

init().catch((err) => showStatus(t('pop.fail', { msg: err?.message ?? err }), true));
