// 選用權限(optional_host_permissions)的查詢 / 要求 / 收回。content script 不能呼叫 chrome.permissions,由背景代辦。
// poe.ninja:物價查詢與 poe.ninja 雙語共用;pobb.in:pobb.in 中文化(2026-11-04 起開關在側邊欄,不在 popup)。
//
// 直接跳 Chrome 的權限對話框(使用者 2026-09-08 要求「點了就出現允許/拒絕」):
// content script 在**點擊當下**送來的 runtime.sendMessage 會把使用者手勢帶進 onMessage,所以這裡可以直接要。
// ⚠ 側邊欄那端的 sendMessage 必須是點擊處理器裡的第一個非同步動作(前面不能 await),否則手勢就過期了。
//   手勢真的沒帶到(拋「must be called during a user gesture」)才退回:把 popup 開成分頁讓使用者在那裡按。
// ⚠ Firefox 不把 onMessage 當使用者輸入處理器,request 在這裡**一定**被拒,所以 Firefox 永遠走退路開授權頁 ——
//   這是預期行為,不是 bug,不要為了 Firefox 把 request 拿掉。

const SITES = {
  ninja: 'https://poe.ninja/*',
  pobbin: 'https://pobb.in/*',
};

export function handlePermissionMessage(msg) {
  const m = /^perm:(ninja|pobbin)(?:-(ask|remove))?$/.exec(msg?.t ?? '');
  if (!m) return null;
  const [, site, action] = m;
  const origins = [SITES[site]];
  if (!action) {
    return chrome.permissions.contains({ origins })
      .then((granted) => ({ ok: true, granted }))
      .catch(() => ({ ok: true, granted: false }));
  }
  if (action === 'ask') {
    return chrome.permissions.request({ origins })
      .then((granted) => ({ ok: true, granted, direct: true }))
      // 手勢沒帶到(Firefox 一定如此):已經在授權頁允許過就直接回已授權,不再開一頁(否則側邊欄永遠拿不到 granted)
      .catch(() => chrome.permissions.contains({ origins }).catch(() => false)
        .then((has) => (has ? { ok: true, granted: true, direct: true }
          : chrome.tabs.create({ url: chrome.runtime.getURL(`popup/popup.html?ask=${site}`) })
            .then(() => ({ ok: true, direct: false }))))
        .catch((err) => ({ ok: false, error: String(err?.message ?? err) })));
  }
  // 收回權限不需要使用者手勢,背景直接做得到
  return chrome.permissions.remove({ origins })
    .then((removed) => ({ ok: true, granted: !removed }))
    .catch((err) => ({ ok: false, error: String(err?.message ?? err) }));
}
