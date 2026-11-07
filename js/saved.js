// Saved: favourites, highlighted passages, and notes (including free notes not tied to an email).
import { store } from './store.js';
import * as db from './db.js';
import { esc, paragraphs, fmtDate, fmtDateTime, toast, SENDER_NAME } from './util.js';

let tab = 'highlights';

export async function renderSaved(root) {
  const states = [...store.state.values()];
  const favs = states.filter((s) => s.favourite && store.byId.has(s.id)).map((s) => store.byId.get(s.id)).sort((a, b) => b.date.localeCompare(a.date));
  const highlights = [];
  for (const s of states) {
    const e = store.byId.get(s.id);
    if (!e || !s.highlights.length) continue;
    const ps = paragraphs(e.text);
    for (const i of s.highlights) if (ps[i]) highlights.push({ e, text: ps[i] });
  }
  highlights.sort((a, b) => b.e.date.localeCompare(a.e.date));
  const notes = (await db.getAll('notes')).sort((a, b) => b.created.localeCompare(a.created));

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Saved</h1><p>What you've marked as worth keeping.</p></div>
    <div class="seg" role="group">
      ${seg('highlights', `Highlights (${highlights.length})`)}${seg('favourites', `Favourites (${favs.length})`)}${seg('notes', `Notes (${notes.length})`)}
    </div>
    <div id="pane"></div>
  </div>`;

  const pane = root.querySelector('#pane');
  const draw = () => {
    root.querySelectorAll('.seg button').forEach((b) => b.setAttribute('aria-pressed', b.dataset.tab === tab));
    if (tab === 'highlights') {
      pane.innerHTML = highlights.map(({ e, text }) => `<a class="quote" data-sender="${e.sender}" href="#/read/${e.id}">${esc(text).replace(/\n/g, '<br>')}
        <small>${SENDER_NAME[e.sender]} · ${esc(e.subject)} · ${fmtDate(e.date)}</small></a>`).join('')
        || empty('No highlights yet. While reading, tap any paragraph to highlight it.');
    } else if (tab === 'favourites') {
      pane.innerHTML = favs.map((e) => `<a class="quote" data-sender="${e.sender}" href="#/read/${e.id}"><b>${esc(e.subject)}</b>
        <small>${SENDER_NAME[e.sender]} · ${fmtDate(e.date)}</small></a>`).join('')
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
        notes.unshift(note);
        toast('Note saved');
        renderSaved(root);
      });
    }
  };
  root.querySelectorAll('.seg button').forEach((b) => b.addEventListener('click', () => { tab = b.dataset.tab; draw(); }));
  draw();
}

const seg = (t, label) => `<button data-tab="${t}" aria-pressed="${tab === t}">${label}</button>`;
const empty = (msg) => `<p class="empty">${msg}</p>`;
