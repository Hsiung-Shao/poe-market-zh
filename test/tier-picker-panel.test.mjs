// 階級面板(content/tier-picker.js)的位置計算、點選、開收與 i18n 譯名測試。
// 執行:node --test test/tier-picker-panel.test.mjs
// 沒有 jsdom:以 node:vm 載入 content script,配上下方的最小假 DOM。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const read = (p) => fs.readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf-8');
const PICKER_SRC = read('../content/tier-picker.js');

// ── 最小假 DOM ──
// 只支援本檔用得到的:元素樹、class / 屬性、isConnected / contains / closest、
// 簡單選擇器(tag / .class / [attr] / [attr="v"]、`:scope >` 與 `>` 子代鏈、逗號)、
// 非冒泡的事件派送(監聽器只在被派送的那個節點上觸發),以及監聽器計數。
class FakeEvent {
  constructor(type, init = {}) { this.type = type; this.key = init.key; this.target = null; }
  preventDefault() {}
  stopPropagation() {}
}
class FakeCustomEvent extends FakeEvent {}

class Target {
  constructor() { this._ls = []; }
  addEventListener(type, fn, opt) { this._ls.push({ type, fn, capture: opt === true || !!opt?.capture }); }
  removeEventListener(type, fn, opt) {
    const capture = opt === true || !!opt?.capture;
    const i = this._ls.findIndex((l) => l.type === type && l.fn === fn && l.capture === capture);
    if (i >= 0) this._ls.splice(i, 1);
  }
  dispatchEvent(ev) {
    if (!ev.target) ev.target = this;
    for (const l of this._ls.filter((x) => x.type === ev.type)) l.fn(ev);
    return true;
  }
  listenerCount(type) { return this._ls.filter((l) => l.type === type).length; }
}

function parseCompound(s) {
  const m = /^([a-zA-Z][\w-]*)?((?:\.[\w-]+|\[[^\]]+\])*)$/.exec(s.trim());
  if (!m) throw new Error(`假 DOM 不支援的選擇器:${s}`);
  const classes = [];
  const attrs = [];
  for (const part of m[2].match(/\.[\w-]+|\[[^\]]+\]/g) ?? []) {
    if (part[0] === '.') classes.push(part.slice(1));
    else {
      const am = /^\[([\w-]+)(?:="([^"]*)")?\]$/.exec(part);
      if (!am) throw new Error(`假 DOM 不支援的屬性選擇器:${part}`);
      attrs.push([am[1], am[2]]);
    }
  }
  return { tag: m[1]?.toLowerCase() ?? null, classes, attrs };
}
function matchCompound(el, c) {
  if (c.tag && el.tagName.toLowerCase() !== c.tag) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const [n, v] of c.attrs) {
    if (!el.hasAttribute(n)) return false;
    if (v !== undefined && el.getAttribute(n) !== v) return false;
  }
  return true;
}
function parseSelector(sel) {
  return sel.split(',').map((one) => {
    let s = one.trim();
    let scoped = false;
    if (s.startsWith(':scope')) { scoped = true; s = s.replace(/^:scope\s*>\s*/, ''); }
    s = s.replace(/\s*>\s*/g, '>');
    if (/\s/.test(s)) throw new Error(`假 DOM 不支援後代組合子:${one}`);
    return { scoped, chain: s.split('>').map(parseCompound) };
  });
}
function matchesChain(el, { scoped, chain }, scope) {
  let cur = el;
  for (let i = chain.length - 1; i >= 0; i--) {
    if (!cur || !matchCompound(cur, chain[i])) return false;
    if (i > 0) cur = cur.parentNode;
  }
  return scoped ? cur.parentNode === scope : true;
}

class Element extends Target {
  constructor(tag, doc) {
    super();
    this.tagName = tag.toUpperCase();
    this.ownerDocument = doc;
    this.parentNode = null;
    this.children = [];
    this.attributes = new Map();
    this._text = '';
    this.style = {};
    this.className = '';
    this.value = '';
    const self = this;
    this.classList = {
      contains: (k) => self.className.split(/\s+/).includes(k),
      add: (k) => { if (!self.classList.contains(k)) self.className = `${self.className} ${k}`.trim(); },
      remove: (k) => { self.className = self.className.split(/\s+/).filter((x) => x && x !== k).join(' '); },
      toggle: (k, on) => {
        const want = on === undefined ? !self.classList.contains(k) : !!on;
        if (want) self.classList.add(k); else self.classList.remove(k);
        return want;
      },
    };
  }
  setAttribute(n, v) { if (n === 'class') this.className = String(v); else this.attributes.set(n, String(v)); }
  getAttribute(n) { return n === 'class' ? this.className : (this.attributes.has(n) ? this.attributes.get(n) : null); }
  hasAttribute(n) { return n === 'class' ? !!this.className : this.attributes.has(n); }
  removeAttribute(n) { this.attributes.delete(n); }
  get isConnected() {
    let n = this;
    while (n.parentNode) n = n.parentNode;
    return n === this.ownerDocument;
  }
  // 版面量測掛鉤:由測試在 document.scrollHeightOf 指定(預設 0,等同沒有版面)
  get scrollHeight() { return this.ownerDocument.scrollHeightOf?.(this) ?? 0; }
  get textContent() { return this._text + this.children.map((c) => c.textContent).join(''); }
  set textContent(v) { for (const c of [...this.children]) c.remove(); this._text = String(v); }
  appendChild(c) {
    if (c.parentNode) c.remove();
    c.parentNode = this;
    this.children.push(c);
    return c;
  }
  append(...nodes) {
    for (const n of nodes) {
      if (typeof n === 'string') this._text += n; else this.appendChild(n);
    }
  }
  insertBefore(c, ref) {
    if (!ref) return this.appendChild(c);
    if (c.parentNode) c.remove();
    const i = this.children.indexOf(ref);
    if (i < 0) throw new Error('insertBefore:ref 不是子節點');
    c.parentNode = this;
    this.children.splice(i, 0, c);
    return c;
  }
  remove() {
    if (!this.parentNode) return;
    const sib = this.parentNode.children;
    sib.splice(sib.indexOf(this), 1);
    this.parentNode = null;
  }
  get previousElementSibling() {
    const sib = this.parentNode?.children;
    if (!sib) return null;
    return sib[sib.indexOf(this) - 1] ?? null;
  }
  get nextElementSibling() {
    const sib = this.parentNode?.children;
    if (!sib) return null;
    return sib[sib.indexOf(this) + 1] ?? null;
  }
  contains(n) {
    for (let c = n; c; c = c.parentNode) if (c === this) return true;
    return false;
  }
  *_descendants() {
    for (const c of this.children) { yield c; yield* c._descendants(); }
  }
  matches(sel) { return parseSelector(sel).some((p) => matchesChain(this, p, null)); }
  closest(sel) {
    const ps = parseSelector(sel);
    for (let n = this; n && n instanceof Element; n = n.parentNode) if (ps.some((p) => matchesChain(n, p, null))) return n;
    return null;
  }
  querySelectorAll(sel) {
    const ps = parseSelector(sel);
    return [...this._descendants()].filter((el) => ps.some((p) => matchesChain(el, p, this)));
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}

class Document extends Target {
  constructor() {
    super();
    this.documentElement = new Element('html', this);
    this.documentElement.parentNode = this;
    this.body = new Element('body', this);
    this.documentElement.appendChild(this.body);
  }
  createElement(tag) { return new Element(tag, this); }
  querySelector(sel) { return this.documentElement.matches(sel) ? this.documentElement : this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
}

// ── 載入 ──
const STAT = 'explicit.stat_test1';
const LADDERS = JSON.stringify({
  stats: { [STAT]: { fam: [{ g: 'P', c: ['armour.chest'], t: [[1, 5, 9], [10, 10, 14], [20, 15, 19]] }] } },
  meta: {},
});

// 每個測試一個全新的 vm 環境(模組內有 openPanel 等狀態,避免互相污染)
function load() {
  const document = new Document();
  const window = new Target();
  Object.assign(window, { innerWidth: 1280, innerHeight: 800, postMessage() {} });
  const box = {
    document, window,
    location: { pathname: '/trade/search/Standard', origin: 'https://www.pathofexile.com' },
    Event: FakeEvent, CustomEvent: FakeCustomEvent,
    setTimeout: () => 0, clearTimeout: () => {},
    console: { info() {}, log() {}, warn() {}, error() {} },
  };
  box.globalThis = box;
  vm.createContext(box);
  vm.runInContext(PICKER_SRC, box, { filename: 'content/tier-picker.js' });
  const I = box.__pmzTierPickerInternals;

  // 搜尋面板 > 篩選列 > .filter-body > [sep, MIN, sep, MAX]
  const panelRoot = document.createElement('div');
  panelRoot.className = 'search-advanced-items';
  const row = document.createElement('div');
  row.setAttribute('data-pmz-stat-id', STAT);
  row.setAttribute('data-pmz-gi', '0');
  row.setAttribute('data-pmz-fi', '0');
  const body = document.createElement('div');
  body.className = 'filter-body';
  for (const cls of ['sep', 'minmax', 'sep', 'minmax']) {
    const n = document.createElement(cls === 'sep' ? 'span' : 'input');
    n.className = cls;
    body.appendChild(n);
  }
  row.appendChild(body);
  panelRoot.appendChild(row);
  document.body.appendChild(panelRoot);

  I.useLadders(LADDERS); // 內部會 rescan → 插入控制項
  const ctrl = body.querySelector(`:scope > .${'pmz-tier-pick'}`);
  assert.ok(ctrl, '前置:rescan 後應插入控制項');
  const sel = ctrl.querySelector('select');
  let changes = 0;
  sel.addEventListener('change', () => { changes++; });
  const panelEl = () => document.body.querySelector(`.${I.PANEL}`);
  const rowOf = (value) => panelEl()?.querySelectorAll(`.${I.PANEL}-row`).find((r) => r.getAttribute('data-value') === value) ?? null;
  const click = (el) => el.dispatchEvent(new FakeEvent('click'));
  return { I, document, window, panelRoot, row, ctrl, sel, panelEl, rowOf, click, changes: () => changes };
}

// ── P:placePanel 位置計算 ──
const { placePanel } = load().I;
const VW = 1280;
const W = 560;

test('P1 下方放得下時放在控制項下方', () => {
  const r = { left: 100, top: 80, bottom: 100 };
  const p = placePanel(r, 200, VW, 800, W);
  // 放上方或沒加 2px 間距就會失敗
  assert.equal(p.top, r.bottom + 2);
  assert.equal(p.maxHeight, 800 - r.bottom - 2 - 8);
});

test('P2 下方不夠、上方夠時改放上方', () => {
  const r = { left: 100, top: 700, bottom: 720 };
  const h = 300;
  const p = placePanel(r, h, VW, 800, W);
  // 仍放下方(溢出視窗)或貼齊上緣就會失敗
  assert.equal(p.top, r.top - 2 - h);
  assert.ok(p.top >= 8, `top=${p.top}`);
  // 高度沒限制在上方空間(往上溢出)就會失敗
  assert.equal(p.maxHeight, r.top - 2 - 8);
});

test('P3 兩邊都小於 120 時佔滿視窗', () => {
  const vh = 200;
  const r = { left: 100, top: 90, bottom: 110 };
  const p = placePanel(r, 500, VW, vh, W);
  // 擠在 80px 的小空間裡就會失敗
  assert.equal(p.top, 8);
  assert.equal(p.maxHeight, vh - 16);
});

test('P4 兩邊都放不下且下方較大時放下方', () => {
  const vh = 800;
  const r = { left: 100, top: 200, bottom: 220 };
  const below = vh - r.bottom - 2 - 8;
  const above = r.top - 2 - 8;
  assert.ok(below > above && above >= 120, '前置:下方較大且兩邊皆 ≥120');
  const p = placePanel(r, 1000, VW, vh, W);
  // 選錯邊、或高度沒縮到下方空間(超出視窗)就會失敗
  assert.equal(p.top, r.bottom + 2);
  assert.equal(p.maxHeight, below);
});

test('P5 上方較大時貼齊視窗上緣', () => {
  const vh = 800;
  const r = { left: 100, top: 600, bottom: 620 };
  const below = vh - r.bottom - 2 - 8;
  const above = r.top - 2 - 8;
  assert.ok(above > below && below >= 120, '前置:上方較大且兩邊皆 ≥120');
  const p = placePanel(r, 1000, VW, vh, W);
  // 用 r.top-2-h 算出負的 top(跑出視窗上緣)或高度沒限制在上方空間就會失敗
  assert.equal(p.top, 8);
  assert.equal(p.maxHeight, above);
});

test('P6 左右位置夾在視窗內', () => {
  for (const left of [1000, VW - 10, -50]) {
    const p = placePanel({ left, top: 80, bottom: 100 }, 200, VW, 800, W);
    // 沒夾右邊(面板右側溢出)或沒夾左邊(負座標)就會失敗
    assert.ok(p.left >= 8 && p.left <= VW - W - 8, `r.left=${left} → left=${p.left}`);
  }
});

// 控制項在視窗外 / 半截超出時,面板本身仍須完整落在視窗內(上下各留 8px)
function assertInViewport(r, h = 200, vh = 800) {
  const p = placePanel(r, h, VW, vh, W);
  const msg = `r=${JSON.stringify(r)} → ${JSON.stringify(p)}`;
  // 面板頂端跑出視窗上緣
  assert.ok(p.top >= 8, `top<8:${msg}`);
  // 面板底端跑出視窗下緣
  assert.ok(p.top + Math.min(h, p.maxHeight) <= vh - 8, `底端超出 ${vh - 8}:${msg}`);
  // 高度被算成 0 或負數(面板看不見)
  assert.ok(p.maxHeight > 0, `maxHeight≤0:${msg}`);
}

test('P7 控制項在視窗上方外時面板仍在視窗內', () => {
  assertInViewport({ left: 100, top: -300, bottom: -280 });
});

test('P8 控制項在視窗下方外時面板仍在視窗內', () => {
  assertInViewport({ left: 100, top: 1000, bottom: 1020 });
});

test('P9 控制項半截超出上緣時面板仍在視窗內', () => {
  assertInViewport({ left: 100, top: -10, bottom: 10 });
});

// ── T:togglePanel 把位置寫進樣式 ──
function openWithLayout(rect, scrollHeight) {
  const t = load();
  t.ctrl.getBoundingClientRect = () => ({ ...rect });
  t.document.scrollHeightOf = (el) => (el.classList.contains(t.I.PANEL) ? scrollHeight : 0);
  t.I.togglePanel(t.ctrl);
  const el = t.panelEl();
  assert.ok(el, '前置:面板已開');
  return el.style;
}

test('T1 開面板時把放上方的位置寫進樣式', () => {
  const s = openWithLayout({ left: 100, top: 700, bottom: 720 }, 300);
  // 沒量控制項框 / 內容高度、或沒把 placePanel 結果寫進 style 就會失敗
  assert.equal(s.left, '100px');
  assert.equal(s.top, '398px');
  assert.equal(s.maxHeight, '690px');
  assert.equal(s.width, '560px');
});

test('T2 開面板時把放下方的位置寫進樣式', () => {
  const s = openWithLayout({ left: 100, top: 100, bottom: 120 }, 200);
  // 誤放上方或高度沒依下方空間限制就會失敗
  assert.equal(s.top, '122px');
  assert.equal(s.maxHeight, '670px');
});

// ── C:點選列 ──
test('C1 點已選階級仍會送出 change', () => {
  const t = load();
  t.sel.value = '0:1'; // 已選 T2
  t.I.togglePanel(t.ctrl);
  const r = t.rowOf('0:1');
  assert.ok(r, '前置:面板內應有 0:1 這一列');
  t.click(r);
  // 「值沒變就不送 change」的實作會得到 0;重複派送會得到 2
  assert.equal(t.changes(), 1);
  assert.equal(t.sel.value, '0:1');
});

test('C2 點階級後面板關閉', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  assert.ok(t.panelEl(), '前置:面板已開');
  t.click(t.rowOf('0:0'));
  // 點完面板留在 body 就會失敗
  assert.equal(t.panelEl(), null);
});

test('C3 控制項已不在頁面時點選不送 change', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  const r = t.rowOf('0:2');
  t.ctrl.remove(); // 官網重畫掉篩選列
  t.click(r);
  // 對已脫離頁面的 select 照送 change(填到錯的列)就會失敗
  assert.equal(t.changes(), 0);
  assert.equal(t.panelEl(), null);
});

// ── K:開收 ──
test('K1 同一控制項再點一次會收起面板', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  assert.ok(t.panelEl(), '前置:第一次開啟');
  t.I.togglePanel(t.ctrl);
  // 第二次又重開一個(或疊兩個)就會失敗
  assert.equal(t.document.body.querySelectorAll(`.${t.I.PANEL}`).length, 0);
});

test('K2 控制項被重畫掉時 rescan 收面板', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  t.ctrl.remove();
  assert.ok(t.panelRoot.isConnected, '前置:搜尋面板仍在');
  t.I.rescan();
  // rescan 沒檢查開著面板的控制項是否還在頁面就會失敗
  assert.equal(t.panelEl(), null);
});

test('K3 搜尋面板整個不見時 rescan 仍收面板', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  t.panelRoot.remove();
  assert.equal(t.ctrl.isConnected, false, '前置:控制項隨之離開頁面');
  t.I.rescan();
  // 「找不到搜尋面板就提早 return」排在收面板之前就會失敗
  assert.equal(t.panelEl(), null);
});

test('K4 階級表清空時 rescan 仍收面板', () => {
  const t = load();
  t.I.togglePanel(t.ctrl);
  t.I.state.ladders = null;
  t.ctrl.remove();
  t.I.rescan();
  // 「沒有階級表就提早 return」排在收面板之前就會失敗
  assert.equal(t.panelEl(), null);
});

test('K5 收面板後不再回應 Esc 與捲動', () => {
  const t = load();
  const { document: doc, window: win } = t;
  const base = { kd: doc.listenerCount('keydown'), md: doc.listenerCount('mousedown'), sc: win.listenerCount('scroll'), rs: win.listenerCount('resize') };
  t.I.togglePanel(t.ctrl);
  // 前置:開著時確實掛了監聽器(否則下面的「已解除」沒有意義)
  assert.ok(doc.listenerCount('keydown') > base.kd && win.listenerCount('scroll') > base.sc, '前置:開面板時應掛上 keydown / scroll 監聽器');
  t.I.closePanel();
  assert.doesNotThrow(() => {
    doc.dispatchEvent(new FakeEvent('keydown', { key: 'Escape' }));
    const s = new FakeEvent('scroll');
    s.target = doc;
    win.dispatchEvent(s);
  });
  assert.equal(t.panelEl(), null);
  // 漏解除任一監聽器(殘留閉包、重複收面板)就會失敗
  assert.equal(doc.listenerCount('keydown'), base.kd);
  assert.equal(doc.listenerCount('mousedown'), base.md);
  assert.equal(win.listenerCount('scroll'), base.sc);
  assert.equal(win.listenerCount('resize'), base.rs);
});

// ── I:譯名 ──
test('I1 異界的中文標籤使用官方譯名鎖骨', () => {
  const box = {};
  box.globalThis = box;
  box.window = box;
  vm.createContext(box);
  vm.runInContext(read('../shared/i18n.js'), box, { filename: 'shared/i18n.js' });
  const v = box.PMZ_I18N.tables.zh['tierpick.infl.otherworldly'];
  // 誤植成「錨骨」或缺鍵就會失敗
  assert.equal(typeof v, 'string');
  assert.ok(v.includes('鎖骨'), `zh = ${JSON.stringify(v)}`);
  assert.ok(!v.includes('錨骨'), `zh = ${JSON.stringify(v)}`);
});
