// Popup:語言切換與翻譯資料維護(單頁四鈕)。
// 設定即存即用,交易頁重新整理後生效。

const $ = (sel) => document.querySelector(sel);
const statusEl = $('#status');

function showStatus(msg, isError = false) {
  statusEl.textContent = msg;
  statusEl.classList.toggle('error', isError);
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
const SRC_LABEL = { remote: '遠端', cache: '快取', bundled: '內建' };

// ⚠ 一律走 textContent 建節點,不用 innerHTML:這裡顯示的
// indexVersion / remoteError / gameVersion 全部源自遠端內容(remoteError 還
// 直接帶了遠端 body 的前 120 字),拼進 innerHTML 等於把遠端字串當標記執行。
function renderDictInfo(ds) {
  const el = $('#dictInfo');
  el.textContent = '';
  if (!ds) return;

  const head = document.createElement('div');
  head.append('字典來源:');
  const shown = [];
  for (const key of ['remote', 'cache', 'bundled']) {
    const n = ds.counts?.[key] ?? 0;
    if (!n) continue;
    const span = document.createElement('span');
    span.className = `src-${key}`;
    span.textContent = `${SRC_LABEL[key]} ${n}`;
    shown.push(span);
  }
  if (!shown.length) head.append('尚未載入');
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
  if (ds.indexVersion != null) line(`遠端字典 v${ds.indexVersion}`);
  else if (ds.remoteError) line(`遠端未取得(${ds.remoteError})`);
  // ggpk.json 一直帶著 meta.game_version / generated_at,以前讀進來就丟掉,
  // 使用者無從得知手上這份遊戲資料是哪個版本、什麼時候抽的
  if (ds.gameVersion) {
    const day = String(ds.gameDataGeneratedAt ?? '').slice(0, 10);
    line(`PoE1 遊戲資料 ${ds.gameVersion}${day ? `(${day})` : ''}`);
  }
  if (ds.gameVersion2) {
    const day = String(ds.gameDataGeneratedAt2 ?? '').slice(0, 10);
    line(`PoE2 遊戲資料 ${ds.gameVersion2}${day ? `(${day})` : ''}`);
  }
  if (ds.failed?.length) line(`⚠ 取得失敗:${ds.failed.join('、')}`);
}

// 只顯示**已經建過**的那幾款(資料是依實際開過的交易站建的,沒開過 PoE2 的人
// 不該看到一行「PoE2 尚未建置」而以為壞了)
function formatGameStatus(games) {
  const parts = [];
  for (const info of Object.values(games ?? {})) {
    const st = info?.buildStatus;
    if (!st) continue;
    const time = new Date(st.at).toLocaleString();
    if (st.state === 'building') parts.push(`${info.label} 建置中… (${time})`);
    else if (st.state === 'done') parts.push(`✓ ${st.msg}\n更新於 ${time}`);
    else parts.push(`✗ ${info.label} 建置失敗:${st.msg}`);
  }
  return parts;
}

async function refreshBuildStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ t: 'translation:status' });
    renderDictInfo(res?.dictStatus);
    const parts = formatGameStatus(res?.games);
    if (!parts.length) {
      showStatus('尚未建置翻譯資料');
      return;
    }
    showStatus(parts.join('\n\n'), parts.some((p) => p.startsWith('✗')));
  } catch (err) {
    showStatus(`無法取得狀態:${err.message}`, true);
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
  $('#bilingualState').textContent = on ? '開' : '關';
}

// ── poe.ninja 選用權限 ──
// 放進 manifest 的 host_permissions 會讓 Chrome 在擴充更新後停用它、等使用者手動
// 重新授權(所有現有使用者都會被打斷),所以物價功能改成使用者自己開。
// chrome.permissions.request 只能從這裡呼叫(需要使用者手勢),content script 不行。
const NINJA_ORIGIN = 'https://poe.ninja/*';

function renderSidebar(on) {
  $('#sidebarToggle').classList.toggle('on', on);
  $('#sidebarState').textContent = on ? '開' : '關';
}

$('#sidebarToggle').addEventListener('click', async () => {
  const { sidebarEnabled } = await chrome.storage.local.get('sidebarEnabled');
  const next = sidebarEnabled === false; // 只有明確關掉才算關
  await chrome.storage.local.set({ sidebarEnabled: next });
  renderSidebar(next);
  showStatus(`已${next ? '開啟' : '關閉'}側邊欄,重新整理交易頁生效`);
});

function renderNinja(on) {
  $('#ninjaToggle').classList.toggle('on', on);
  $('#ninjaState').textContent = on ? '開' : '關';
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
  const { language, bilingualMods } = await chrome.storage.local.get(['language', 'bilingualMods']);
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
    showStatus('側邊欄的「物價」分頁要讀 poe.ninja 的公開匯率。\n要用的話請按上面的「物價查詢(poe.ninja)」允許存取;不需要就直接關掉這一頁。');
    return; // 這一頁是來問權限的,不要再蓋掉訊息
  }
  refreshBuildStatus();
}

$('#ninjaToggle').addEventListener('click', async () => {
  const on = await chrome.permissions.contains({ origins: [NINJA_ORIGIN] });
  const next = on
    ? !(await chrome.permissions.remove({ origins: [NINJA_ORIGIN] }))
    : await chrome.permissions.request({ origins: [NINJA_ORIGIN] });
  renderNinja(next);
  showStatus(next ? '已開啟物價查詢,回交易頁的側邊欄「物價」分頁即可使用' : '已關閉物價查詢');
});

// ── 語系與雙語顯示 ──
// 側邊欄 ⚙ 的「中文化」區塊改的是同一組 storage 鍵(language / bilingualMods),
// 兩邊都能開關,誰改了另一邊都跟著動(見下方 onChanged)。
$('#applyZh').addEventListener('click', async () => {
  await chrome.storage.local.set({ language: 'zh_tw' });
  renderLang('zh_tw');
  showStatus('已套用中文化,建置翻譯資料中…');
  try {
    const failed = [];
    for (const game of await seenGames()) {
      const res = await chrome.runtime.sendMessage({ t: 'translation:build', game });
      if (!res?.ok) failed.push(`${game}:${res?.error ?? '未知錯誤'}`);
    }
    if (failed.length) showStatus(`✗ ${failed.join('、')}`, true);
    else await refreshBuildStatus();
  } catch (err) {
    showStatus(`✗ ${err.message}`, true);
  }
});

$('#restoreEn').addEventListener('click', async () => {
  await chrome.storage.local.set({ language: 'us' });
  renderLang('us');
  showStatus('已還原英文,重新整理交易頁生效');
});

$('#bilingualToggle').addEventListener('click', async () => {
  const { bilingualMods } = await chrome.storage.local.get('bilingualMods');
  const next = bilingualMods !== true;
  await chrome.storage.local.set({ bilingualMods: next });
  renderBilingual(next);
  showStatus(`已${next ? '開啟' : '關閉'}詞綴雙語顯示,重新整理交易頁生效`);
});

$('#clearCache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'translation:clear' }).catch(() => {});
  renderDictInfo(null); // 字典快取與來源狀態一起被清掉了
  showStatus('已清除,下次開啟交易頁會重新建置');
});

// 側邊欄(或其他分頁)改了共用設定 → 這裡跟著更新。
// popup 每次開啟都重新 init,平時用不到;但 popup 開著時 background 完成建置、
// 或使用者在另一個視窗操作,畫面不該停在舊狀態。
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.language) renderLang(changes.language.newValue ?? 'zh_tw');
  if (changes.bilingualMods) renderBilingual(changes.bilingualMods.newValue === true);
  if (changes.sidebarEnabled) renderSidebar(changes.sidebarEnabled.newValue !== false);
});

// init 任何一步失敗都不該讓 popup 停在半成品(語系、字典狀態全都不顯示)
init().catch((err) => showStatus(`初始化失敗:${err?.message ?? err}`, true));
