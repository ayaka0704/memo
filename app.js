'use strict';

/* =========================================================
   天使と悪魔ノート（試作版）
   データはこの端末のブラウザ（localStorage）の中だけに保存する。
   ========================================================= */

const STORE_KEY = 'tn-data-v1';
const LOCK_KEY = 'tn-lock-v1';
const WELCOME_KEY = 'tn-welcomed-v1';
const AUTO_LOCK_MS = 60 * 1000;          // 1分以上ほかのアプリにいたらロック
const PAGE_OPTIONS = [25, 30, 50];       // 試作版だけ選べるページ数
const RELATIONS = { dating: 'お付き合い', reunion: '復縁', married: '夫婦' };
const SIDE_NAME = { angel: '天使', devil: '悪魔' };

// DV・モラハラの心配がある言葉（悪魔ページだけを見る）
const SAFETY_WORDS = [
  '殴', '蹴', '叩', '暴力', '首を絞', '首をしめ', '突き飛ば', '物を投げ', 'ものを投げ',
  '脅', '死ね', '殺す', '殺され', 'お金を取', 'お金を返さ', 'お金を盗', '借金',
  'スマホを勝手', '勝手にスマホ', '監視', '位置情報', '無理やり', 'むりやり',
  '避妊', '閉じ込め', '外出させ', '人格否定', '土下座'
];

/* ---------- 保存まわり ---------- */
function store(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
function storeSet(k, v) { try { localStorage.setItem(k, v); return true; } catch (e) { return false; } }
function storeDel(k) { try { localStorage.removeItem(k); } catch (e) { /* noop */ } }

function emptyData() { return { version: 1, books: [], pages: [] }; }
function isValidData(d) { return d && Array.isArray(d.books) && Array.isArray(d.pages); }
function loadData() {
  const raw = store(STORE_KEY);
  if (!raw) return emptyData();
  try {
    const d = JSON.parse(raw);
    if (isValidData(d)) return d;
  } catch (e) { /* 壊れていたら下で退避 */ }
  storeSet(STORE_KEY + '-broken-' + Date.now(), raw);
  return emptyData();
}
let data = loadData();
function persist() {
  if (!storeSet(STORE_KEY, JSON.stringify(data))) toast('保存できませんでした。ブラウザの設定を確認してね');
}
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});

/* ---------- 小さな道具 ---------- */
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }
function esc(s) {
  return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtDate(s) {
  if (!s) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${y}年${m}月${d}日`;
}
function val(id) { const el = document.getElementById(id); return el ? el.value : ''; }

/* ---------- ノートの計算 ---------- */
function getBook(id) { return data.books.find(b => b.id === id); }
function getPage(id) { return data.pages.find(p => p.id === id); }
function pagesOf(bookId) { return data.pages.filter(p => p.bookId === bookId); }
function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : a.createdAt - b.createdAt; }
function sidePages(bookId, side) { return pagesOf(bookId).filter(p => p.side === side).sort(byDate); }
function stats(book) {
  const a = sidePages(book.id, 'angel');
  const d = sidePages(book.id, 'devil');
  const used = a.length + d.length;
  return { a, d, used, left: Math.max(0, book.pageCount - used), full: used >= book.pageCount };
}
// 天使は前から1,2,3…、悪魔は後ろから（いちばん古い悪魔ページが最終ページ）
function pageNumber(book, page) {
  const list = sidePages(book.id, page.side);
  const i = list.findIndex(p => p.id === page.id);
  return page.side === 'angel' ? i + 1 : book.pageCount - i;
}
function isLatestVolume(book) {
  return !data.books.some(b => b.seriesId === book.seriesId && b.volume > book.volume);
}
function groupSeries() {
  const map = new Map();
  data.books.forEach(b => {
    if (!map.has(b.seriesId)) map.set(b.seriesId, []);
    map.get(b.seriesId).push(b);
  });
  return [...map.values()].map(books => {
    books.sort((x, y) => x.volume - y.volume);
    const latest = books[books.length - 1];
    return { books, partner: latest.partner, relation: latest.relation, updated: Math.max(...books.map(b => b.createdAt)) };
  }).sort((x, y) => y.updated - x.updated);
}
function needsSafety(book) {
  const st = stats(book);
  const text = st.d.map(p => [p.what, p.feel, p.think].join(' ')).join(' ');
  if (SAFETY_WORDS.some(w => text.includes(w))) return true;
  return st.d.length >= 10 && st.d.length / st.used >= 0.8;
}

/* ---------- パスロック（画面のカギ。データの暗号化ではない） ---------- */
function hashPin(pin, salt) {
  let h = 0x811c9dc5;
  const s = salt + ':' + pin;
  for (let r = 0; r < 3000; r++) {
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    h = (h ^ r) >>> 0;
  }
  return h.toString(16);
}
function getLock() { try { return JSON.parse(store(LOCK_KEY) || 'null'); } catch (e) { return null; } }
function setLock(pin) { const salt = uid(); storeSet(LOCK_KEY, JSON.stringify({ salt, hash: hashPin(pin, salt) })); }
function checkPin(pin) { const l = getLock(); return !!l && hashPin(pin, l.salt) === l.hash; }

let locked = !!getLock();
let pin = { buf: '', first: '', err: '', busy: false };
function resetPin() { pin = { buf: '', first: '', err: '', busy: false }; }

let hiddenAt = 0;
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { hiddenAt = Date.now(); return; }
  if (getLock() && !locked && hiddenAt && Date.now() - hiddenAt > AUTO_LOCK_MS) {
    locked = true; resetPin(); render();
  }
});

/* ---------- 画面の行き来 ---------- */
let ui = { view: 'shelf' };
let stack = [];
if (!getLock() && !store(WELCOME_KEY)) ui = { view: 'welcome' };

function nav(view, params = {}) { stack.push({ ...ui }); ui = { ...ui, ...params, view }; render(true); }
function replace(view, params = {}) { ui = { ...ui, ...params, view }; render(true); }
function back() { ui = stack.pop() || { view: 'shelf' }; render(true); }
function home() { stack = []; ui = { view: 'shelf' }; render(true); }

/* ---------- キャラクター（ChatGPTで作った絵を丸く切り抜いたもの） ---------- */
function charaImg(file, s) {
  return `<img class="chara" src="img/${file}.webp" width="${s}" height="${s}" alt="" aria-hidden="true">`;
}
// 画面を切り替えたときに一瞬白くならないよう、先に読み込んでおく
['angel', 'devil', 'main', 'spine', 'shelf-top', 'shelf-mid', 'shelf-base'].forEach(f => { const im = new Image(); im.src = `img/${f}.webp`; });
function angelSvg(s = 64) { return charaImg('angel', s); }
function devilSvg(s = 64) { return charaImg('devil', s); }
function wingSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M3 16c0-7 6-12 18-12-2 3-4 4-7 5 2 0 4 0 5-1-2 3-5 5-8 5 1 1 3 1 4 1-3 3-8 3-12 2z" fill="#fff" stroke="#e0a95a" stroke-width="1.4" stroke-linejoin="round"/></svg>`;
}
function tailSvg() {
  return `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M4 4c0 9 6 12 11 10" fill="none" stroke="#8c63b8" stroke-width="2.2" stroke-linecap="round"/><path d="M13 9l8 4-8 4z" fill="#8c63b8"/></svg>`;
}
function charaOf(side, s) { return side === 'angel' ? angelSvg(s) : devilSvg(s); }

/* ---------- 共通パーツ ---------- */
function header(title, opts = {}) {
  const left = opts.back ? `<button class="icon-btn" data-action="back" aria-label="もどる"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg></button>` : `<span class="icon-sp"></span>`;
  const right = opts.right || `<span class="icon-sp"></span>`;
  return `<header class="bar">${left}<h1>${title}</h1>${right}</header>`;
}
function safetyCard() {
  return `<aside class="safety">
    <p class="safety-title">ひとりで抱えなくて大丈夫</p>
    <p>怖い思いをしていたり、自分を責めてしまったりしていませんか。相談できる場所があります。</p>
    <ul>
      <li><a href="tel:%238008">DV相談ナビ #8008</a><span>近くの相談窓口につながります</span></li>
      <li><a href="tel:0120279889">DV相談＋（プラス） 0120-279-889</a><span>24時間。メール・チャットもあります</span></li>
      <li><a href="tel:110">身の危険を感じたら 110</a></li>
    </ul>
  </aside>`;
}
function ratioBar(a, d, big) {
  const total = a + d;
  if (!total) return `<div class="ratio${big ? ' big' : ''} none"><span>まだページがありません</span></div>`;
  const ap = Math.round(a / total * 100);
  return `<div class="ratio${big ? ' big' : ''}" role="img" aria-label="天使 ${ap}パーセント、悪魔 ${100 - ap}パーセント">
    <div class="r-angel" style="width:${ap}%"><span>${ap ? ap + '%' : ''}</span></div>
    <div class="r-devil" style="width:${100 - ap}%"><span>${100 - ap ? (100 - ap) + '%' : ''}</span></div>
  </div>`;
}
function snippet(s, n = 26) { s = (s || '').replace(/\s+/g, ' '); return s.length > n ? s.slice(0, n) + '…' : s; }

function heroImg() {
  return `<img class="hero" src="img/main.webp" width="800" height="800" alt="目を閉じて、おでこと手のひらを合わせる天使ちゃんと悪魔ちゃん">`;
}

/* ---------- 画面：はじめて ---------- */
function viewWelcome() {
  return `<main class="wrap welcome">
    ${heroImg()}
    <h1 class="title">天使と悪魔ノート</h1>
    <p class="lead">愛を感じたら天使ちゃんに。<br>「あれ？おかしいかも？」と思ったら悪魔ちゃんに。</p>
    <p class="sub">書いたことはこの端末の中だけに保存されます。<br>まずは、ほかの人に開かれないようにカギをかけておこう。</p>
    <button class="btn primary block" data-action="welcomeset">パスコードを設定する</button>
    <button class="btn ghost block" data-action="welcomeskip">今はしない</button>
  </main>`;
}

/* ---------- 画面：パスコード ---------- */
function keypad(title, sub) {
  const dots = [0, 1, 2, 3].map(i => `<span class="dot${i < pin.buf.length ? ' on' : ''}"></span>`).join('');
  const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '', '0', 'del'];
  return `<div class="keypad-screen">
    <p class="kp-title">${esc(title)}</p>
    <p class="kp-sub${pin.err ? ' err' : ''}">${esc(pin.err || sub || '')}</p>
    <div class="dots">${dots}</div>
    <div class="keys">${keys.map(k => k === '' ? '<span></span>' :
      `<button class="key" data-action="key" data-k="${k}" aria-label="${k === 'del' ? '1文字消す' : k}">${k === 'del' ? '⌫' : k}</button>`).join('')}</div>
  </div>`;
}
function viewPinSet() {
  return header('パスコード', { back: true }) + keypad(pin.first ? 'もう一度入力してね' : '新しいパスコード（4けた）', 'このアプリを開くときに使います');
}
function pressKey(k) {
  if (pin.busy) return;
  if (k === 'del') { pin.buf = pin.buf.slice(0, -1); pin.err = ''; render(); return; }
  if (pin.buf.length >= 4) return;
  pin.buf += k; pin.err = ''; render();
  if (pin.buf.length === 4) { pin.busy = true; setTimeout(() => { pin.busy = false; completePin(); }, 160); }
}
function completePin() {
  const entered = pin.buf;
  pin.buf = '';
  if (locked) {
    if (checkPin(entered)) { locked = false; resetPin(); }
    else pin.err = 'ちがうみたい。もう一度入力してね';
    render();
    return;
  }
  if (ui.view !== 'pinset') return;
  if (!pin.first) { pin.first = entered; render(); return; }
  if (pin.first === entered) {
    setLock(entered); storeSet(WELCOME_KEY, '1'); resetPin();
    toast('パスコードを設定しました');
    if (ui.pinFrom === 'welcome') home(); else back();
  } else {
    pin.first = ''; pin.err = 'さっきとちがうみたい。最初からもう一度';
    render();
  }
}

/* ---------- 画面：本棚 ---------- */
// 背表紙は絵の本。上から天使ページのぶんだけピンク、下から悪魔ページのぶんだけむらさきに染まる
function spine(book) {
  const st = stats(book);
  const n = book.pageCount;
  const aP = st.a.length / n * 100;
  const dP = 100 - st.d.length / n * 100;
  const tint = `linear-gradient(to bottom, var(--tint-angel) 0 ${aP}%, transparent ${aP}% ${dP}%, var(--tint-devil) ${dP}% 100%)`;
  return `<button class="book-item${st.full ? ' full' : ''}" data-action="open" data-id="${book.id}"
      aria-label="第${book.volume}巻をひらく（天使${st.a.length}・悪魔${st.d.length}／${n}ページ）">
    <img class="spine" src="img/spine.webp" alt="">
    <span class="tint" style="background:${tint}"></span>
    <span class="vol">${book.volume}</span>
  </button>`;
}
// 本棚で「どこから書けばいいか」迷わないように、いちばん新しい巻を開くボタン
function continueBtn(book, withName) {
  const st = stats(book);
  const who = withName ? `${esc(book.partner)}の` : '';
  const label = st.full ? `${who}第${book.volume}巻を見返す`
    : st.used ? `${who}第${book.volume}巻のつづきを書く` : `${who}第${book.volume}巻に書きはじめる`;
  return `<button class="btn ghost block small continue" data-action="open" data-id="${book.id}">
    ${st.full ? ICON_BOOK : ICON_PEN}${label}<span class="count">${st.used}/${book.pageCount}</span></button>`;
}
// ボタンの小さな線画アイコン（ペン先・ひらいた本）
const ICON_PEN = `<svg class="ic" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M4 20l2.5-6.5L16 4l4 4-9.5 9.5z"/><path d="M4 20l5-2M14 6l4 4M6.5 13.5l4 4"/><circle cx="11" cy="13" r="1"/></svg>`;
const ICON_BOOK = `<svg class="ic" width="24" height="22" viewBox="0 0 26 22" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linejoin="round" aria-hidden="true"><path d="M13 5c-3-2-7-2.5-10-2v15c3-.5 7 0 10 2 3-2 7-2.5 10-2V3c-3-.5-7 0-10 2z"/><path d="M13 5v15"/></svg>`;
// 本棚の絵：上の段（飾りつき）＋ 相手の数だけ段 ＋ 脚。段は最低2つ
function bookcase(series) {
  const rows = Math.max(2, series.length);
  let html = '';
  for (let i = 0; i < rows; i++) {
    const s = series[i];
    html += `<div class="bc-row ${i === 0 ? 'bc-top' : 'bc-mid'}">${s ? `
      <span class="bc-name">${esc(s.partner)}<small>${RELATIONS[s.relation] || ''}</small></span>
      <div class="bc-books">${s.books.map(spine).join('')}</div>` : ''}</div>`;
  }
  return `<div class="bookcase">${html}<div class="bc-base"></div></div>
    <p class="bc-legend"><span class="sw a"></span>上から天使ちゃん　<span class="sw d"></span>下から悪魔ちゃん</p>`;
}
function viewShelf() {
  let body;
  if (!data.books.length) {
    body = `<section class="empty">
      ${heroImg()}
      <p class="lead">愛を感じたことは天使ちゃんに。<br>「あれ？おかしいかも？」は悪魔ちゃんに。</p>
      <p class="sub">1冊のノートに、前から天使、後ろから悪魔が書いていきます。いっぱいになったら、見返してみよう。</p>
    </section>`;
  } else {
    const series = groupSeries();
    body = bookcase(series) +
      series.map(s => continueBtn(s.books[s.books.length - 1], series.length > 1)).join('');
  }
  const warn = data.books.some(needsSafety) ? safetyCard() : '';
  return header('天使と悪魔ノート', { right: `<button class="icon-btn" data-action="settings" aria-label="せってい">⚙</button>` }) +
    `<main class="wrap">${warn}${body}
      <button class="btn primary block" data-action="newbook">＋ 新しいノートをつくる</button>
    </main>`;
}

/* ---------- 画面：新しいノート ---------- */
function viewNewBook() {
  const rel = ui.formRel || 'dating';
  const pc = ui.formPc || 25;
  return header('新しいノート', { back: true }) + `<main class="wrap">
    <label class="field"><span class="label">相手の呼び名</span>
      <input id="f-partner" maxlength="20" placeholder="例：かれ、Kくん" autocomplete="off">
      <small>本名じゃなくて大丈夫。あなたが分かればOK</small></label>
    <div class="field"><span class="label">ふたりの関係</span>
      <div class="seg">${Object.entries(RELATIONS).map(([k, v]) =>
        `<button class="${k === rel ? 'on' : ''}" data-action="pick" data-key="formRel" data-val="${k}">${v}</button>`).join('')}</div></div>
    <div class="field"><span class="label">ページ数</span>
      <div class="seg">${PAGE_OPTIONS.map(n =>
        `<button class="${n === pc ? 'on' : ''}" data-action="pick" data-key="formPc" data-val="${n}" data-num="1">${n}ページ</button>`).join('')}</div>
      <small>試作版だけ選べます。使いながら、ちょうどいい数を決めよう</small></div>
    <button class="btn primary block" data-action="createbook">ノートをつくる</button>
  </main>`;
}

/* ---------- 画面：ノート ---------- */
function viewBook() {
  const book = getBook(ui.bookId);
  if (!book) return viewMissing();
  const st = stats(book);
  const n = book.pageCount;
  const slots = [];
  for (let i = 0; i < n; i++) {
    let p = null, cls = 'empty';
    if (i < st.a.length) { p = st.a[i]; cls = 'angel'; }
    else if (i >= n - st.d.length) { p = st.d[n - 1 - i]; cls = 'devil'; }
    const moved = p && p.side !== p.origSide;
    const maybe = p && p.truth && p.truth.verdict === 'maybe';
    slots.push(p
      ? `<button class="slot ${cls}${moved ? ' moved' : ''}${maybe ? ' maybe' : ''}" data-action="page" data-id="${p.id}" aria-label="${i + 1}ページ目">${i + 1}</button>`
      : `<span class="slot empty">${i + 1}</span>`);
  }
  const latest = isLatestVolume(book);
  let actions;
  if (st.full) {
    actions = `<div class="full-note card">
      <p class="full-title">ノートがいっぱいになりました</p>
      <p>天使ページ ${st.a.length}枚、悪魔ページ ${st.d.length}枚。どんなふうに見えるかな。</p>
      ${book.reviewedAt && latest
        ? `<button class="btn primary block" data-action="nextvol">第${book.volume + 1}巻をはじめる</button>
           <button class="btn ghost block" data-action="review">もう一度見返す</button>`
        : `<button class="btn primary block" data-action="review">見返す</button>`}
    </div>`;
  } else {
    actions = `<div class="write-pair">
      <button class="write-btn angel" data-action="write" data-side="angel"><span class="portrait">${angelSvg(60)}</span><span class="t">天使ちゃんに書く</span><small>愛を感じたな</small></button>
      <button class="write-btn devil" data-action="write" data-side="devil"><span class="portrait">${devilSvg(60)}</span><span class="t">悪魔ちゃんに書く</span><small>あれ？おかしいかも？</small></button>
    </div>
    <button class="btn ghost block small" data-action="review">${ICON_BOOK}途中で見返す</button>`;
  }
  const list = (pages, side) => pages.length
    ? `<ul class="plist ${side}">${(side === 'devil' ? [...pages].reverse() : pages).map(p =>
        `<li><button data-action="page" data-id="${p.id}"><span class="pn">${pageNumber(book, p)}</span><span class="pd">${fmtDate(p.date)}</span><span class="pt">${esc(snippet(p.what))}</span>${p.side !== p.origSide ? `<span class="pm">${p.origSide === 'devil' ? wingSvg() : tailSvg()}</span>` : ''}</button></li>`).join('')}</ul>`
    : `<p class="muted small">まだありません</p>`;

  return header(`${esc(book.partner)} 第${book.volume}巻`, { back: true }) + `<main class="wrap">
    ${needsSafety(book) ? safetyCard() : ''}
    <section class="card notebook">
      <div class="nb-legend"><span class="lg angel">天使は前から →</span><span class="lg devil">← 悪魔は後ろから</span></div>
      <div class="slots${n >= 50 ? ' wide' : ''}">${slots.join('')}</div>
      <div class="nb-count"><span class="c-angel">天使 ${st.a.length}</span><span class="c-left">のこり ${st.left}</span><span class="c-devil">悪魔 ${st.d.length}</span></div>
    </section>
    ${actions}
    <section class="card"><h2 class="h-angel">天使ページ</h2>${list(st.a, 'angel')}</section>
    <section class="card"><h2 class="h-devil">悪魔ページ</h2>${list(st.d, 'devil')}</section>
    <button class="btn danger-link block small" data-action="delbook">このノートを削除する</button>
  </main>`;
}

/* ---------- 画面：書く ---------- */
function viewWrite() {
  const book = getBook(ui.bookId);
  if (!book) return viewMissing();
  const editing = ui.editId ? getPage(ui.editId) : null;
  const side = editing ? editing.origSide : ui.side;
  const p = editing || { date: todayStr(), what: '', feel: '', think: '' };
  const prompt = side === 'angel'
    ? '愛を感じたこと、書いておこう'
    : '「あれ？おかしいかも？」って思ったこと、ここに置いていこう';
  return header(editing ? '書き直す' : `${SIDE_NAME[side]}ページを書く`, { back: true }) + `<main class="wrap write ${side}">
    <div class="speech">${charaOf(side, 64)}<p>${prompt}</p></div>
    <label class="field"><span class="label">いつのこと？</span><input id="f-date" type="date" value="${esc(p.date)}" max="${todayStr()}"></label>
    <label class="field"><span class="label">何があった？ <em>必須</em></span>
      <textarea id="f-what" rows="4" placeholder="見たこと、言われたこと、されたことをそのまま">${esc(p.what)}</textarea></label>
    <label class="field"><span class="label">どう感じた？</span>
      <textarea id="f-feel" rows="3" placeholder="うれしい、さみしい、悲しい、腹が立つ…">${esc(p.feel)}</textarea></label>
    <label class="field"><span class="label">それってどう思った？</span>
      <textarea id="f-think" rows="3" placeholder="わたしはこう受け取った、こういうことかなと思った">${esc(p.think)}</textarea>
      <small>「起きたこと」と「自分の受け取り方」を分けておくと、あとで見返したときに気づきやすくなります</small></label>
    <button class="btn primary block ${side}" data-action="savepage">${editing ? '書き直しを保存' : 'このページを書く'}</button>
  </main>`;
}

/* ---------- 画面：ページを読む ---------- */
function fieldBlock(label, text) {
  return text ? `<div class="pf"><p class="pf-label">${label}</p><p class="pf-text">${esc(text)}</p></div>` : '';
}
// 「まだ分からないけど、もしかして」の言い方。悪魔ページなら勘違い、天使ページなら違ったかも
function maybeLabel(p) { return p.origSide === 'devil' ? '勘違いだったかな？' : 'あれ？違ったかな？'; }
function truthBlock(p) {
  const t = p.truth;
  const title = t.verdict === 'moved' ? '本当はこうだった'
    : t.verdict === 'maybe' ? maybeLabel(p) : 'やっぱり本当だった';
  const when = t.verdict === 'maybe' ? 'に思った' : 'に分かった';
  return `<div class="truth ${t.verdict}"><p class="truth-title">${title}<span>${fmtDate(t.at)}${when}</span></p><p class="pf-text">${esc(t.text)}</p></div>`;
}
function viewPage() {
  const p = getPage(ui.pageId);
  if (!p) return viewMissing();
  const book = getBook(p.bookId);
  const moved = p.side !== p.origSide;
  return header(`${pageNumber(book, p)}ページ目`, { back: true }) + `<main class="wrap">
    <article class="page card ${p.side}">
      <div class="page-head">${charaOf(p.side, 48)}<div><p class="page-kind">${SIDE_NAME[p.side]}ページ</p><p class="page-date">${fmtDate(p.date)}</p></div></div>
      ${moved ? `<p class="moved-note">${p.origSide === 'devil' ? wingSvg() + '悪魔ページから来たページ' : tailSvg() + '天使ページから来たページ'}</p>` : ''}
      ${p.truth ? truthBlock(p) : ''}
      ${moved ? `<p class="was">最初は${SIDE_NAME[p.origSide]}ページにこう書いてた</p>` : ''}
      <div class="${moved ? 'orig' : ''}">
        ${fieldBlock('何があった？', p.what)}${fieldBlock('どう感じた？', p.feel)}${fieldBlock('それってどう思った？', p.think)}
      </div>
    </article>
    <button class="btn primary block" data-action="truth">${p.truth ? 'あとから気づいたことを直す' : 'あとから気づいたことを書く'}</button>
    <p class="hint">「勘違いだったかな？」も、ここから書けます</p>
    <div class="row2">
      <button class="btn ghost" data-action="edit">書き直す</button>
      <button class="btn ghost danger-text" data-action="delpage">このページを消す</button>
    </div>
  </main>`;
}

/* ---------- 画面：あとから気づいたこと（本当のことが分かった／勘違いだったかな？） ---------- */
function viewTruth() {
  const p = getPage(ui.pageId);
  if (!p) return viewMissing();
  const choices = p.origSide === 'devil'
    ? [['moved', '勘違い・誤解だった', '本当のことが分かった。天使ページへ移します'],
       ['maybe', '勘違いだったかな？', 'まだ分からない。悪魔ページのまま「？」の付箋を貼ります'],
       ['true', 'やっぱり本当だった', '悪魔ページのまま残します']]
    : [['moved', '嘘・ごまかしだった', '本当のことが分かった。悪魔ページへ移します'],
       ['maybe', 'あれ？違ったかな？', 'まだ分からない。天使ページのまま「？」の付箋を貼ります'],
       ['true', 'やっぱり本当だった', '天使ページのまま残します']];
  const cur = ui.truthVerdict || '';
  return header('あとから気づいたこと', { back: true }) + `<main class="wrap">
    <div class="card quote ${p.origSide}"><p class="pf-label">最初に${SIDE_NAME[p.origSide]}ページに書いたこと</p><p class="pf-text">${esc(p.what)}</p></div>
    <label class="field"><span class="label">あとから思ったこと・分かったこと</span>
      <textarea id="f-truth" rows="4" placeholder="相手から聞いたこと、落ち着いて考えたら思ったこと">${esc(p.truth ? p.truth.text : '')}</textarea></label>
    <div class="field"><span class="label">いまはどう思う？</span>
      <div class="choices">${choices.map(([k, t, s]) =>
        `<button class="choice${k === cur ? ' on' : ''}" data-action="pick" data-key="truthVerdict" data-val="${k}"><span>${t}</span><small>${s}</small></button>`).join('')}</div></div>
    <button class="btn primary block" data-action="savetruth">保存する</button>
    ${p.truth ? `<button class="btn ghost block small" data-action="cleartruth">あとから気づいたことを消して、もとに戻す</button>` : ''}
  </main>`;
}

/* ---------- 画面：見返す ---------- */
function viewReview() {
  const book = getBook(ui.bookId);
  if (!book) return viewMissing();
  const st = stats(book);
  if (st.full && !book.reviewedAt) { book.reviewedAt = Date.now(); persist(); }
  const all = pagesOf(book.id).sort(byDate);
  const origDevil = all.filter(p => p.origSide === 'devil').length;
  const origAngel = all.filter(p => p.origSide === 'angel').length;
  const toAngel = all.filter(p => p.origSide === 'devil' && p.side === 'angel').length;
  const toDevil = all.filter(p => p.origSide === 'angel' && p.side === 'devil').length;
  const sureDevil = all.filter(p => p.side === 'devil' && p.truth && p.truth.verdict === 'true').length;
  const maybeDevil = all.filter(p => p.origSide === 'devil' && p.truth && p.truth.verdict === 'maybe').length;
  const maybeAngel = all.filter(p => p.origSide === 'angel' && p.truth && p.truth.verdict === 'maybe').length;

  const insights = [];
  if (toAngel) insights.push(`${wingSvg()}<span>最初に悪魔ページに書いた ${origDevil}枚のうち、<b>${toAngel}枚</b>は、本当は違っていました。</span>`);
  if (toDevil) insights.push(`${tailSvg()}<span>天使ページに書いた ${origAngel}枚のうち、<b>${toDevil}枚</b>は、あとから悪魔ページに移りました。</span>`);
  if (maybeDevil) insights.push(`<span class="qmark">?</span><span>悪魔ページのうち <b>${maybeDevil}枚</b>は「勘違いだったかな？」と思いました。</span>`);
  if (maybeAngel) insights.push(`<span class="qmark">?</span><span>天使ページのうち <b>${maybeAngel}枚</b>は「あれ？違ったかな？」と思いました。</span>`);
  if (sureDevil) insights.push(`<span class="dotmark devil"></span><span>悪魔ページのうち <b>${sureDevil}枚</b>は「やっぱり本当だった」と確かめました。</span>`);

  const timeline = all.length ? `<ul class="timeline">${all.map(p =>
    `<li class="${p.side}"><button data-action="page" data-id="${p.id}">
      <span class="tl-dot"></span><span class="tl-date">${fmtDate(p.date)}</span>
      <span class="tl-text">${esc(snippet(p.what, 30))}</span>
      ${p.side !== p.origSide ? `<span class="pm">${p.origSide === 'devil' ? wingSvg() : tailSvg()}</span>` : ''}
      ${p.truth && p.truth.verdict === 'maybe' ? `<span class="pm"><span class="qmark">?</span></span>` : ''}
    </button></li>`).join('')}</ul>` : `<p class="muted small">まだページがありません</p>`;

  return header('見返しタイム', { back: true }) + `<main class="wrap">
    <section class="card review-top">
      <p class="muted small">${esc(book.partner)} 第${book.volume}巻・${st.used}/${book.pageCount}ページ</p>
      <div class="vs">${angelSvg(60)}${ratioBar(st.a.length, st.d.length, true)}${devilSvg(60)}</div>
      <div class="nb-count"><span class="c-angel">天使ページ ${st.a.length}枚</span><span class="c-devil">悪魔ページ ${st.d.length}枚</span></div>
    </section>
    ${insights.length ? `<section class="card insights">${insights.map(t => `<p>${t}</p>`).join('')}</section>` : ''}
    <section class="card"><h2>時間の順に見る</h2>${timeline}</section>
    <p class="gentle">どちらが多くても、それがいまのあなたの感じ方。<br>良い・悪いの答えじゃなくて、見えたものをそのまま受け取ってみてね。</p>
    ${needsSafety(book) ? safetyCard() : ''}
    ${st.full && isLatestVolume(book) ? `<button class="btn primary block" data-action="nextvol">第${book.volume + 1}巻をはじめる</button>` : ''}
  </main>`;
}

/* ---------- 画面：せってい ---------- */
function viewSettings() {
  const lock = getLock();
  return header('せってい', { back: true }) + `<main class="wrap">
    <section class="card">
      <h2>パスコード</h2>
      <p class="muted small">${lock ? 'パスコードがかかっています。1分以上ほかのアプリを使うと、またカギがかかります。' : 'まだパスコードがありません。'}</p>
      ${lock
        ? `<div class="row2"><button class="btn ghost" data-action="setpin">変える</button><button class="btn ghost" data-action="removepin">はずす</button></div>`
        : `<button class="btn primary block" data-action="setpin">パスコードを設定する</button>`}
    </section>
    <section class="card">
      <h2>バックアップ</h2>
      <p class="muted small">書いたことはこの端末のブラウザの中だけにあります。ブラウザのデータを消すと一緒に消えるので、ときどき書き出しておこう。</p>
      <div class="row2"><button class="btn ghost" data-action="export">書き出す</button><button class="btn ghost" data-action="import">読み込む</button></div>
      <input id="f-import" type="file" accept="application/json,.json" hidden>
    </section>
    <section class="card">
      <h2>データを全部消す</h2>
      <p class="muted small">ノートもパスコードもすべて消えます。元には戻せません。</p>
      <button class="btn danger block" data-action="wipe">全部消す</button>
    </section>
    <p class="muted small center">天使と悪魔ノート 試作版</p>
  </main>`;
}

function viewMissing() {
  return header('見つかりません', { back: true }) + `<main class="wrap"><p class="muted">このページは見つかりませんでした。</p></main>`;
}

const VIEWS = {
  welcome: viewWelcome, shelf: viewShelf, newbook: viewNewBook, book: viewBook, write: viewWrite,
  page: viewPage, truth: viewTruth, review: viewReview, settings: viewSettings, pinset: viewPinSet
};

/* ---------- 操作 ---------- */
const ACTIONS = {
  back, home,
  settings: () => nav('settings'),
  welcomeset: () => { resetPin(); nav('pinset', { pinFrom: 'welcome' }); },
  welcomeskip: () => { storeSet(WELCOME_KEY, '1'); home(); },
  setpin: () => { resetPin(); nav('pinset', { pinFrom: 'settings' }); },
  removepin: () => {
    if (!confirm('パスコードをはずしますか？')) return;
    storeDel(LOCK_KEY); toast('パスコードをはずしました'); render();
  },
  key: el => pressKey(el.dataset.k),
  newbook: () => nav('newbook', { formRel: 'dating', formPc: 25 }),
  pick: el => {
    ui[el.dataset.key] = el.dataset.num ? Number(el.dataset.val) : el.dataset.val;
    el.parentElement.querySelectorAll('button').forEach(b => b.classList.toggle('on', b === el));
  },
  createbook: () => {
    const book = {
      id: uid(), type: 'angel-devil', seriesId: uid(), volume: 1,
      partner: val('f-partner').trim() || 'あの人', relation: ui.formRel || 'dating',
      pageCount: Number(ui.formPc) || 25, createdAt: Date.now(), reviewedAt: null
    };
    data.books.push(book); persist();
    replace('book', { bookId: book.id });
  },
  open: el => nav('book', { bookId: el.dataset.id }),
  write: el => nav('write', { side: el.dataset.side, editId: null }),
  savepage: () => {
    const what = val('f-what').trim();
    if (!what) { toast('「何があった？」だけは書いてね'); document.getElementById('f-what').focus(); return; }
    const fields = { date: val('f-date') || todayStr(), what, feel: val('f-feel').trim(), think: val('f-think').trim() };
    const book = getBook(ui.bookId);
    if (ui.editId) {
      Object.assign(getPage(ui.editId), fields, { updatedAt: Date.now() });
      persist(); toast('書き直しました'); back(); return;
    }
    if (stats(book).full) { toast('このノートはもういっぱいです'); back(); return; }
    data.pages.push({ id: uid(), bookId: book.id, side: ui.side, origSide: ui.side, ...fields, truth: null, createdAt: Date.now(), updatedAt: Date.now() });
    persist();
    if (stats(book).full) toast('これでノートがいっぱいになったよ。見返してみよう');
    else toast(ui.side === 'angel' ? 'だいじな気持ち、ちゃんと残したよ' : 'つらかったね。ここに置いていっていいよ');
    back();
  },
  page: el => nav('page', { pageId: el.dataset.id }),
  edit: () => { const p = getPage(ui.pageId); nav('write', { editId: p.id, bookId: p.bookId }); },
  delpage: () => {
    if (!confirm('このページを消しますか？元には戻せません。')) return;
    data.pages = data.pages.filter(p => p.id !== ui.pageId); persist();
    toast('ページを消しました'); back();
  },
  truth: () => { const p = getPage(ui.pageId); nav('truth', { truthVerdict: p.truth ? p.truth.verdict : '' }); },
  savetruth: () => {
    const p = getPage(ui.pageId);
    const text = val('f-truth').trim();
    if (!text) { toast('あとから思ったことを、ひとことでも書いてね'); return; }
    if (!ui.truthVerdict) { toast('「いまはどう思う？」を選んでね'); return; }
    const other = p.origSide === 'angel' ? 'devil' : 'angel';
    const wasSide = p.side;
    p.truth = { text, verdict: ui.truthVerdict, at: todayStr() };
    p.side = ui.truthVerdict === 'moved' ? other : p.origSide;
    p.updatedAt = Date.now();
    persist();
    if (p.side !== wasSide) toast(p.side === 'angel' ? '天使ページに移ったよ。ノートの境目が動いたね' : '悪魔ページに移ったよ。気づけてえらかったね');
    else if (ui.truthVerdict === 'maybe') toast('「？」の付箋を貼っておいたよ。分かったら、また書き直してね');
    else toast('付箋を貼っておいたよ');
    back();
  },
  cleartruth: () => {
    if (!confirm('あとから気づいたことを消して、最初の場所に戻しますか？')) return;
    const p = getPage(ui.pageId);
    p.truth = null; p.side = p.origSide; p.updatedAt = Date.now(); persist();
    toast('もとに戻しました'); back();
  },
  review: () => nav('review'),
  nextvol: () => {
    const book = getBook(ui.bookId);
    const nb = {
      id: uid(), type: book.type, seriesId: book.seriesId, volume: book.volume + 1,
      partner: book.partner, relation: book.relation, pageCount: book.pageCount, createdAt: Date.now(), reviewedAt: null
    };
    data.books.push(nb); persist();
    stack = [{ view: 'shelf' }]; ui = { view: 'book', bookId: nb.id }; render(true);
    toast(`第${nb.volume}巻をはじめたよ`);
  },
  delbook: () => {
    const book = getBook(ui.bookId);
    if (!confirm(`「${book.partner} 第${book.volume}巻」を削除しますか？中のページもすべて消えて、元には戻せません。`)) return;
    data.pages = data.pages.filter(p => p.bookId !== book.id);
    data.books = data.books.filter(b => b.id !== book.id);
    persist(); toast('ノートを削除しました'); home();
  },
  export: () => {
    const blob = new Blob([JSON.stringify({ app: 'tenshi-akuma-note', exportedAt: new Date().toISOString(), data }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = `memo-backup-${todayStr()}.json`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast('書き出しました');
  },
  import: () => document.getElementById('f-import').click(),
  wipe: () => {
    if (!confirm('ノートもパスコードもすべて消えます。本当に消しますか？')) return;
    if (!confirm('元には戻せません。最後の確認です。全部消しますか？')) return;
    storeDel(STORE_KEY); storeDel(LOCK_KEY); storeDel(WELCOME_KEY);
    data = emptyData(); locked = false; stack = []; ui = { view: 'welcome' }; render(true);
  }
};

function importFile(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let obj;
    try { obj = JSON.parse(reader.result); } catch (e) { toast('読み込めないファイルでした'); return; }
    const d = obj && obj.data;
    if (!isValidData(d)) { toast('このアプリのバックアップではないみたい'); return; }
    if (!confirm(`ノート${d.books.length}冊・${d.pages.length}ページを読み込みます。今のデータは上書きされます。よろしいですか？`)) return;
    data = d; persist(); toast('読み込みました'); home();
  };
  reader.readAsText(file);
}

/* ---------- 描画 ---------- */
const $app = document.getElementById('app');
function render(scrollTop) {
  $app.innerHTML = locked ? keypad('メモ', 'パスコードを入力') : (VIEWS[ui.view] || viewShelf)();
  if (scrollTop) window.scrollTo(0, 0);
}

$app.addEventListener('click', e => {
  const el = e.target.closest('[data-action]');
  if (!el || !$app.contains(el)) return;
  const fn = ACTIONS[el.dataset.action];
  if (fn) { e.preventDefault(); fn(el); }
});
$app.addEventListener('change', e => {
  if (e.target.id === 'f-import' && e.target.files[0]) { importFile(e.target.files[0]); e.target.value = ''; }
});
document.addEventListener('keydown', e => {
  if (!(locked || ui.view === 'pinset')) return;
  if (/^[0-9]$/.test(e.key)) pressKey(e.key);
  else if (e.key === 'Backspace') pressKey('del');
});

let toastTimer;
function toast(msg) {
  const t = document.getElementById('toast');
  t.textContent = msg; t.hidden = false;
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { t.classList.remove('show'); setTimeout(() => { t.hidden = true; }, 250); }, 2600);
}

render();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || ['localhost', '127.0.0.1'].includes(location.hostname))) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}
