// App entry: loads data, routes between views, registers the service worker.
import { load } from './store.js';
import { logEvent } from './db.js';
import { renderLibrary, rememberLibraryScroll } from './library.js';
import { renderReader } from './reader.js';
import { renderSaved } from './saved.js';
import { renderData, applyTheme } from './data.js';

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
  else if (name === 'data') { await renderData(view); window.scrollTo(0, 0); }
  else renderLibrary(view);
}

async function start() {
  applyTheme();
  await load();
  window.addEventListener('hashchange', route);
  await route();
  logEvent('app-open', null, { standalone: matchMedia('(display-mode: standalone)').matches });
  // Ask the browser to keep our data (silently granted on many installed PWAs).
  navigator.storage?.persist?.().catch(() => {});
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch((e) => console.warn('SW registration failed', e));
}

// Make sure the last reading session is saved if the app is closed mid-email.
window.addEventListener('pagehide', () => { if (cleanup) { cleanup(); cleanup = null; } });

start().catch((e) => {
  console.error(e);
  view.innerHTML = `<div class="page"><div class="empty"><p>Something went wrong starting the app.</p><p>${String(e.message || e)}</p></div></div>`;
});
