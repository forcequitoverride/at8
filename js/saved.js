// Saved: everything you've marked as worth keeping.
//   Highlights · Rated (♥ Like / ♥♥ Like very much / ∞ Timeless) · Favourites · Notes
import { store } from './store.js';
import * as db from './db.js';
import { esc, paragraphs, fmtDate, lengthLabel, SENDER_NAME, RATINGS } from './util.js';
import { noteHtml, noteFormHtml, wireNoteForm, wireNoteList } from './notes.js';

let tab = 'highlights';
let noteFilter = 'all';   // 'all' | 'mine' | 'dev'
let ratedLevel = 'all';   // 'all' or '1' | '2' | '3'

export async function renderSaved(root) {
  const states = [...store.state.values()].filter((s) => store.byId.has(s.id));
  const newest = (a, b) => b.date.localeCompare(a.date);
  const favs = states.filter((s) => s.favourite).map((s) => store.byId.get(s.id)).sort(newest);
  const rated = states.filter((s) => s.rating).map((s) => ({ e: store.byId.get(s.id), rating: s.rating }))
    .sort((a, b) => b.rating - a.rating || newest(a.e, b.e));
  const highlights = [];
  for (const s of states) {
    if (!s.highlights.length) continue;
    const e = store.byId.get(s.id);
    const ps = paragraphs(e.text);
    for (const i of s.highlights) if (ps[i]) highlights.push({ e, text: ps[i] });
  }
  highlights.sort((a, b) => newest(a.e, b.e));
  const notes = (await db.getAll('notes')).sort((a, b) => b.created.localeCompare(a.created));

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Saved</h1><p>What you've marked as worth keeping.</p></div>
    <div class="seg" role="group">
      ${seg('highlights', 'Highlights', highlights.length)}${seg('rated', 'Rated', rated.length)}${seg('favourites', '★', favs.length)}${seg('notes', 'Notes', notes.length)}
    </div>
    <div id="pane"></div>
  </div>`;

  const pane = root.querySelector('#pane');
  const emailCard = (e, extra = '') => `<a class="quote" data-sender="${e.sender}" href="#/read/${e.id}"><b>${esc(e.subject)}</b>
    <small>${SENDER_NAME[e.sender]} · ${fmtDate(e.date)} · ${lengthLabel(e.words)}${extra}</small></a>`;

  const draw = () => {
    root.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === tab));
    if (tab === 'highlights') {
      pane.innerHTML = highlights.map(({ e, text }) => `<a class="quote" data-sender="${e.sender}" href="#/read/${e.id}">${esc(text).replace(/\n/g, '<br>')}
        <small>${SENDER_NAME[e.sender]} · ${esc(e.subject)} · ${fmtDate(e.date)}</small></a>`).join('')
        || empty('No highlights yet. While reading, tap any paragraph to highlight it.');
    } else if (tab === 'rated') {
      // Rated is one section with three levels inside it.
      const count = (v) => rated.filter((r) => String(r.rating) === v).length;
      const shown = ratedLevel === 'all' ? rated : rated.filter((r) => String(r.rating) === ratedLevel);
      pane.innerHTML = `<div class="values sublevels">
          <button class="chip value" data-level="all" aria-pressed="${ratedLevel === 'all'}">All <span class="n">${rated.length}</span></button>
          ${[...RATINGS].reverse().map((r) => `<button class="chip value" data-level="${r.v}" aria-pressed="${ratedLevel === String(r.v)}">${r.short} ${r.label} <span class="n">${count(String(r.v))}</span></button>`).join('')}
        </div>
        ${ratedLevel === 'all'
          ? [...RATINGS].reverse().map((r) => {
              const list = rated.filter((x) => x.rating === r.v);
              return list.length ? `<div class="section-title">${r.short} ${r.label}</div>${list.map((x) => emailCard(x.e)).join('')}` : '';
            }).join('') || empty('Nothing rated yet. Rate an email with ♥, ♥♥ or ∞ while reading.')
          : shown.map((x) => emailCard(x.e)).join('') || empty('Nothing at this level yet.')}`;
      pane.querySelectorAll('[data-level]').forEach((b) => b.addEventListener('click', () => { ratedLevel = b.dataset.level; draw(); }));
    } else if (tab === 'favourites') {
      pane.innerHTML = favs.map((e) => emailCard(e)).join('')
        || empty('No favourites yet. Tap the ★ at the top of an email to keep it here.');
    } else {
      const devCount = notes.filter((n) => n.kind === 'dev').length;
      const shown = noteFilter === 'dev' ? notes.filter((n) => n.kind === 'dev')
        : noteFilter === 'mine' ? notes.filter((n) => n.kind !== 'dev') : notes;
      pane.innerHTML = `<div class="values sublevels">
          <button class="chip value" data-nf="all" aria-pressed="${noteFilter === 'all'}">All <span class="n">${notes.length}</span></button>
          <button class="chip value" data-nf="mine" aria-pressed="${noteFilter === 'mine'}">My notes <span class="n">${notes.length - devCount}</span></button>
          <button class="chip value" data-nf="dev" aria-pressed="${noteFilter === 'dev'}">Dev notes <span class="n">${devCount}</span></button>
        </div>
        ${noteFilter === 'dev' ? '<p class="hint">Dev notes are ideas, wishes and problems for the developer. They go out with <b>Data → Export activity</b>, and get read through with you at the start of the next dev session.</p>' : ''}
        ${noteFormHtml('A note of your own — not tied to any email.')}
        <div class="notes" id="noteList" style="margin-top:14px">${shown.map((n) => noteHtml(n, { showEmail: true })).join('') || empty('No notes here yet.')}</div>`;
      if (noteFilter === 'dev') pane.querySelector('input[name="dev"]').checked = true;
      pane.querySelectorAll('[data-nf]').forEach((b) => b.addEventListener('click', () => { noteFilter = b.dataset.nf; draw(); }));
      wireNoteForm(pane.querySelector('[data-note-form]'), { onSaved: () => renderSaved(root) });
      wireNoteList(pane.querySelector('#noteList'), { showEmail: true });
    }
  };
  root.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  draw();
}

const seg = (t, label, n) => `<button data-tab="${t}" aria-pressed="${tab === t}">${label} <span class="seg-n">${n}</span></button>`;
const empty = (msg) => `<p class="empty">${msg}</p>`;
