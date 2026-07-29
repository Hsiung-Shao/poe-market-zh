// MAIN world / document_start:官網前端會讀取全域 `__` 字典作為介面字串
// 的替換來源(站方自身的 i18n 掛勾點)。此字典為本專案自行撰寫的翻譯,
// 依 localStorage['ptm-ui-mode'] 決定 中文(zh)/ 純英(en)。
// UI 字串一律直接替換為單一語言(純中文),不做雙語對照 ——
// 下拉選單的中英對照屬 lscache 資料層(bg/translation.js),與此無關。

const __ = (() => {
  const dict = {
    // ── 頂欄與通用 ──
    'Search Items': '搜尋物品',
    'Bulk Item Exchange': '大宗通貨交易',
    'Search': '搜尋',
    'Clear': '清除',
    'Settings': '設定',
    'Sign In': '登入',
    'Sign Out': '登出',
    'League': '聯盟',
    'Status': '狀態',
    'Any': '不限',
    'Yes': '是',
    'No': '否',
    'Online Only': '僅限線上',
    'Online': '線上',
    'Offline': '離線',
    'Min': '最小',
    'Max': '最大',
    'Show Filters': '顯示篩選',
    'Hide Filters': '隱藏篩選',
    'Load More': '載入更多',
    'About the new Trade site': '關於交易網站',
    'Feedback and Bug Reports': '意見回饋與問題回報',

    // ── 篩選群組 ──
    'Type Filters': '類型篩選',
    'Weapon Filters': '武器篩選',
    'Armour Filters': '防具篩選',
    'Socket Filters': '插槽篩選',
    'Requirements': '需求條件',
    'Map Filters': '地圖篩選',
    'Heist Filters': '劫盜篩選',
    'Sanctum Filters': '聖所篩選',
    'Ultimatum Filters': '終極試煉篩選',
    'Miscellaneous': '雜項',
    'Trade Filters': '交易篩選',
    'Stat Filters': '詞綴篩選',

    // ── 類型篩選 ──
    'Item Category': '物品分類',
    'Item Rarity': '物品稀有度',
    'Normal': '普通',
    'Magic': '魔法',
    'Rare': '稀有',
    'Unique': '傳奇',
    'Unique (Foil)': '傳奇(閃箔)',
    'Any Non-Unique': '非傳奇',

    // ── 武器/防具屬性 ──
    'Damage': '傷害',
    'Attacks per Second': '每秒攻擊次數',
    'Critical Chance': '暴擊率',
    'Damage per Second': '每秒傷害 (DPS)',
    'Physical DPS': '物理 DPS',
    'Elemental DPS': '元素 DPS',
    'Armour': '護甲',
    'Evasion Rating': '閃避值',
    'Energy Shield': '能量護盾',
    'Ward': '結界',
    'Block': '格擋',
    'Base Percentile': '基底百分位',

    // ── 插槽 ──
    'Sockets': '插槽',
    'Links': '連結',
    'Socket Colours': '插槽顏色',

    // ── 需求 ──
    'Level': '等級',
    'Strength': '力量',
    'Dexterity': '敏捷',
    'Intelligence': '智慧',
    'Character Class': '角色職業',

    // ── 地圖 ──
    'Map Tier': '地圖階級',
    'Map Packsize': '怪物群大小',
    'Map IIQ': '物品數量加成',
    'Map IIR': '物品稀有度加成',
    'Blighted Map': '凋落地圖',
    'Blight-Ravaged Map': '凋落肆虐地圖',
    'Area Level': '區域等級',
    'Map Series': '地圖系列',

    // ── 雜項 ──
    'Quality': '品質',
    'Item Level': '物品等級',
    'Gem Level': '寶石等級',
    'Gem Experience %': '寶石經驗 %',
    'Shaper Influence': '塑者之影',
    'Elder Influence': '尊師之影',
    'Crusader Influence': '聖戰軍王之影',
    'Redeemer Influence': '救贖者之影',
    'Hunter Influence': '狩獵者之影',
    'Warlord Influence': '總督軍之影',
    'Fractured Item': '破裂物品',
    'Synthesised Item': '追憶物品',
    'Alternate Art': '特殊外觀',
    'Identified': '已鑑定',
    'Corrupted': '已汙染',
    'Mirrored': '已複製',
    'Split': '已分裂',
    'Crafted': '已工藝加工',
    'Veiled': '隱匿',
    'Enchanted': '已附魔',
    'Talisman Tier': '塔莉斯曼階級',
    'Stored Experience': '儲存經驗值',
    'Stack Size': '堆疊數量',
    'Alternate Quality': '替代品質',
    'Foil Variation': '閃箔樣式',
    'Scourge Tier': '禍變階級',
    'Searing Exarch Item': '灼熱總督物品',
    'Eater of Worlds Item': '噬世者物品',

    // ── 交易篩選 ──
    'Sale Type': '販售型態',
    'Priced': '已標價',
    'Buyout or Fixed Price': '買斷或固定價格',
    'No Listed Price': '未標價',
    'Listed Currency': '標價通貨',
    'Listed': '上架時間',
    'Any Time': '不限時間',
    'Up to a Day Ago': '一天內',
    'Up to 3 Days Ago': '三天內',
    'Up to a Week Ago': '一週內',
    'Up to 2 Weeks Ago': '兩週內',
    'Up to 1 Month Ago': '一個月內',
    'Up to 2 Months Ago': '兩個月內',
    'Buyout Price': '買斷價格',
    'Price': '價格',
    'Seller Account': '賣家帳號',
    'Account': '帳號',
    'Instant Buyout Only': '僅限即時買斷',
    'Identified Only': '僅限已鑑定',

    // ── 詞綴篩選器 ──
    'Add Stat Filter': '新增詞綴篩選',
    'Search for a stat...': '搜尋詞綴…',
    'And': '符合全部',
    'Not': '排除',
    'If': '若存在',
    'Count': '符合數量',
    'Weighted Sum': '加權總和',
    'Weighted Sum v2': '加權總和 v2',
    'Delete Group': '刪除群組',
    'Filter Group Type': '群組類型',
    'Pseudo': '擬真',
    'Explicit': '隨機',
    'Implicit': '固有',
    'Fractured': '破裂',
    'Enchant': '附魔',
    'Scourge': '禍變',
    'Crucible': '熔爐',
    'Veiled Mods': '隱匿詞綴',
    'Monster': '怪物',
    'Delve': '掘獄',
    'Ultimatum': '終極試煉',

    // ── 結果列 ──
    'Exact Price': '定價',
    'Asking Price': '要價',
    'Negotiable Price': '可議價',
    'Whisper': '密語',
    'Direct Whisper': '直接密語',
    'Copy Whisper': '複製密語',
    'Contact Seller': '聯絡賣家',
    'Ignore Seller': '忽略賣家',
    'Report Seller': '檢舉賣家',
    'Physical Damage': '物理傷害',
    'Elemental Damage': '元素傷害',
    'Chaos Damage': '混沌傷害',
    'Critical Strike Chance': '暴擊率',
    'Requires': '需求',
    'Sockets:': '插槽:',
    'corrupted': '已汙染',
    'unidentified': '未鑑定',
    'mirrored': '已複製',

    // ── 即時搜尋 ──
    'Live Search': '即時搜尋',
    'Activate Live Search': '啟動即時搜尋',
    'Deactivate Live Search': '停止即時搜尋',
    'Manage Live Searches': '管理即時搜尋',

    // ── 大宗交易 ──
    'I Want': '我想要',
    'I Have': '我擁有',
    'Minimum Stock': '最低庫存',
    'Fill in your side of the trade': '填入你要交換的通貨',
    'Market Ratios': '市場匯率',
    'Collapse Listings by Account': '依帳號合併列表',

    // ⚠ 官網有**兩套** i18n,這份字典只餵得到舊的那套。
    //   舊(legacy `plugins.js`):`translate(s)` → `typeof __ != "undefined" && __[s]`
    //     → 篩選面板、按鈕等,加在這裡有效。
    //   新(Vue3 app):gettext 式 `catalog[lang].translations[context][msgid]`,
    //     而且開頭就是 `if (this.lang.value === this.defaultLang) return 原文`
    //     → 英文站永遠不查表,**加在這裡完全沒有作用**。
    //   結果列的物品卡(含傭兵契約書的「Tier N」「Mercenary Level」「Build」)
    //   屬於新的那套,只能在 content/results.js 以 DOM 層處理。

    // ── 其他 ──
    'Search Listed Items': '搜尋已上架物品',
    'Recent Searches': '最近的搜尋',
    'Saved Searches': '已儲存的搜尋',
    'Save Search': '儲存搜尋',
    'Rename': '重新命名',
    'Delete': '刪除',
    'Copy': '複製',
    'Cancel': '取消',
    'Confirm': '確認',
    'Close': '關閉',
    'Open': '開啟',
    'Loading...': '載入中…',
    'Error': '錯誤',
    'Not Found': '找不到結果',
    'No Results': '沒有結果',
  };

  let mode = 'zh';
  let merged = dict;
  try {
    mode = localStorage.getItem('ptm-ui-mode') || 'zh';
    // 主字典(background 建置時整合的內建繁中字典 + 社群遞補,
    // 由 bootstrap.js 同步到 localStorage);實站驗證過的主字典優先,
    // 上方自寫字典僅填其缺口
    const extra = JSON.parse(localStorage.getItem('ptm-ui-extra') ?? '{}');
    merged = { ...dict, ...extra };
  } catch (_) { /* localStorage 不可用或字典資料損毀時,退回自寫字典 */ }

  if (mode === 'en') return {};
  return merged;
})();
