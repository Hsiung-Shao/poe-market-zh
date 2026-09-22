// 擴充**自己的介面**語言(側邊欄、popup、對話框、提示)。與「交易站要不要翻成中文」
// 是兩件事:那個由 `language`(zh_tw / us)管,這裡由 `uiLang`(zh / en)管。
// `uiLang = 'en'` 時一律不翻交易站、不載任何中文資料(見 bg/translation.js 的守門)。
//
// 純 script、不用 import:content script(isolated world, document_end)、popup 的
// <script>、Service Worker 的 side-effect import 三邊共用同一份。
// 字串表由各模組以 `PMZ_I18N.register({ zh:{…}, en:{…} })` 登記,
// tools/verify-i18n.mjs 鎖住兩邊鍵完全對等、en 表零 CJK。
(() => {
  const g = globalThis;
  if (g.PMZ_I18N) return;

  // 可選的介面語言。**要加語言只改這裡 + 各字串表補一段**:popup 與側邊欄的下拉選單
  // 都從這份清單長出來(使用者 2026-09-21 要求改下拉以保留擴充性)。
  //   name:語言自己的寫法(endonym),不隨介面語言翻 —— 看不懂目前語言的人才找得到
  //   translatesSite:選這個語言時要不要把交易站翻成中文、下載中文翻譯資料
  //   ⚠ 目前只有 zh 會翻交易站;加新語言時先想清楚它要不要(以及資料從哪來)
  const LANGS = [
    { id: 'zh', name: '中文', html: 'zh-Hant', translatesSite: true },
    { id: 'en', name: 'English', html: 'en', translatesSite: false },
  ];
  const LANG_IDS = LANGS.map((l) => l.id);
  const tables = Object.fromEntries(LANG_IDS.map((id) => [id, {}]));
  let lang = 'zh';

  // 不認得的值(含還沒選)一律當中文顯示
  const normalize = (v) => (LANG_IDS.includes(v) ? v : 'zh');

  function register(t) {
    for (const l of LANG_IDS) Object.assign(tables[l], t?.[l] ?? {});
  }

  // 缺字時回鍵名而不是退回中文:英文使用者看到一串中文比看到鍵名更糟,
  // 而鍵名缺漏由 verify-i18n 在離線就擋下來。
  function t(key, vars) {
    let s = tables[lang][key] ?? key;
    if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m));
    return s;
  }

  // ⚠ 刻意沒有「依瀏覽器語言自動判斷」:使用者 2026-09-21 裁定語言由使用者自己選。
  //   還沒選(uiLang 沒有值)時介面先用中文顯示,但不建任何中文資料(見 background.js)。
  const isChosen = (v) => LANG_IDS.includes(v);
  // 實際生效的介面語言。⚠ 舊使用者(329.5.9 以前)沒有 uiLang,但一定有 language 鍵
  //   (舊版 onInstalled 每次都會寫它;新安裝的 onInstalled 刻意不寫)→ 視同中文。
  //   不能只靠 background 在更新時補值:擴充一更新,交易站頁面可能搶在補值之前載入,
  //   那一頁就會被當成「沒選語言」而變英文、側邊欄跳出選擇列(使用者 2026-09-23 要求升級不得影響現有使用)。
  //   ⚠ 同一條規則在 content/bootstrap.js 與 bg/translation.js 各內嵌一份(那兩支讀不到這裡),verify-intl 鎖住三份一致。
  const effectiveUiLang = (uiLang, language) =>
    (isChosen(uiLang) ? uiLang : language !== undefined ? 'zh' : undefined);

  g.PMZ_I18N = {
    register,
    t,
    setLang: (v) => { lang = normalize(v); },
    getLang: () => lang,
    normalize,
    isChosen,
    effectiveUiLang,
    langs: () => LANGS.map((l) => ({ ...l })),
    langInfo: (v) => ({ ...LANGS.find((l) => l.id === normalize(v)) }),
    tables,
  };

  // 跨模組共用的字串(開/關、確定/取消等)
  register({
    zh: {
      'common.on': '開',
      'common.off': '關',
      'common.ok': '確定',
      'common.cancel': '取消',
      'common.continue': '繼續',
      'common.close': '關閉',
    },
    en: {
      'common.on': 'On',
      'common.off': 'Off',
      'common.ok': 'OK',
      'common.cancel': 'Cancel',
      'common.continue': 'Continue',
      'common.close': 'Close',
    },
  });

  // content/mod-row.js(結果列 ± 篩選按鈕)的提示文字
  register({
    zh: {
      'modrow.addMin': '加入篩選並帶入下限 {value}',
      'modrow.addPlain': '加入篩選(這條沒有數值)',
      'modrow.exclude': '加入排除條件',
      'copy.done': '已複製物品文字(可貼進 Path of Building)',
      'copy.failed': '複製失敗',
    },
    en: {
      'modrow.addMin': 'Add to filters with min {value}',
      'modrow.addPlain': 'Add to filters (no value on this mod)',
      'modrow.exclude': 'Add as "not" filter',
      'copy.done': 'Item text copied (paste into Path of Building)',
      'copy.failed': 'Copy failed',
    },
  });

  // content/bookmarks-model.js:預設名稱(會存進資料)與匯入錯誤訊息。
  // ⚠ zh 值必須與模型裡 tr() 的中文原文逐字相同(verify-i18n 有鎖)
  register({
    zh: {
      'bm.customSearch': '自訂搜尋',
      'bm.searchQuery': '搜尋條件',
      'bm.untitled': '未命名',
      'bm.myBookmarks': '我的書籤',
      'bm.noName': '(無名稱)',
      'bm.archived': '{name}(封存)',
      'bm.err.selfParent': '不能把資料夾放進自己底下',
      'bm.err.twoLevels': '「{name}」底下還有資料夾,不能再變成子資料夾(最多兩層)',
      'bm.err.empty': '沒有內容',
      'bm.err.notBase64': '這段文字不是匯出碼(不是 base64)',
      'bm.err.noBase64': '環境不支援 base64 解碼',
      'bm.err.codeNotJson': '這段文字不是匯出碼(內容不是 JSON)',
      'bm.err.codeNoBookmarks': '這份匯出碼裡沒有書籤資料',
      'bm.err.fileNotJson': '檔案內容不是 JSON',
      'bm.err.fileNoBookmarks': '這個檔案裡沒有書籤資料',
      'bm.err.btNotJson': '不是 Better PathOfExile Trading 的資料夾匯出碼(內容不是 JSON)',
      'bm.err.btNoTrs': '不是 Better PathOfExile Trading 的資料夾匯出碼(沒有 trs)',
      'bm.err.btBad': '這段文字不是 Better PathOfExile Trading 的匯出({error})',
      'bm.err.exportNoBookmarks': '這份匯出裡沒有書籤資料',
    },
    en: {
      'bm.customSearch': 'Custom search',
      'bm.searchQuery': 'Search query',
      'bm.untitled': 'Untitled',
      'bm.myBookmarks': 'My bookmarks',
      'bm.noName': '(no name)',
      'bm.archived': '{name} (archived)',
      'bm.err.selfParent': "A folder can't be moved into itself",
      'bm.err.twoLevels': '"{name}" has subfolders, so it can\'t become a subfolder (2 levels max)',
      'bm.err.empty': 'Nothing to import',
      'bm.err.notBase64': 'This is not an export code (not base64)',
      'bm.err.noBase64': 'Base64 decoding is not available here',
      'bm.err.codeNotJson': 'This is not an export code (content is not JSON)',
      'bm.err.codeNoBookmarks': 'This export code contains no bookmarks',
      'bm.err.fileNotJson': 'The file is not JSON',
      'bm.err.fileNoBookmarks': 'This file contains no bookmarks',
      'bm.err.btNotJson': 'Not a Better PathOfExile Trading folder export (content is not JSON)',
      'bm.err.btNoTrs': 'Not a Better PathOfExile Trading folder export (no trs)',
      'bm.err.btBad': 'This is not a Better PathOfExile Trading export ({error})',
      'bm.err.exportNoBookmarks': 'This export contains no bookmarks',
    },
  });

  // content/pob-import.js:分類與部位名(會變成資料夾/書籤名)、解碼錯誤。
  // ⚠ zh 值必須與 pob-import.js 的 CATEGORY_ZH / SLOT_ZH / tr() 中文原文逐字相同
  const slots = {
    'Weapon 1': ['主手', 'Main Hand'], 'Weapon 2': ['副手', 'Off Hand'],
    'Weapon 1 Swap': ['換手主手', 'Main Hand (Swap)'], 'Weapon 2 Swap': ['換手副手', 'Off Hand (Swap)'],
    Helmet: ['頭盔', 'Helmet'], 'Body Armour': ['胸甲', 'Body Armour'], Gloves: ['手套', 'Gloves'],
    Boots: ['鞋子', 'Boots'], Amulet: ['項鍊', 'Amulet'],
    'Ring 1': ['戒指 1', 'Ring 1'], 'Ring 2': ['戒指 2', 'Ring 2'], 'Ring 3': ['戒指 3', 'Ring 3'],
    Belt: ['腰帶', 'Belt'],
    'Flask 1': ['藥水 1', 'Flask 1'], 'Flask 2': ['藥水 2', 'Flask 2'], 'Flask 3': ['藥水 3', 'Flask 3'],
    'Flask 4': ['藥水 4', 'Flask 4'], 'Flask 5': ['藥水 5', 'Flask 5'],
    Trinket: ['飾品', 'Trinket'], Charm: ['護符', 'Charm'],
  };
  const pob = {
    zh: {
      'pob.cat.weapon': '武器', 'pob.cat.armour': '防具', 'pob.cat.accessory': '飾品',
      'pob.cat.jewel': '珠寶', 'pob.cat.flask': '藥水', 'pob.cat.other': '其他',
      'pob.defaultBuild': 'PoB 匯入',
      'pob.pair': '{a}:{b}',
      'pob.err.empty': '沒有內容',
      'pob.err.notBase64': '這段文字不是 PoB code(不是 base64)',
      'pob.err.badBase64': '這段文字不是 PoB code(base64 解不開)',
      'pob.err.notZlib': '這段文字不是 PoB code(不是 zlib 壓縮)',
      'pob.err.inflate': 'PoB code 解壓失敗:{error}',
      'pob.err.notPob': '解出來的不是 Path of Building 存檔',
    },
    en: {
      'pob.cat.weapon': 'Weapons', 'pob.cat.armour': 'Armour', 'pob.cat.accessory': 'Accessories',
      'pob.cat.jewel': 'Jewels', 'pob.cat.flask': 'Flasks', 'pob.cat.other': 'Other',
      'pob.defaultBuild': 'PoB import',
      'pob.pair': '{a}: {b}',
      'pob.err.empty': 'Nothing to import',
      'pob.err.notBase64': 'This is not a PoB code (not base64)',
      'pob.err.badBase64': 'This is not a PoB code (base64 could not be decoded)',
      'pob.err.notZlib': 'This is not a PoB code (not zlib-compressed)',
      'pob.err.inflate': 'Could not decompress the PoB code: {error}',
      'pob.err.notPob': 'The decoded data is not a Path of Building save',
    },
  };
  for (const [slot, [zh, en]] of Object.entries(slots)) {
    pob.zh[`pob.slot.${slot}`] = zh;
    pob.en[`pob.slot.${slot}`] = en;
  }
  register(pob);
})();
