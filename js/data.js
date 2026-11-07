// Data: import emails / backups, export activity for refresh sessions, storage, appearance.
import { store, setEmails, load, status } from './store.js';
import * as db from './db.js';
import { esc, fmtDateTime, toast } from './util.js';

const APP_VERSION = '0.1.0';

export async function renderData(root) {
  const [eventCount, notes, importedAt, lastExport, persisted] = await Promise.all([
    db.count('events'), db.getAll('notes'), db.getMeta('emailsImportedAt'), db.getMeta('lastExportAt'),
    navigator.storage?.persisted ? navigator.storage.persisted() : Promise.resolve(false),
  ]);
  const total = store.emails.length;
  const by = (s) => store.emails.filter((e) => e.sender === s);
  const readOf = (list) => list.filter((e) => status(e.id) === 'read').length;
  const started = store.emails.filter((e) => status(e.id) === 'started').length;
  const read = readOf(store.emails);
  const highlights = [...store.state.values()].reduce((n, s) => n + s.highlights.length, 0);
  const devSource = await fetch('data/emails.json', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  const theme = localStorage.getItem('theme') || 'system';

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Data</h1><p>Everything is stored on this device only.</p></div>

    <section class="card">
      <h2>Your reading</h2>
      <div class="stats">
        <div class="stat"><b>${read.toLocaleString()}</b><span>read of ${total.toLocaleString()}</span></div>
        <div class="stat"><b>${started}</b><span>in progress</span></div>
        <div class="stat"><b>${(total - read - started).toLocaleString()}</b><span>never opened</span></div>
        <div class="stat"><b>${highlights}</b><span>highlights</span></div>
        <div class="stat"><b>${notes.length}</b><span>notes</span></div>
        <div class="stat"><b>${eventCount.toLocaleString()}</b><span>activity records</span></div>
      </div>
      ${['tate', 'zarak'].map((s) => { const l = by(s); const r = readOf(l); return `<p style="margin:8px 0 0">${s === 'tate' ? 'Andrew Tate' : 'Zarak'}: ${r} of ${l.length} read</p><div class="meter"><i style="width:${l.length ? (r / l.length) * 100 : 0}%;${s === 'zarak' ? 'background:var(--zarak)' : ''}"></i></div>`; }).join('')}
    </section>

    <section class="card">
      <h2>Export your activity</h2>
      <p>Saves one file with your reading history, highlights, favourites and notes. Send it to your PC for a refresh session — it also works as a backup.${lastExport ? ` Last export: ${fmtDateTime(lastExport)}.` : ''}</p>
      <div class="row"><button class="btn primary" id="export">Export activity</button></div>
    </section>

    <section class="card">
      <h2>Import a file</h2>
      <p>Emails file (<code>emails.json</code>), an activity backup, or — from Stage 2 — an analysis update. Your reading history is never overwritten.</p>
      <p>${total ? `${total.toLocaleString()} emails on this device${importedAt ? `, imported ${fmtDateTime(importedAt)}` : ''}.` : 'No emails on this device yet.'}</p>
      <div class="row">
        <label class="btn primary" for="file">Choose file…</label>
        <input id="file" type="file" accept=".json,application/json" hidden>
        ${devSource ? '<button class="btn" id="devLoad">Load emails from this computer</button>' : ''}
      </div>
    </section>

    <section class="card">
      <h2>Keep data safe</h2>
      <p>${persisted ? 'Protected: the browser has agreed not to clear this app’s data on its own.' : 'Not yet protected: the browser may clear data when storage runs low. Ask it to keep the data, and export regularly as a backup.'}</p>
      ${persisted ? '' : '<div class="row"><button class="btn" id="persist">Keep my data</button></div>'}
    </section>

    <section class="card">
      <h2>Appearance</h2>
      <div class="seg" role="group" aria-label="Theme">
        ${['system', 'light', 'dark'].map((t) => `<button data-theme="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
    </section>
    <p class="hint" style="text-align:center">AT8 Zararak ${APP_VERSION} · Stage 1</p>
  </div>`;

  root.querySelector('#export').addEventListener('click', exportActivity);
  root.querySelector('#file').addEventListener('change', async (ev) => {
    const file = ev.target.files[0];
    if (!file) return;
    try { await importJson(JSON.parse(await file.text())); renderData(root); } catch (err) { console.error(err); toast(`Import failed: ${err.message}`, 5000); }
    ev.target.value = '';
  });
  root.querySelector('#devLoad')?.addEventListener('click', async (ev) => {
    ev.target.disabled = true; ev.target.textContent = 'Loading…';
    try { await importJson(await (await fetch('data/emails.json')).json()); renderData(root); } catch (err) { toast(`Load failed: ${err.message}`, 5000); }
  });
  root.querySelector('#persist')?.addEventListener('click', async () => {
    const ok = await navigator.storage?.persist?.();
    toast(ok ? 'Data protected' : 'The browser said no for now. Installing the app to your home screen usually helps.', 5000);
    renderData(root);
  });
  root.querySelectorAll('[data-theme]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('theme', b.dataset.theme);
    applyTheme();
    renderData(root);
  }));
}

export function applyTheme() {
  const t = localStorage.getItem('theme') || 'system';
  if (t === 'system') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
}

async function exportActivity() {
  const [state, notes, events] = await Promise.all([db.getAll('state'), db.getAll('notes'), db.getAll('events')]);
  const now = new Date().toISOString();
  const payload = {
    kind: 'at8-activity', version: 1, app: APP_VERSION, exportedAt: now,
    emailCount: store.emails.length, state, notes, events,
    settings: { theme: localStorage.getItem('theme') || 'system', readerSize: Number(localStorage.getItem('readerSize')) || 19 },
  };
  const name = `at8-activity-${now.slice(0, 10)}.json`;
  const file = new File([JSON.stringify(payload)], name, { type: 'application/json' });
  await db.setMeta('lastExportAt', now);
  db.logEvent('export', null, { events: events.length, notes: notes.length });
  // On phones, offer the share sheet (Drive, WhatsApp to yourself, email…); otherwise download.
  if (navigator.canShare?.({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name }); toast('Exported'); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(file);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  toast(`Saved ${name}`);
}

async function importJson(data) {
  // 1) Emails file: array of {id, sender, date, subject, text}
  if (Array.isArray(data) && data.length && data[0].id && data[0].text && data[0].sender) {
    await db.putMany('emails', data);
    await db.setMeta('emailsImportedAt', new Date().toISOString());
    await load();
    db.logEvent('import', null, { kind: 'emails', count: data.length });
    toast(`Imported ${data.length.toLocaleString()} emails`);
    return;
  }
  // 2) Activity backup: merge without losing anything already on this device.
  if (data?.kind === 'at8-activity') {
    const local = new Map((await db.getAll('state')).map((s) => [s.id, s]));
    const mergedState = (data.state || []).map((r) => {
      const l = local.get(r.id);
      if (!l) return r;
      return {
        ...l,
        opens: Math.max(l.opens, r.opens), reads: Math.max(l.reads, r.reads), seconds: Math.max(l.seconds, r.seconds),
        maxProgress: Math.max(l.maxProgress, r.maxProgress), favourite: l.favourite || r.favourite,
        highlights: [...new Set([...l.highlights, ...r.highlights])].sort((a, b) => a - b),
        firstOpened: [l.firstOpened, r.firstOpened].filter(Boolean).sort()[0] || null,
        lastOpened: [l.lastOpened, r.lastOpened].filter(Boolean).sort().at(-1) || null,
      };
    });
    await db.putMany('state', mergedState);
    const noteKey = (n) => `${n.created}|${n.text}`;
    const haveNotes = new Set((await db.getAll('notes')).map(noteKey));
    await db.putMany('notes', (data.notes || []).filter((n) => !haveNotes.has(noteKey(n))).map(({ nid, ...n }) => n));
    const evKey = (e) => `${e.t}|${e.type}|${e.emailId || ''}`;
    const haveEvents = new Set((await db.getAll('events')).map(evKey));
    await db.putMany('events', (data.events || []).filter((e) => !haveEvents.has(evKey(e))).map(({ eid, ...e }) => e));
    await load();
    db.logEvent('import', null, { kind: 'activity', from: data.exportedAt });
    toast('Activity backup restored and merged');
    return;
  }
  if (data?.kind === 'at8-analysis') throw new Error('analysis files arrive in Stage 2 — this version can’t read them yet');
  throw new Error('this file isn’t an AT8 emails, activity or analysis file');
}
