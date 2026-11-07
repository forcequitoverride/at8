// Notes, shared by the reader and Saved.
// - Every note can be edited; each edit keeps the previous text in `history`.
// - A note can be a DEV NOTE: an idea or problem for the developer. Dev notes travel in the
//   activity export and are read out in the next dev session (tools/devnotes.mjs).
import { store } from './store.js';
import * as db from './db.js';
import { esc, fmtDateTime, toast, SENDER_NAME } from './util.js';

const APP_VERSION = 'v4';
const uid = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

export function noteFormHtml(placeholder) {
  return `<form class="note-form" data-note-form>
    <label class="sr-only">New note<textarea placeholder="${esc(placeholder)}"></textarea></label>
    <label class="check"><input type="checkbox" name="dev"> Dev note — an idea, wish or problem for the next dev session</label>
    <button class="btn primary" type="submit">Save note</button>
  </form>`;
}

export function noteHtml(n, { showEmail = false } = {}) {
  const e = showEmail && n.emailId && store.byId.get(n.emailId);
  const versions = n.history?.length || 0;
  return `<div class="note ${n.kind === 'dev' ? 'dev' : ''}" data-nid="${n.nid}">
    <div class="note-head">
      <time>${fmtDateTime(n.created)}</time>
      ${n.kind === 'dev' ? '<span class="tag-dev">Dev note</span>' : ''}
      <span class="spacer"></span>
      <button class="link" data-act="edit">Edit</button>
    </div>
    <div class="note-text">${esc(n.text)}</div>
    ${versions ? `<button class="link note-edited" data-act="history">Edited ${fmtDateTime(n.edited)} · ${versions} earlier version${versions > 1 ? 's' : ''}</button>
      <div class="note-history" hidden>${[...n.history].reverse().map((h) => `<div><time>${fmtDateTime(h.at)}</time>${esc(h.text)}</div>`).join('')}</div>` : ''}
    ${e ? `<small class="note-on">on <a href="#/read/${e.id}">${esc(e.subject)}</a> · ${SENDER_NAME[e.sender]}</small>` : ''}
  </div>`;
}

// Wire a note form: calls onSaved(note) after saving.
export function wireNoteForm(form, { emailId = null, getProgress = null, onSaved }) {
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const ta = form.querySelector('textarea');
    const text = ta.value.trim();
    if (!text) return;
    const dev = form.querySelector('input[name="dev"]').checked;
    const note = { uid: uid(), emailId, kind: dev ? 'dev' : 'personal', text, created: new Date().toISOString(), appVersion: APP_VERSION };
    if (getProgress) note.progress = Math.round(getProgress() * 100) / 100;
    note.nid = await db.put('notes', note);
    db.logEvent('note', emailId, { nid: note.nid, kind: note.kind, length: text.length });
    ta.value = '';
    form.querySelector('input[name="dev"]').checked = false;
    toast(dev ? 'Dev note saved — it goes out with your next export' : 'Note saved');
    onSaved(note);
  });
}

// Edit + history, by event delegation on a container of notes.
export function wireNoteList(container, { showEmail = false } = {}) {
  container.addEventListener('click', async (ev) => {
    const btn = ev.target.closest('[data-act]');
    if (!btn) return;
    const el = btn.closest('.note');
    const nid = Number(el.dataset.nid);
    if (btn.dataset.act === 'history') {
      const h = el.querySelector('.note-history');
      h.hidden = !h.hidden;
      return;
    }
    if (btn.dataset.act === 'edit') {
      const n = await db.get('notes', nid);
      el.querySelector('.note-text').outerHTML = `<div class="note-edit"><textarea>${esc(n.text)}</textarea>
        <label class="check"><input type="checkbox" name="dev" ${n.kind === 'dev' ? 'checked' : ''}> Dev note</label>
        <div class="row"><button class="btn primary" data-act="save">Save</button><button class="btn" data-act="cancel">Cancel</button></div></div>`;
      btn.hidden = true;
      el.querySelector('.note-edit textarea').focus();
      return;
    }
    if (btn.dataset.act === 'cancel' || btn.dataset.act === 'save') {
      const n = await db.get('notes', nid);
      if (btn.dataset.act === 'save') {
        const text = el.querySelector('.note-edit textarea').value.trim();
        const kind = el.querySelector('.note-edit input[name="dev"]').checked ? 'dev' : 'personal';
        if (text && (text !== n.text || kind !== n.kind)) {
          if (text !== n.text) n.history = [...(n.history || []), { text: n.text, at: n.edited || n.created }];
          n.text = text;
          n.kind = kind;
          n.edited = new Date().toISOString();
          n.uid ||= uid();
          await db.put('notes', n);
          db.logEvent('note-edit', n.emailId, { nid, kind, versions: n.history?.length || 0 });
          toast('Note updated — earlier version kept');
        }
      }
      el.outerHTML = noteHtml(n, { showEmail });
    }
  });
}
