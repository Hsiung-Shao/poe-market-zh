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

async function refreshBuildStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ t: 'translation:status' });
    const st = res?.buildStatus;
    if (!st) {
      showStatus('尚未建置翻譯資料');
      return;
    }
    const time = new Date(st.at).toLocaleString();
    if (st.state === 'building') showStatus(`建置中… (${time})`);
    else if (st.state === 'done') showStatus(`✓ ${st.msg}\n更新於 ${time}`);
    else showStatus(`✗ 建置失敗:${st.msg}`, true);
  } catch (err) {
    showStatus(`無法取得狀態:${err.message}`, true);
  }
}

function renderBilingual(on) {
  $('#bilingualToggle').classList.toggle('on', on);
  $('#bilingualState').textContent = on ? '開' : '關';
}

// 合併選單預設開啟(與 bilingualMods 相反,故以 !== false 判定)
function renderGrouping(on) {
  $('#groupingToggle').classList.toggle('on', on);
  $('#groupingState').textContent = on ? '開' : '關';
}

async function init() {
  $('#version').textContent = chrome.runtime.getManifest().version;
  const { language, bilingualMods, statGrouping } = await chrome.storage.local.get([
    'language',
    'bilingualMods',
    'statGrouping',
  ]);
  renderLang(language ?? 'zh_tw');
  renderBilingual(bilingualMods === true);
  renderGrouping(statGrouping === true);
  refreshBuildStatus();
}

$('#applyZh').addEventListener('click', async () => {
  await chrome.storage.local.set({ language: 'zh_tw' });
  renderLang('zh_tw');
  showStatus('已套用中文化,建置翻譯資料中…');
  try {
    const res = await chrome.runtime.sendMessage({ t: 'translation:build' });
    if (res?.ok) await refreshBuildStatus();
    else showStatus(`✗ ${res?.error ?? '未知錯誤'}`, true);
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

$('#groupingToggle').addEventListener('click', async () => {
  const { statGrouping } = await chrome.storage.local.get('statGrouping');
  const next = statGrouping !== true; // 預設關閉,見 content/bootstrap.js 的說明
  await chrome.storage.local.set({ statGrouping: next });
  renderGrouping(next);
  showStatus(`已${next ? '開啟' : '關閉'}同類詞綴合併選單,重新整理交易頁生效`);
});

$('#clearCache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'translation:clear' }).catch(() => {});
  showStatus('已清除,下次開啟交易頁會重新建置');
});

init();
