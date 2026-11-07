// Saved: everything you've marked as worth keeping.
//   Highlights · Rated (♥ Like / ♥♥ Like very much / ∞ Timeless) · Favourites · Notes
import { store } from './store.js';
import * as db from './db.js';
import { esc, paragraphs, fmtDate, fmtDateTime, toast, lengthLabel, SENDER_NAME, RATINGS } from './util.js';

let tab = 'highlights';
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
      pane.innerHTML = `<form class="note-form" id="freeNote" style="margin-bottom:14px">
          <label class="sr-only" for="freeText">New note</label>
          <textarea id="freeText" placeholder="A note of your own — not tied to any email."></textarea>
          <button class="btn primary" type="submit">Save note</button>
        </form>
        <div class="notes">${notes.map((n) => {
          const e = n.emailId && store.byId.get(n.emailId);
          const on = e ? `<small style="display:block;color:var(--muted);font-size:12px;margin-top:6px">on <a href="#/read/${e.id}">${esc(e.subject)}</a> · ${SENDER_NAME[e.sender]}</small>` : '';
          return `<div class="note"><time>${fmtDateTime(n.created)}</time>${esc(n.text)}${on}</div>`;
        }).join('') || empty('No notes yet.')}</div>`;
      pane.querySelector('#freeNote').addEventListener('submit', async (ev) => {
        ev.preventDefault();
        const text = pane.querySelector('#freeText').value.trim();
        if (!text) return;
        const note = { emailId: null, text, created: new Date().toISOString() };
        note.nid = await db.put('notes', note);
        db.logEvent('note', null, { nid: note.nid, length: text.length });
        toast('Note saved');
        renderSaved(root);
      });
    }
  };
  root.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  draw();
}

const seg = (t, label, n) => `<button data-tab="${t}" aria-pressed="${tab === t}">${label} <span class="seg-n">${n}</span></button>`;
const empty = (msg) => `<p class="empty">${msg}</p>`;
