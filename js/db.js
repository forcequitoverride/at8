// IndexedDB storage. Everything the app knows lives here, on the phone.
// Stores:
//   emails  {id, sender, date, subject, words, text}          — imported content
//   state   {id, opens, reads, firstOpened, lastOpened, maxProgress, scrollPos,
//            favourite, highlights:[paragraphIndex], seconds}  — per-email reading state
//   notes   {nid, emailId|null, text, created}                 — your notes
//   events  {eid, t, type, emailId?, data?}                    — activity log (append-only)
//   meta    {key, value}                                       — settings, import info
const DB_NAME = 'at8-zararak';
const DB_VERSION = 1;

let dbPromise = null;

export function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('emails')) db.createObjectStore('emails', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('state')) db.createObjectStore('state', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('notes')) {
        const s = db.createObjectStore('notes', { keyPath: 'nid', autoIncrement: true });
        s.createIndex('emailId', 'emailId');
      }
      if (!db.objectStoreNames.contains('events')) db.createObjectStore('events', { keyPath: 'eid', autoIncrement: true });
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(tx) {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function result(req) {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export async function getAll(store) {
  const db = await openDb();
  return result(db.transaction(store).objectStore(store).getAll());
}

export async function get(store, key) {
  const db = await openDb();
  return result(db.transaction(store).objectStore(store).get(key));
}

export async function put(store, value) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const key = await result(tx.objectStore(store).put(value));
  await done(tx);
  return key;
}

export async function del(store, key) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  tx.objectStore(store).delete(key);
  await done(tx);
}

export async function putMany(store, values) {
  const db = await openDb();
  const tx = db.transaction(store, 'readwrite');
  const s = tx.objectStore(store);
  for (const v of values) s.put(v);
  await done(tx);
}

export async function count(store) {
  const db = await openDb();
  return result(db.transaction(store).objectStore(store).count());
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}

export function setMeta(key, value) {
  return put('meta', { key, value });
}

// Activity log — never edited, only appended. Exported for refresh sessions.
export function logEvent(type, emailId = null, data = null) {
  const ev = { t: new Date().toISOString(), type };
  if (emailId) ev.emailId = emailId;
  if (data) ev.data = data;
  return put('events', ev).catch((e) => console.warn('logEvent failed', e));
}

export function blankState(id) {
  return { id, opens: 0, reads: 0, firstOpened: null, lastOpened: null, maxProgress: 0, scrollPos: 0, favourite: false, highlights: [], seconds: 0 };
}

export async function getState(id) {
  return (await get('state', id)) || blankState(id);
}
