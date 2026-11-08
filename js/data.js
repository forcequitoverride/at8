// Data: import emails / backups, export activity for refresh sessions, storage, appearance.
import { store, setEmails, load, status } from './store.js';
import * as db from './db.js';
import { esc, fmtDateTime, toast } from './util.js';
import { getExclusions, addExclusion, removeExclusion, pauseCounting, resumeCounting, periodCounts, mergeExclusions, recount, pausedPeriod } from './counting.js';

// <input type="datetime-local"> wants local time "YYYY-MM-DDTHH:MM".
const localInput = (iso) => { const d = new Date(iso); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };

function countingCard(exclusions, perPeriod, firstEventT) {
  const paused = pausedPeriod();
  const closed = exclusions.filter((p) => p.to).sort((a, b) => b.from.localeCompare(a.from));
  const pauseHtml = paused
    ? `<p class="paused-note"><b>Counting is paused</b> since ${fmtDateTime(paused.from)}. Reading still works and is logged, but doesn't count.</p>
       <div class="row"><button class="btn primary" id="resume">Resume counting</button></div>`
    : '<div class="row"><button class="btn" id="pause">Pause counting</button></div>';
  const periodsHtml = closed.length ? `<div class="section-title">Left out</div>${closed.map((p) => `
    <div class="period"><div><b>${fmtDateTime(p.from)} → ${new Date(p.from).toDateString() === new Date(p.to).toDateString() ? new Date(p.to).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }) : fmtDateTime(p.to)}</b>
      <small>${esc(p.reason || 'No reason given')} · ${perPeriod.get(p.id) || 0} reading records${p.undoMarks ? ' · ratings, ★ and highlights also undone' : ''}</small></div>
      <button class="link" data-remove="${p.id}">Count again</button></div>`).join('')}` : '';
  return `<section class="card" id="counting">
    <h2>What counts</h2>
    <p>Reads, skims, opens and reading time are counted from your activity log. You can pause counting, or leave out a period (like testing). Nothing is deleted: the log keeps everything, and "Count again" brings a period back.</p>
    ${pauseHtml}
    ${periodsHtml}
    <details class="exclude" ${closed.length ? '' : 'open'}>
      <summary>Leave out a period</summary>
      <form id="excludeForm">
        <label>From <input type="datetime-local" name="from" required value="${localInput(firstEventT)}"></label>
        <label>To <input type="datetime-local" name="to" required value="${localInput(new Date().toISOString())}"></label>
        <label>Reason <input type="text" name="reason" value="Testing the app"></label>
        <label class="check"><input type="checkbox" name="undoMarks"> Also undo ratings, ★ and highlights made in this period</label>
        <p class="hint">Pre-filled from your first activity to now, which leaves out all testing so far. Notes are never touched.</p>
        <button class="btn primary" type="submit">Leave out this period</button>
      </form>
    </details>
  </section>`;
}

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
  const skimmed = store.emails.filter((e) => status(e.id) === 'skimmed').length;
  const read = readOf(store.emails);
  const devNotes = notes.filter((n) => n.kind === 'dev').length;
  const pct = (r, n) => { if (!n || !r) return '0%'; const p = (r / n) * 100; return p < 1 ? '<1%' : `${Math.round(p)}%`; };
  // Coverage: how much of each sender / year you've read (skims don't count).
  const coverRow = (label, list, color = 'var(--tate)') => {
    const r = readOf(list);
    return `<div class="cover"><span class="cover-label">${label}</span><div class="meter"><i style="width:${list.length ? (r / list.length) * 100 : 0}%;background:${color}"></i></div>
      <span class="cover-n"><b>${pct(r, list.length)}</b> ${r}/${list.length}</span></div>`;
  };
  const years = [...new Set(store.emails.map((e) => e.date.slice(0, 4)))].reverse();
  const highlights = [...store.state.values()].reduce((n, s) => n + s.highlights.length, 0);
  const devSource = await fetch('data/emails.json', { method: 'HEAD' }).then((r) => r.ok).catch(() => false);
  const theme = localStorage.getItem('theme') || 'system';
  const cards = localStorage.getItem('cards') || 'comfortable';
  const [exclusions, perPeriod, allEvents] = await Promise.all([getExclusions(), periodCounts(), db.getAll('events')]);
  // Default "From": your first activity, or an hour ago if there's barely any yet.
  const hourAgo = new Date(Date.now() - 3_600_000).toISOString();
  const firstEventT = allEvents.reduce((m, e) => (e.t < m ? e.t : m), hourAgo);

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Data</h1><p>Everything is stored on this device only.</p></div>

    <section class="card">
      <h2>Your reading</h2>
      <div class="stats">
        <div class="stat"><b>${pct(read, total)}</b><span>read · ${read.toLocaleString()} of ${total.toLocaleString()}</span></div>
        <div class="stat"><b>${started}</b><span>in progress</span></div>
        <div class="stat"><b>${skimmed}</b><span>skimmed only</span></div>
        <div class="stat"><b>${(total - read - started - skimmed).toLocaleString()}</b><span>never opened</span></div>
        <div class="stat"><b>${highlights}</b><span>highlights</span></div>
        <div class="stat"><b>${notes.length}</b><span>notes${devNotes ? ` · ${devNotes} dev` : ''}</span></div>
      </div>
      <div class="section-title">By sender</div>
      ${coverRow('Andrew Tate', by('tate'))}${coverRow('Zarak', by('zarak'), 'var(--zarak)')}
      <div class="section-title">By year</div>
      ${years.map((y) => coverRow(y, store.emails.filter((e) => e.date.startsWith(y)), 'var(--muted)')).join('')}
      <p class="hint" style="margin-top:10px">Skims don't count as reads. ${eventCount.toLocaleString()} activity records stored.</p>
    </section>
    ${devNotes ? `<section class="card"><h2>Dev notes waiting: ${devNotes}</h2><p>They go out with your next <b>Export activity</b>. In the next dev session they get read through with you before anything is built. See them in <a href="#/saved">Saved → Notes → Dev notes</a>.</p></section>` : ''}

    ${countingCard(exclusions, perPeriod, firstEventT)}

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
      <p>Theme</p>
      <div class="seg" role="group" aria-label="Theme">
        ${['system', 'light', 'dark'].map((t) => `<button data-theme="${t}" aria-pressed="${theme === t}">${t[0].toUpperCase() + t.slice(1)}</button>`).join('')}
      </div>
      <p>Library cards</p>
      <div class="seg" role="group" aria-label="Library cards">
        <button data-cards="comfortable" aria-pressed="${cards !== 'compact'}">Comfortable</button>
        <button data-cards="compact" aria-pressed="${cards === 'compact'}">Compact</button>
      </div>
      <p class="hint">Compact shows just the subject and the time, for fast scanning. Comfortable adds the opening lines.</p>
    </section>
    <p class="hint" style="text-align:center">AT8 Zararak ${APP_VERSION} · Stage 1 (v7)</p>
  </div>`;

  root.querySelector('#export').addEventListener('click', exportActivity);
  const afterRecount = (n, msg) => { toast(`${msg} · ${n} email${n === 1 ? '' : 's'} recounted`, 3500); renderData(root); };
  root.querySelector('#pause')?.addEventListener('click', async () => { await pauseCounting(); toast('Counting paused'); renderData(root); });
  root.querySelector('#resume')?.addEventListener('click', async () => afterRecount(await resumeCounting(), 'Counting resumed'));
  root.querySelectorAll('[data-remove]').forEach((b) => b.addEventListener('click', async () => afterRecount(await removeExclusion(b.dataset.remove), 'Period counts again')));
  root.querySelector('#excludeForm').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const f = new FormData(ev.target);
    const from = new Date(f.get('from')).toISOString();
    // The picker works in whole minutes: "To 10:15" means up to the END of 10:15.
    const to = new Date(new Date(f.get('to')).getTime() + 59_999).toISOString();
    if (to <= from) { toast('"To" must be after "From"'); return; }
    afterRecount(await addExclusion({ from, to, reason: String(f.get('reason') || '').trim(), undoMarks: f.get('undoMarks') === 'on' }), 'Period left out');
  });
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
  root.querySelectorAll('[data-cards]').forEach((b) => b.addEventListener('click', () => {
    localStorage.setItem('cards', b.dataset.cards);
    renderData(root);
  }));
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
    emailCount: store.emails.length, state, notes, events, exclusions: await getExclusions(),
    settings: { theme: localStorage.getItem('theme') || 'system', readerSize: Number(localStorage.getItem('readerSize')) || 19, cards: localStorage.getItem('cards') || 'comfortable' },
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
        opens: Math.max(l.opens, r.opens), reads: Math.max(l.reads, r.reads), skims: Math.max(l.skims || 0, r.skims || 0), seconds: Math.max(l.seconds, r.seconds),
        maxProgress: Math.max(l.maxProgress, r.maxProgress), favourite: l.favourite || r.favourite,
        rating: Math.max(l.rating || 0, r.rating || 0),
        highlights: [...new Set([...l.highlights, ...r.highlights])].sort((a, b) => a - b),
        firstOpened: [l.firstOpened, r.firstOpened].filter(Boolean).sort()[0] || null,
        lastOpened: [l.lastOpened, r.lastOpened].filter(Boolean).sort().at(-1) || null,
      };
    });
    await db.putMany('state', mergedState);
    // Notes: matched by uid (or creation time for older notes). If both sides have the note,
    // keep the more recently edited version, so edits and their history survive.
    const noteKey = (n) => n.uid || n.created;
    const localNotes = new Map((await db.getAll('notes')).map((n) => [noteKey(n), n]));
    const noteRows = [];
    for (const { nid, ...n } of data.notes || []) {
      const l = localNotes.get(noteKey(n));
      if (!l) noteRows.push(n);
      else if ((n.edited || n.created) > (l.edited || l.created)) noteRows.push({ ...n, nid: l.nid });
    }
    await db.putMany('notes', noteRows);
    const evKey = (e) => `${e.t}|${e.type}|${e.emailId || ''}`;
    const haveEvents = new Set((await db.getAll('events')).map(evKey));
    await db.putMany('events', (data.events || []).filter((e) => !haveEvents.has(evKey(e))).map(({ eid, ...e }) => e));
    await mergeExclusions(data.exclusions || []);
    await recount();
    db.logEvent('import', null, { kind: 'activity', from: data.exportedAt });
    toast('Activity backup restored and merged');
    return;
  }
  if (data?.kind === 'at8-analysis') throw new Error('analysis files arrive in Stage 2 — this version can’t read them yet');
  throw new Error('this file isn’t an AT8 emails, activity or analysis file');
}
