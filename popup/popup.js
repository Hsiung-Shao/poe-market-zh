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

async function init() {
  $('#version').textContent = chrome.runtime.getManifest().version;
  const { language } = await chrome.storage.local.get('language');
  renderLang(language ?? 'zh_tw');
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

$('#clearCache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'translation:clear' }).catch(() => {});
  showStatus('已清除,下次開啟交易頁會重新建置');
});

init();
