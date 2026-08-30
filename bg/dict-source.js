// 翻譯字典的三層來源:遠端 → chrome.storage.local 快取 → 擴充內建 data/*.json。
//
// 為什麼要遠端:六個字典本來完全鎖在擴充包裡,改一個譯名就得重發一版擴充、
// 等商店審核。遠端化之後譯名可以獨立更新,內建那份退居**最後一道後路**。
//
// 遠端佈局是本 repo 的 **`dict` 孤兒分支**,經 raw.githubusercontent.com 取用,
// 檔名即字典檔名,所以下載 URL 永遠不變。**刻意不打 GitHub API** —— 匿名限額
// 60 次/hr/IP,而 raw 走 CDN 不吃額度。
//
// ⚠ **為什麼不是 GitHub Release asset**(2026-08-09 一度做成那樣,實測後改掉):
// release 的下載網址在 `github.com` 網域,而且會 302 到
// `release-assets.githubusercontent.com`,兩個都得寫進 manifest 的
// host_permissions。**新增 host_permissions 會讓 Chrome 在擴充更新後把它停用、
// 等使用者手動重新授權** —— 為了換一個更新管道去打斷所有現有使用者,不划算。
// `raw.githubusercontent.com` 本來就在權限清單裡(社群遞補字典在用),改走它
// 等於零新權限。
//
// ⚠ 「遠端拉不到」是正常情況,不是錯誤。分支還沒推上去時 raw 回的是乾淨的
// HTTP 404 + `text/plain` 的 "404: Not Found"。整條路徑必須在「遠端永遠拿不到」
// 的前提下,與遠端化之前一模一樣地運作。

// 開發診斷 log:發佈打包(tools/pack.mjs)會把下行替換為 no-op,勿改動格式
const dbg = (...a) => console.info(...a);

// raw.githubusercontent.com/<owner>/<repo>/<分支>/<檔名>
const REMOTE_BASE = 'https://raw.githubusercontent.com/Hsiung-Shao/poe-market-zh/dict/';
const INDEX_NAME = 'dict-index.json';

// 字典檔名(順序即 popup 顯示順序)。tools/gen-dict-index.mjs 產生索引時
// 用的是同一份清單,兩邊要一起改。
export const DICT_FILES = [
  'translate.json',
  'translate.zh_TW.json',
  'clusterJewel.json',
  'passivesNotable.json',
  's2t.json',
  'ggpk.json',
  // PoE2 的遊戲檔字典(詞綴種子 + 物品錨定 + 傳奇名),由 tools/gen-ggpk2-data.mjs
  // 從 PoE2 GGPK 的 `data/balance/traditional chinese/` 產生。與 ggpk.json 同形,
  // 多一個 uniques 區塊(傳奇名必須與基底/寶石名分開,見該腳本註解的 Briarpatch)。
  'ggpk2.json',
  // 官方 trade data API 的快照,四個端點的逐字副本。**只有遠端,沒有內建版本** ——
  // 用途是「官方 API 被擋時的後路」,擴充包不為此變大 5MB;拿不到就退回原本的降級。
  // ⚠ 列在這裡**不會**讓第一階段多抓東西:第一階段是逐檔明列 loadDictOr(...) 的,
  //   這份清單只餵給 DICT_STORAGE_KEYS(清除快取)與 tools/gen-dict-index.mjs。
  'api-us.json',
  'api-tw.json',
  'api2-us.json',
  'api2-tw.json',
];
// 沒有內建版本的檔。索引產生器不能拿 data/ 底下的同名檔跟它們比涵蓋率(根本沒有),
// 擴充端的 loadDict 走到第三層也會直接 throw —— 兩邊都要知道這件事。
export const REMOTE_ONLY_FILES = new Set([
  'api-us.json', 'api-tw.json', 'api2-us.json', 'api2-tw.json',
]);

// 逾時:第一階段的性質是「不需網路、必定成功」,遠端拖住就直接走本地。
// 可由 _test.setTimeouts 調整,讓離線驗證不必真的等 30 秒。
const TIMEOUTS = { index: 8000, file: 30000 };

const CACHE_PREFIX = 'dict:'; // dict:<檔名> → { sha256, size, text, storedAt, extVersion }
// 目前的擴充版本。快取記錄要蓋這個章,才分得出「這份快取是不是比現在的內建新」。
const EXT_VERSION = (() => {
  try { return chrome.runtime.getManifest().version; } catch (_) { return ''; }
})();

// 內建字典(data/ 底下那幾份)的版本。**動到 data/ 裡的字典就要 +1。**
//
// ⚠⚠ 沒有這條的話,**遠端永遠壓過內建**:遠端字典機制的用意是「不發版也能更新
//   字典」,但發版時內建字典也會一起更新,那一刻 dict 分支往往還沒跟上 ——
//   於是新版擴充下載回一份舊字典,把自己剛出貨的資料蓋掉。
//   2026-08-30 實際發生:新加進 ggpk.json 的詞綴群組名(modNames)整批消失,
//   而 console 只印一行「字典 ggpk.json:遠端(3559815 bytes)」,看起來一切正常
//   (3.39 MB 是舊檔,新的是 3.62 MB)。
//   遠端索引宣告的 `version` 大於這個值時才代表「遠端真的比較新」。
//   推新字典到 dict 分支時,索引的 version 要一併調高才會被採用。
const BUNDLED_DICT_VERSION = 3;
const INDEX_KEY = 'dictIndex'; // 最後一次成功取得的遠端索引(診斷用)
const STATUS_KEY = 'dictStatus'; // 給 popup 顯示「這份字典是哪來的」
// 索引宣告的大小若超過這個值就不下載 —— 六個字典最大的 ggpk.json 是 3.5MB,
// 32MB 是「遠端顯然壞掉」的分界,不是效能調校。
const MAX_FILE_BYTES = 32 * 1024 * 1024;

export const DICT_STORAGE_KEYS = [INDEX_KEY, STATUS_KEY, ...DICT_FILES.map((f) => CACHE_PREFIX + f)];

// ── 每次建置一個 session:索引只抓一次,來源記錄一次寫清楚 ──
let session = null;

export function resetDictStatus() {
  session = { indexPromise: null, index: null, remoteError: null, files: {}, notes: [] };
  return session;
}

function ensureSession() {
  return session ?? resetDictStatus();
}

// ── 回應驗證 ──

function decodeText(buf) {
  // sha256 一律對**原始位元組**算,不對 res.text() 算:translate.zh_TW.json 帶
  // BOM,而 Response.text() 的 UTF-8 解碼器會把 BOM 吃掉 —— 拿解碼後的字串算
  // 雜湊會與檔案本身的雜湊對不上,校驗永遠失敗。
  return new TextDecoder('utf-8').decode(buf).replace(/^\uFEFF/, '');
}

// 驗回應的「型別」不是只看 status:反機器人層(Cloudflare / Anubis)會回
// HTTP 200 + 挑戰 HTML,`res.ok` 為真,錯誤要拖到 JSON.parse 才爆而且堆疊指向
// 解析而非網路,查起來離真正原因很遠。
//
// ⚠ 但**不能**要求 content-type 是 `application/json`。GitHub 沒有任何一條路回 json
// (2026-08-10 對已上線的 dict 分支實測):
//     raw:小檔(≤ 幾百 KB)  → `text/plain; charset=utf-8`
//     raw:ggpk.json(3.5MB) → `application/octet-stream`  ← **同一個來源、同一次請求批次**
//     release asset(CDN)   → `application/octet-stream`   ← 曾評估過的來源
// ⚠ 最後這點是 08-09 那輪沒測出來的:當時以為 octet-stream 只會出現在 release asset,
// 所以「順便接受它」像是多餘的相容性。實際上**現行來源自己就會回 octet-stream** ——
// raw 依檔案大小決定,只接受 text/plain 的話 ggpk.json(六個字典裡最大、詞綴全靠它)
// 會被判失敗而靜默退回內建,其餘五個檔卻正常,是最難察覺的那種半壞。
// 硬性要求 json 會把正常的遠端全部判成失敗,而三層降級會安靜地退回內建,
// 表面上完全看不出遠端從來沒被用過。
// 判準因此是「**明確是 HTML 就失敗**」+「**內容形狀必須像 JSON**」,並把 body
// 前段帶進錯誤訊息。**同時接受 text/plain 與 octet-stream 是刻意的,不是漏寫** ——
// 檔案託管層根本不知道你要的是 JSON,那不是它的職責。
function assertJsonLike(text, ct, what) {
  const head = text.slice(0, 120).replace(/\s+/g, ' ').trim();
  const looksJson = /^\s*[{[]/.test(text.slice(0, 64));
  if (/html/i.test(ct ?? '') || !looksJson) {
    throw new Error(`${what} 回應不是 JSON(content-type=${ct || '無'};body 前段:${head})`);
  }
}

async function sha256Hex(buf) {
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

async function fetchRemote(name, timeoutMs, init = {}) {
  const url = REMOTE_BASE + name;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { credentials: 'omit', signal: ctrl.signal, ...init });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    return { buf, ct: res.headers?.get?.('content-type') ?? '' };
  } catch (err) {
    // AbortError 的原生訊息(「The operation was aborted」)看不出是逾時
    if (err?.name === 'AbortError') throw new Error(`逾時(${timeoutMs}ms)`);
    throw err;
  } finally {
    // ⚠ 一定要清:未清的 timer 會把 Node 端的離線驗證腳本吊到逾時才結束
    clearTimeout(timer);
  }
}

// ── 遠端索引 ──
// { version: 12, generatedAt: "...", files: { "translate.json": { sha256, size }, … } }
async function getIndex() {
  const s = ensureSession();
  if (s.indexPromise) return s.indexPromise;
  s.indexPromise = (async () => {
    try {
      const { buf, ct } = await fetchRemote(INDEX_NAME, TIMEOUTS.index, { cache: 'no-store' });
      const text = decodeText(buf);
      assertJsonLike(text, ct, INDEX_NAME);
      const json = JSON.parse(text);
      if (!json?.files || typeof json.files !== 'object') {
        throw new Error(`${INDEX_NAME} 缺 files 欄位`);
      }
      s.index = json;
      dbg(`[PTM] 遠端字典索引 v${json.version ?? '?'}:${Object.keys(json.files).length} 個檔`);
      // 索引落盤是診斷用途,寫不進去不影響這一輪的下載
      try {
        await chrome.storage.local.set({ [INDEX_KEY]: { ...json, fetchedAt: Date.now() } });
      } catch (err) {
        s.notes.push(`索引落盤失敗(${String(err?.message ?? err)})`);
      }
      return json;
    } catch (err) {
      s.remoteError = String(err?.message ?? err);
      dbg(`[PTM] 遠端字典索引取得失敗,改用快取/內建:${s.remoteError}`);
      return null;
    }
  })();
  return s.indexPromise;
}

// ── 快取層 ──

async function readCache(name) {
  const key = CACHE_PREFIX + name;
  try {
    const got = await chrome.storage.local.get(key);
    const rec = got?.[key];
    if (rec && typeof rec.text === 'string' && typeof rec.sha256 === 'string') return rec;
  } catch (err) {
    ensureSession().notes.push(`${name}:快取讀取失敗(${String(err?.message ?? err)})`);
  }
  return null;
}

// ⚠ 快取寫入是 best-effort 副作用,**絕不能和主流程共用同一個 try** ——
// 曾經因為 storage 配額爆掉,把「快取寫不進去」放大成「功能失敗」。
// 這裡寫失敗照樣回傳已經下載好的資料,只是下次還要重下。
async function writeCache(name, got) {
  try {
    await chrome.storage.local.set({
      [CACHE_PREFIX + name]: {
        sha256: got.sha256,
        size: got.size,
        text: got.text,
        storedAt: Date.now(),
        // 下載當下的擴充版本。用來判斷「這份快取還算不算比內建新」——
        // 見 loadDict 第二層的說明。舊快取沒有這個欄位,一律當成過期。
        extVersion: EXT_VERSION,
      },
    });
  } catch (err) {
    ensureSession().notes.push(`${name}:快取寫入失敗(${String(err?.message ?? err)})`);
    dbg(`[PTM] 字典 ${name} 快取寫入失敗(不影響本輪):`, err?.message ?? err);
  }
}

async function clearDictCache() {
  await chrome.storage.local.remove(DICT_STORAGE_KEYS);
}

// ── 內建層(最後一道後路,永遠不經網路)──
async function loadBundledDict(name) {
  const res = await fetch(chrome.runtime.getURL(`data/${name}`));
  if (!res.ok) throw new Error(`內建字典 data/${name} 讀取失敗(HTTP ${res.status})`);
  const text = await res.text();
  return JSON.parse(text.replace(/^\uFEFF/, '')); // 部分檔案含 BOM
}

// ── 下載 + 校驗 ──
async function downloadVerified(name, want) {
  if (typeof want.size === 'number' && want.size > MAX_FILE_BYTES) {
    throw new Error(`索引宣告的大小異常(${want.size} bytes)`);
  }
  const { buf, ct } = await fetchRemote(name, TIMEOUTS.file);
  const text = decodeText(buf);
  // 型別先驗:挑戰頁在這裡就被擋下,錯誤訊息才會指向「被擋了」而不是「雜湊不符」
  assertJsonLike(text, ct, name);
  if (typeof want.size === 'number' && want.size !== buf.byteLength) {
    throw new Error(`大小不符(索引 ${want.size},實得 ${buf.byteLength})`);
  }
  const sha256 = await sha256Hex(buf);
  if (sha256 !== want.sha256) {
    throw new Error(`sha256 不符(索引 ${String(want.sha256).slice(0, 12)}…,實得 ${sha256.slice(0, 12)}…)`);
  }
  return { sha256, size: buf.byteLength, text, json: JSON.parse(text) };
}

function record(name, src, meta) {
  ensureSession().files[name] = { src, ...meta };
}

/**
 * 取一個字典,依「遠端 → 快取 → 內建」降級。
 * 三層全滅才會 throw —— 呼叫端必須自己容錯,不得讓一個檔拖垮整份建置。
 */
export async function loadDict(name) {
  const s = ensureSession();
  const index = await getIndex();

  // 遠端沒有比內建新 → 這一輪連碰都不碰遠端與快取,直接用內建。
  // (見 BUNDLED_DICT_VERSION 的說明:少了這一步,發版一起更新的內建字典會被
  //  dict 分支上的舊檔靜默蓋掉。)
  // ⚠ api-*.json 只有遠端有,沒有內建可退,那幾個不適用這條。
  // ⚠ 一定要先確認**索引真的拿到了**。索引拿不到(離線、GitHub 掛掉)時 index 是
  //   null,若把它當成「版本 0、不比內建新」就會連快取那一層也一起跳過 ——
  //   而離線時快取正是它存在的理由。拿不到索引就維持原本的三層降級。
  if (index && (index.version ?? 0) <= BUNDLED_DICT_VERSION && !REMOTE_ONLY_FILES.has(name)) {
    const json = await loadBundledDict(name);
    record(name, 'bundled', { bundledNewer: true });
    dbg(`[PTM] 字典 ${name}:用內建(遠端索引 v${index?.version ?? '?'} 未超過內建 v${BUNDLED_DICT_VERSION})`);
    return json;
  }

  const want = index?.files?.[name] ?? null;
  const cached = await readCache(name);
  let cacheTried = false; // 同一個壞掉的快取不要解析兩次、記兩筆 note

  if (want?.sha256) {
    // 索引與快取的雜湊相同 → 這個檔沒變,不必重下(「只下載有變的」)
    if (cached?.sha256 === want.sha256) {
      cacheTried = true;
      const parsed = parseCached(name, cached);
      if (parsed !== undefined) {
        record(name, 'cache', { sha256: cached.sha256, size: cached.size, upToDate: true });
        return parsed;
      }
    } else {
      try {
        const got = await downloadVerified(name, want);
        await writeCache(name, got); // best-effort,失敗也照用
        record(name, 'remote', { sha256: got.sha256, size: got.size, upToDate: true });
        dbg(`[PTM] 字典 ${name}:遠端(${got.size} bytes)`);
        return got.json;
      } catch (err) {
        // 只降級**這一個檔**,其餘照常
        const msg = String(err?.message ?? err);
        s.notes.push(`${name}:遠端取得失敗(${msg})`);
        dbg(`[PTM] 字典 ${name} 遠端取得失敗,改用快取/內建:${msg}`);
      }
    }
  }

  // 遠端這次沒宣告或拿不到,但先前下載過。
  // ⚠⚠ 「快取一定比內建新」**只有在擴充版本沒變的前提下才成立**。發版時內建字典
  //    會跟著更新,那一刻舊快取反而是舊的 —— 而這一層會安靜地把新的內建蓋掉,
  //    使用者更新到新版卻拿到舊字典,console 只印一行「快取」不會有人看出問題。
  //    2026-08-30 實際發生:新加進 ggpk.json 的詞綴群組名整批被舊快取吃掉,
  //    結果卡的群組名全部維持英文。
  //    擴充版本一變就不再信任快取「比較新」,改用內建;真的比較新的遠端版本會在
  //    下一次索引宣告新雜湊時從第一層重新下載回來。
  if (cached && !cacheTried) {
    // ⚠ 先解析再判版本,順序不能倒過來:版本檢查若擋在前面,「快取壞掉」這個
    //   診斷訊號就永遠不會被記下來(verify-remote-dict 的 A5 會抓)。
    const parsed = parseCached(name, cached);
    if (parsed !== undefined) {
      if (cached.extVersion === EXT_VERSION) {
        record(name, 'cache', { sha256: cached.sha256, size: cached.size, upToDate: !!want && cached.sha256 === want.sha256 });
        return parsed;
      }
      dbg(`[PTM] 字典 ${name}:快取來自舊版擴充(${cached.extVersion ?? '未記錄'} ≠ ${EXT_VERSION}),改用內建`);
    }
  }

  // 只有遠端的檔沒有第三層。講清楚是「遠端與快取都沒有」,不要讓呼叫端看到
  // 一個指向 data/ 的 404 —— 那會把人帶去找根本不該存在的檔案。
  if (REMOTE_ONLY_FILES.has(name)) {
    throw new Error(`${name} 只有遠端版本,這次遠端與快取都拿不到`);
  }
  const json = await loadBundledDict(name);
  record(name, 'bundled', {});
  return json;
}

function parseCached(name, rec) {
  try {
    return JSON.parse(rec.text);
  } catch (err) {
    // 快取壞掉不算致命,當作沒有這層
    ensureSession().notes.push(`${name}:快取內容無法解析(${String(err?.message ?? err)})`);
    return undefined;
  }
}

/** 本輪各字典實際來自哪一層,給 popup 顯示與診斷用 */
export function getDictStatus() {
  const s = ensureSession();
  const counts = { remote: 0, cache: 0, bundled: 0 };
  for (const f of Object.values(s.files)) counts[f.src] = (counts[f.src] ?? 0) + 1;
  return {
    indexVersion: s.index?.version ?? null,
    generatedAt: s.index?.generatedAt ?? null,
    remoteError: s.remoteError,
    counts,
    files: { ...s.files },
    notes: [...s.notes],
    at: Date.now(),
  };
}

export async function saveDictStatus(extra = {}) {
  const status = { ...getDictStatus(), ...extra };
  try {
    await chrome.storage.local.set({ [STATUS_KEY]: status });
  } catch (_) {
    // 純顯示用,寫不進去不影響任何功能
  }
  return status;
}

// 供離線驗證腳本使用,執行期不用
export const _test = {
  REMOTE_BASE,
  INDEX_NAME,
  CACHE_PREFIX,
  INDEX_KEY,
  STATUS_KEY,
  TIMEOUTS,
  setTimeouts: (t) => Object.assign(TIMEOUTS, t),
  decodeText,
  assertJsonLike,
  sha256Hex,
  loadBundledDict,
  clearDictCache,
};

export { clearDictCache };
