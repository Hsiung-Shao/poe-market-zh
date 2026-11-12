// 交易站 Vue 沿用 DOM 節點改內容時,content/results.js 必須只顯示新物品的翻譯。
// 執行:node --test test/results-redraw.test.mjs
// 沒有 jsdom:以 node:vm 載入 content script,配上下方的最小假 DOM。缺的介面一律拋錯。
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const SRC = fs.readFileSync(fileURLToPath(new URL('../content/results.js', import.meta.url)), 'utf-8');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ── 選擇器引擎:標籤 / .class / [attr] / [attr="v"] / ^= / *= / :not([attr]) / 後代 / > / :scope / 逗號 ──
function parseCompound(s, i) {
  const c = { tag: null, classes: [], attrs: [], nots: [], scope: false };
  const start = i;
  let m = /^(\*|[a-zA-Z][\w-]*)/.exec(s.slice(i));
  if (m) { c.tag = m[1].toLowerCase(); i += m[0].length; }
  for (;;) {
    const rest = s.slice(i);
    if ((m = /^\.([\w-]+)/.exec(rest))) c.classes.push(m[1]);
    else if ((m = /^\[([\w-]+)(?:([\^*]?=)(?:"([^"]*)"|'([^']*)'))?\]/.exec(rest))) c.attrs.push([m[1], m[2], m[3] ?? m[4]]);
    else if ((m = /^:not\(\[([\w-]+)\]\)/.exec(rest))) c.nots.push(m[1]);
    else if ((m = /^:scope/.exec(rest))) c.scope = true;
    else break;
    i += m[0].length;
  }
  if (i === start || (i < s.length && !/[\s>]/.test(s[i]))) throw new Error(`假 DOM 不支援的選擇器:${s.slice(start)}`);
  return [c, i];
}
function splitTop(sel) {
  const out = []; let depth = 0; let cur = '';
  for (const ch of sel) {
    if (ch === '[' || ch === '(') depth++;
    if (ch === ']' || ch === ')') depth--;
    if (ch === ',' && depth === 0) { out.push(cur); cur = ''; } else cur += ch;
  }
  out.push(cur);
  return out;
}
function parseSelector(sel) {
  return splitTop(sel).map((one) => {
    const s = one.trim();
    const parts = []; let comb = ''; let i = 0;
    while (i < s.length) {
      if (s[i] === '>') { comb = '>'; i++; continue; }
      if (/\s/.test(s[i])) { if (!comb) comb = ' '; i++; continue; }
      let c; [c, i] = parseCompound(s, i);
      parts.push({ c, comb: parts.length ? comb || ' ' : '' });
      comb = '';
    }
    if (!parts.length) throw new Error(`假 DOM 不支援的選擇器:${sel}`);
    return parts;
  });
}
function matchCompound(el, c, scope) {
  if (c.scope && el !== scope) return false;
  if (c.tag && c.tag !== '*' && el.tagName.toLowerCase() !== c.tag) return false;
  for (const k of c.classes) if (!el.classList.contains(k)) return false;
  for (const [n, op, v] of c.attrs) {
    if (!el.hasAttribute(n)) return false;
    const a = el.getAttribute(n);
    if (op === '=' && a !== v) return false;
    if (op === '^=' && !a.startsWith(v)) return false;
    if (op === '*=' && !a.includes(v)) return false;
  }
  for (const n of c.nots) if (el.hasAttribute(n)) return false;
  return true;
}
function matchAt(el, parts, i, scope) {
  if (!matchCompound(el, parts[i].c, scope)) return false;
  if (i === 0) return true;
  if (parts[i].comb === '>') return el.parentNode instanceof FEl && matchAt(el.parentNode, parts, i - 1, scope);
  for (let p = el.parentNode; p instanceof FEl; p = p.parentNode) if (matchAt(p, parts, i - 1, scope)) return true;
  return false;
}
const matchSel = (el, sel, scope) => parseSelector(sel).some((p) => matchAt(el, p, p.length - 1, scope));

// ── 最小假 DOM ──
class FNode {
  constructor() { this.parentNode = null; }
  get parentElement() { return this.parentNode instanceof FEl ? this.parentNode : null; }
  get isConnected() { let n = this; while (n.parentNode) n = n.parentNode; return n.isDocument === true; }
  get nextSibling() { const s = this.parentNode?.childNodes; return s ? s[s.indexOf(this) + 1] ?? null : null; }
  get previousSibling() { const s = this.parentNode?.childNodes; return s ? s[s.indexOf(this) - 1] ?? null : null; }
  remove() { this.parentNode?.removeChild(this); }
  replaceWith(...nodes) {
    const p = this.parentNode; if (!p) return;
    const next = this.nextSibling;
    p.removeChild(this);
    for (const n of nodes) p.insertBefore(typeof n === 'string' ? new FText(n) : n, next);
  }
}
class FText extends FNode {
  constructor(t) { super(); this.nodeType = 3; this.nodeName = '#text'; this.data = String(t); }
  get textContent() { return this.data; }
  set textContent(v) { this.data = String(v); }
  get nodeValue() { return this.data; }
  set nodeValue(v) { this.data = String(v); }
}
class FComment extends FNode {
  constructor(t) { super(); this.nodeType = 8; this.nodeName = '#comment'; this.data = String(t); }
}
class FEl extends FNode {
  constructor(tag) {
    super();
    this.nodeType = 1;
    this.nodeName = this.tagName = tag.toUpperCase();
    this.attrs = new Map();
    this.childNodes = [];
    this.style = { cssText: '', setProperty(k, v) { this[k] = v; }, removeProperty(k) { delete this[k]; }, getPropertyValue(k) { return this[k] ?? ''; } };
    const self = this;
    const cls = () => (self.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
    this.classList = {
      contains: (k) => cls().includes(k),
      add: (k) => { if (!cls().includes(k)) self.setAttribute('class', [...cls(), k].join(' ')); },
      remove: (k) => self.setAttribute('class', cls().filter((x) => x !== k).join(' ')),
      toggle: (k, on) => {
        const want = on === undefined ? !cls().includes(k) : !!on;
        if (want) self.classList.add(k); else self.classList.remove(k);
        return want;
      },
    };
    const toAttr = (k) => `data-${k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    const toKey = (a) => a.slice(5).replace(/-([a-z])/g, (_, c) => c.toUpperCase());
    const desc = (k) => ({ value: self.getAttribute(toAttr(k)), enumerable: true, configurable: true, writable: true });
    this.dataset = new Proxy({}, {
      get: (_, k) => (typeof k === 'string' && self.hasAttribute(toAttr(k)) ? self.getAttribute(toAttr(k)) : undefined),
      set: (_, k, v) => { self.setAttribute(toAttr(k), String(v)); return true; },
      deleteProperty: (_, k) => { self.removeAttribute(toAttr(k)); return true; },
      has: (_, k) => typeof k === 'string' && self.hasAttribute(toAttr(k)),
      ownKeys: () => [...self.attrs.keys()].filter((a) => a.startsWith('data-')).map(toKey),
      getOwnPropertyDescriptor: (_, k) => (typeof k === 'string' && self.hasAttribute(toAttr(k)) ? desc(k) : undefined),
    });
  }
  getAttribute(n) { return this.attrs.has(n) ? this.attrs.get(n) : null; }
  setAttribute(n, v) { this.attrs.set(n, String(v)); }
  removeAttribute(n) { this.attrs.delete(n); }
  hasAttribute(n) { return this.attrs.has(n); }
  get className() { return this.getAttribute('class') ?? ''; }
  set className(v) { this.setAttribute('class', v); }
  get id() { return this.getAttribute('id') ?? ''; }
  get title() { return this.getAttribute('title') ?? ''; }
  set title(v) { this.setAttribute('title', v); }
  get children() { return this.childNodes.filter((c) => c.nodeType === 1); }
  get firstChild() { return this.childNodes[0] ?? null; }
  get lastChild() { return this.childNodes[this.childNodes.length - 1] ?? null; }
  get firstElementChild() { return this.children[0] ?? null; }
  get nextElementSibling() { let s = this.nextSibling; while (s && s.nodeType !== 1) s = s.nextSibling; return s; }
  get previousElementSibling() { let s = this.previousSibling; while (s && s.nodeType !== 1) s = s.previousSibling; return s; }
  get textContent() {
    return this.childNodes.map((c) => (c.nodeType === 3 ? c.data : c.nodeType === 1 ? c.textContent : '')).join('');
  }
  set textContent(v) {
    for (const c of [...this.childNodes]) this.removeChild(c);
    if (String(v) !== '') this.appendChild(new FText(v));
  }
  get innerHTML() { return this.textContent; }
  set innerHTML(_) { throw new Error('假 DOM 不支援 innerHTML 寫入'); }
  appendChild(c) { return this.insertBefore(c, null); }
  insertBefore(c, ref) {
    c.parentNode?.removeChild(c);
    const i = ref ? this.childNodes.indexOf(ref) : this.childNodes.length;
    if (i < 0) throw new Error('insertBefore:ref 不是子節點');
    this.childNodes.splice(i, 0, c);
    c.parentNode = this;
    return c;
  }
  removeChild(c) {
    const i = this.childNodes.indexOf(c);
    if (i < 0) throw new Error('removeChild:不是子節點');
    this.childNodes.splice(i, 1);
    c.parentNode = null;
    return c;
  }
  contains(n) { for (let c = n; c; c = c.parentNode) if (c === this) return true; return false; }
  matches(sel) { return matchSel(this, sel, null); }
  closest(sel) { for (let n = this; n instanceof FEl; n = n.parentNode) if (matchSel(n, sel, null)) return n; return null; }
  querySelectorAll(sel) { return walkEls(this).slice(1).filter((el) => matchSel(el, sel, this)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
}
// 自己 + 所有後代元素,依文件順序
function walkEls(root) {
  const out = [root];
  for (const c of root.childNodes) if (c.nodeType === 1) out.push(...walkEls(c));
  return out;
}

class FDoc {
  constructor() {
    this.isDocument = true; this.nodeType = 9; this.parentNode = null;
    this.documentElement = new FEl('html');
    this.documentElement.parentNode = this;
    this.childNodes = [this.documentElement];
    this.head = this.documentElement.appendChild(new FEl('head'));
    this.body = this.documentElement.appendChild(new FEl('body'));
  }
  createElement(t) { return new FEl(t); }
  createTextNode(t) { return new FText(t); }
  createComment(t) { return new FComment(t); }
  querySelectorAll(sel) { return walkEls(this.documentElement).filter((el) => matchSel(el, sel, null)); }
  querySelector(sel) { return this.querySelectorAll(sel)[0] ?? null; }
  getElementById(id) { return walkEls(this.documentElement).find((el) => el.getAttribute('id') === id) ?? null; }
  createTreeWalker(root, show, filter) {
    const FILTER = { ACCEPT: 1, REJECT: 2, SKIP: 3 };
    const filt = (n) => {
      if (!(show & (1 << (n.nodeType - 1)))) return FILTER.SKIP;
      if (!filter) return FILTER.ACCEPT;
      return typeof filter === 'function' ? filter(n) : filter.acceptNode(n);
    };
    const w = {
      root, currentNode: root,
      nextNode() {
        let node = w.currentNode; let result = FILTER.ACCEPT;
        for (;;) {
          while (result !== FILTER.REJECT && node.childNodes?.length) {
            node = node.childNodes[0];
            result = filt(node);
            if (result === FILTER.ACCEPT) { w.currentNode = node; return node; }
          }
          let sib = null;
          for (let t = node; t; t = t.parentNode) {
            if (t === root) return null;
            if ((sib = t.nextSibling)) { node = sib; break; }
          }
          if (!sib) return null;
          result = filt(node);
          if (result === FILTER.ACCEPT) { w.currentNode = node; return node; }
        }
      },
    };
    return w;
  }
}

// ── 載入環境 ──
const ITEM_MAP = { 'Warlock Boots': '術士長靴', 'Vaal Regalia': '瓦爾聖甲' };
const STAT_MAP = {
  '#% reduced Attribute Requirements': '減少 #% 能力值需求',
  'Adds # to # Fire Damage': '附加 # 至 # 火焰傷害',
  '+# to Intelligence': '+# 智慧',
  '+# to maximum Energy Shield': '+# 最大能量護盾',
  '#% increased Movement Speed': '增加 #% 移動速度',
};
const STAT_ID_MAP = Object.fromEntries(Object.entries(STAT_MAP).map(([en, zh], i) => [`explicit.stat_${i + 1}`, { en, zh }]));

function makeEnv({ bilingual = false, statMapExtra = {} } = {}) {
  const doc = new FDoc();
  const observers = [];
  const logs = [];
  const store = {
    language: 'zh_tw', uiLang: 'zh', updated: 1, uniqueMap: {}, passives: null,
    bilingualMods: bilingual, itemMap: ITEM_MAP, statMap: { ...STAT_MAP, ...statMapExtra }, statIdMap: STAT_ID_MAP,
  };
  const requested = [];
  const log = (lv) => (...a) => logs.push([lv, ...a.map(String)]);
  const sandbox = {
    location: { pathname: '/trade/history', hostname: 'www.pathofexile.com' },
    console: { info: log('info'), warn: log('warn'), log: log('log'), error: log('error') },
    setTimeout, clearTimeout,
    Node: { TEXT_NODE: 3, ELEMENT_NODE: 1 },
    NodeFilter: { SHOW_ELEMENT: 1, SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 },
    HTMLElement: FEl,
    MutationObserver: class {
      constructor(cb) { this.callback = cb; this.targets = []; observers.push(this); }
      observe(target, options) { this.targets.push({ target, options }); }
      disconnect() { this.targets = []; }
      takeRecords() { return []; }
    },
    document: doc,
    chrome: {
      storage: {
        local: {
          // 與 tools/load-results.mjs 一樣挑剔:鍵不是非空字串就拋 TypeError
          get: async (keys) => {
            const list = Array.isArray(keys) ? keys : [keys];
            for (const k of list) if (typeof k !== 'string' || !k) throw new TypeError(`storage.get: 無效的鍵 ${String(k)}`);
            requested.push(...list);
            const out = {};
            for (const k of list) if (store[k] !== undefined) out[k] = store[k];
            return out;
          },
        },
        onChanged: { addListener() {} },
      },
    },
  };
  sandbox.globalThis = sandbox;
  sandbox.window = sandbox;
  vm.createContext(sandbox);
  return { sandbox, doc, observers, logs, requested };
}

// ── 官網 Vue render 結構 fixture ──
function buildMod(doc, lines, variant, statId) {
  const T = () => doc.createTextNode('');
  const mod = doc.createElement('div');
  mod.className = 'item-mod item-mod--explicit';
  const lc = doc.createElement('span');
  lc.className = variant === 'B' ? 'lc s' : 'lc';
  if (variant === 'B') lc.setAttribute('data-field', `stat.${statId}`);
  lc.appendChild(T());
  const spans = lines.map((text, i) => {
    lc.appendChild(T());
    lc.appendChild(i === 0 ? doc.createComment('') : doc.createElement('br'));
    lc.appendChild(T());
    const span = lc.appendChild(doc.createElement('span'));
    span.appendChild(doc.createTextNode(text));
    lc.appendChild(T());
    lc.appendChild(T());
    return span;
  });
  lc.appendChild(T());
  mod.appendChild(lc);
  return { mod, lc, spans };
}

const ITEM1 = [
  { t: ['18% reduced Attribute Requirements'], id: 'explicit.stat_1' },
  { t: ['Adds 87 to 169 Fire Damage'], id: 'explicit.stat_2' },
];
const NEW_MODS = [
  ['+44 to Intelligence', 'explicit.stat_3'],
  ['+46 to maximum Energy Shield', 'explicit.stat_4'],
];

async function setup({ variant = 'A', bilingual = false, mods = ITEM1, statMapExtra = {} } = {}) {
  const env = makeEnv({ bilingual, statMapExtra });
  const { doc } = env;
  const container = doc.createElement('div'); container.className = 'results';
  doc.body.appendChild(container);
  const popup = container.appendChild(doc.createElement('div')); popup.className = 'item-popup';
  const header = popup.appendChild(doc.createElement('div')); header.className = 'item-popup__header';
  const headerLine = header.appendChild(doc.createElement('div')); headerLine.className = 'item-popup__header-line';
  headerLine.appendChild(doc.createTextNode('Vaal Regalia'));
  const content = popup.appendChild(doc.createElement('div')); content.className = 'item-popup__content';
  const built = mods.map((m) => buildMod(doc, m.t, variant, m.id));
  for (const b of built) content.appendChild(b.mod);

  vm.runInContext(SRC, env.sandbox, { filename: 'content/results.js' });
  await sleep(60);
  const warns = env.logs.filter((l) => (l[0] === 'warn' || l[0] === 'error') && !String(l[1]).includes('PMZ_GAME'));
  if (warns.length) console.error('[results.js 警告]', JSON.stringify(warns), '要求過的鍵:', env.requested.join(','));

  const pending = [];
  const ctx = {
    mods: built, headerLine, content, last: [],
    // Vue 重設某行內層 span 的內容:清掉現有子節點、放入新文字節點(變體 B 另外改 data-field,不產生紀錄)
    vueLine(i, j, text, id) {
      const m = built[i];
      if (variant === 'B' && id) m.lc.setAttribute('data-field', `stat.${id}`);
      const span = m.spans[j];
      const removed = [...span.childNodes];
      for (const n of removed) span.removeChild(n);
      const t = span.appendChild(doc.createTextNode(text));
      pending.push({ type: 'childList', target: span, addedNodes: [t], removedNodes: removed });
    },
    vueAppend(lines, id) {
      const b = buildMod(doc, lines, variant, id);
      content.appendChild(b.mod);
      built.push(b);
      pending.push({ type: 'childList', target: content, addedNodes: [b.mod], removedNodes: [] });
    },
    vueHeader(text) {
      const removed = [...headerLine.childNodes];
      headerLine.textContent = text;
      pending.push({ type: 'childList', target: headerLine, addedNodes: [...headerLine.childNodes], removedNodes: removed });
    },
    // 把紀錄餵給容器 observer,再等 300ms(實作可能 debounce)
    async feed(records) {
      const obs = env.observers.filter((o) => o.targets.some((t) => t.target === container)).pop();
      if (!obs) throw new Error(`找不到觀察容器 .results 的 MutationObserver(logs=${JSON.stringify(env.logs)})`);
      obs.callback.call(obs, records, obs);
      await sleep(300);
    },
    async flush() { this.last = pending.splice(0); await this.feed(this.last); },
  };
  return ctx;
}

// ── 斷言用 helper ──
// 畫面文字:後代文字依文件順序串接,排除 .ptm-orig 與 class 含 pmz- 的元素內的文字,<br> 換行,最後 trim
function shown(root) {
  let out = '';
  (function walk(n) {
    for (const c of n.childNodes) {
      if (c.nodeType === 3) out += c.data;
      else if (c.nodeType === 1) {
        if (c.classList.contains('ptm-orig') || c.className.includes('pmz-')) continue;
        if (c.tagName === 'BR') out += '\n'; else walk(c);
      }
    }
  })(root);
  return out.trim();
}
const modText = (ctx, i) => shown(ctx.mods[i].mod);
const titlesOf = (root) => walkEls(root).map((el) => el.getAttribute('title')).filter((t) => t !== null && t !== '');
const changeTo2 = (ctx) => NEW_MODS.forEach(([t, id], i) => ctx.vueLine(i, 0, t, id));

// ── 測試 ──
test('T0 初次載入時詞綴與物品名翻成中文', async () => {
  const ctx = await setup();
  assert.equal(modText(ctx, 0), '減少 18% 能力值需求');
  assert.equal(modText(ctx, 1), '附加 87 至 169 火焰傷害');
  assert.equal(shown(ctx.headerLine), '瓦爾聖甲');
});

for (const variant of ['A', 'B']) {
  test(`T1 換選物品後詞綴只顯示新物品的中文(變體 ${variant})`, async () => {
    const ctx = await setup({ variant });
    changeTo2(ctx);
    await ctx.flush();
    assert.equal(modText(ctx, 0), '+44 智慧');
    assert.equal(modText(ctx, 1), '+46 最大能量護盾');
  });
}

test('T2 換選後新增的詞綴列也會翻', async () => {
  const ctx = await setup();
  changeTo2(ctx);
  ctx.vueAppend(['30% increased Movement Speed'], 'explicit.stat_5');
  await ctx.flush();
  assert.equal(modText(ctx, 2), '增加 30% 移動速度');
});

test('T3 文字沒變的詞綴維持原本中文', async () => {
  const ctx = await setup();
  ctx.vueLine(0, 0, '+44 to Intelligence');
  await ctx.flush();
  assert.equal(modText(ctx, 0), '+44 智慧');
  assert.equal(modText(ctx, 1), '附加 87 至 169 火焰傷害');
});

test('T4 換成查不到翻譯的詞綴時顯示新英文', async () => {
  const ctx = await setup();
  ctx.vueLine(0, 0, 'Some Unknown Mod 5');
  await ctx.flush();
  assert.equal(modText(ctx, 0), 'Some Unknown Mod 5');
  assert.deepEqual(titlesOf(ctx.mods[0].mod).filter((t) => t === '18% reduced Attribute Requirements'), []);
});

test('T5 非雙語模式 hover 原文跟著換', async () => {
  const ctx = await setup();
  changeTo2(ctx);
  await ctx.flush();
  assert.deepEqual([...new Set(titlesOf(ctx.mods[0].mod))], ['+44 to Intelligence']);
});

test('T6 雙語模式換選後英文小字只剩新物品的', async () => {
  const ctx = await setup({ bilingual: true });
  changeTo2(ctx);
  await ctx.flush();
  const want = [['+44 to Intelligence', '+44 智慧'], ['+46 to maximum Energy Shield', '+46 最大能量護盾']];
  want.forEach(([en, zh], i) => {
    const origs = ctx.mods[i].mod.querySelectorAll('.ptm-orig');
    assert.equal(origs.length, 1);
    assert.equal(origs[0].textContent.trim(), en);
    assert.equal(modText(ctx, i), zh);
  });
});

test('T7 物品名換選後重新翻譯', async () => {
  const ctx = await setup();
  ctx.vueHeader('Warlock Boots');
  await ctx.flush();
  assert.equal(shown(ctx.headerLine), '術士長靴');
  assert.equal(ctx.headerLine.getAttribute('title'), 'Warlock Boots');
  ctx.vueHeader('Hypnotic Trail');
  await ctx.flush();
  assert.equal(shown(ctx.headerLine), 'Hypnotic Trail');
  assert.equal(ctx.headerLine.getAttribute('title') ?? '', '');
});

test('T8 多行詞綴換選後各行正確', async () => {
  const ctx = await setup({
    mods: [{ t: ['18% reduced Attribute Requirements', 'Adds 87 to 169 Fire Damage'], id: 'explicit.stat_1' }],
    statMapExtra: { '#% reduced Attribute Requirements\nAdds # to # Fire Damage': '減少 #% 能力值需求\n附加 # 至 # 火焰傷害' },
  });
  ctx.vueLine(0, 1, 'Adds 5 to 9 Fire Damage');
  await ctx.flush();
  assert.equal(modText(ctx, 0), '減少 18% 能力值需求\n附加 5 至 9 火焰傷害');
});

for (const bilingual of [false, true]) {
  test(`T9 官網沒再改字時重送紀錄畫面不變(${bilingual ? '雙語' : '非雙語'})`, async () => {
    const ctx = await setup({ bilingual });
    changeTo2(ctx);
    await ctx.flush();
    await ctx.feed(ctx.last);
    assert.equal(modText(ctx, 0), '+44 智慧');
    assert.equal(modText(ctx, 1), '+46 最大能量護盾');
    if (bilingual) for (const i of [0, 1]) assert.equal(ctx.mods[i].mod.querySelectorAll('.ptm-orig').length, 1);
  });
}
