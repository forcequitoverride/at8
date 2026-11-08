// What counts. The activity log (events) is the source of truth and is never deleted.
// Reading stats (opens, reads, skims, time, progress) can be RECOUNTED from it, leaving out
// "excluded periods" — e.g. testing, or a day that shouldn't count. Excluding is reversible:
// remove the period and recount, and everything comes back.
//
// Exclusion: {id, from, to|null, reason, undoMarks, created}
//   to = null  → open-ended = "counting paused" (live)
//   undoMarks  → also ignore ratings, ★ and highlights made in that period
import * as db from './db.js';
import { store, load } from './store.js';

const FINISHED = 0.95;

export async function getExclusions() {
  return (await db.getMeta('exclusions', [])) || [];
}

async function setExclusions(list) {
  await db.setMeta('exclusions', list);
  cache = list;
}

let cache = [];
export async function primeExclusions() { cache = await getExclusions(); }

// Synchronous check used by the reader on every action.
export const pausedPeriod = () => cache.find((p) => !p.to) || null;
export const isPaused = () => !!pausedPeriod();

const inPeriod = (t, p) => t >= p.from && (!p.to || t <= p.to);

export async function addExclusion({ from, to = null, reason = '', undoMarks = false }) {
  const list = await getExclusions();
  const p = { id: `x${Date.now().toString(36)}`, from, to, reason, undoMarks, created: new Date().toISOString() };
  list.push(p);
  await setExclusions(list);
  db.logEvent('exclusion-add', null, { from, to, reason, undoMarks });
  return recount();
}

export async function removeExclusion(id) {
  const list = (await getExclusions()).filter((p) => p.id !== id);
  await setExclusions(list);
  db.logEvent('exclusion-remove', null, { id });
  return recount();
}

export async function pauseCounting(reason = 'Paused') {
  if (isPaused()) return null;
  return addExclusion({ from: new Date().toISOString(), reason });
}

export async function resumeCounting() {
  const list = await getExclusions();
  const p = list.find((x) => !x.to);
  if (!p) return null;
  p.to = new Date().toISOString();
  await setExclusions(list);
  db.logEvent('exclusion-close', null, { id: p.id, from: p.from, to: p.to });
  return recount();
}

// Merge exclusions from an imported backup (by id; a closed period beats an open one).
export async function mergeExclusions(incoming = []) {
  const list = await getExclusions();
  const byId = new Map(list.map((p) => [p.id, p]));
  for (const p of incoming) {
    const l = byId.get(p.id);
    if (!l || (!l.to && p.to)) byId.set(p.id, p);
  }
  await setExclusions([...byId.values()]);
}

// How many activity records each period covers (for the Data page).
export async function periodCounts() {
  const [list, events] = await Promise.all([getExclusions(), db.getAll('events')]);
  return new Map(list.map((p) => [p.id, events.filter((e) => inPeriod(e.t, p) && ['open', 'finish', 'skim', 'leave', 'rate', 'favourite', 'highlight', 'unhighlight'].includes(e.type)).length]));
}

// Rebuild every email's reading stats from the log, skipping excluded periods.
// Returns the number of emails whose stats changed.
export async function recount() {
  const [events, rows, list] = await Promise.all([db.getAll('events'), db.getAll('state'), getExclusions()]);
  cache = list;
  events.sort((a, b) => a.t.localeCompare(b.t) || a.eid - b.eid);
  const counts = (t) => !list.some((p) => inPeriod(t, p));
  const marksOff = (t) => list.some((p) => p.undoMarks && inPeriod(t, p));

  // Marks (rating, ★, highlights) are rebuilt from the log for every email that has
  // events of that kind, so undoing AND re-including a period both work. An email with no
  // events of a kind keeps its stored value (safety net, e.g. data from before logging).
  const has = { rate: new Set(), favourite: new Set(), highlight: new Set() };
  for (const ev of events) {
    if (ev.type === 'rate') has.rate.add(ev.emailId);
    else if (ev.type === 'favourite') has.favourite.add(ev.emailId);
    else if (ev.type === 'highlight' || ev.type === 'unhighlight') has.highlight.add(ev.emailId);
  }

  const before = new Map(rows.map((s) => [s.id, JSON.stringify([s.opens, s.reads, s.skims, s.seconds, s.rating, s.favourite, s.highlights])]));
  const reset = (s) => ({
    ...s, opens: 0, reads: 0, skims: 0, seconds: 0, maxProgress: 0, firstOpened: null, lastOpened: null,
    ...(has.rate.has(s.id) ? { rating: 0 } : {}),
    ...(has.favourite.has(s.id) ? { favourite: false } : {}),
    ...(has.highlight.has(s.id) ? { highlights: [] } : {}),
  });
  const states = new Map(rows.map((s) => [s.id, reset(s)]));
  const get = (id) => { if (!states.has(id)) states.set(id, reset(db.blankState(id))); return states.get(id); };

  const visits = new Map();   // emailId -> open visit
  const close = (id, leave) => {
    const v = visits.get(id);
    if (!v) return;
    visits.delete(id);
    if (!v.counted) return;
    const s = get(id);
    const skim = leave?.skim ?? v.skim;
    const reached = v.finished || (leave?.visitMax ?? 0) >= FINISHED;
    if (skim) s.skims += 1;
    else if (reached) s.reads += 1;
    s.seconds += leave?.seconds || 0;
    s.maxProgress = Math.max(s.maxProgress, leave?.visitMax ?? leave?.maxProgress ?? (reached ? 1 : 0));
  };

  for (const ev of events) {
    const id = ev.emailId;
    const d = ev.data || {};
    switch (ev.type) {
      case 'open': {
        close(id);   // an earlier visit with no "leave" (app was killed)
        const counted = counts(ev.t);
        visits.set(id, { counted, finished: false, skim: false });
        if (counted) { const s = get(id); s.opens += 1; s.firstOpened ||= ev.t; s.lastOpened = ev.t; }
        break;
      }
      case 'finish': if (visits.has(id)) visits.get(id).finished = true; break;
      case 'skim': if (visits.has(id)) { visits.get(id).skim = !!d.on; if (d.finished) visits.get(id).finished = true; } break;
      case 'leave': close(id, d); break;
      case 'rate': if (!marksOff(ev.t)) get(id).rating = d.rating || 0; break;
      case 'favourite': if (!marksOff(ev.t)) get(id).favourite = !!d.on; break;
      case 'highlight':
      case 'unhighlight':
        if (!marksOff(ev.t)) {
          const s = get(id);
          const set = new Set(s.highlights);
          ev.type === 'highlight' ? set.add(d.p) : set.delete(d.p);
          s.highlights = [...set].sort((a, b) => a - b);
        }
        break;
      default:
    }
  }
  for (const id of [...visits.keys()]) close(id);

  for (const s of states.values()) {
    s.maxProgress = Math.min(1, s.maxProgress);
    if (!s.opens) s.scrollPos = 0;   // nothing counted → no "resume where you left off"
  }
  const out = [...states.values()];
  const changed = out.filter((s) => before.get(s.id) !== JSON.stringify([s.opens, s.reads, s.skims, s.seconds, s.rating, s.favourite, s.highlights])).length;
  await db.putMany('state', out);
  await load();
  return changed;
}

