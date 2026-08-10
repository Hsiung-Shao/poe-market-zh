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
    line(`遊戲資料 ${ds.gameVersion}${day ? `(${day})` : ''}`);
  }
  if (ds.failed?.length) line(`⚠ 取得失敗:${ds.failed.join('、')}`);
}

async function refreshBuildStatus() {
  try {
    const res = await chrome.runtime.sendMessage({ t: 'translation:status' });
    renderDictInfo(res?.dictStatus);
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

async function init() {
  $('#version').textContent = chrome.runtime.getManifest().version;
  const { language, bilingualMods } = await chrome.storage.local.get(['language', 'bilingualMods']);
  renderLang(language ?? 'zh_tw');
  renderBilingual(bilingualMods === true);
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

$('#clearCache').addEventListener('click', async () => {
  await chrome.runtime.sendMessage({ t: 'translation:clear' }).catch(() => {});
  renderDictInfo(null); // 字典快取與來源狀態一起被清掉了
  showStatus('已清除,下次開啟交易頁會重新建置');
});

init();
