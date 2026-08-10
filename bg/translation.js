// 翻譯資料建置:同時抓美服(英文)與台服(繁中)官方 trade data API,
// 依官方 id 對接產生中文化資料。資料來自 GGG 官方公開 API,
// 另有 data/ggpk.json 離線層(解析本機 Content.ggpk 的官方遊戲資料,
// 由 tools/gen-ggpk-data.mjs 產生)作為詞綴種子與物品遞補。
//
// 六個字典本身走 bg/dict-source.js 的三層降級(遠端 → storage 快取 → 內建),
// 這個檔只管「拿到字典之後怎麼用」,以及任一字典拿不到時如何只降級那一項。

import { clearDictCache, loadDict, resetDictStatus, saveDictStatus } from './dict-source.js';

const API_BASE = {
  us: 'https://www.pathofexile.com/api/trade/data/',
  tw: 'https://pathofexile.tw/api/trade/data/',
};
// 遞補層資料來源:cswzhang/Poe-trade-zh(Apache-2.0,簡體,經 s2t 轉繁)。
// 僅用於填補官方資料對不齊的缺口,官方台服資料永遠優先。
const COMMUNITY = {
  items: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/item.json',
  ui: 'https://raw.githubusercontent.com/cswzhang/Poe-trade-zh/master/json/interface.json',
};
const KINDS = ['items', 'stats', 'static', 'filters'];
// 不含正負號:官方模板寫作「+#%」,若把 +12 整段換成 # 會與模板 key 對不上
const NUM_RE = /\d+(?:\.\d+)?/g;
const ALARM_NAME = 'ptm-rebuild-translation';
const REBUILD_MINUTES = 24 * 60;
// 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
const dbg = (...a) => console.info(...a);

async function fetchKind(base, kind) {
  const res = await fetch(base + kind, { credentials: 'omit' });
  if (!res.ok) throw new Error(`fetch ${base}${kind} => HTTP ${res.status}`);
  return res.json();
}

async function fetchAll(base) {
  const results = await Promise.all(KINDS.map((k) => fetchKind(base, k)));
  return Object.fromEntries(KINDS.map((k, i) => [k, results[i]]));
}

// 建立 tw stats 的 id → entry 索引
function indexStatEntries(statsData) {
  const map = new Map();
  for (const group of statsData?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id) map.set(entry.id, entry);
    }
  }
  return map;
}

function bilingual(zh, en) {
  if (!zh || zh === en) return en;
  return `${zh} (${en})`;
}

// 美服(英文基準)資料的語言健檢。GGG 曾發生 www 英文站的 stats endpoint
// 整份回傳日文的事故(credentials:'omit'、無痕、繞快取皆同,items/static/
// filters 卻正常)。英文模板既是 statMap 的 key 也是下拉的英文半邊,一旦混入
// 他國語言,下拉會變成「中文 (日文)」、statMap 的 key 全部對不上結果列。
// 抽樣條目文字,非 ASCII 占比過高即判定不可用。
// ⚠ 抽樣必須**跨所有群組**:實測事故中 pseudo 群組仍是英文而其餘 13 組是日文,
// 只取開頭 N 筆會全部落在 pseudo 而誤判整份可用。
function looksEnglish(data, sample = 400, threshold = 0.2) {
  const groups = data?.result ?? [];
  if (!groups.length) return false;
  const perGroup = Math.max(5, Math.ceil(sample / groups.length));
  const texts = [];
  for (const group of groups) {
    let taken = 0;
    for (const entry of group.entries ?? []) {
      if (!entry.text) continue;
      texts.push(entry.text);
      if (++taken >= perGroup) break;
    }
  }
  if (!texts.length) return false;
  return texts.filter((t) => /[^\x00-\x7F]/.test(t)).length / texts.length <= threshold;
}

// stats:依 entry.id 對接;option 型詞綴依 option.id 對接。
// 台服查無該 id 時,以現有詞綴模板字典(ggpk 官方繁中,key 為 # 正規化
// 英文模板,與 stats API 的 text 同格式)補上 —— 台服 API 落後或缺席的
// 詞綴(如 Map is occupied by The Purifier)結果列翻得出來,下拉也應一致;
// 字典也查無才保留英文。
function translateStats(usStats, twStats, statFallback = {}) {
  const out = structuredClone(usStats);
  const twIndex = indexStatEntries(twStats);
  const twGroupLabel = new Map(
    (twStats?.result ?? []).map((g) => [g.id, g.label])
  );
  for (const group of out.result ?? []) {
    const zhLabel = twGroupLabel.get(group.id);
    if (zhLabel) group.label = zhLabel;
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (!tw) {
        let zh = statFallback[entry.text] ?? statFallback[`${entry.text} (Local)`];
        if (!zh) {
          // 帶實數的變體條目(如 You have Igniting Conflux for 3 seconds…):
          // 數值正規化成 # 查模板,命中後把原數值依序回填中文模板
          const key = entry.text.replace(NUM_RE, '#');
          const tpl = statFallback[key] ?? statFallback[`${key} (Local)`];
          if (tpl) {
            const nums = entry.text.match(NUM_RE) ?? [];
            let i = 0;
            zh = tpl.replace(/#/g, () => nums[i++] ?? '#');
          }
        }
        if (zh) entry.text = bilingual(zh, entry.text);
        continue;
      }
      entry.text = bilingual(tw.text, entry.text);
      if (entry.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [o.id, o.text]));
        for (const opt of entry.option.options) {
          const zh = twOpts.get(opt.id);
          if (zh) opt.text = bilingual(zh, opt.text);
        }
      }
    }
  }
  return out;
}

// items:GGG 的 items API 沒有跨語系共用 id,兩服清單只能靠位置對位 ——
// 但位置對位在兩服更新進度不同步時會整段錯位(實測 3.29 台服 gem 缺
// Raging Spirit of Enormity 但總數巧合相同,Chaos Golem 被配到食腐魔像
// 的翻譯)。因此條目層一律**以英文為準查字典**(fallbackItems:ggpk 官方
// 繁中 + 內建 + 社群,key 為英文全名/傳奇名),不做任何位置對位;
// 查無翻譯保留英文原文(寧缺勿錯)。分類標題依 cat.id 對接台服(id 為
// 語言無關鍵,安全)。
// 組合條目拆解:「Outer (Inner)」兩段各自可譯才組合(如 Scrying Orb (Strand)
// → 占卜寶珠(致命岩灘)、Vaal Arc (Arc of Oscillating) → 瓦爾.電弧(電弧.震盪)、
// Blighted Map (Strand) → 凋落地圖(致命岩灘));內圈為區域名時退查「Inner Map」。
// 任一段查無就不組(寧缺勿錯)。
const COMBO_RE = /^(.+?) \((.+)\)$/;
const stripEnSuffix = (v) => v.replace(/ \((?=[A-Za-z+#])[^()]*\)$/, ''); // 去字典值尾端的英文對照段
function comboLookup(fallbackItems, text) {
  const m = text.match(COMBO_RE);
  if (!m) return null;
  const outer = fallbackItems[m[1]];
  const inner = fallbackItems[m[2]] ?? fallbackItems[`${m[2]} Map`];
  if (!outer || !inner) return null;
  return `${stripEnSuffix(outer)}(${stripEnSuffix(inner)}) (${text})`;
}

// 變體條目(占卜寶珠、海圖等)在兩服 items API 的 `type` 是**語言無關的內部
// id**(兩服皆 `AbyssalPlain`),`disc` 亦同 —— 實測 839 筆帶 disc 的條目中
// 410 筆可用 `cat.id+type+disc` 唯一對接、零多重零錯配。這條路拿到的是台服
// 官方用語,優先於社群簡轉繁字典。(基底條目的 type 是本地化名稱,對接不到,
// 由 ggpk 字典負責。)
function indexTwVariants(twItems) {
  const map = new Map();
  for (const cat of twItems?.result ?? []) {
    for (const entry of cat.entries ?? []) {
      if (!entry.disc || !entry.text) continue;
      const key = `${cat.id}|${entry.type ?? ''}|${entry.disc}`;
      if (!map.has(key)) map.set(key, entry.text);
    }
  }
  return map;
}

// 台服 trade API 的變體條目,基底段有時與遊戲檔用字不一致(實例:trade 寫
// 「砂質海床海圖」,而遊戲檔與 trade 自己的基底條目都寫「沙質海床海圖」)。
// 以遊戲檔為準改寫基底段,同一批條目才不會兩種字混用。
const VARIANT_RE = /^(.*?)\s*[(（](.+)[)）]\s*$/;
function normalizeBaseName(zhText, enText, officialItems) {
  const zhM = zhText.match(VARIANT_RE);
  const enM = enText.match(VARIANT_RE);
  if (!zhM || !enM) return zhText;
  const officialBase = stripEnSuffix(officialItems[enM[1]] ?? '');
  if (!officialBase || officialBase === zhM[1]) return zhText;
  return `${officialBase} (${zhM[2]})`;
}

// 傳奇條目的判別:text 為「傳奇名 + 空格 + 基底名」,後面可能再帶交易站的變體
// 標記(遺產版)。回傳該標記的中文,無法判別則回 null。
const UNIQUE_SUFFIX = [[' (Legacy)', '(遺產)']];
function uniqueSuffix(entry, en) {
  if (!entry.name || !entry.type) return null;
  const base = `${entry.name} ${entry.type}`;
  if (en === base) return '';
  for (const [enSfx, zhSfx] of UNIQUE_SUFFIX) if (en === base + enSfx) return zhSfx;
  return null;
}
const uniqueName = (entry, en) => uniqueSuffix(entry, en) !== null;

function translateItems(usItems, twItems, fallbackItems = {}, officialItems = fallbackItems, ggpkItems = {}) {
  const out = structuredClone(usItems);
  const twCats = new Map((twItems?.result ?? []).map((c) => [c.id, c]));
  const twVariants = indexTwVariants(twItems);
  for (const cat of out.result ?? []) {
    const twLabel = twCats.get(cat.id)?.label;
    if (twLabel) cat.label = twLabel;
    for (const entry of cat.entries ?? []) {
      // 注意:name/type 是送給官方 API 的查詢值,必須保持英文,只改顯示用的 text
      // ⚠ 不得退用基底 type 的翻譯 —— text 含有比 type 更多資訊的條目
      // (傳奇名、寶石變體、地圖階級標註等)會被基底翻譯吃掉資訊,
      // 官網下拉比對 text,被吃掉的部分連英文都搜不到。
      const en = entry.text ?? entry.type;
      if (!en) continue;
      // 優先序:遊戲檔傳奇組合 → 官方精確 → 官方組合 → 內建與社群字典 → 台服(最後遞補)
      //
      // 傳奇條目的 text 是「傳奇名 基底名」,而字典兩者分開收錄。只查傳奇名會把
      // 基底名吃掉(「漁夫之辮」少了「潛能之戒」),下拉就無法區分同名不同基底的
      // 傳奇。而且這裡刻意只用**遊戲檔**的兩段來組:內建字典雖有完整詞條,卻是
      // 舊賽季快照,會蓋掉改過的譯名(實例:Heroic Tragedy 已由「英勇悲劇」改為
      // 「英勇的悲劇」)。
      // ⚠ 傳奇條目**不得只用傳奇名的譯法**:那會把基底名與遺產標記一起吃掉,連英文
      // 原文都殘缺(「Auxium Chain Belt (Legacy)」被壓成「奧術之符 (Auxium)」,
      // 搜 Legacy 或 Chain Belt 都找不到)。兩段都查得到才組,否則保留英文。
      const uSfx = uniqueSuffix(entry, en);
      const isUnique = uSfx !== null;
      const uCombo = (dict) => {
        const outer = dict[entry.name], inner = dict[entry.type];
        return outer && inner ? bilingual(`${stripEnSuffix(outer)} ${stripEnSuffix(inner)}${uSfx}`, en) : null;
      };
      let zh = isUnique ? uCombo(ggpkItems) : null; // 遊戲檔優先(內建字典是舊賽季快照)
      zh = zh ?? officialItems[en];
      if (!zh && isUnique) zh = uCombo(officialItems);
      zh = zh
        ?? (isUnique ? null : officialItems[entry.name])
        ?? comboLookup(officialItems, en)
        ?? fallbackItems[en];
      if (!zh && isUnique) zh = uCombo(fallbackItems);
      zh = zh
        ?? (isUnique ? null : fallbackItems[entry.name])
        ?? comboLookup(fallbackItems, en);
      // 台服 trade API 擺最後:它的用字與遊戲檔常有出入(實例:區域「硫磺蝕岸」
      // 台服寫成別的字),只在官方三源都組不出來時才用,並把基底名正規化回官方
      if (!zh && entry.disc) {
        const twText = twVariants.get(`${cat.id}|${entry.type ?? ''}|${entry.disc}`);
        if (twText) zh = bilingual(normalizeBaseName(twText, en, officialItems), en);
      }
      if (zh) entry.text = zh;
    }
  }
  return out;
}

// 遞補字典合併,優先序低到高:
//   社群 s2t 轉繁 < 內建 translate.json < ggpk(本機遊戲檔官方繁中)
// ggpk 擺最高的理由:它是從**當前版本遊戲檔**抽出來的,也就是玩家在遊戲裡真正
// 看到的字;內建字典則是某個舊賽季的快照,GGG 改譯名後就過期了(實測 3159 筆
// 交集中有 16 筆過期,例如 Split Arrow 在 3.29 已從「分裂箭矢」改為「裂化箭矢」,
// 另有兩張凋落地圖內建根本沒翻)。內建字典仍負責 ggpk 沒涵蓋的條目。
function mergeFallbackItems(communityItems, bundledItems, ggpkItems = {}) {
  const merged = {};
  for (const [en, zh] of Object.entries(communityItems)) merged[en] = bilingual(zh, en);
  for (const [en, v] of Object.entries(bundledItems)) {
    if (typeof v?.zh_tw === 'string' && v.zh_tw) merged[en] = v.zh_tw;
  }
  for (const [en, zh] of Object.entries(ggpkItems)) merged[en] = bilingual(zh, en);
  return merged;
}

// 官方層(遊戲檔 + 內建,不含社群簡轉繁):供 translateItems 判斷「這個譯名
// 是否有官方依據」,以及基底名正規化的比對基準
function mergeOfficialItems(bundledItems, ggpkItems = {}) {
  return mergeFallbackItems({}, bundledItems, ggpkItems);
}

// static(通貨等大宗交易項目):依 entry.id 對接
function translateStatic(usStatic, twStatic) {
  const out = structuredClone(usStatic);
  const twIndex = new Map();
  for (const group of twStatic?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (entry.id) twIndex.set(entry.id, entry);
    }
  }
  const twGroupLabel = new Map(
    (twStatic?.result ?? []).map((g) => [g.id, g.label])
  );
  for (const group of out.result ?? []) {
    const zhLabel = twGroupLabel.get(group.id);
    if (zhLabel) group.label = zhLabel;
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (tw?.text) entry.text = bilingual(tw.text, entry.text);
    }
  }
  return out;
}

// filters:群組與欄位依 id 對接,標題用純中文;下拉選項雙語
function translateFilters(usFilters, twFilters) {
  const out = structuredClone(usFilters);
  const twGroups = new Map((twFilters?.result ?? []).map((g) => [g.id, g]));
  for (const group of out.result ?? []) {
    const twGroup = twGroups.get(group.id);
    if (!twGroup) continue;
    if (twGroup.title) group.title = twGroup.title;
    const twFields = new Map((twGroup.filters ?? []).map((f) => [f.id, f]));
    for (const field of group.filters ?? []) {
      const tw = twFields.get(field.id);
      if (!tw) continue;
      if (tw.text) field.text = tw.text;
      if (tw.title) field.title = tw.title;
      if (field.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [String(o.id), o.text]));
        for (const opt of field.option.options) {
          const zh = twOpts.get(String(opt.id));
          if (zh && opt.text) opt.text = bilingual(zh, opt.text);
        }
      }
    }
  }
  return out;
}

// 結果頁翻譯引擎的查表:正規化英文模板(數值→#)→ 中文模板。
// # 數量不一致的項目跳過,避免回填錯位。
function buildStatMap(usStats, twStats) {
  const map = {};
  const twIndex = indexStatEntries(twStats);
  const countHash = (s) => (s.match(/#/g) ?? []).length;
  const addPair = (en, zh) => {
    if (!en || !zh || en === zh) return;
    const key = en.replace(NUM_RE, '#');
    const zhTpl = zh.replace(NUM_RE, '#');
    if (countHash(key) !== countHash(zhTpl)) return;
    if (!(key in map)) map[key] = zhTpl;
  };
  for (const group of usStats?.result ?? []) {
    for (const entry of group.entries ?? []) {
      const tw = twIndex.get(entry.id);
      if (!tw) continue;
      if (entry.option?.options && tw.option?.options) {
        const twOpts = new Map(tw.option.options.map((o) => [o.id, o.text]));
        for (const opt of entry.option.options) {
          const zhOpt = twOpts.get(opt.id);
          if (!zhOpt) continue;
          addPair(entry.text.replace('#', opt.text), tw.text.replace('#', zhOpt));
        }
      } else {
        addPair(entry.text, tw.text);
      }
    }
  }
  return map;
}

// ── 結果列查表的主鍵:國際服 stat id ──
// 官網在結果列每條詞綴的 DOM 上帶 `data-field="stat.<id>"`,直接取官方 id
// 查表即可,不必拿英文全句去比對 —— 後者只要措辭有一點出入(遊戲檔的
// stat_descriptions 與交易站措辭本來就不同一套)整條就翻不出來。
//
// 譯文來源優先序(使用者 2026-07-27 裁定):台服 → GGPK → 保留英文。
//
// 台服譯文必須通過守門才採用,因為**同 id 不保證同義**:
//   R1 同一 id 在國際服清單對應多種英文。GGG 會把語意不同的詞綴併成同一
//      個 id(「Area contains The Sacred Grove」與「Your Maps have +#%
//      chance to contain The Sacred Grove」),台服只給一條中文,無從判定
//      它對應哪一條 —— 硬配就會把「必定含有」翻成「有 #% 機率含有」。
//   R2/R3 佔位符數量或百分比型態與英文不符,回填會產生殘缺(「含有額外
//      # 個保險箱」)或單位錯置。
//   R4 台服根本沒翻(整條純 ASCII),讓 GGPK 有機會接手。
//
// 刻意**不做**「中文有『機率』但英文沒有 chance」這類詞彙特徵比對:實測
// 會把「+#% Chance to Block」→「+#% 格擋率」這種正確譯法誤殺 395 條,而
// 真正該擋的案例 R1 已全數涵蓋。守衛型過濾一律先量化誤殺率再上線。
const HASH_RE = /#/g;
const PERCENT_RE = /#\s*%/g;
const countOf = (s, re) => (String(s ?? '').match(re) ?? []).length;

// 回傳 null 表示台服譯文可用,否則回傳退回原因代碼
function gateTwStat(enText, zhText, ambiguousId) {
  if (!zhText) return 'TW_MISSING';
  if (ambiguousId) return 'R1_AMBIGUOUS_ID';
  if (countOf(zhText, HASH_RE) !== countOf(enText, HASH_RE)) return 'R2_PLACEHOLDER_COUNT';
  if (countOf(zhText, PERCENT_RE) !== countOf(enText, PERCENT_RE)) return 'R3_PERCENT_SHAPE';
  if (!/[^\x00-\x7F]/.test(zhText)) return 'R4_UNTRANSLATED';
  return null;
}

// { [statId]: { en, zh, src } }
//   en  = 國際服模板,結果列用它建擷取正則抓出實際數值(不可省:省了就
//         退回「數字→#」的脆弱比對,正負號與字面數字都會出錯)
//   zh  = 中文模板
//   src = 'tw' | 'ggpk',供診斷與稽核用
// 帶 option 的條目(星團珠寶、塗油等)刻意不收 —— 它們的 # 放的是選項
// 文字不是數值,擷取正則會抓錯;那類條目由 buildStatMap 逐選項展開處理。
function buildStatIdMap(usStats, twStats, ggpkStatMap = {}) {
  const map = {};
  const rejected = {};
  const twIndex = indexStatEntries(twStats);

  // R1:先掃一次,統計每個 id 對應幾種不同英文
  const enFormsById = new Map();
  for (const group of usStats?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (!entry?.id || !entry.text) continue;
      let set = enFormsById.get(entry.id);
      if (!set) enFormsById.set(entry.id, (set = new Set()));
      set.add(entry.text);
    }
  }

  for (const group of usStats?.result ?? []) {
    for (const entry of group.entries ?? []) {
      if (!entry?.id || !entry.text || entry.option?.options) continue;
      if (map[entry.id]) continue; // 同 id 多筆時第一筆為準(R1 已擋掉歧義的)
      const en = entry.text;
      const tw = twIndex.get(entry.id);
      const reason = gateTwStat(en, tw?.text, (enFormsById.get(entry.id)?.size ?? 1) > 1);
      if (!reason) {
        map[entry.id] = { en, zh: tw.text, src: 'tw' };
        continue;
      }
      rejected[reason] = (rejected[reason] ?? 0) + 1;
      const zh = ggpkStatMap[en] ?? ggpkStatMap[`${en} (Local)`];
      if (zh) map[entry.id] = { en, zh, src: 'ggpk' };
      // 兩源都沒有 → 不寫入,結果列保留英文(寧缺勿錯)
    }
  }
  return { map, rejected };
}

// ── 六個字典(源自 POE Trade zh,使用者指示直接沿用;README 致謝)──
// translate.json:物品名 4,636 條,值已是「中文 (英文)」格式
// translate.zh_TW.json:官網 UI 字串 1,760 條(繁中)
// clusterJewel.json / passivesNotable.json:結果頁天賦卡名稱+描述
// s2t.json:簡→繁字元對照(社群遞補層專用)
// ggpk.json:本機 Content.ggpk 抽出的官方繁中(詞綴種子 + 物品遞補)
//
// 取得方式一律經 loadDict():遠端 → storage 快取 → 擴充內建。

// 單檔容錯:三層全滅時只讓那一個字典變空,其餘照常。
// ⚠ 遠端化之前這幾個呼叫**完全沒有錯誤處理**,任一失敗就讓整個 buildTranslation
// 回 { ok:false }。當時每個檔都在擴充包裡、失敗機率實質為零所以沒事;一旦多了
// 網路那一層,不補容錯等於把「必定成功」這個性質弄壞。
async function loadDictOr(file, empty, failed) {
  try {
    return await loadDict(file);
  } catch (err) {
    failed.add(file);
    dbg(`[PTM] 字典 ${file} 三層(遠端/快取/內建)全部失敗:`, err?.message ?? err);
    return empty;
  }
}

// ── ggpk 離線層:解析本機 Content.ggpk 取得的官方繁中(GGG 遊戲資料)──
// 由 tools/gen-ggpk-data.mjs 產生 data/ggpk.json;拿不到時回空集合,
// 只影響詞綴種子與物品遞補的覆蓋率,不影響建置流程。
// meta(遊戲版本、產生時間)一併帶出來給 popup 顯示 —— 以前讀進來就丟掉,
// 使用者無從得知手上這份遊戲資料是哪個版本抽的。
async function loadGgpk(failed) {
  const g = await loadDictOr('ggpk.json', null, failed);
  return { statMap: g?.statMap ?? {}, items: g?.items ?? {}, meta: g?.meta ?? null };
}

function makeS2t(charMap) {
  return (s) => {
    let out = '';
    for (const ch of String(s)) out += charMap[ch] ?? ch;
    return out;
  };
}

// 失敗容忍:遞補層抓不到就回空物件,只影響補洞範圍
async function fetchCommunityDict(url, s2t) {
  try {
    const res = await fetch(url, { credentials: 'omit' });
    if (!res.ok) return {};
    const raw = await res.json();
    const out = {};
    for (const [en, zh] of Object.entries(raw)) {
      // 濾掉非物品/字串類雜項 key(如純數字)
      if (typeof zh !== 'string' || !/[A-Za-z]/.test(en)) continue;
      out[en] = s2t(zh);
    }
    return out;
  } catch (_) {
    return {};
  }
}

// 結果頁物品名/基底翻譯查表:英文 → 中文
// 結果列物品名查表:與 translateItems 同原則,以英文為準查字典,
// 不做任何位置對位(參數保留 usItems/twItems 以維持既有呼叫介面)。
function buildItemMap(_usItems, _twItems, fallbackItems = {}) {
  return { ...fallbackItems };
}

// 供離線測試腳本驗證對照邏輯用,執行期不使用
export const _test = {
  looksEnglish,
  translateStats,
  translateItems,
  translateStatic,
  translateFilters,
  buildStatMap,
  buildStatIdMap,
  gateTwStat,
  buildItemMap,
  makeS2t,
  fetchCommunityDict,
  mergeFallbackItems,
  mergeOfficialItems,
  normalizeBaseName,
  indexTwVariants,
  COMMUNITY,
};

let building = null;

// 兩階段建置:
// 第一階段「內建字典」不需網路、必定成功 —— UI 字串、物品名、天賦卡立即可用;
// 第二階段「官方 API + 社群遞補」best-effort —— 提供詞綴/篩選器 lscache 資料與
// 台服官方用語強化,失敗只降級不影響第一階段成果。
export async function buildTranslation() {
  if (building) return building;
  building = (async () => {
    try {
      // ── 第一階段:字典(遠端 → 快取 → 內建)──
      resetDictStatus();
      await chrome.storage.local.set({
        buildStatus: { state: 'building', msg: '載入翻譯字典…', at: Date.now() },
      });
      const dictFailed = new Set();
      const [bundledItems, bundledUI, clusterJewel, passivesNotable, s2tMap, ggpk] =
        await Promise.all([
          loadDictOr('translate.json', {}, dictFailed),
          loadDictOr('translate.zh_TW.json', {}, dictFailed),
          loadDictOr('clusterJewel.json', {}, dictFailed),
          loadDictOr('passivesNotable.json', {}, dictFailed),
          loadDictOr('s2t.json', {}, dictFailed),
          loadGgpk(dictFailed),
        ]);
      const dictStatus = await saveDictStatus({
        failed: [...dictFailed],
        gameVersion: ggpk.meta?.game_version ?? null,
        gameDataGeneratedAt: ggpk.meta?.generated_at ?? null,
      });
      dbg(
        `[PTM] 字典來源:遠端 ${dictStatus.counts.remote}、快取 ${dictStatus.counts.cache}、` +
          `內建 ${dictStatus.counts.bundled}` +
          (dictStatus.indexVersion != null ? `(遠端索引 v${dictStatus.indexVersion})` : '') +
          (dictFailed.size ? `;取得失敗:${[...dictFailed].join('、')}` : '')
      );

      const itemMapBundled = {};
      for (const [en, v] of Object.entries(bundledItems)) {
        if (typeof v?.zh_tw === 'string' && v.zh_tw) itemMapBundled[en] = v.zh_tw;
      }
      // 只在資料不存在時寫入(首次啟動);重建時不可用純內建版本
      // 降級掉上一輪第二階段已成功的完整資料
      const existing = await chrome.storage.local.get([
        'itemMap',
        'uiExtra',
        'statMap',
        'updated',
        'passives',
      ]);
      const stageOne = {
        buildStatus: {
          state: 'building',
          msg: `字典已載入(物品 ${Object.keys(itemMapBundled).length}、UI ${Object.keys(bundledUI).length}),更新官方資料中…`,
          at: Date.now(),
        },
      };
      // 天賦卡:兩份都拿得到才覆寫。任一份失敗時若已有舊資料就原封不動 ——
      // 失敗路徑不得產出比現況差的狀態。從未有過就有多少寫多少(空的也比沒有好懂)。
      const passivesOk =
        !dictFailed.has('clusterJewel.json') && !dictFailed.has('passivesNotable.json');
      if (passivesOk || !existing.passives) {
        stageOne.passives = { clusterJewel, passivesNotable };
      }
      if (!existing.itemMap) stageOne.itemMap = itemMapBundled;
      if (!existing.uiExtra) stageOne.uiExtra = bundledUI;
      // ggpk 詞綴種子:讓詞綴翻譯離線即可用;第二階段成功時被官方值覆蓋
      if (!existing.statMap && Object.keys(ggpk.statMap).length) {
        stageOne.statMap = ggpk.statMap;
      }
      if (!existing.updated) stageOne.updated = Date.now();
      await chrome.storage.local.set(stageOne);

      // ── 第二階段:官方 API + 社群遞補(失敗不影響內建字典)──
      // 分項容錯:美服(英文基準)必須成功,否則整段降級;台服/社群個別失敗
      // 只影響中文覆蓋率 —— 新賽季物品仍以最新美服資料入庫(英文可搜),
      // 不因台服尚未更新而整批沿用舊快照(否則新物品從官網下拉消失)。
      try {
        // s2t 轉換表拿不到就整個跳過社群字典。社群資料是簡體,沒有轉換表會把簡體字
        // 直接送進字典 —— 那比少幾條翻譯更糟,而且完全無聲。
        const s2tOk = !dictFailed.has('s2t.json');
        const s2t = makeS2t(s2tMap);
        dbg('[PTM] build:抓取官方雙服 API 與社群字典…');
        const [usRes, twRes, commItemsRes, commUiRes] = await Promise.allSettled([
          fetchAll(API_BASE.us),
          fetchAll(API_BASE.tw),
          s2tOk ? fetchCommunityDict(COMMUNITY.items, s2t) : Promise.resolve({}),
          s2tOk ? fetchCommunityDict(COMMUNITY.ui, s2t) : Promise.resolve({}),
        ]);
        if (usRes.status === 'rejected') throw usRes.reason; // 英文基準拿不到才算失敗
        const us = usRes.value;
        const tw = twRes.status === 'fulfilled' ? twRes.value : null;
        const communityItems = commItemsRes.status === 'fulfilled' ? commItemsRes.value : {};
        const communityUI = commUiRes.status === 'fulfilled' ? commUiRes.value : {};
        const degraded = [];
        if (!tw) degraded.push(`台服 API(${String(twRes.reason?.message ?? twRes.reason)})`);
        if (commItemsRes.status === 'rejected') degraded.push('社群物品字典');
        if (commUiRes.status === 'rejected') degraded.push('社群 UI 字典');
        if (!s2tOk) degraded.push('簡繁對照表(社群字典整層停用)');
        for (const f of dictFailed) degraded.push(`字典 ${f}`);
        if (degraded.length) dbg('[PTM] build:部分來源失敗,以遞補字典補中文:', degraded.join('、'));

        // 英文基準語言健檢:stats 異常時只降級 stats 一項,items/static/filters
        // 照常更新(與上方分項容錯同精神)
        const statsUsable = looksEnglish(us.stats);
        if (!statsUsable) degraded.push('官方英文詞綴資料異常(非英文)');
        const prev =
          statsUsable && !dictFailed.size
            ? {}
            : await chrome.storage.local.get([
                'translation',
                'statMap',
                'statIdMap',
                'itemMap',
                'uiExtra',
              ]);

        // 字典降級時不得用縮水的結果蓋掉上一輪的完整資料;但如果從來沒有過舊值,
        // 就照寫這一份(英文仍搜得到,比整個沒有好)。與上面 stats 的處理同一條規則。
        const keep = (ok, fresh, old) => (ok || old === undefined ? fresh : old);
        const itemsDictOk = !dictFailed.has('translate.json');
        const uiDictOk = !dictFailed.has('translate.zh_TW.json');

        const fallbackItems = mergeFallbackItems(communityItems, bundledItems, ggpk.items);
        const officialItems = mergeOfficialItems(bundledItems, ggpk.items);
        const translation = {
          items: keep(
            itemsDictOk,
            translateItems(us.items, tw?.items, fallbackItems, officialItems, ggpk.items),
            prev.translation?.items
          ),
          static: translateStatic(us.static, tw?.static),
          filters: translateFilters(us.filters, tw?.filters),
        };
        // stats 不可用時沿用上次成功的快照;從未成功過就整個不寫,
        // bootstrap 便不覆寫 lscache-tradestats,官網用自己的資料
        const prevStats = prev.translation?.stats;
        if (statsUsable) translation.stats = translateStats(us.stats, tw?.stats, ggpk.statMap);
        else if (prevStats) translation.stats = prevStats;
        // ggpk 種子墊底,官方 trade API 值(台服現行用語)同 key 覆蓋
        const statMap = statsUsable
          ? { ...ggpk.statMap, ...buildStatMap(us.stats, tw?.stats) }
          : { ...ggpk.statMap, ...(prev.statMap ?? {}) };
        // 結果列的主要查表(依官方 stat id);英文基準異常時沿用上次的,
        // 絕不用汙染的英文重建 —— 那會讓 R2/R3 守門全數誤判
        let statIdMap = prev.statIdMap ?? {};
        let idRejected = null;
        if (statsUsable) {
          const built = buildStatIdMap(us.stats, tw?.stats, ggpk.statMap);
          statIdMap = built.map;
          idRejected = built.rejected;
        }
        const itemMap = keep(
          itemsDictOk,
          buildItemMap(us.items, tw?.items, fallbackItems),
          prev.itemMap
        );
        // 內建繁中字典優先
        const uiExtra = keep(uiDictOk, { ...communityUI, ...bundledUI }, prev.uiExtra);
        const updated = Date.now();
        const doneMsg =
          `完成:詞綴 ${Object.keys(statMap).length} 條、物品 ${Object.keys(itemMap).length} 條、UI ${Object.keys(uiExtra).length} 條` +
          (degraded.length ? `(部分來源失敗:${degraded.join('、')})` : '') +
          (statsUsable ? '' : `;詞綴下拉${prevStats ? '沿用前次資料' : '暫用官網原文'}`);
        if (idRejected) {
          dbg('[PTM] build:詞綴 id 對照表', Object.keys(statIdMap).length, '條;退回原因', idRejected);
        }
        await chrome.storage.local.set({
          translation,
          statMap,
          statIdMap,
          itemMap,
          uiExtra,
          updated,
          buildStatus: { state: 'done', msg: doneMsg, at: updated },
        });
        dbg('[PTM] build:', doneMsg);
        return { ok: true, updated, degraded: degraded.length ? degraded : undefined };
      } catch (apiErr) {
        // 如實揭露降級範圍:曾成功建置過 → 沿用舊官方資料;從未成功 → 詞綴暫不可用
        const { translation: prevTranslation } = await chrome.storage.local.get('translation');
        const scope = prevTranslation
          ? '沿用上次成功的官方資料'
          : Object.keys(ggpk.statMap).length
            ? '詞綴改用本機遊戲檔字典,篩選器翻譯暫不可用(字典的物品/UI/天賦卡翻譯不受影響)'
            : '詞綴與篩選器翻譯暫不可用(字典的物品/UI/天賦卡翻譯不受影響)';
        // ⚠ 字典的降級也要在這條路徑講出來。第二階段失敗時原本只報「官方資料更新
        // 失敗」,字典缺了哪幾份完全不見 —— 有 fallback 的地方,缺口本來就安靜,
        // 再被另一個錯誤蓋掉就徹底查不到了。
        const dictNote = dictFailed.size ? `;字典取得失敗:${[...dictFailed].join('、')}` : '';
        const failMsg = `官方資料更新失敗,${scope}:${String(apiErr?.message ?? apiErr)}${dictNote}`;
        dbg('[PTM] build:', failMsg);
        await chrome.storage.local.set({
          buildStatus: { state: 'done', msg: failMsg, at: Date.now() },
        });
        return { ok: true, partial: true };
      }
    } catch (err) {
      await chrome.storage.local.set({
        buildStatus: { state: 'error', msg: String(err?.message ?? err), at: Date.now() },
      });
      return { ok: false, error: String(err?.message ?? err) };
    } finally {
      building = null;
    }
  })();
  return building;
}

export async function ensureAlarm() {
  const existing = await chrome.alarms.get(ALARM_NAME);
  if (!existing) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: REBUILD_MINUTES });
  }
}

export function isRebuildAlarm(alarm) {
  return alarm?.name === ALARM_NAME;
}

export async function handleTranslationMessage(msg) {
  switch (msg.t) {
    case 'translation:build':
      return buildTranslation();
    case 'translation:status': {
      const { buildStatus, updated, dictStatus } = await chrome.storage.local.get([
        'buildStatus',
        'updated',
        'dictStatus',
      ]);
      return {
        buildStatus: buildStatus ?? null,
        updated: updated ?? null,
        dictStatus: dictStatus ?? null,
      };
    }
    case 'translation:clear':
      await chrome.storage.local.remove([
        // statGroups 是 0.3.x 合併選單的產物,功能移除後一併清掉舊資料
        'translation', 'statMap', 'statIdMap', 'itemMap', 'uiExtra', 'passives', 'statGroups',
        'updated', 'buildStatus',
      ]);
      // 字典快取一併清掉:使用者按「清除快取」就是要重新拉一份,留著下載好的
      // 舊字典等於清了一半
      await clearDictCache();
      return { ok: true };
    default:
      return null;
  }
}
