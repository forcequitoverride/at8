// Library: every email by date, with sender/status/date filters and search.
import { store, status, stateOf, search } from './store.js';
import { logEvent } from './db.js';
import { esc, fmtDate, fmtMonth, monthKey, readMinutes, debounce, SENDER_NAME } from './util.js';

const CHUNK = 120;
const f = { q: '', sender: 'all', status: 'all', year: 'all', month: 'all', sort: 'new' };
let memory = { scrollY: 0, shown: CHUNK };   // restore position when coming back from the reader

export function rememberLibraryScroll() {
  memory.scrollY = window.scrollY;
}

function filtered() {
  let pool = store.emails;
  if (f.sender !== 'all') pool = pool.filter((e) => e.sender === f.sender);
  if (f.year !== 'all') pool = pool.filter((e) => e.date.startsWith(f.year));
  if (f.year !== 'all' && f.month !== 'all') pool = pool.filter((e) => e.date.slice(5, 7) === f.month);
  if (f.status === 'fav') pool = pool.filter((e) => stateOf(e.id).favourite);
  else if (f.status !== 'all') pool = pool.filter((e) => status(e.id) === f.status);
  const s = f.q ? search(f.q, pool) : null;
  if (s) return { list: s.results, terms: s.terms };
  const list = f.sort === 'new' ? [...pool].reverse() : pool;
  return { list, terms: null };
}

function snippet(e, terms) {
  const flat = e.text.replace(/\s+/g, ' ');
  if (!terms) return esc(flat.slice(0, 180));
  const lower = flat.toLowerCase();
  const at = Math.max(0, lower.indexOf(terms[0]) - 60);
  let s = esc((at > 0 ? '…' : '') + flat.slice(at, at + 200));
  for (const t of terms) s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return s;
}

function itemHtml(e, terms) {
  const st = stateOf(e.id);
  const stat = status(e.id);
  const badges = [];
  if (st.favourite) badges.push('<span class="star" title="Favourite">★</span>');
  if (st.reads > 1) badges.push(`<span class="badge" title="Times read">read ×${st.reads}</span>`);
  else if (stat === 'read') badges.push('<span class="badge">read</span>');
  const progress = stat === 'started' ? `<div class="progress"><i style="width:${Math.round(st.maxProgress * 100)}%"></i></div>` : '';
  return `<li><a class="item ${stat === 'unread' ? 'unread' : ''}" data-sender="${e.sender}" href="#/read/${e.id}">
    <div class="meta"><span class="who">${SENDER_NAME[e.sender]}</span><span>${fmtDate(e.date)}</span><span>${readMinutes(e.words)} min</span>
    <span class="badges">${badges.join('')}</span></div>
    <div class="subject">${esc(e.subject || '(no subject)')}</div>
    <div class="snippet">${snippet(e, terms)}</div>${progress}</a></li>`;
}

export function renderLibrary(root) {
  if (!store.emails.length) {
    root.innerHTML = `<div class="page"><div class="page-head"><h1>AT8 Zararak</h1></div>
      <div class="empty"><p>No emails loaded yet.</p><a class="btn primary" href="#/data">Import your emails</a></div></div>`;
    return;
  }
  const years = [...new Set(store.emails.map((e) => e.date.slice(0, 4)))].reverse();
  const readCount = store.emails.filter((e) => status(e.id) === 'read').length;
  root.innerHTML = `<div class="page">
    <div class="controls" id="controls">
      <input class="search" type="search" id="q" placeholder="Search ${store.emails.length.toLocaleString()} emails" value="${esc(f.q)}" autocomplete="off">
      <div class="chips" role="group" aria-label="Sender">
        ${chip('sender', 'all', 'Both')}${chip('sender', 'tate', 'Tate')}${chip('sender', 'zarak', 'Zarak')}
        <span style="width:6px;flex:none"></span>
        ${chip('status', 'all', 'All')}${chip('status', 'unread', 'Never read')}${chip('status', 'started', 'In progress')}${chip('status', 'read', 'Read')}${chip('status', 'fav', '★ Favourites')}
      </div>
      <div class="chips">
        <select class="select" id="year" aria-label="Year"><option value="all">All years</option>${years.map((y) => `<option ${f.year === y ? 'selected' : ''}>${y}</option>`).join('')}</select>
        <select class="select" id="month" aria-label="Month" ${f.year === 'all' ? 'disabled' : ''}><option value="all">All months</option>${
          ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'].map((m) => `<option value="${m}" ${f.month === m ? 'selected' : ''}>${new Intl.DateTimeFormat(undefined, { month: 'long' }).format(new Date(`2000-${m}-15`))}</option>`).join('')}</select>
        <button class="chip" id="sort" ${f.q ? 'disabled' : ''}>${f.sort === 'new' ? 'Newest first' : 'Oldest first'}</button>
      </div>
      <div class="summary" id="summary"></div>
    </div>
    <ul class="list" id="list"></ul>
    <div class="sentinel" id="sentinel"></div>
  </div>`;

  const controls = root.querySelector('#controls');
  const setControlsH = () => document.documentElement.style.setProperty('--controls-h', `${controls.offsetHeight}px`);
  setControlsH();

  let current = filtered();
  let shown = 0;
  const listEl = root.querySelector('#list');
  const summary = root.querySelector('#summary');

  function draw(reset, upTo = CHUNK) {
    if (reset) { current = filtered(); shown = 0; listEl.innerHTML = ''; }
    const parts = [];
    const end = Math.min(current.list.length, Math.max(shown + CHUNK, upTo));
    for (let i = shown; i < end; i++) {
      const e = current.list[i];
      const prev = current.list[i - 1];
      if (!current.terms && (!prev || monthKey(prev.date) !== monthKey(e.date))) parts.push(`<li class="month">${fmtMonth(e.date)}</li>`);
      parts.push(itemHtml(e, current.terms));
    }
    listEl.insertAdjacentHTML('beforeend', parts.join(''));
    shown = end;
    memory.shown = shown;
    const n = current.list.length;
    summary.textContent = current.terms
      ? `${n.toLocaleString()} match${n === 1 ? '' : 'es'} · best first`
      : `${n.toLocaleString()} emails · ${readCount.toLocaleString()} of ${store.emails.length.toLocaleString()} read overall`;
    if (!n) listEl.innerHTML = `<li class="empty">Nothing matches. Try fewer words or clear a filter.</li>`;
  }

  draw(true, memory.shown);
  requestAnimationFrame(() => window.scrollTo(0, memory.scrollY));

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && shown < current.list.length) draw(false);
  }, { rootMargin: '800px' }).observe(root.querySelector('#sentinel'));

  const refresh = () => { memory = { scrollY: 0, shown: CHUNK }; window.scrollTo(0, 0); draw(true); };

  const logSearch = debounce((q, n) => { if (q.length > 1) logEvent('search', null, { q, results: n }); }, 1200);
  root.querySelector('#q').addEventListener('input', (ev) => {
    f.q = ev.target.value.trim();
    root.querySelector('#sort').disabled = !!f.q;
    refresh();
    logSearch(f.q, current.list.length);
  });

  root.querySelectorAll('.chip[data-k]').forEach((b) => b.addEventListener('click', () => {
    f[b.dataset.k] = b.dataset.v;
    root.querySelectorAll(`.chip[data-k="${b.dataset.k}"]`).forEach((x) => x.setAttribute('aria-pressed', x.dataset.v === f[b.dataset.k]));
    logEvent('filter', null, { [b.dataset.k]: b.dataset.v });
    refresh();
  }));

  root.querySelector('#year').addEventListener('change', (ev) => {
    f.year = ev.target.value;
    if (f.year === 'all') f.month = 'all';
    const m = root.querySelector('#month');
    m.disabled = f.year === 'all';
    if (f.year === 'all') m.value = 'all';
    logEvent('filter', null, { year: f.year });
    refresh();
  });
  root.querySelector('#month').addEventListener('change', (ev) => { f.month = ev.target.value; logEvent('filter', null, { month: f.month }); refresh(); });
  root.querySelector('#sort').addEventListener('click', (ev) => {
    f.sort = f.sort === 'new' ? 'old' : 'new';
    ev.target.textContent = f.sort === 'new' ? 'Newest first' : 'Oldest first';
    refresh();
  });
}

function chip(k, v, label) {
  return `<button class="chip" data-k="${k}" data-v="${v}" aria-pressed="${f[k] === v}">${label}</button>`;
}
