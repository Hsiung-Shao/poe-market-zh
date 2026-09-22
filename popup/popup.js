// Popup:介面語言、交易站語系與翻譯資料維護。
// 設定即存即用,交易頁重新整理後生效。
//
// 介面語言(uiLang,2026-09-21):中文 / English。English = 交易站不翻、不載任何中文資料、
// 不連台服 API(守門在 bg/translation.js 的 buildTranslation)。翻譯相關的按鈕與字典狀態
// 只在中文介面出現。字串表在 shared/i18n.js(popup.html 先載入它)。

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');
const I18N = globalThis.PMZ_I18N;
const t = (k, v) => I18N.t(k, v);

I18N.register({
  zh: {
    'pop.uiLang': '介面語言 / Language',
    'pop.langNow': '目前語系',
    'pop.applyZh': '繁體中文化(ZH_TW)',
    'pop.restoreEn': '還原回英文(US)',
    'pop.bilingual': '詞綴雙語顯示(附英文原文)',
    'pop.sidebar': '側邊欄(書籤 / 歷史 / 物價)',
    'pop.ninja': '物價查詢(poe.ninja)',
    'pop.clearCache': '清除快取',
    'pop.tip1': '套用後記得重新整理交易頁讓修改生效',
    'pop.tip2': 'POE 改版後,先「清除快取」再重新套用,就能用英文搜到新道具',
    'pop.tip3': '開啟交易站時若翻譯資料超過 6 小時會自動背景更新;台服跟上改版後會自動補上新詞綴',
    'pop.src.remote': '遠端',
    'pop.src.cache': '快取',
    'pop.src.bundled': '內建',
    'pop.dict.head': '字典來源:',
    'pop.dict.none': '尚未載入',
    'pop.dict.remoteVer': '遠端字典 v{v}',
    'pop.dict.remoteErr': '遠端未取得({error})',
    'pop.dict.game1': 'PoE1 遊戲資料 {ver}{day}',
    'pop.dict.game2': 'PoE2 遊戲資料 {ver}{day}',
    'pop.dict.day': '({day})',
    'pop.dict.failed': '⚠ 取得失敗:{list}',
    'pop.listSep': '、',
    'pop.st.building': '{label} 建置中… ({time})',
    'pop.st.done': '✓ {msg}\n更新於 {time}',
    'pop.st.error': '✗ {label} 建置失敗:{msg}',
    'pop.st.lscache': '✗ {label} 交易站頁面空間不足,{list} 未套用{used}\n請在交易站分頁關掉其他交易站擴充,或按上方「清除快取」後重新整理',
    'pop.st.lscacheUsed': '(已用 {kb} KB / 上限約 5120 KB)',
    'pop.st.none': '尚未建置翻譯資料',
    'pop.st.fetchErr': '無法取得狀態:{error}',
    'pop.sidebarToggled': '已{state}側邊欄,重新整理交易頁生效',
    'pop.bilingualToggled': '已{state}詞綴雙語顯示,重新整理交易頁生效',
    'pop.opened': '開啟',
    'pop.closed': '關閉',
    'pop.ninjaAsk': '側邊欄的「物價」分頁要讀 poe.ninja 的公開匯率。\n要用的話請按上面的「物價查詢(poe.ninja)」允許存取;不需要就直接關掉這一頁。',
    'pop.ninjaOn': '已開啟物價查詢,回交易頁的側邊欄「物價」分頁即可使用',
    'pop.ninjaOff': '已關閉物價查詢',
    'pop.applying': '已套用中文化,建置翻譯資料中…',
    'pop.unknownErr': '未知錯誤',
    'pop.fail': '✗ {msg}',
    'pop.restored': '已還原英文,重新整理交易頁生效',
    'pop.cleared': '已清除,下次開啟交易頁會重新建置',
    'pop.initFail': '初始化失敗:{error}',
    'pop.uiSwitched': '介面語言已切換,已清除下載的中文資料;重新整理交易頁生效',
    'pop.chooseLang': '請先選擇介面語言 / Please choose your language',
    'pop.chooseLangOption': '— 請選擇 / Choose —',
  },
  en: {
    'pop.uiLang': 'Language',
    'pop.langNow': 'Trade site language',
    'pop.applyZh': 'Translate to Chinese (ZH_TW)',
    'pop.restoreEn': 'Restore English (US)',
    'pop.bilingual': 'Bilingual mods (show English)',
    'pop.sidebar': 'Sidebar (bookmarks / history / prices)',
    'pop.ninja': 'Price check (poe.ninja)',
    'pop.clearCache': 'Clear cache',
    'pop.tip1': 'Reload the trade page after changing settings',
    'pop.tip2': 'Bookmarks, history and prices live in the sidebar on the trade site',
    'pop.tip3': 'Works on pathofexile.com/trade, /trade2 and the Taiwan trade site',
    'pop.src.remote': 'remote',
    'pop.src.cache': 'cache',
    'pop.src.bundled': 'bundled',
    'pop.dict.head': 'Dictionary source: ',
    'pop.dict.none': 'not loaded',
    'pop.dict.remoteVer': 'Remote dictionary v{v}',
    'pop.dict.remoteErr': 'Remote not available ({error})',
    'pop.dict.game1': 'PoE1 game data {ver}{day}',
    'pop.dict.game2': 'PoE2 game data {ver}{day}',
    'pop.dict.day': ' ({day})',
    'pop.dict.failed': '⚠ Failed: {list}',
    'pop.listSep': ', ',
    'pop.st.building': '{label} building… ({time})',
    'pop.st.done': '✓ {msg}\nUpdated {time}',
    'pop.st.error': '✗ {label} build failed: {msg}',
    'pop.st.lscache': '✗ {label}: not enough page storage, {list} not applied{used}\nDisable other trade extensions on the trade tab, or press "Clear cache" and reload',
    'pop.st.lscacheUsed': ' (used {kb} KB of ~5120 KB)',
    'pop.st.none': 'No translation data built yet',
    'pop.st.fetchErr': 'Could not read status: {error}',
    'pop.sidebarToggled': 'Sidebar {state}. Reload the trade page to apply',
    'pop.bilingualToggled': 'Bilingual mods {state}. Reload the trade page to apply',
    'pop.opened': 'enabled',
    'pop.closed': 'disabled',
    'pop.ninjaAsk': 'The sidebar "Prices" tab reads public exchange rates from poe.ninja.\nTo use it, click "Price check (poe.ninja)" above and allow access. Otherwise just close this page.',
    'pop.ninjaOn': 'Price check enabled. Open the "Prices" tab in the sidebar on the trade page',
    'pop.ninjaOff': 'Price check disabled',
    'pop.applying': 'Chinese enabled, building translation data…',
    'pop.unknownErr': 'unknown error',
    'pop.fail': '✗ {msg}',
    'pop.restored': 'English restored. Reload the trade page to apply',
    'pop.cleared': 'Cleared',
    'pop.initFail': 'Initialization failed: {error}',
    'pop.uiSwitched': 'Language changed. Downloaded Chinese data was removed. Reload the trade page to apply',
    'pop.chooseLang': 'Please choose your language',
    'pop.chooseLangOption': '— Choose —',
  },
});

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
}

let uiLang = 'zh';
let uiLangChosen = false;

// 靜態字串(data-i18n)與「只在中文介面出現」的區塊。
// ⚠ 語言由使用者自己選(使用者 2026-09-21 裁定,不依瀏覽器判斷):還沒選時下拉停在「請選擇」,
//   翻譯相關的按鈕先藏起來(選之前不建任何中文資料)。
function applyUiLang(lang) {
  uiLangChosen = I18N.isChosen(lang);
  uiLang = I18N.normalize(lang);
  I18N.setLang(uiLang);
  document.documentElement.lang = I18N.langInfo(uiLang).html;
  for (const el of document.querySelectorAll('[data-i18n]')) el.textContent = t(el.dataset.i18n);
  renderLangSelect();
  // 翻譯相關的按鈕只給「會翻交易站」的語言(目前只有中文)
  const zh = uiLangChosen && I18N.langInfo(uiLang).translatesSite;
  $('#zhOnly').hidden = !zh;
  $('#dictInfo').hidden = !zh;
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

// 全新安裝開的語言選擇頁(?ask=lang):選完語言接著問一次物價權限
// (background.js 在全新安裝時只開這一頁,不另開 ?ask=ninja)。
async function afterLangChosen() {
  if (new URLSearchParams(location.search).get('ask') !== 'lang') return;
  await chrome.storage.local.set({ ninjaAsked: true });
  if (await ninjaGranted()) return;
  $('#ninjaToggle').hidden = false;
  $('#ninjaToggle').classList.add('armed');
  showStatus(t('pop.ninjaAsk'));
}

function renderLang(language) {
  const isZh = (language ?? 'zh_tw') === 'zh_tw';
  $('#langNow').textContent = language ?? 'zh_tw';
  // 目前語系對應的按鈕停用;另一側高亮(中文化鈕金色填充)呼籲切換
  $('#applyZh').disabled = isZh;
  $('#applyZh').classList.toggle('armed', !isZh);
  $('#restoreEn').disabled = !isZh;
}

// 字典來源摘要。有三層降級的東西一定要看得見自己吃的是哪一層 ——
// 降級越優雅,資料缺口對使用者越安靜。
const SRC_KEYS = ['remote', 'cache', 'bundled'];

// ⚠ 一律走 textContent 建節點,不用 innerHTML:這裡顯示的
// indexVersion / remoteError / gameVersion 全部源自遠端內容(remoteError 還
// 直接帶了遠端 body 的前 120 字),拼進 innerHTML 等於把遠端字串當標記執行。
function renderDictInfo(ds) {
  const el = $('#dictInfo');
  el.textContent = '';
  if (!ds) return;

  const head = document.createElement('div');
  head.append(t('pop.dict.head'));
  const shown = [];
  for (const key of SRC_KEYS) {
    const n = ds.counts?.[key] ?? 0;
    if (!n) continue;
    const span = document.createElement('span');
    span.className = `src-${key}`;
    span.textContent = `${t(`pop.src.${key}`)} ${n}`;
    shown.push(span);
  }
  if (!shown.length) head.append(t('pop.dict.none'));
  shown.forEach((span, i) => {
    if (i) head.append(' · ');
    head.append(span);
  });
  el.append(head);

  const line = (text) => {
    const div = document.createElement('div');
    div.textContent = text;
    el.append(div);
  };
  if (ds.indexVersion != null) line(t('pop.dict.remoteVer', { v: ds.indexVersion }));
  else if (ds.remoteError) line(t('pop.dict.remoteErr', { error: ds.remoteError }));
  // ggpk.json 一直帶著 meta.game_version / generated_at,以前讀進來就丟掉,
  // 使用者無從得知手上這份遊戲資料是哪個版本、什麼時候抽的
  const dayOf = (at) => {
    const day = String(at ?? '').slice(0, 10);
    return day ? t('pop.dict.day', { day }) : '';
  };
  if (ds.gameVersion) line(t('pop.dict.game1', { ver: ds.gameVersion, day: dayOf(ds.gameDataGeneratedAt) }));
  if (ds.gameVersion2) line(t('pop.dict.game2', { ver: ds.gameVersion2, day: dayOf(ds.gameDataGeneratedAt2) }));
  if (ds.failed?.length) line(t('pop.dict.failed', { list: ds.failed.join(t('pop.listSep')) }));
}

// 只顯示**已經建過**的那幾款(資料是依實際開過的交易站建的,沒開過 PoE2 的人
// 不該看到一行「PoE2 尚未建置」而以為壞了)
function formatGameStatus(games) {
  const parts = [];
  for (const info of Object.values(games ?? {})) {
    const st = info?.buildStatus;
    if (!st) continue;
    const time = new Date(st.at).toLocaleString();
    if (st.state === 'building') parts.push(t('pop.st.building', { label: info.label, time }));
    else if (st.state === 'done') parts.push(t('pop.st.done', { msg: st.msg, time }));
    else parts.push(t('pop.st.error', { label: info.label, msg: st.msg }));
    // 資料建好了,但寫不進交易站頁面的 localStorage(5 MB 配額爆掉)——
    // 對使用者的表現是「顯示已完成、下拉卻還是英文」,一定要講出來
    const ls = info?.lscacheError;
    if (ls?.failed?.length) {
      parts.push(t('pop.st.lscache', {
        label: info.label,
        list: ls.failed.join(t('pop.listSep')),
        used: ls.usedKB ? t('pop.st.lscacheUsed', { kb: ls.usedKB }) : '',
      }));
    }
  }
  return parts;
}

async function refreshBuildStatus() {
  // English 介面(或還沒選語言)沒有翻譯資料可言,不顯示建置狀態
  if (!uiLangChosen || uiLang === 'en') return;
  try {
    const res = await chrome.runtime.sendMessage({ t: 'translation:status' });
    renderDictInfo(res?.dictStatus);
    const parts = formatGameStatus(res?.games);
    if (!parts.length) {
      showStatus(t('pop.st.none'));
      return;
    }
    showStatus(parts.join('\n\n'), parts.some((p) => p.startsWith('✗')));
  } catch (err) {
    showStatus(t('pop.st.fetchErr', { error: err.message }), true);
  }
}

// 「套用中文化」要重建**使用者實際用過的每一款**,不是只有 PoE1
async function seenGames() {
  const { gamesSeen } = await chrome.storage.local.get('gamesSeen');
  const seen = Object.keys(gamesSeen ?? {});
  return seen.length ? seen : ['poe1'];
}

function renderBilingual(on) {
  $('#bilingualToggle').classList.toggle('on', on);
  $('#bilingualState').textContent = t(on ? 'common.on' : 'common.off');
}

// ── poe.ninja 選用權限 ──
// 放進 manifest 的 host_permissions 會讓 Chrome 在擴充更新後停用它、等使用者手動
// 重新授權(所有現有使用者都會被打斷),所以物價功能改成使用者自己開。
// chrome.permissions.request 只能從這裡呼叫(需要使用者手勢),content script 不行;
// Firefox 更嚴:background 的 onMessage 也不算手勢,所以 Firefox 上側邊欄那條路
// 一律退回開這一頁(?ask=ninja)。
const NINJA_ORIGIN = 'https://poe.ninja/*';

function renderSidebar(on) {
  $('#sidebarToggle').classList.toggle('on', on);
  $('#sidebarState').textContent = t(on ? 'common.on' : 'common.off');
}

$('#sidebarToggle').addEventListener('click', async () => {
  const { sidebarEnabled } = await chrome.storage.local.get('sidebarEnabled');
  const next = sidebarEnabled === false; // 只有明確關掉才算關
  await chrome.storage.local.set({ sidebarEnabled: next });
  renderSidebar(next);
  showStatus(t('pop.sidebarToggled', { state: t(next ? 'pop.opened' : 'pop.closed') }));
});

// 目前授權狀態的快取:click handler 要靠它決定「要 request 還是 remove」,
// 不能在 permissions.request 之前先 await permissions.contains —— Firefox 只承認
// 使用者輸入處理器裡**第一個**呼叫的手勢,await 過後 request 會被拒
// (「may only be called from a user input handler」);Chrome 兩種寫法都能跑。
let ninjaOn = false;

function renderNinja(on) {
  ninjaOn = on === true;
  $('#ninjaToggle').classList.toggle('on', ninjaOn);
  $('#ninjaState').textContent = t(ninjaOn ? 'common.on' : 'common.off');
}

// init 裡任何一步丟例外都會讓 popup 停在半成品狀態(語系、字典狀態全都不顯示),
// 所以權限查詢自己吞掉錯誤,查不到就當作沒開。
async function ninjaGranted() {
  try {
    return await chrome.permissions.contains({ origins: [NINJA_ORIGIN] });
  } catch (_) {
    return false;
  }
}

async function init() {
  $('#version').textContent = chrome.runtime.getManifest().version;
  const { language, bilingualMods, uiLang: stored } = await chrome.storage.local.get(['language', 'bilingualMods', 'uiLang']);
  // 沒有 uiLang 但有 language = 舊使用者 → 中文
  applyUiLang(I18N.effectiveUiLang(stored, language));
  renderLang(language ?? 'zh_tw');
  renderBilingual(bilingualMods === true);
  const { sidebarEnabled } = await chrome.storage.local.get('sidebarEnabled');
  renderSidebar(sidebarEnabled !== false);
  const granted = await ninjaGranted();
  renderNinja(granted);
  // 安裝/更新後 background 會把這頁開成分頁(?ask=ninja)問一次物價權限,
  // 側邊欄的物價開關也是開這個網址 —— content script 呼叫不到 permissions.request。
  if (new URLSearchParams(location.search).get('ask') === 'ninja' && !granted) {
    $('#ninjaToggle').hidden = false;
    $('#ninjaToggle').classList.add('armed');
    showStatus(t('pop.ninjaAsk'));
    return; // 這一頁是來問權限的,不要再蓋掉訊息
  }
  if (!uiLangChosen) {
    showStatus(t('pop.chooseLang'));
    return;
  }
  refreshBuildStatus();
}

$('#ninjaToggle').addEventListener('click', async () => {
  // ⚠ permissions.request 必須是這個 handler 的第一個呼叫(見 ninjaOn 的說明)
  const next = ninjaOn
    ? !(await chrome.permissions.remove({ origins: [NINJA_ORIGIN] }))
    : await chrome.permissions.request({ origins: [NINJA_ORIGIN] });
  renderNinja(next);
  showStatus(t(next ? 'pop.ninjaOn' : 'pop.ninjaOff'));
});

// 重建使用者用過的每一款的中文資料(套用中文化、切回中文介面共用)
async function buildSeenGames() {
  showStatus(t('pop.applying'));
  try {
    const failed = [];
    for (const game of await seenGames()) {
      const res = await chrome.runtime.sendMessage({ t: 'translation:build', game });
      if (!res?.ok) failed.push(`${game}:${res?.error ?? t('pop.unknownErr')}`);
    }
    if (failed.length) showStatus(t('pop.fail', { msg: failed.join(t('pop.listSep')) }), true);
    else await refreshBuildStatus();
  } catch (err) {
    showStatus(t('pop.fail', { msg: err.message }), true);
  }
}

// ── 介面語言(下拉選單,選項來自 shared/i18n.js 的語言清單)──
// 不翻交易站的語言(English…):交易站一併還原英文、不載中文資料(背景會清掉已下載的)。
// 翻交易站的語言(中文):同時套用中文化並建置 —— 選中文的人要的就是中文的交易站。
$('#uiLangSel').addEventListener('change', async () => {
  const lang = I18N.langs().find((l) => l.id === $('#uiLangSel').value);
  if (!lang) return;
  const language = lang.translatesSite ? 'zh_tw' : 'us';
  await chrome.storage.local.set({ uiLang: lang.id, language });
  applyUiLang(lang.id);
  renderLang(language);
  if (lang.translatesSite) {
    renderBilingual((await chrome.storage.local.get('bilingualMods')).bilingualMods === true);
    renderSidebar((await chrome.storage.local.get('sidebarEnabled')).sidebarEnabled !== false);
    renderNinja(ninjaOn);
    await buildSeenGames();
  } else {
    renderSidebar((await chrome.storage.local.get('sidebarEnabled')).sidebarEnabled !== false);
    renderNinja(ninjaOn);
    showStatus(t('pop.uiSwitched'));
  }
  await afterLangChosen();
});

// ── 語系與雙語顯示 ──
// 側邊欄 ⚙ 的「中文化」區塊改的是同一組 storage 鍵(language / bilingualMods),
// 兩邊都能開關,誰改了另一邊都跟著動(見下方 onChanged)。
$('#applyZh').addEventListener('click', async () => {
  await chrome.storage.local.set({ language: 'zh_tw' });
  renderLang('zh_tw');
  await buildSeenGames();
});

$('#restoreEn').addEventListener('click', async () => {
  await chrome.storage.local.set({ language: 'us' });
  renderLang('us');
  showStatus(t('pop.restored'));
});

$('#bilingualToggle').addEventListener('click', async () => {
  const { bilingualMods } = await chrome.storage.local.get('bilingualMods');
  const next = bilingualMods !== true;
  await chrome.storage.local.set({ bilingualMods: next });
  renderBilingual(next);
  showStatus(t('pop.bilingualToggled', { state: t(next ? 'pop.opened' : 'pop.closed') }));
});

$('#clearCache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'translation:clear' }).catch(() => {});
  renderDictInfo(null); // 字典快取與來源狀態一起被清掉了
  showStatus(t('pop.cleared'));
});

// 側邊欄(或其他分頁)改了共用設定 → 這裡跟著更新。
// popup 每次開啟都重新 init,平時用不到;但 popup 開著時 background 完成建置、
// 或使用者在另一個視窗操作,畫面不該停在舊狀態。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.uiLang) applyUiLang(changes.uiLang.newValue);
  if (changes.language) renderLang(changes.language.newValue ?? 'zh_tw');
  if (changes.bilingualMods) renderBilingual(changes.bilingualMods.newValue === true);
  if (changes.sidebarEnabled) renderSidebar(changes.sidebarEnabled.newValue !== false);
});

// init 任何一步失敗都不該讓 popup 停在半成品(語系、字典狀態全都不顯示)
init().catch((err) => showStatus(t('pop.initFail', { error: err?.message ?? err }), true));
