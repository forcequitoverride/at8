// Library: every email, organised by GROUPS (dimensions) that each hold VALUES.
//   Sender · Read status · Rating · Length · Date · Mood* · Category*   (* arrive with Stage 2 analysis)
// Within a group, picked values are OR-ed (Short or Medium). Across groups they are AND-ed
// (Short AND Timeless AND Tate). Each value shows how many emails it would give;
// values that would give none are greyed out.
import { store, status, stateOf, search } from './store.js';
import { logEvent } from './db.js';
import { esc, fmtDate, fmtMonth, monthKey, readMinutes, debounce, fmtMins, minsLeft, SENDER_NAME, LENGTHS, lengthOf, RATINGS } from './util.js';

const CHUNK = 120;
const MONTHS = ['01', '02', '03', '04', '05', '06', '07', '08', '09', '10', '11', '12'];
const monthName = (m) => new Intl.DateTimeFormat(undefined, { month: 'short' }).format(new Date(`2000-${m}-15`));

// Each group: key, label, values [{v, label, hint?}], test(email, value).
function groups() {
  const years = [...new Set(store.emails.map((e) => e.date.slice(0, 4)))].reverse();
  return [
    { key: 'sender', label: 'Sender', values: [{ v: 'tate', label: 'Andrew Tate' }, { v: 'zarak', label: 'Zarak' }], test: (e, v) => e.sender === v },
    {
      key: 'status', label: 'Read status',
      values: [{ v: 'unread', label: 'Never read' }, { v: 'started', label: 'In progress' }, { v: 'read', label: 'Read' }, { v: 'fav', label: '★ Favourite' }],
      test: (e, v) => (v === 'fav' ? stateOf(e.id).favourite : status(e.id) === v),
    },
    {
      key: 'rating', label: 'Rating',
      values: [...RATINGS.map((r) => ({ v: String(r.v), label: `${r.short} ${r.label}` })), { v: '0', label: 'Not rated' }],
      test: (e, v) => String(stateOf(e.id).rating || 0) === v,
    },
    { key: 'length', label: 'Length', values: LENGTHS.map((l) => ({ v: l.v, label: l.label, hint: l.hint })), test: (e, v) => lengthOf(e.words) === v },
    { key: 'year', label: 'Year', values: years.map((y) => ({ v: y, label: y })), test: (e, v) => e.date.startsWith(v) },
    { key: 'month', label: 'Month', values: MONTHS.map((m) => ({ v: m, label: monthName(m) })), test: (e, v) => e.date.slice(5, 7) === v },
    { key: 'mood', label: 'Mood', soon: true },
    { key: 'category', label: 'Category', soon: true },
  ];
}

const f = { q: '', sort: 'new', sel: {} };      // sel: groupKey -> Set of values
// Picks and order are remembered between app launches (search text is not).
try {
  const saved = JSON.parse(localStorage.getItem('libraryFilters') || 'null');
  if (saved) { f.sort = saved.sort || 'new'; f.sel = Object.fromEntries(Object.entries(saved.sel || {}).map(([k, v]) => [k, new Set(v)])); }
} catch {}
const saveFilters = () => {
  try { localStorage.setItem('libraryFilters', JSON.stringify({ sort: f.sort, sel: Object.fromEntries(Object.entries(f.sel).map(([k, s]) => [k, [...s]])) })); } catch {}
};
let openGroup = null;
let memory = { scrollY: 0, shown: CHUNK };

export function rememberLibraryScroll() { memory.scrollY = window.scrollY; }

const selOf = (k) => (f.sel[k] ||= new Set());

function passes(e, G, skipKey = null) {
  for (const g of G) {
    if (g.soon || g.key === skipKey) continue;
    const s = f.sel[g.key];
    if (s && s.size && ![...s].some((v) => g.test(e, v))) return false;
  }
  return true;
}

const SORTS = {
  new: { label: 'Newest first', fn: (a, b) => b.date.localeCompare(a.date) },
  old: { label: 'Oldest first', fn: (a, b) => a.date.localeCompare(b.date) },
  short: { label: 'Shortest first', fn: (a, b) => a.words - b.words || b.date.localeCompare(a.date) },
  long: { label: 'Longest first', fn: (a, b) => b.words - a.words || b.date.localeCompare(a.date) },
};

function filtered(G) {
  const pool = store.emails.filter((e) => passes(e, G));
  const s = f.q ? search(f.q, pool) : null;
  if (s) return { list: s.results, terms: s.terms, byDate: false };
  const months = new Map();   // month -> {n, words} for the headings
  for (const e of pool) { const m = months.get(monthKey(e.date)) || { n: 0, words: 0 }; m.n++; m.words += e.words; months.set(monthKey(e.date), m); }
  return { list: [...pool].sort(SORTS[f.sort].fn), terms: null, byDate: f.sort === 'new' || f.sort === 'old', months };
}

const anyPicks = () => Object.values(f.sel).some((s) => s.size);

// Emails you started but didn't finish, most recent first, with the time each still needs.
function continueStrip() {
  const started = [...store.state.values()]
    .filter((s) => s.opens && !s.reads && s.maxProgress < 0.95 && store.byId.has(s.id))
    .sort((a, b) => (b.lastOpened || '').localeCompare(a.lastOpened || ''))
    .slice(0, 3);
  if (!started.length) return '';
  return `<div class="continue"><div class="continue-title">Continue reading</div>${started.map((s) => {
    const e = store.byId.get(s.id);
    return `<a href="#/read/${e.id}" data-sender="${e.sender}"><span class="subj">${esc(e.subject)}</span><span class="left">${fmtMins(minsLeft(e.words, s.maxProgress))} left</span></a>`;
  }).join('')}</div>`;
}

function snippet(e, terms) {
  const flat = e.text.replace(/\s+/g, ' ');
  if (!terms) return esc(flat.slice(0, 180));
  const at = Math.max(0, flat.toLowerCase().indexOf(terms[0]) - 60);
  let s = esc((at > 0 ? '…' : '') + flat.slice(at, at + 200));
  for (const t of terms) s = s.replace(new RegExp(`(${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'), '<mark>$1</mark>');
  return s;
}

function itemHtml(e, terms) {
  const st = stateOf(e.id);
  const stat = status(e.id);
  const badges = [];
  if (st.rating) badges.push(`<span class="badge rating" title="${RATINGS[st.rating - 1].label}">${RATINGS[st.rating - 1].short} ${RATINGS[st.rating - 1].label}</span>`);
  if (st.favourite) badges.push('<span class="star" title="Favourite">★</span>');
  if (st.reads > 1) badges.push(`<span class="badge" title="Times read">read ×${st.reads}</span>`);
  else if (stat === 'read') badges.push('<span class="badge">read</span>');
  const len = LENGTHS.find((l) => l.v === lengthOf(e.words));
  const progress = stat === 'started' ? `<div class="progress"><i style="width:${Math.round(st.maxProgress * 100)}%"></i></div>` : '';
  // The time cost, shown before you open anything. In progress = what's left.
  const cost = stat === 'started'
    ? `${fmtMins(minsLeft(e.words, st.maxProgress))} left`
    : `${len.label} · ${readMinutes(e.words)} min`;
  return `<li><a class="item ${stat === 'unread' ? 'unread' : ''}" data-sender="${e.sender}" href="#/read/${e.id}">
    <div class="meta"><span class="who">${SENDER_NAME[e.sender]}</span><span>${fmtDate(e.date)}</span><span class="len len-${len.v}">${cost}</span></div>
    <div class="subject">${esc(e.subject || '(no subject)')}</div>
    <div class="snippet">${snippet(e, terms)}</div>
    ${badges.length ? `<div class="badges">${badges.join('')}</div>` : ''}${progress}</a></li>`;
}

export function renderLibrary(root) {
  if (!store.emails.length) {
    root.innerHTML = `<div class="page"><div class="page-head"><h1>AT8 Zararak</h1></div>
      <div class="empty"><p>No emails loaded yet.</p><a class="btn primary" href="#/data">Import your emails</a></div></div>`;
    return;
  }
  const G = groups();
  root.innerHTML = `<div class="page">
    <div class="controls" id="controls">
      <input class="search" type="search" id="q" placeholder="Search ${store.emails.length.toLocaleString()} emails" value="${esc(f.q)}" autocomplete="off">
      <div class="chips groups" id="groups" role="tablist" aria-label="Organise by"></div>
      <div class="facet" id="facet" hidden></div>
      <div class="active" id="active"></div>
      <div class="sortrow">
        <span class="summary" id="summary"></span>
        <select class="select" id="sort" aria-label="Order">${Object.entries(SORTS).map(([k, s]) => `<option value="${k}" ${f.sort === k ? 'selected' : ''}>${s.label}</option>`).join('')}</select>
      </div>
    </div>
    <div id="continue"></div>
    <ul class="list ${localStorage.getItem('cards') === 'compact' ? 'compact' : ''}" id="list"></ul>
    <div class="sentinel" id="sentinel"></div>
  </div>`;

  const controls = root.querySelector('#controls');
  const listEl = root.querySelector('#list');
  const summary = root.querySelector('#summary');
  let current = filtered(G);
  let shown = 0;

  const setControlsH = () => document.documentElement.style.setProperty('--controls-h', `${controls.offsetHeight}px`);

  function drawGroups() {
    root.querySelector('#groups').innerHTML = G.map((g) => {
      const n = f.sel[g.key]?.size || 0;
      return `<button class="chip group ${g.soon ? 'soon' : ''}" role="tab" data-g="${g.key}" aria-selected="${openGroup === g.key}" aria-pressed="${openGroup === g.key}">
        ${g.label}${n ? ` <span class="count">${n}</span>` : ''}</button>`;
    }).join('');
    const facet = root.querySelector('#facet');
    const g = G.find((x) => x.key === openGroup);
    if (!g) { facet.hidden = true; facet.innerHTML = ''; }
    else if (g.soon) {
      facet.hidden = false;
      facet.innerHTML = `<p class="soon-note"><b>${g.label}</b> fills in after the first analysis (Stage 2). Each email will get ${g.key === 'mood' ? 'moods like reflective, fierce or calm' : 'weighted categories like Spirituality 62%, Strength 31%'}, and you'll be able to pick them here.</p>`;
    } else {
      // Count what each value would give, keeping every OTHER group's picks.
      let base = store.emails.filter((e) => passes(e, G, g.key));
      if (f.q) base = search(f.q, base)?.results ?? base;
      const sel = selOf(g.key);
      facet.hidden = false;
      facet.innerHTML = `<div class="values">${g.values.map((val) => {
        const n = base.filter((e) => g.test(e, val.v)).length;
        const on = sel.has(val.v);
        return `<button class="chip value" data-v="${val.v}" aria-pressed="${on}" ${!n && !on ? 'disabled' : ''}>${esc(val.label)}${val.hint ? ` <small>${val.hint}</small>` : ''} <span class="n">${n.toLocaleString()}</span></button>`;
      }).join('')}</div>${g.key === 'month' && !f.sel.year?.size ? '<p class="soon-note">Months apply across all years. Pick a year too to narrow it.</p>' : ''}`;
    }
    // Active picks as removable pills.
    const pills = [];
    for (const g2 of G) for (const v of f.sel[g2.key] || []) {
      const val = g2.values.find((x) => x.v === v);
      pills.push(`<button class="pill" data-g="${g2.key}" data-v="${v}" aria-label="Remove ${esc(val.label)}">${g2.label}: ${esc(val.label)} ✕</button>`);
    }
    root.querySelector('#active').innerHTML = pills.length ? pills.join('') + '<button class="pill clear" id="clearAll">Clear all</button>' : '';
    root.querySelector('#sort').disabled = !!f.q;
    setControlsH();
  }

  function draw(reset, upTo = CHUNK) {
    if (reset) { current = filtered(G); shown = 0; listEl.innerHTML = ''; }
    const parts = [];
    const end = Math.min(current.list.length, Math.max(shown + CHUNK, upTo));
    for (let i = shown; i < end; i++) {
      const e = current.list[i];
      const prev = current.list[i - 1];
      if (current.byDate && (!prev || monthKey(prev.date) !== monthKey(e.date))) {
        const m = current.months.get(monthKey(e.date));
        parts.push(`<li class="month"><span>${fmtMonth(e.date)}</span><span class="month-stats">${m.n} · ${fmtMins(m.words / 200)}</span></li>`);
      }
      parts.push(itemHtml(e, current.terms));
    }
    listEl.insertAdjacentHTML('beforeend', parts.join(''));
    shown = end;
    memory.shown = shown;
    const n = current.list.length;
    const mins = current.list.reduce((t, e) => t + e.words, 0) / 200;
    summary.textContent = `${n.toLocaleString()} ${current.terms ? `match${n === 1 ? '' : 'es'}, best first` : 'emails'} · about ${mins < 90 ? `${Math.round(mins)} min` : `${Math.round(mins / 60)} h`} of reading`;
    if (!n) listEl.innerHTML = '<li class="empty">Nothing matches. Remove a pick or try fewer words.</li>';
    root.querySelector('#continue').innerHTML = !f.q && !anyPicks() ? continueStrip() : '';
  }

  drawGroups();
  draw(true, memory.shown);
  requestAnimationFrame(() => window.scrollTo(0, memory.scrollY));

  new IntersectionObserver((entries) => {
    if (entries[0].isIntersecting && shown < current.list.length) draw(false);
  }, { rootMargin: '800px' }).observe(root.querySelector('#sentinel'));

  const refresh = () => { memory = { scrollY: 0, shown: CHUNK }; saveFilters(); drawGroups(); window.scrollTo(0, 0); draw(true); };
  const logPick = (g, v, on) => logEvent('filter', null, { group: g, value: v, on, active: Object.fromEntries(Object.entries(f.sel).filter(([, s]) => s.size).map(([k, s]) => [k, [...s]])) });

  const logSearch = debounce((q, n) => { if (q.length > 1) logEvent('search', null, { q, results: n }); }, 1200);
  root.querySelector('#q').addEventListener('input', (ev) => {
    f.q = ev.target.value.trim();
    refresh();
    logSearch(f.q, current.list.length);
  });

  controls.addEventListener('click', (ev) => {
    const groupBtn = ev.target.closest('.chip.group');
    if (groupBtn) { openGroup = openGroup === groupBtn.dataset.g ? null : groupBtn.dataset.g; drawGroups(); return; }
    const valueBtn = ev.target.closest('.chip.value');
    if (valueBtn) {
      const s = selOf(openGroup);
      const v = valueBtn.dataset.v;
      const on = !s.has(v);
      on ? s.add(v) : s.delete(v);
      logPick(openGroup, v, on);
      refresh();
      return;
    }
    const pill = ev.target.closest('.pill');
    if (pill) {
      if (pill.id === 'clearAll') f.sel = {};
      else { selOf(pill.dataset.g).delete(pill.dataset.v); logPick(pill.dataset.g, pill.dataset.v, false); }
      refresh();
    }
  });

  root.querySelector('#sort').addEventListener('change', (ev) => { f.sort = ev.target.value; logEvent('sort', null, { sort: f.sort }); refresh(); });
}
