// In-memory view of the database, loaded once at start and kept in sync on writes.
import * as db from './db.js';

export const store = {
  emails: [],          // sorted oldest -> newest
  byId: new Map(),
  state: new Map(),    // id -> reading state
  lower: new Map(),    // id -> lowercase "subject \n text" for search
  lastOpenedId: null,  // for reading-path logging
};

export async function load() {
  const [emails, states] = await Promise.all([db.getAll('emails'), db.getAll('state')]);
  setEmails(emails);
  store.state = new Map(states.map((s) => [s.id, s]));
}

export function setEmails(emails) {
  emails.sort((a, b) => a.date.localeCompare(b.date));
  store.emails = emails;
  store.byId = new Map(emails.map((e) => [e.id, e]));
  store.lower = new Map(emails.map((e) => [e.id, `${e.subject}\n${e.text}`.toLowerCase()]));
}

export function stateOf(id) {
  return store.state.get(id) || db.blankState(id);
}

export async function saveState(s) {
  store.state.set(s.id, s);
  await db.put('state', s);
}

// "read" = reached the end at least once; "started" = opened but not finished.
export function status(id) {
  const s = store.state.get(id);
  if (!s || !s.opens) return 'unread';
  return s.reads > 0 ? 'read' : 'started';
}

// Ranked full-text search: every term must appear; subject hits weigh more.
export function search(query, pool) {
  const terms = query.toLowerCase().split(/\s+/).filter((t) => t.length > 1);
  if (!terms.length) return null;
  const out = [];
  for (const e of pool) {
    const hay = store.lower.get(e.id);
    let score = 0;
    let ok = true;
    for (const t of terms) {
      let n = 0;
      let i = hay.indexOf(t);
      if (i < 0) { ok = false; break; }
      while (i >= 0 && n < 50) { n++; i = hay.indexOf(t, i + t.length); }
      score += n + (e.subject.toLowerCase().includes(t) ? 8 : 0);
    }
    if (ok) out.push({ e, score });
  }
  out.sort((a, b) => b.score - a.score || b.e.date.localeCompare(a.e.date));
  return { terms, results: out.map((r) => r.e) };
}
