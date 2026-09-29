// pobb.in / poe.ninja 中文化(isolated world,document_idle)。
//
// ⚠ 這支**不在 manifest 的 content_scripts 裡**:兩個網站都是選用權限
//   (optional_host_permissions),寫進 manifest 等於新增 host 權限 —— Chrome 會在
//   擴充更新後把整個擴充停用、等使用者手動重新授權。改由 bg/sites.js 在使用者於
//   popup 打開開關並授權後,用 chrome.scripting.registerContentScripts 動態註冊。
//
// 做法:兩站都是前端框架渲染(pobb.in = SolidJS、poe.ninja = React),沒有交易站那種
// data-field 可以拿官方 stat id,只能**以畫面上的英文逐行查表**:
//   1. 名稱(整行完全相同才換):天賦 / 昇華 / 職業 / 角色面板用詞(遠端字典 sitenames1/2.json,GGPK;不進擴充包)、
//      物品 / 寶石 / 傳奇名(交易站建置好的 itemMap / uniqueMap)、少量網站介面字(SITE_UI)
//   2. 詞綴行:statMap 模板(數值→# 後查表,與 content/results.js 同一套規則)
//   查不到就保留英文(寧缺勿錯);**同一個英文在兩個來源對到不同中文的一律不換**。
//
// 寫回一律「只改既有文字節點的內容、不增刪節點」(與 results.js 同一原則):兩個框架都靠
// 自己的虛擬 DOM 追蹤節點,增刪節點會讓它們的比對錯亂。框架之後把文字改回英文時會觸發
// characterData 變動,這裡再翻一次。關掉開關會把改過的節點逐一還原成原文。

(() => {
  if (globalThis.__pmzSiteZh) return; // 動態註冊 + 重新整理前的舊實例:只跑一次
  globalThis.__pmzSiteZh = true;

  // 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
  const dbg = (...a) => console.info(...a);

  const HOST = typeof location === 'undefined' ? '' : location.hostname; // 離線測試沒有 location
  const SITE = /(^|\.)pobb\.in$/.test(HOST) ? 'pobbin' : /(^|\.)poe\.ninja$/.test(HOST) ? 'ninja' : null;

  // ── 遊戲別 ──
  // poe.ninja:網址一定帶 /poe1/ 或 /poe2/(兩款的頁面是兩套路由)。
  // pobb.in:同一個網址格式兩款共用,判別靠頁面自己宣告的版本 —— 標題尾巴的 `[3.29]` / `[0.3]`
  //   (PoB 匯出碼的 targetVersion;PoE2 的玩家端版本是 0.x),其次是圖片 CDN 路徑
  //   `assets.pobb.in/1/…`、`/2/…`。兩個訊號都沒有就不翻(不猜)。
  function detectGame(doc = document, loc = location) {
    if (SITE === 'ninja' || /(^|\.)poe\.ninja$/.test(loc.hostname)) {
      const m = /^\/(poe[12])(\/|$)/.exec(loc.pathname);
      return m ? m[1] : null;
    }
    const v = /\[(\d+)\.\d+[^\]]*\]\s*$/.exec(doc.title ?? '');
    if (v) return v[1] === '0' ? 'poe2' : 'poe1';
    const img = doc.querySelector?.('img[src*="assets.pobb.in/"]')?.getAttribute('src') ?? '';
    const a = /assets\.pobb\.in\/([12])\//.exec(img);
    return a ? (a[1] === '2' ? 'poe2' : 'poe1') : null;
  }

  // ── 網站介面字(非遊戲資料)──
  // 只收兩站頁面框架上固定出現、而且**遊戲客戶端有同一個詞**的字;
  // 每一條後面註明 GGPK 出處(clientstrings / characterpaneltabs / itemclasses 的 Id)。
  // 遊戲裡找不到對應詞的一律不收(保留英文),不自己翻。
  const SITE_UI = {
    Equipment: '裝備', // clientstrings.AncestralTrialInventoryTitle
    Gear: '裝備', // clientstrings.AncestralTrialItemTypeGear(英文為 Gear)
    Skills: '技能', // clientstrings.PassiveTreePanelTitle
    Jewels: '珠寶', // clientstrings.PassiveSkillTreePlannerJewelTitle
    Flasks: '藥劑', // clientstrings.TutorialPanelFlasks
    Level: '等級', // clientstrings.Level
    Offence: '攻擊屬性', // characterpaneltabs.Offence
    Defence: '防禦屬性', // characterpaneltabs.Defence
    Resistances: '抗性', // characterpaneltabs.GamepadResistances
    Charges: '充能球', // characterpaneltabs.Charges
    Pantheon: '眾神殿', // clientstrings.PatheonTabName
    Keystones: '關鍵天賦', // clientstrings.PassiveSkillTreePlannerKeystoneTitle
    Quality: '品質', // clientstrings.Quality
    'Item Level': '物品等級', // clientstrings.ItemDisplayStringItemLevel
    'Item Rarity': '物品稀有度', // clientstrings.ItemDisplayMapRarityIncrease
    Corrupted: '已汙染', // clientstrings.ItemPopupCorrupted
    Mirrored: '已複製', // clientstrings.ItemPopupMirrored
    Unidentified: '未鑑定', // clientstrings.ItemPopupUnidentified
    Strength: '力量', // clientstrings.Strength
    Dexterity: '敏捷', // clientstrings.Dexterity
    Intelligence: '智慧', // clientstrings.Intelligence
    'Chance to Block': '格擋率', // clientstrings.ItemDisplayShieldBlockChance
    Currency: '通貨', // itemclasscategories.Currency
    'Divination Cards': '命運卡', // itemclasses.DivinationCard
    Scarabs: '聖甲蟲', // clientstrings.TradeMarketScarabCategory
    Essences: '精髓', // clientstrings.TutorialPanelEssences
    Incubators: '培育器', // itemclasses.Incubator
    'Skill Gems': '技能寶石', // itemclasses.Active Skill Gem
    'Support Gems': '輔助寶石', // itemclasses.Support Skill Gem
    'Unique Flasks': '傳奇藥劑', // clientstrings.FlaskStashFilterUnique
  };

  // ── 網站自己的介面字(人工譯名)──
  // 使用者 2026-09-27 要求 ninja / pobb.in 網站本身的字也翻,並指定導覽列「經濟 | 流派 | 天賦樹」。
  // 這些是網站自創的用語,遊戲檔沒有;遊戲檔有同義詞的一律沿用遊戲用字(閃避機率、格擋、傷害減免、充能、專精…)。
  // 與 SITE_UI(遊戲檔出處)分開放:這張是人工譯名,改之前先問使用者。
  const SITE_UI_MANUAL = {
    // 導覽列
    Economy: '經濟', Builds: '流派', 'Atlas Trees': '輿圖天賦樹', 'Passive Skill Tree': '天賦樹', More: '更多', 'Log in': '登入',
    // 角色頁
    'Back to search': '返回搜尋', Previous: '上一個', Next: '下一個', Favorite: '收藏',
    'Time Machine': '時光機', 'Time machine': '時光機', 'Latest snapshot': '最新快照',
    Profile: '個人檔案', 'Last fetched': '最後更新', 'Import Code for Path of Building': 'Path of Building 匯入碼',
    'Build Planner': '配裝規劃器', Copy: '複製', 'Base Jewels': '基礎珠寶',
    Stats: '屬性', Attributes: '能力值', Bandits: '盜賊', Defensive: '防禦', Offensive: '攻擊',
    'Damage Reduction': '傷害減免', Block: '格擋', 'Spell Block': '法術格擋',
    'Spell Supression': '法術壓制', 'Spell Suppression': '法術壓制',
    'Evade chance': '閃避機率', 'Deflect chance': '偏斜機率',
    'Physical taken as': '物理傷害轉換', 'Fire taken as': '火焰傷害轉換', 'Cold taken as': '冰冷傷害轉換',
    'Lightning taken as': '閃電傷害轉換', 'Chaos taken as': '混沌傷害轉換',
    'Effective Health Pool': '有效生命池', 'Max Hit': '最大承受傷害',
    Recovery: '恢復', 'Life regen': '生命回復', 'Mana regen': '魔力回復', 'Energy shield recharge': '能量護盾充能',
    'Life leech + on hit': '生命偷取 + 擊中回復', 'Main Skills': '主要技能',
    'Passive tree': '天賦樹', Enlarge: '放大', 'Ascendancy & Keystones': '昇華與關鍵天賦', Ascendancy: '昇華',
    Keystone: '關鍵天賦', Masteries: '專精', 'Quest Rewards': '任務獎勵', Choices: '選擇', All: '全部', Interludes: '間章',
    // 物價頁
    'Equipment & gems': '裝備與寶石', Atlas: '輿圖', General: '一般', 'Value Display': '價值顯示', Adaptive: '自動',
    Name: '名稱', 'Last 7 days': '近 7 天', 'Volume / Hour': '每小時交易量', 'Most Popular': '最熱門兌換', 'Show more': '顯示更多',
    'Search filters...': '搜尋篩選…',
    // 流派列表頁的篩選欄標題與技能特性
    Classes: '職業', Passives: '天賦', Filters: '篩選', 'Spirit Skills': '精魂技能', 'All Skills': '所有技能',
    'Anointed Passives': '塗油天賦', 'Main Skill Traits': '主要技能特性', 'Weapon Configuration': '武器配置',
    'Damage Type': '傷害類型', Delivery: '施放方式', Crit: '暴擊', 'No Crit': '無暴擊',
    'Second Ascendancy': '第二昇華', 'All Gems': '所有寶石',
    // 使用者回報(2026-09-29)的流派頁區塊標題與物價頁分類。能從遊戲檔推的註明出處,其餘是人工譯名
    'Vestigial Modifiers': '殘存詞綴', // clientstrings DivergentItem「Vestigial {0}」= 殘存 {0}、殘存固定詞綴
    'Mercenary Class': '傭兵職業', 'Mercenary Items': '傭兵物品', // 傭兵 = leaguenames Mercenaries
    'No Major God': '無主神', 'No Minor God': '無次神', // clientstrings PantheonInformationMajorGod 主神之力 / 次神之力
    'Animated Guardian': '幻靈守衛',
    wiki: '維基', // ninja 物價列每一列的外部連結
    'Character is using any': '角色使用任一', 'Check wiki for optional modifiers': '可選詞綴請查看維基', Foulborn: '穢生', Type: '類型', // 物價頁篩選標籤(穢生 = clientstrings MutatedUniqueName) // 流派頁篩選提示「Character is using any <物品>」
    // 流派首頁(聯盟清單):挑戰聯盟、不限期聯盟取 clientstrings,其餘人工
    'Available Leagues': '可選聯盟', 'Challenge Leagues': '挑戰聯盟', 'Permanent Leagues': '不限期聯盟', 'Past leagues': '過往聯盟',
    'Private Leagues': '私人聯盟', 'Add private league': '新增私人聯盟', Streamers: '實況主',
    'Top Classes Per League': '各聯盟熱門職業', 'See all builds': '查看所有流派',
    '(scroll to see more)': '(捲動查看更多)',
    'The Brine King': '海洋之王', // quest.Name 與 npctalk 一致(萬神殿的「海洋王之魂」是神魂名) // monstervarieties AnimatedArmour(另一個「聚魂之衛」是血族變體)
    // 流派頁表格欄位(人工譯名;暴擊率 / 暴擊加成 / 投射物 沿用遊戲檔用字)
    'Attack/Cast Rate': '攻擊 / 施放速度', 'Crit Chance': '暴擊率', 'Crit Multiplier': '暴擊加成', Projectiles: '投射物',
    Pierces: '穿透', 'AoE Radius': '範圍半徑', 'Damage types': '傷害類型',
    Ladder: '天梯', Depth: '深度', 'Base Class': '基礎職業', 'Show low confidence': '顯示低可信度', '# Listed': '上架數',
    Artifacts: '文物', // 破碎之環文物(Broken Circle Artifact)
    'Forbidden Jewels': '禁忌珠寶', // 禁忌烈焰 / 禁忌血肉
    'Cluster Jewels': '星團珠寶', // 交易站 jewel.cluster
    'Blighted Maps': '凋落地圖', 'Blight-ravaged Maps': '凋落蔓延地圖', // baseitemtypes Blighted / Blight-ravaged Map
    'Valdo Maps': '瓦爾多地圖', // 瓦爾多的謎盒
    Invitations: '邀請', // 釋界之邀 / 異界之邀
    Temples: '神殿', // incursionrooms 神殿前院、神殿通道…
    'Scrying Orbs': '占卜寶珠', 'Base Types': '基礎類型', // baseitemtypes / clientstrings SortMethodBaseType
    Vials: '罈', // Vial of Summoning = 召喚之罈
    'Lineage Gems': '血脈寶石', // 交易站 Lineage Support Gems = 血脈輔助寶石
    'Precursor Tablets': '先行者碑牌', // 先行者(Precursor)+ 碑牌(Tablet)
    Cluster: '星團珠寶', // 交易站分類 jewel.cluster「Cluster Jewel」= 星團珠寶(ninja 簡寫成 Cluster)
    // 輿圖天賦樹頁
    Found: '找到', 'unique atlas trees.': '個不重複的輿圖天賦樹。', 'Reset all filters': '重設所有篩選',
    'Show atlas heatmap': '顯示輿圖熱度圖', 'Show passive heatmap': '顯示天賦熱度圖', Columns: '欄位', Tree: '天賦樹',
    Popularity: '熱門度', Points: '點數', None: '無', 'Add your character': '新增你的角色',
    'Not enough data': '資料不足', 'Memory Tears': '記憶裂痕', 'Scarab Specialization': '聖甲蟲專精',
    'Map Monsters': '地圖怪物', 'Map Tiers': '地圖階級', 'Shaper & Elder': '塑者與尊師', 'Labyrinth Trials': '迷宮試煉',
    // 頁尾
    About: '關於', Statistics: '統計', Resources: '資源', Contribute: '協助', 'Support the site': '支持本站',
    'Docs & FAQ': '說明與常見問題', 'Data dumps': '資料匯出', 'Privacy Policy': '隱私權政策',
    // pobb.in
    Gems: '寶石', 'Tree Preview': '天賦樹預覽', Notes: '備註', 'Brief notes': '簡短備註', Loadout: '配置', Custom: '自訂',
    Config: '設定', Bandit: '盜賊', 'Kill All': '全部殺掉', Web: '網頁', 'Share your Build': '分享你的配裝',
    Create: '建立', Import: '匯入', Login: '登入', Speed: '速度', 'Hit Chance': '命中率',
  };
  // 網站自己的數量 / 時間格式(人工譯名,同上)
  const SITE_PATTERNS = [
    [/^Week (\d+)$/, '第 $1 週'], [/^Day (\d+)$/, '第 $1 天'], [/^Hour (\d+)$/, '第 $1 小時'], [/^Act (\d+)$/, '第 $1 章'],
    [/^(\d+) minutes? ago$/, '$1 分鐘前'], [/^(\d+) hours? ago$/, '$1 小時前'], [/^(\d+) days? ago$/, '$1 天前'],
    [/^(\d+) weeks? ago$/, '$1 週前'], [/^(\d+) months? ago$/, '$1 個月前'],
    [/^Found ([\d,]+) characters\.$/, '找到 $1 個角色。'],
    [/^([\d,]+) characters$/, '$1 個角色'], // 流派首頁每個聯盟的角色數
    [/^Level (\d+) \((\d+) passives\)$/, '等級 $1($2 點天賦)'],
  ];

  // ── 翻譯核心(純函式,tools/verify-site-zh.mjs 離線測)──

  // 範圍值「(10-18)」整段算一個數值(ninja 物品浮窗印的是詞綴範圍:`(10-18)% increased Attack Speed`)
  const NUM_RE = /\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)|\d+(?:\.\d+)?/g;
  const SIGNED_NUM_RE = /\(-?\d+(?:\.\d+)?--?\d+(?:\.\d+)?\)|-?\d+(?:\.\d+)?/g;
  const PLUS_NUM_RE = /[+-]?\(\d+(?:\.\d+)?-\d+(?:\.\d+)?\)|[+-]?\d+(?:\.\d+)?/g;
  const CJK_RE = /[㐀-鿿]/;
  const MAX_LEN = 240; // 超過這個長度的一定不是單條詞綴或名稱(備註、說明文)
  const MAX_TEXT_LEN = 1200; // 整句查表(技能敘述、傳說文字)的上限;更長的是使用者備註

  // 物品表的值多為「中文 (English)」(交易站下拉用的雙語格式),網站上直接換成純中文
  const stripBilingual = (en, zh) => {
    const s = String(zh ?? '');
    const suffix = ` (${en})`;
    return s.endsWith(suffix) ? s.slice(0, -suffix.length) : s;
  };

  // sources: { siteNames:{passives,ascendancies,classes,panel,stats}, itemMap, uniqueMap, passiveMap, statMap }
  // 回傳 { names: Map, lower: Map, gems: Map, statMap, conflicts: [] }
  function buildSiteDict(sources) {
    const names = new Map();
    const conflicts = [];
    const dropped = new Set();
    const add = (en, zh, src) => {
      if (!en || !zh || en === zh || dropped.has(en)) return;
      const prev = names.get(en);
      if (prev === undefined) { names.set(en, { zh, src }); return; }
      if (prev.zh === zh) return;
      // 同一個英文、兩個來源兩種中文 → 畫面上分不出是哪一個,不換
      names.delete(en);
      dropped.add(en);
      conflicts.push({ en, a: `${prev.src}:${prev.zh}`, b: `${src}:${zh}` });
    };
    const sn = sources.siteNames ?? {};
    for (const [en, zh] of Object.entries(sn.ascendancies ?? {})) add(en, zh, 'ascendancy');
    for (const [en, zh] of Object.entries(sn.classes ?? {})) add(en, zh, 'class');
    // 天賦名:交易站建好的 passiveMap(台服 trade「配置 X」為準、遊戲檔墊底 —— 2026-09-25 裁定,
    // 見 bg/translation.js buildPassiveMap)先蓋過名稱表;交易站配置不到的天賦(昇華、精通、小天賦)才用名稱表的 GGPK 譯名。
    const passives = { ...(sn.passives ?? {}), ...(sources.passiveMap ?? {}) };
    for (const [en, zh] of Object.entries(passives)) add(en, zh, 'passive');
    for (const [en, zh] of Object.entries(sources.uniqueMap ?? {})) add(en, stripBilingual(en, zh), 'unique');
    // 技能敘述、輔助寶石說明、通貨效果與用法(整句)、寶石標籤(Spell / AoE / Warcry…)
    for (const [en, zh] of Object.entries(sn.tags ?? {})) add(en, zh, 'tag');
    const gems = new Map();
    for (const [en, zh] of Object.entries(sources.itemMap ?? {})) {
      const z = stripBilingual(en, zh);
      add(en, z, 'item');
      if (/ Support$/.test(en)) gems.set(en, z);
    }
    // 面板用詞與介面字:大小寫不同也算(poe.ninja 寫 `Energy shield`、遊戲寫 `Energy Shield`)。
    // 只有這兩類放寬,物品與天賦名一律大小寫完全相同才換。
    const lower = new Map();
    const lowerDropped = new Set();
    const addLower = (en, zh) => {
      const k = en.toLowerCase();
      if (lowerDropped.has(k)) return;
      const prev = lower.get(k);
      if (prev !== undefined && prev !== zh) { lower.delete(k); lowerDropped.add(k); return; }
      lower.set(k, zh);
    };
    for (const [en, zh] of Object.entries(sn.panel ?? {})) if (en !== zh) addLower(en, zh);
    // 從兩站頁面收集到的介面字(分類名、浮窗欄位名、單位),交易站分類標籤 > 遊戲檔,見 tools/gen-site-names.mjs
    for (const [en, zh] of Object.entries(sn.ui ?? {})) if (en !== zh) addLower(en, zh);
    // 同一個字大小寫不同在遊戲裡可能是不同的詞(物品欄位「Block chance」= 格擋機率、角色面板「Block Chance」= 格擋率):
    // 大小寫完全相同的先查,查不到才放寬大小寫
    const uiExact = new Map(Object.entries(sn.ui ?? {}).filter(([en, zh]) => en !== zh));
    // 介面字是人工核對過出處的,優先於面板用詞(同詞不同譯時以它為準)
    // 網站自己的字(人工譯名)蓋過面板用詞(「Defensive」面板給「防禦的」,在網站上當分區標題不通順);
    // 遊戲檔出處的 SITE_UI 最後蓋,優先序最高
    for (const [en, zh] of Object.entries(SITE_UI_MANUAL)) { lower.set(en.toLowerCase(), zh); lowerDropped.delete(en.toLowerCase()); }
    for (const [en, zh] of Object.entries(SITE_UI)) { lower.set(en.toLowerCase(), zh); lowerDropped.delete(en.toLowerCase()); }
    // 技能顯示名(裝備賦予的技能、PoE2 技能)只補其他來源都沒有的名字:寶石以交易站物品表的名稱為準
    // (`Bone Armour` 寶石「骨製戰甲」vs 技能表「骸骨鎧甲」—— 畫面上的是寶石),不拿來跟它們比撞名
    for (const [en, zh] of Object.entries(sn.skills ?? {})) if (!names.has(en) && !dropped.has(en)) add(en, zh, 'skill');
    // 地區名(任務獎勵區)同樣只補缺:地名常跟物品 / 天賦同名,不拿來跟它們比撞名
    for (const [en, zh] of Object.entries(sn.areas ?? {})) if (!names.has(en) && !dropped.has(en)) add(en, zh, 'area');
    // 整句的說明文字只補缺:四個字以上的傳奇名(The Light of Meaning = 意涵之光)會剛好等於某段說明裡的句子(意義之光),
    // 物品名優先,不讓它們互相抵銷成兩邊都不換(2026-09-29 使用者回報)
    for (const [en, zh] of Object.entries(sn.texts ?? {})) if (!names.has(en) && !dropped.has(en)) add(en, zh, 'text');
    // 其他遊戲檔名稱(傭兵職業、神殿房間、地圖 / 碑牌基底、萬神殿神名、多字的物品名):同樣只補缺
    for (const [en, zh] of Object.entries(sn.extras ?? {})) if (!names.has(en) && !dropped.has(en)) add(en, zh, 'extra');
    // 交易站官方清單印證過的傳奇名(含單字的 Reverie = 綺夢):同樣只補缺
    for (const [en, zh] of Object.entries(sn.uniqueWords ?? {})) if (!names.has(en) && !dropped.has(en)) add(en, zh, 'unique');
    const flat = new Map([...names].map(([en, v]) => [en, v.zh]));
    // 職業 / 昇華名(給「Level 100 Warden」這種標題用)。這個位置一定是職業,所以直接取
    // ascendancy / characters 兩張表,不受天賦撞名影響(`Warden` 昇華「守林人」vs 同名天賦「守護者」,
    // 單獨出現時分不出來而不換,放在「Level N」後面就只可能是職業)。兩張表彼此撞名才不收。
    const classNames = new Map();
    for (const [en, zh] of [...Object.entries(sn.ascendancies ?? {}), ...Object.entries(sn.classes ?? {})]) {
      if (classNames.has(en) && classNames.get(en) !== zh) classNames.set(en, null);
      else if (!classNames.has(en)) classNames.set(en, zh);
    }
    for (const [en, zh] of classNames) if (!zh) classNames.delete(en);
    // 數值格式(`{0} (Max)` →「{0}（最高等級）」):轉成擷取正則
    // 物品浮窗的格式字串(`Recovers {0} Life over {1} Seconds` →「{1} 秒內回復 {0} 生命」):
    // 英文轉成擷取正則,記下每個擷取群組是第幾號佔位符 —— 中文依編號填,不依位置(中英語序不同)。
    // 字面越長的越先試(越具體)。
    const PH = /\{(\d+)(?::[^}]*)?\}/;
    const formats = Object.entries(sn.formats ?? {}).map(([en, zh]) => {
      const order = [];
      const src = en.split(/(\{\d+(?::[^}]*)?\})/).map((part) => {
        const m = PH.exec(part);
        if (m && m[0] === part) { order.push(m[1]); return '(.+?)'; }
        return part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ +/g, '\\s+');
      }).join('');
      let re = null;
      try { re = new RegExp(`^${src}$`); } catch (_) { /* 轉不成正則的格式不用 */ }
      return { re, order, zh, weight: en.replace(/\{\d+(?::[^}]*)?\}/g, '').length };
    }).filter((f) => f.re).sort((a, b) => b.weight - a.weight);
    // 聯盟名一律不翻(使用者 2026-09-26 裁定:ninja 是國際服在用,聯盟名維持英文)
    const leagues = new Set((sources.leagues ?? []).map((l) => String(l).toLowerCase()));
    // 稀有度 + 物品類別(`Rare Ring`):兩半各自來自交易站篩選 × 遊戲檔交叉比對(tools/gen-site-names.mjs rarityAndCats)
    const rarity = new Map(Object.entries(sn.rarity ?? {}));
    const itemCats = new Map(Object.entries(sn.itemCats ?? {}));
    const monsters = new Map(Object.entries(sn.monsters ?? {}));
    // 依區塊查表(ninja 流派頁「天賦 / 塗油天賦 / 輿圖」區塊):同名的物品 / 技能 / 職業在那裡不會出現,
    // 直接查天賦表(Quickstep 天賦「疾步」vs 技能「迅捷步伐」撞名時,名稱表兩邊都不收)
    const passiveAll = new Map(Object.entries({ ...(sn.passives ?? {}), ...(sources.passiveMap ?? {}) }));
    const atlasPassives = new Map(Object.entries(sn.atlasPassives ?? {}));
    // 塗油只能塗一般天賦樹的天賦(Saboteur 塗油 = 怠工者;同名的昇華是破壞者)
    const anointPassives = new Map(Object.entries(sn.anointPassives ?? {}));
    // 物品區查傳奇名、技能區查寶石名(Briarpatch 傳奇「薔薇眼罩」vs 寶石「荊棘叢」撞名時,名稱表兩邊都不收)
    const uniqueAll = new Map([...Object.entries(sn.uniqueWords ?? {}),
      ...Object.entries(sources.uniqueMap ?? {}).map(([en, zh]) => [en, stripBilingual(en, zh)])]);
    const gemAll = new Map([...Object.entries(sn.skills ?? {}),
      ...Object.entries(sources.itemMap ?? {}).map(([en, zh]) => [en, stripBilingual(en, zh)])]);
    return { names: flat, uiExact, lower, gems, classNames, rarity, itemCats, monsters, passiveAll, atlasPassives, anointPassives, uniqueAll, gemAll, formats, leagues, statMap: sources.statMap ?? null, statTpl: sn.stats ?? null, conflicts };
  }

  function fillTemplate(zhTpl, nums) {
    let i = 0;
    return zhTpl.replace(/#/g, () => nums[i++] ?? '#');
  }
  const hashCount = (s) => (s.match(/#/g) ?? []).length;

  // 模板裡的「(部分)」是交易站篩選清單的消歧義後綴,物品那一行本來就不印(見 results.js)
  const stripLocalZh = (s) => String(s).replace(/\s*[(（]部分[)）]\s*$/, '');

  // 把一行裡的數字逐一決定「當佔位符(#)還是保留原樣」,列出所有組合。
  // 回傳 [{ key, vals }],vals = 換成 # 的那些數字(依英文順序)。數字太多(> 5)不試。
  function maskedKeys(text) {
    const nums = [...text.matchAll(NUM_RE)];
    if (nums.length > 5) return [];
    const out = [];
    for (let mask = (1 << nums.length) - 1; mask >= 0; mask--) {
      let key = '';
      let last = 0;
      const vals = [];
      const at = [];
      nums.forEach((m, i) => {
        const hole = (mask >> i) & 1;
        key += text.slice(last, m.index) + (hole ? '#' : m[0]);
        if (hole) { vals.push(m[0]); at.push(m.index); }
        last = m.index + m[0].length;
      });
      out.push({ key: key + text.slice(last), vals, at });
    }
    return out;
  }

  // ① GGPK 原始模板(名稱表的 stats):中文佔位符寫成 {n},n = 英文裡第幾個 #。
  //   只收「多個佔位符」或「含寫死數字」的模板 —— 正是只有 # 的字典會填錯位置的那些。
  function renderOrdered(text, tpl) {
    if (!tpl) return null;
    // 沒有數值的整句(技能檔的「Fires Projectiles in a circle」)也在這張表:vals 為空時就是原樣比對。
    // ninja 流派頁的詞綴篩選清單直接列模板本身(`#% increased Strength`):沒有數值可填的格子印回 `#`,
    // 不是空字串(否則變成「增加 % 力量」);ninja 也把帶號模板的 `+` 省掉了(`#% to …` = 遊戲檔 `+#% to …`)
    const literal = text.includes('#');
    const keys = literal ? [text, text.replace(/(^|\s)#/, '$1+#'), text.replace(/(^|\s)#/g, '$1+#')] : [text];
    for (const k0 of keys) {
      for (const { key, vals } of maskedKeys(k0)) {
        const zh = tpl[key];
        if (typeof zh === 'string') return zh.replace(/\{(\d+)\}/g, (_m, k) => vals[Number(k)] ?? (literal ? '#' : ''));
      }
    }
    // 負值:遊戲檔的帶號模板是 `{0:+d}`(鍵裡是 `+#`,中文是 `+{0}`),畫面印的是 `-1%`。
    // 把數字前的負號當成正號去比對,命中後那一格的「+值」換成「-值」(符號跟著數值走,不改字)
    if (/(^|[\s(])-\d/.test(text)) {
      const neg = new Set();
      const flipped = text.replace(/(^|[\s(])-(?=\d)/g, (m, pre, off) => { neg.add(off + pre.length + 1); return `${pre}+`; });
      for (const { key, vals, at } of maskedKeys(flipped)) {
        const zh = tpl[key];
        if (typeof zh !== 'string') continue;
        return zh.replace(/(\+?)\{(\d+)\}/g, (_m, plus, k) => {
          const i = Number(k);
          return neg.has(at[i]) ? `-${vals[i]}` : `${plus}${vals[i] ?? ''}`;
        });
      }
    }
    return null;
  }

  // ② 交易站 statMap(只有 #,中文照順序填):**只拿來翻 0~1 個數值的行**。
  //   兩個以上的 # 無從得知中文的填入順序(`若你至少配置 # 生命專精,有 #%` 就會把 10 與 6 填反),
  //   那種行只信 ①,① 沒有就保留英文。
  function renderSingle(text, map) {
    // 第三種:正負號連數值一起當一格(畫面「+40%」、字典「#%」:Nightblade 那條)
    for (const re of [NUM_RE, SIGNED_NUM_RE, PLUS_NUM_RE]) {
      const key = text.replace(re, '#');
      if (hashCount(key) > 1) continue;
      const tpl = map[key] ?? map[`${key} (Local)`];
      if (typeof tpl === 'string' && hashCount(tpl) === hashCount(key)) return fillTemplate(stripLocalZh(tpl), text.match(re) ?? []);
    }
    // 多個數字、但只有其中一個是佔位符(其他是寫死的):逐一試保留字面數的鍵
    for (const { key, vals } of maskedKeys(text)) {
      if (vals.length !== 1) continue;
      const tpl = map[key];
      if (typeof tpl === 'string' && hashCount(tpl) === 1) return fillTemplate(stripLocalZh(tpl), vals);
    }
    return null;
  }

  const normKeyCache = new WeakMap(); // statMap → Map(換行正規化成空白的鍵 → 原鍵)
  function renderStat(text, map, tpl) {
    const ordered = renderOrdered(text, tpl);
    if (ordered) return ordered;
    if (!map) return null;
    // 整句原樣就是鍵(數字全是寫死的)
    if (typeof map[text] === 'string' && !map[text].includes('#')) return map[text];
    // 模板本身(ninja 流派頁的詞綴篩選清單:`#% to Critical Strike Multiplier per #% Chance to Block Attack Damage`):
    // 沒有數字要填,就沒有「填錯位置」的問題,多個 # 也可以直接用;ninja 省掉的 `+` 也試一下
    if (text.includes('#') && !/\d/.test(text)) {
      // 兩行式模板的鍵帶換行(`… when Leech is\nremoved by …`),畫面文字已正規化成空白:另建一份正規化鍵的索引
      let norm = normKeyCache.get(map);
      if (!norm) {
        norm = new Map();
        for (const k of Object.keys(map)) if (/\n/.test(k)) norm.set(k.replace(/\s+/g, ' '), k);
        normKeyCache.set(map, norm);
      }
      for (const k of [text, text.replace(/(^|\s)#/, '$1+#'), text.replace(/(^|\s)#/g, '$1+#')]) {
        const z = map[k] ?? map[`${k} (Local)`] ?? map[norm.get(k)];
        if (typeof z === 'string') return stripLocalZh(z);
      }
      // ninja 連模板裡「寫死的數字」也換成 #(遊戲檔「… with a 0.3 second Cooldown」→ 畫面「… with a # second Cooldown」):
      // 把鍵裡所有數字(含正負號)都當 # 再比一次;只有唯一對應才用,中文照原樣(寫死的數字保留、佔位符印 #)
      const want = hashAll(text);
      const k1 = looseIndex(map).get(want);
      if (k1) return stripLocalZh(map[k1]);
      const k2 = tpl && looseIndex(tpl).get(want);
      if (k2) return tpl[k2].replace(/\{\d+\}/g, '#');
    }
    return renderSingle(text, map);
  }
  const hashAll = (k) => k.replace(/\s+/g, ' ').trim().replace(/[+-]?\d+(?:\.\d+)?/g, '#').replace(/[+-]#/g, '#');
  const looseCache = new WeakMap();
  function looseIndex(obj) {
    let idx = looseCache.get(obj);
    if (idx) return idx;
    idx = new Map();
    for (const k of Object.keys(obj)) {
      const h = hashAll(k);
      idx.set(h, idx.has(h) && idx.get(h) !== k ? null : k); // 多個鍵正規化後相同 → 不用(null)
    }
    looseCache.set(obj, idx);
    return idx;
  }

  // 一段文字 → 中文(保留前後空白);查不到回 null
  function translateText(raw, D) {
    const s = String(raw ?? '');
    const t = s.trim().replace(/\s+/g, ' ');
    if (!t || !/[A-Za-z]{2}/.test(t) || CJK_RE.test(t)) return null;
    // 長段文字只做整句查表(技能敘述、通貨用法、傳說文字),不跑任何拆解規則
    if (t.length > MAX_LEN) {
      const whole = t.length <= MAX_TEXT_LEN ? D.names.get(t) : null;
      return whole ? s.match(/^\s*/)[0] + whole + s.match(/\s*$/)[0] : null;
    }
    if (D.leagues?.has(t.toLowerCase())) return null;
    const lead = s.match(/^\s*/)[0];
    const trail = s.match(/\s*$/)[0];
    // ninja 寫「Two Handed Mace」,交易站選項是「Two-Handed Mace」
    // PoE1 交易站叫 `Base One-Handed Mace`、遊戲檔叫 `One Hand Mace`,都試
    const itemCat = (x) => D.itemCats?.get(x) ?? D.itemCats?.get(x.replace(/\b(One|Two) Handed\b/, '$1-Handed'))
      ?? D.itemCats?.get(x.replace(/\b(One|Two) Handed\b/, '$1 Hand')) ?? null;
    const one = (x) => {
      let zh = D.names.get(x) ?? D.uiExact?.get(x) ?? D.lower.get(x.toLowerCase());
      // pobb.in 的寶石列省略「 Support」(`Burning Damage` = 燃燒傷害輔助)。
      // 只從寶石表補,不拿其他來源湊;名稱表本身查得到的優先(同名的主動技能)
      if (!zh) zh = D.gems.get(`${x} Support`);
      if (!zh) zh = renderStat(x, D.statMap, D.statTpl);
      // 物品類別單數名(ninja 武器配置「Staff」「Wand / Sceptre」):其他來源都查不到才用
      if (!zh) zh = itemCat(x);
      return zh ?? null;
    };
    // 數值欄:數字 + 單位(`13 Mana`、`0.75 sec`)或數值格式(`20 (Max)`)。
    // 每一段英文字都要在介面字表查得到才換,缺一段就不換
    // 物品浮窗格式字串:每個擷取值若含英文字就要翻得出來(內層詞綴 / 名稱 / 數值單位),否則照原樣(數字)
    const formatted = (x) => {
      for (const f of D.formats ?? []) {
        const m = f.re.exec(x);
        if (!m) continue;
        // 含英文字的擷取值必須本身是一條完整的名稱 / 詞綴 / 格式(`{0} (Max)` 裡的 `20` 除外都是數字);
        // 不做單位逐字替換 —— 否則 `{0}% of base` 會把「Attack Speed: 300」整段當成數值吃進去
        // 怪物名只在這裡用(「Companion: {0}」的 {0}),不當一般名稱:怪物名常跟玩家角色名 / 其他字同形
        const vals = m.slice(1).map((c) => (/[A-Za-z]{2}/.test(c) ? one(c) ?? formatted(c) ?? D.monsters?.get(c) ?? null : c));
        if (vals.some((v) => v == null)) continue;
        return f.zh.replace(/\{(\d+)(?::[^}]*)?\}/g, (_m, n) => vals[f.order.indexOf(n)] ?? '');
      }
      return null;
    };
    const value = (x) => {
      if (!/[A-Za-z]/.test(x)) return x;
      const fmt = formatted(x);
      if (fmt) return fmt;
      // 值本身是一條詞綴 / 名稱(`Helmets: Gain Guard equal to 10% …`、`Grants Skill: Raise Shield`)
      const whole = one(x);
      if (whole || !/\d/.test(x)) return whole;
      let ok = true;
      const out = x.replace(/[A-Za-z][A-Za-z' ]*[A-Za-z]|[A-Za-z]/g, (w) => {
        // 整段查不到才逐字(`Requires Level 64` → 需要 等級 64);逐字時每個字都要是介面字
        let z = D.lower.get(w.toLowerCase());
        if (!z && w.includes(' ')) {
          const parts = w.split(' ').map((p) => D.lower.get(p.toLowerCase()));
          if (parts.every(Boolean)) z = parts.join(' ');
        }
        if (!z) ok = false;
        return z ?? w;
      });
      return ok ? out : null;
    };
    let zh = one(t);
    // 網站自己的數量 / 時間格式(`Week 9`、`50 hours ago`、`Found 124410 characters.`)
    if (!zh) for (const [re, out] of SITE_PATTERNS) if (re.test(t)) { zh = t.replace(re, out); break; }
    if (!zh) zh = formatted(t);
    // ninja 物價列把變體接在名稱後面的另一個節點:`, Magic`、`, Forbidden Flesh`(逗號也是原文的一部分)
    if (!zh) {
      const m = /^, (.+)$/.exec(t);
      const z = m && (one(m[1]) ?? formatted(m[1]) ?? D.rarity?.get(m[1]));
      if (z) zh = `,${z}`;
    }
    // 篩選清單的計數:`Duelist [30]`、`Magic [8]`
    if (!zh) {
      const m = /^(.+?) \[(\d+)\]$/.exec(t);
      const z = m && (one(m[1]) ?? D.rarity?.get(m[1]) ?? D.classNames?.get(m[1]));
      if (z) zh = `${z} [${m[2]}]`;
    }
    if (!zh && /\d/.test(t)) zh = value(t);
    // 「標籤: 數值」(`Cost: 13 Mana`、`Cast Time: Instant`、`Grants Skill: Raise Shield`)
    if (!zh) {
      // 標籤可以帶括號(觸媒品質「Quality (Attribute Modifiers): +20%」)
      const m = /^([A-Za-z][A-Za-z &'\/()-]*?):\s*(.+)$/.exec(t);
      if (m) {
        const lab = one(m[1]);
        const val = lab && value(m[2]);
        if (lab && val) zh = `${lab}: ${val}`;
      }
    }
    // ninja 流派頁的物品篩選「Rare Ring」「Magic Quarterstaff」= 稀有度 + 物品類別(單數)。
    // 稀有度與類別兩半都要查得到(稀有度只收交易站與遊戲檔一致的,`Normal` 兩邊不同 → 不換)
    if (!zh) {
      const m = /^(Normal|Magic|Rare|Unique) (.+)$/.exec(t);
      const r = m && D.rarity?.get(m[1]);
      const c = r && itemCat(m[2]);
      if (c) zh = `${r}${c}`;
    }
    // 武器配置「Dual Mace」= 雙持 + 類別
    if (!zh) {
      const m = /^Dual (.+)$/.exec(t);
      const c = m && (itemCat(m[1]) ?? D.lower.get(m[1].toLowerCase()));
      if (c) zh = `雙持${c}`;
    }
    // 「Unique Weapons」這類 ninja 分類 = 遊戲檔「傳奇」+ 交易站分類名(複數沒有就試單數)
    if (!zh) {
      const m = /^Unique (.+)$/.exec(t);
      const uq = m && D.lower.get('unique');
      const rest = m && (one(m[1]) ?? one(m[1].replace(/s$/, '')));
      if (uq && rest) zh = `${uq}${rest}`;
    }
    // 標籤尾巴的冒號(`Evasion Rating:`)
    if (!zh && /[^:]:$/.test(t)) {
      const z = one(t.slice(0, -1));
      if (z) zh = `${z}:`;
    }
    // 角色標題「Level 100 Chieftain」:後半必須是職業 / 昇華名(不是任意名稱)
    if (!zh) {
      const m = /^Level (\d+) (.+)$/.exec(t);
      const cls = m && D.classNames?.get(m[2]);
      if (cls) zh = `${D.lower.get('level') ?? 'Level'} ${m[1]} ${cls}`;
    }
    // poe.ninja 把幾樣東西用「, 」接成一行:精通的多條效果、物價頁的「傳奇名, 變體, 基底」。
    // 整行查不到才拆;**每一段都要各自查得到**(名稱或完整詞綴;只有數字符號的段落原樣保留,如 `6L`),
    // 缺一段就整行保留英文(不湊半中半英)
    // 各段本身也可能含「, 」(專精「Every 4 seconds, Recover 1 Life for every …」):
    // 逐段硬切會把它切壞,改成找「每一段都翻得出來」的切法(相鄰的片段可以接回同一段)
    if (!zh && t.includes(', ')) {
      const pieces = t.split(', ');
      if (pieces.length > 1 && pieces.length <= 8) {
        const tr = (p) => (/[A-Za-z]{2}/.test(p) ? one(p) : p);
        const best = [[]]; // best[i] = 前 i 片的一種可行切法(譯文陣列)
        for (let i = 1; i <= pieces.length; i++) {
          for (let j = i - 1; j >= 0 && !best[i]; j--) {
            if (!best[j] || (j === 0 && i === pieces.length)) continue; // 整行不切的情況前面已試過
            const z = tr(pieces.slice(j, i).join(', '));
            if (z) best[i] = [...best[j], z];
          }
        }
        if (best[pieces.length]) zh = best[pieces.length].join(',');
      }
    }
    // ninja 天賦樹頁的「Blight / Fungal Remission」(機制 / 基石):同樣每段都要查得到
    if (!zh && t.includes(' / ')) {
      const parts = t.split(' / ').map((p) => one(p));
      if (parts.length > 1 && parts.every(Boolean)) zh = parts.join(' / ');
    }
    // 括號裡一個介面字(寶石列的 `(trigger)`)
    if (!zh) {
      const m = /^\(([A-Za-z][A-Za-z ]*)\)$/.exec(t);
      const z = m && D.lower.get(m[1].toLowerCase());
      if (z) zh = `(${z})`;
    }
    return zh ? lead + zh + trail : null;
  }

  globalThis.__pmzSiteZhCore = { detectGame, buildSiteDict, translateText, renderStat, stripBilingual, SITE_UI, SITE_UI_MANUAL };
  // 離線測試載入時沒有 chrome / document:只匯出純函式
  if (typeof chrome === 'undefined' || !chrome.storage || !SITE || typeof document === 'undefined') return;

  // ── DOM ──

  const SKIP_TAGS = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'CODE', 'PRE', 'TEMPLATE']);
  // 下拉選單照翻(時光機的 Week 9 / Latest snapshot、價值顯示…),只有聯盟選單不碰(聯盟名不翻,使用者裁定)
  const isLeagueSelect = (el) => el.tagName === 'SELECT' && (el.id === 'League' || /league/i.test(el.name ?? '') || /league/i.test(el.getAttribute('aria-label') ?? ''));
  const INLINE = new Set(['SPAN', 'A', 'B', 'I', 'EM', 'STRONG', 'SMALL', 'FONT', 'U', 'SUP', 'SUB', 'LABEL', 'MARK']);

  const original = new WeakMap(); // 文字節點 → 原文
  const written = new WeakMap(); // 文字節點 → 我們寫進去的字(用來分辨框架改回英文 vs 自己的寫入)
  const touched = []; // WeakRef<Text>,關掉開關時逐一還原
  const titled = []; // WeakRef<Element>,我們加的 title
  let dict = null;
  let dictGame = null;
  let enabled = false;
  const stat = { lines: 0, nodes: 0, restored: 0 };

  function skipped(node) {
    for (let el = node.parentElement; el; el = el.parentElement) {
      if (SKIP_TAGS.has(el.tagName) || el.isContentEditable || isLeagueSelect(el)) return true;
      if (el.dataset?.pmzNoZh !== undefined) return true;
    }
    return false;
  }

  // 整個元素是不是「一行」:底下只有文字與行內元素、字數不長
  // flex / grid 容器的子元素各自是一格(poe.ninja 的精通效果是同一個 flex 容器裡並排的 <span>,
  // 標籤是行內元素、畫面上卻各佔一行)—— 只看標籤名會把它們當成同一行而全部不換。
  const lays = (el) => /flex|grid/.test(getComputedStyle(el).display);
  // 元素在排版上是不是行內(`display: inline*`);flex / grid 容器的子元素一律不是
  const inlineBox = (el) => INLINE.has(el.tagName) && !(el.parentElement && lays(el.parentElement))
    && getComputedStyle(el).display.startsWith('inline');

  function isLine(el) {
    if (!el || (el.textContent ?? '').length > MAX_LEN) return false;
    if (el.childElementCount > 1 && lays(el)) return false;
    for (const c of el.querySelectorAll('*')) if (!INLINE.has(c.tagName)) return false;
    return true;
  }

  // 文字節點所屬的「行」:往上爬到最外層仍是一行的元素(詞綴常被拆成好幾個 span)
  function lineOf(textNode) {
    let el = textNode.parentElement;
    if (!el || !isLine(el)) return null;
    while (inlineBox(el) && el.parentElement && isLine(el.parentElement)) el = el.parentElement;
    return el;
  }

  function textNodesIn(el) {
    const out = [];
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }

  function setText(node, value) {
    if (!original.has(node)) { original.set(node, node.data); touched.push(new WeakRef(node)); }
    written.set(node, value);
    node.data = value;
  }

  function addTitle(el, en) {
    if (!el || el.hasAttribute('title')) return;
    el.setAttribute('title', en);
    el.dataset.pmzZhTitle = '1';
    titled.push(new WeakRef(el));
  }

  // 目前這個節點的「英文原文」:我們寫過的就拿原文,框架改過的就拿現在的
  const englishOf = (n) => (written.get(n) === n.data ? original.get(n) : n.data);

  function translateLine(el) {
    const nodes = textNodesIn(el);
    if (nodes.length < 2) return false; // 單一文字節點走下面逐節點那條即可
    const en = nodes.map(englishOf).join('');
    const done = () => { addTitle(el, en.trim()); stat.lines++; return true; };
    // 逐段換:每個帶英文字的節點都要各自翻得出來才換(缺一個就不換),數值的顏色等樣式留在原節點上
    const piecewise = () => {
      const parts = nodes.map((n) => {
        const e = englishOf(n);
        return /[A-Za-z]/.test(e) ? classText(n, e) ?? translateText(e, dict) : e;
      });
      if (!parts.every((p) => p != null)) return false;
      nodes.forEach((n, i) => { if (parts[i] !== englishOf(n)) setText(n, parts[i]); });
      return done();
    };
    // 「標籤: 數值」與需求列(`Cost` `:` `13 Mana`、`Requires ` `Level ` `70` `Str ` `35`)先試逐段。
    // 其他行(詞綴被拆成好幾段上色)先整行查,逐段換會變成逐字翻
    if (/^\s*(Requires\b|[A-Za-z][^:]{0,40}:\s)/.test(en) && piecewise()) return true;
    const zh = translateText(en, dict);
    // 整行不是一條已知的東西,但每一段各自是(`Heart of the Well` + `Diamond` = 傳奇名 + 基底名)→ 逐段
    if (!zh) return piecewise();
    const first = nodes.findIndex((n) => englishOf(n).trim());
    nodes.forEach((n, i) => setText(n, i === first ? zh.trim() : ''));
    return done();
  }

  // 這個文字節點所在的「視覺行」裡,除了它自己以外還有沒有別的英文字。
  // 視覺行 = 往上爬出行內元素後,前後兄弟直到遇到區塊元素或 <br> 為止。
  // 有的話就不換這一段:`<span>Cold</span> taken as` 只換 Cold 會變成「冰冷 taken as」,
  // 半中半英比整行英文更難讀(鐵則:不湊半中半英)。旁邊只有數字與符號(`Evasion Rating:` + `103`)照換。
  const isBreak = (n) => n.nodeType === Node.ELEMENT_NODE && !inlineBox(n);
  function hasOtherWords(node) {
    let el = node;
    while (el.parentElement && inlineBox(el.parentElement)) el = el.parentElement;
    let start = el;
    let end = el;
    while (start.previousSibling && !isBreak(start.previousSibling)) start = start.previousSibling;
    while (end.nextSibling && !isBreak(end.nextSibling)) end = end.nextSibling;
    for (let n = start; n; n = n.nextSibling) {
      if (n !== el) {
        const text = n.nodeType === Node.TEXT_NODE ? englishOf(n) : n.textContent;
        if (/[A-Za-z]{2}/.test(text ?? '')) return true;
      } else if (el !== node) {
        // 同一個行內元素底下的其他文字節點
        for (const t of textNodesIn(el)) if (t !== node && /[A-Za-z]{2}/.test(englishOf(t) ?? '')) return true;
      }
      if (n === end) break;
    }
    return false;
  }

  // ninja 流派頁的職業 / 昇華篩選格(`.class-filter-list`):這個位置只可能是職業名,直接查職業表。
  // 單獨出現時撞名的(`Martial Artist` 昇華「武聖」vs 同名天賦「武術家」、`Shaman`)在這裡就不會是天賦
  const CLASS_LIST = '.class-filter-list';
  // 區塊標題(ninja 在 h2 的 title 保留英文原文;沒有 title 的用原文字)→ 該查哪張表
  const SECTION_KINDS = [
    [/^Anointed Passives$/i, 'anoint'],
    [/^(Items|Animated Guardian|Mercenary Items)$/i, 'item'],
    [/^(Main Skills|Spirit Skills|All Skills|All Gems|Skills|Gems)$/i, 'skill'],
    [/^(Passives|Keystones|Masteries|Notables)$/i, 'passive'],
    [/^Atlas$/i, 'atlas'],
    [/^(Classes|Second Ascendancy|Ascendancy|Top Classes Per League)$/i, 'class'],
  ];
  function sectionKind(node) {
    // 標題多半是 h2;流派首頁「Top Classes Per League」是 header 裡的 <a>
    const h2 = node.parentElement?.closest('section')?.querySelector('header h2, header h3, header > a');
    if (!h2) return null;
    const title = (h2.getAttribute('title') ?? textNodesIn(h2).map(englishOf).join('')).trim();
    return SECTION_KINDS.find(([re]) => re.test(title))?.[1] ?? null;
  }
  function classText(node, en) {
    const key = en.trim();
    let zh = null;
    // 職業篩選格,或連到「?class=職業」的卡片(流派首頁各聯盟熱門職業)
    if (node.parentElement?.closest(`${CLASS_LIST}, a[href*="class="]`)) zh = dict.classNames?.get(key);
    // 物價頁「禁忌珠寶」:表格只有昇華天賦名與職業名兩種(Forbidden Power、Saboteur),沒有區塊標題可看
    else if (/\/forbidden-jewels(\/|$)/.test(location.pathname)) zh = dict.classNames?.get(key) ?? dict.passiveAll?.get(key);
    else {
      const kind = sectionKind(node);
      if (kind === 'anoint') zh = dict.anointPassives?.get(key) ?? dict.passiveAll?.get(key);
      else if (kind === 'item') zh = dict.uniqueAll?.get(key);
      else if (kind === 'skill') zh = dict.gemAll?.get(key);
      else if (kind === 'passive') zh = dict.passiveAll?.get(key);
      else if (kind === 'atlas') zh = dict.atlasPassives?.get(key);
      else if (kind === 'class') zh = dict.classNames?.get(key);
    }
    return zh ? en.match(/^\s*/)[0] + zh + en.match(/\s*$/)[0] : null;
  }

  function translateNode(node) {
    const en = englishOf(node);
    if (written.get(node) === node.data) return true; // 已是我們的譯文
    if (hasOtherWords(node)) return false;
    const zh = classText(node, en) ?? translateText(en, dict);
    if (!zh) return false;
    setText(node, zh);
    addTitle(node.parentElement, en.trim());
    stat.nodes++;
    return true;
  }

  // ── 兩行式詞綴:遊戲檔是一條(模板裡有換行),畫面上是兩個並排的行元素 ──
  // 例:「Grants Immunity to Bleeding for 16 seconds if used while Bleeding」+
  //     「Grants Immunity to Corrupted Blood for 16 seconds if used while affected by Corrupted Blood」。
  // 單行都查不到時,跟下一個同類的兄弟元素合併(中間當空白)再查;譯文剛好兩行才按行寫回(參考擴充的多行合併做法)。
  const elText = (el) => textNodesIn(el).map(englishOf).join('').trim();
  function writeEl(el, zh) {
    const nodes = textNodesIn(el);
    const first = nodes.findIndex((n) => englishOf(n).trim());
    nodes.forEach((n, i) => setText(n, i === first ? zh : ''));
  }
  function translatePair(el) {
    const next = el?.nextElementSibling;
    if (!next || next.tagName !== el.tagName || skipped(next)) return false;
    const a = elText(el);
    const b = elText(next);
    if (!/[A-Za-z]{2}/.test(a) || !/[A-Za-z]{2}/.test(b) || a.length + b.length > MAX_LEN) return false;
    const parts = translateText(`${a} ${b}`, dict)?.trim().split('\n');
    if (parts?.length !== 2) return false;
    writeEl(el, parts[0].trim());
    writeEl(next, parts[1].trim());
    addTitle(el, a);
    addTitle(next, b);
    stat.lines++;
    return true;
  }

  // ── 以 <br> 斷行的一段文字(技能敘述、傳說文字、跨兩行的詞綴)──
  // 遊戲檔裡是一整句(或帶換行的一段),畫面上被 <br> 切成好幾個文字節點,逐行查不到。
  // 整段併起來(<br> 當空白)查整句;查到就把譯文寫進第一個文字節點、其餘清空,
  // 並把 <br> 暫時藏起來(只改 style,不刪節點;關開關時還原)。
  const hiddenBrs = []; // WeakRef<HTMLBRElement>
  function brBlockOf(textNode) {
    const p = textNode.parentElement;
    if (!p || !p.querySelector(':scope > br')) return null;
    if ((p.textContent ?? '').length > MAX_TEXT_LEN) return null;
    for (const c of p.children) if (c.tagName !== 'BR' && !INLINE.has(c.tagName)) return null;
    return p;
  }
  function translateBrBlock(p) {
    const nodes = textNodesIn(p);
    const en = [...p.childNodes].map((c) => (c.nodeName === 'BR' ? ' ' : c.nodeType === Node.TEXT_NODE ? englishOf(c) : textNodesIn(c).map(englishOf).join(''))).join('');
    const zh = translateText(en, dict);
    if (!zh) {
      // 框架換了內容、新內容查不到:之前藏起來的 <br> 要放回來,否則英文會黏成一行
      for (const br of p.querySelectorAll(':scope > br')) br.style.removeProperty('display');
      return false;
    }
    const first = nodes.findIndex((n) => englishOf(n).trim());
    nodes.forEach((n, i) => setText(n, i === first ? zh.trim() : ''));
    for (const br of p.querySelectorAll(':scope > br')) {
      if (br.style.display !== 'none') { br.style.display = 'none'; hiddenBrs.push(new WeakRef(br)); }
    }
    addTitle(p, en.replace(/\s+/g, ' ').trim());
    stat.lines++;
    return true;
  }

  function processTextNodes(nodes) {
    const doneLines = new Set();
    const pairTried = new Set();
    for (const n of nodes) {
      if (!n.isConnected || skipped(n)) continue;
      if (written.get(n) === n.data) continue;
      const block = brBlockOf(n);
      if (block) {
        if (doneLines.has(block)) continue;
        doneLines.add(block);
        if (translateBrBlock(block)) continue;
      }
      const line = lineOf(n);
      if (line && !doneLines.has(line)) {
        doneLines.add(line);
        if (translateLine(line)) continue;
      }
      if (translateNode(n)) continue;
      // 單行怎樣都查不到:試著跟下一行合併(兩行式詞綴)
      const row = line ?? n.parentElement;
      if (row && row !== document.body && !pairTried.has(row)) {
        pairTried.add(row);
        translatePair(row);
      }
    }
  }

  // ── 輸入框的提示字(`Search filters...`、`Name`)──
  // 只改 placeholder 屬性;原文記在 WeakMap,關開關時還原。框架自己改了 placeholder(不等於我們寫的)就當新原文
  const placeholderOrig = new WeakMap();
  const placeholderSet = []; // WeakRef<Element>
  function translatePlaceholders(root) {
    if (root.nodeType !== Node.ELEMENT_NODE) return;
    const els = root.matches?.('input[placeholder], textarea[placeholder]') ? [root] : [];
    els.push(...root.querySelectorAll('input[placeholder], textarea[placeholder]'));
    for (const el of els) {
      const cur = el.getAttribute('placeholder');
      const rec = placeholderOrig.get(el);
      if (rec && rec.zh === cur) continue;
      const zh = translateText(cur, dict);
      if (!zh) continue;
      if (!rec) placeholderSet.push(new WeakRef(el));
      placeholderOrig.set(el, { en: cur, zh });
      el.setAttribute('placeholder', zh);
    }
  }

  function collectText(root, out) {
    if (root.nodeType === Node.TEXT_NODE) { out.push(root); return; }
    if (root.nodeType !== Node.ELEMENT_NODE || SKIP_TAGS.has(root.tagName)) return;
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) out.push(n);
  }

  // ── 批次排程:框架一次塞進一大批節點,合併後才處理 ──
  const pending = new Set();
  let timer = null;
  function schedule(node) {
    pending.add(node);
    if (!timer) timer = setTimeout(flush, 60);
  }
  async function flush() {
    timer = null;
    if (!enabled) { pending.clear(); return; }
    const game = detectGame();
    if (game !== dictGame) {
      // SPA 內切換 PoE1 / PoE2(poe.ninja 頂欄那顆),或 pobb.in 的標題剛渲染出來
      const myRun = runId;
      await loadDict(game);
      // ⚠ 載字典要跨程序、可能要幾百毫秒;這段期間使用者可能已經關掉開關 / 切 English(stop() 已把頁面還原)。
      //   不再檢查就會在還原之後又翻一遍(切 English 時背景清資料正好會觸發這條重載,端到端 E20 抓到)
      if (!enabled || myRun !== runId) { pending.clear(); return; }
      pending.clear();
      if (dict) { const all = []; collectText(document.body, all); processTextNodes(all); translatePlaceholders(document.body); }
      return;
    }
    if (!dict) { pending.clear(); return; }
    const nodes = [];
    for (const p of pending) collectText(p, nodes);
    const roots = [...pending];
    pending.clear();
    processTextNodes(nodes);
    for (const r of roots) if (r.isConnected) translatePlaceholders(r);
  }

  // 小量新增(滑到物品上才生出來的浮窗、切換分頁的一小塊)當場翻:MutationObserver 的回呼在瀏覽器繪製前執行,
  // 使用者第一眼就是中文。延後 60ms 的話浮窗會先以英文畫出 4 幀左右、換成中文後大小改變、浮窗重新定位 → 畫面抖動
  // (實測:ninja 裝備浮窗英文 65~72ms 後才變中文)。大量新增(整頁載入、SPA 換頁)仍合併後批次處理。
  const SYNC_MAX_TEXT = 400;
  const observer = new MutationObserver((muts) => {
    const roots = [];
    for (const m of muts) {
      if (m.type === 'characterData') {
        // 自己的寫入不理;框架把字改回英文才再翻
        if (written.get(m.target) !== m.target.data) roots.push(m.target);
      } else {
        for (const n of m.addedNodes) roots.push(n);
      }
    }
    if (!roots.length) return;
    if (dict && !timer && dictGame === detectGame()) {
      const nodes = [];
      for (const r of roots) { collectText(r, nodes); if (nodes.length > SYNC_MAX_TEXT) break; }
      if (nodes.length <= SYNC_MAX_TEXT) {
        processTextNodes(nodes);
        for (const r of roots) if (r.nodeType === Node.ELEMENT_NODE && r.isConnected) translatePlaceholders(r);
        return;
      }
    }
    for (const r of roots) schedule(r);
  });

  // ── 字典 ──
  const KEYS = {
    poe1: { statMap: 'statMap', itemMap: 'itemMap', uniqueMap: 'uniqueMap', passiveMap: 'passiveMap', names: 'dict:sitenames1.json' },
    poe2: { statMap: 'statMap2', itemMap: 'itemMap2', uniqueMap: 'uniqueMap2', passiveMap: 'passiveMap2', names: 'dict:sitenames2.json' },
  };
  let buildAsked = false;

  // 聯盟名(使用者 2026-09-26 裁定:ninja 是國際服在用,聯盟名一律不翻)。
  // 兩個來源:頁面上 ninja 自己的聯盟選單(`<select id="League">`,兩款都有;選單本身本來就不碰),
  // 以及背景的 poe.ninja 聯盟清單(`ninja:leagues`,角色頁沒有選單時靠它)。
  // 「Allflame」單獨出現在角色頁標題時,字典裡剛好有同名條目,不擋就會被換成中文。
  async function leagueNames() {
    const names = new Set();
    const onPage = [...document.querySelectorAll('select#League option, select[name="league" i] option')].map((o) => o.textContent.trim());
    // 在任何一頁看過的選單內容記下來(`siteLeagues`):PoE2 的角色頁沒有選單,背景清單也只有 PoE1
    try {
      const { siteLeagues } = await chrome.storage.local.get('siteLeagues');
      for (const l of siteLeagues ?? []) names.add(l);
      const fresh = onPage.filter((l) => l && !names.has(l));
      if (fresh.length) await chrome.storage.local.set({ siteLeagues: [...names, ...fresh].slice(-500) });
    } catch (_) { /* 存不進去不影響本頁 */ }
    onPage.forEach((l) => names.add(l));
    try {
      const res = await chrome.runtime.sendMessage({ t: 'ninja:leagues' });
      for (const l of res?.leagues ?? []) names.add(String(l));
    } catch (_) { /* 沒有 ninja 權限或背景休眠:只靠頁面上的選單 */ }
    // 困難 / 單人變體:「Hardcore X」「HC X」「SSF X」…只剩核心名也要擋
    for (const n of [...names]) {
      const core = n.replace(/^(Hardcore|HC|SSF|HC SSF|Ruthless|HC Ruthless|SSF R|HC SSF R)\s+/i, '').replace(/\s*\(PL\d+\)$/, '');
      if (core) names.add(core);
    }
    names.delete('');
    return [...names];
  }

  async function loadDict(game) {
    dictGame = game;
    dict = null;
    if (!game) return;
    const K = KEYS[game];
    const got = await chrome.storage.local.get([K.statMap, K.itemMap, K.uniqueMap, K.passiveMap, K.names]);
    // 名稱表只放遠端(dict 分支),背景抓回來存在遠端字典的快取 `dict:sitenamesN.json`({ text, sha256 … })。
    // 沒有就請背景抓(第一次會等下載);有就照用,另外請背景順便確認新鮮度(背景自己節流,6 小時一次)
    let rec = got[K.names];
    if (!rec) {
      await chrome.runtime.sendMessage({ t: 'sites:names', game }).catch(() => {});
      rec = (await chrome.storage.local.get(K.names))[K.names];
    } else {
      chrome.runtime.sendMessage({ t: 'sites:names', game }).catch(() => {});
    }
    let siteNames = null;
    try { siteNames = rec?.text ? JSON.parse(rec.text) : null; } catch (err) { console.warn('[PMZ] 網站名稱表無法解析:', err); }
    if (!siteNames) console.warn('[PMZ] 網站名稱表還沒下載到(遠端與快取都沒有),先只用交易站字典翻');
    if (!got[K.itemMap] && !buildAsked) {
      // 從沒開過這一款的交易站 → 物品與詞綴表還沒建。請背景建一次,建好後 onChanged 會重翻。
      buildAsked = true;
      chrome.runtime.sendMessage({ t: 'translation:build', game }).catch(() => {});
    }
    dict = buildSiteDict({
      siteNames,
      itemMap: got[K.itemMap],
      uniqueMap: got[K.uniqueMap],
      passiveMap: got[K.passiveMap],
      statMap: got[K.statMap],
      leagues: await leagueNames(),
    });
    dbg(`[PMZ/site] ${SITE} ${game}:名稱 ${dict.names.size}、介面/面板 ${dict.lower.size}、` +
      `詞綴模板 ${Object.keys(dict.statMap ?? {}).length}、同名不同譯不換 ${dict.conflicts.length}`);
  }

  function restoreAll() {
    for (const ref of touched) {
      const n = ref.deref();
      if (!n || !original.has(n)) continue;
      if (written.get(n) === n.data) { n.data = original.get(n); stat.restored++; }
      original.delete(n);
      written.delete(n);
    }
    touched.length = 0;
    for (const ref of titled) {
      const el = ref.deref();
      if (el?.dataset.pmzZhTitle) { el.removeAttribute('title'); delete el.dataset.pmzZhTitle; }
    }
    titled.length = 0;
    for (const ref of hiddenBrs) ref.deref()?.style.removeProperty('display');
    hiddenBrs.length = 0;
    for (const ref of placeholderSet) {
      const el = ref.deref();
      const rec = el && placeholderOrig.get(el);
      if (rec && el.getAttribute('placeholder') === rec.zh) el.setAttribute('placeholder', rec.en);
      if (el) placeholderOrig.delete(el);
    }
    placeholderSet.length = 0;
  }

  let runId = 0;
  async function start() {
    if (enabled) return;
    enabled = true;
    runId++;
    dictGame = undefined; // 強制 flush 重載字典並整頁掃一次
    observer.observe(document.body, { childList: true, subtree: true, characterData: true });
    schedule(document.body);
  }

  function stop() {
    if (!enabled) return;
    enabled = false;
    runId++; // 進行中的字典載入一律作廢(見 flush)
    observer.disconnect();
    restoreAll();
    dict = null;
    dictGame = null;
  }

  // 開關開著,而且擴充是中文介面 + 翻譯開著(與交易站同一條規則,見 bg/translation.js chineseDataAllowed)
  async function shouldRun() {
    const { siteZh, language, uiLang } = await chrome.storage.local.get(['siteZh', 'language', 'uiLang']);
    const ui = uiLang === 'zh' || uiLang === 'en' ? uiLang : language !== undefined ? 'zh' : undefined;
    return siteZh === true && ui === 'zh' && (language ?? 'zh_tw') === 'zh_tw';
  }
  const apply = () => shouldRun().then((on) => (on ? start() : stop()))
    .catch((err) => console.warn('[PMZ] 網站中文化初始化失敗:', err));

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== 'local') return;
    if (changes.siteZh || changes.language || changes.uiLang) { apply(); return; }
    // 交易站資料建好 / 更新了 → 重載字典再翻一次(已翻的節點會被略過)
    const K = dictGame && KEYS[dictGame];
    if (enabled && K && (changes[K.itemMap] || changes[K.statMap] || changes[K.passiveMap] || changes[K.names])) {
      dictGame = undefined;
      schedule(document.body);
    }
  });

  window.__pmzSiteZh = () => ({ site: SITE, game: dictGame, ...stat, conflicts: dict?.conflicts ?? [] });
  // 診斷:在 console(擴充的 isolated world)打 __pmzSiteZhTr('英文') 看目前字典翻成什麼
  window.__pmzSiteZhTr = (s) => (dict ? translateText(s, dict) : null);

  apply();
})();
