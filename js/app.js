// App entry: loads data, routes between views, registers the service worker.
import { load } from './store.js';
import { logEvent } from './db.js';
import { renderLibrary, rememberLibraryScroll } from './library.js';
import { renderReader } from './reader.js';
import { renderSaved } from './saved.js';
import { renderData, applyTheme } from './data.js';
import { primeExclusions, isPaused } from './counting.js';
import { renderStats } from './stats.js';

const view = document.getElementById('view');
let cleanup = null;
let currentRoute = '';

async function route() {
  const hash = location.hash || '#/';
  if (currentRoute === '#/') rememberLibraryScroll();
  if (cleanup) { cleanup(); cleanup = null; }
  currentRoute = hash;

  const [, name, arg] = hash.match(/^#\/?([^/]*)\/?(.*)$/) || [];
  document.body.classList.toggle('reading', name === 'read');
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.tab === (name || 'library')));

  if (name === 'read') cleanup = await renderReader(view, arg);
  else if (name === 'saved') { await renderSaved(view); window.scrollTo(0, 0); }
  else if (name === 'stats') { await renderStats(view); window.scrollTo(0, 0); }
  else if (name === 'data') { await renderData(view); window.scrollTo(0, 0); }
  else renderLibrary(view);
}

async function start() {
  applyTheme();
  await load();
  await primeExclusions();
  window.addEventListener('hashchange', route);
  await route();
  logEvent('app-open', null, { standalone: matchMedia('(display-mode: standalone)').matches, paused: isPaused() });
  trackSessions();
  // Ask the browser to keep our data (silently granted on many installed PWAs).
  navigator.storage?.persist?.().catch(() => {});
  if (!('serviceWorker' in navigator)) return;
  if (location.hostname === 'localhost') {
    // Dev: no offline cache, so edits show up on reload.
    (await navigator.serviceWorker.getRegistrations()).forEach((r) => r.unregister());
    (await caches.keys()).forEach((k) => caches.delete(k));
  } else navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}

// App sessions: when the app is on screen, and for how long. Logged as
// app-open / app-show (came back) and app-hide {seconds on screen since last show}.
function trackSessions() {
  let since = document.visibilityState === 'visible' ? Date.now() : null;
  const hide = () => {
    if (!since) return;
    logEvent('app-hide', null, { seconds: Math.round((Date.now() - since) / 1000) });
    since = null;
  };
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') { since = Date.now(); logEvent('app-show'); } else hide();
  });
  window.addEventListener('pagehide', hide);
}

// Make sure the last reading session is saved if the app is closed mid-email.
window.addEventListener('pagehide', () => { if (cleanup) { cleanup(); cleanup = null; } });

start().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="page"><div class="empty"><p>Something went wrong starting the app.</p><p>${String(e.message || e)}</p></div></div>`;
});
