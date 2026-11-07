export const SENDER_NAME = { tate: 'Andrew Tate', zarak: 'Zarak' };

export function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// Escape, then turn bare URLs into links.
export function linkify(s) {
  return esc(s).replace(/\bhttps?:\/\/[^\s<]+[^\s<.,;:!?)\]'"]/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`);
}

export function paragraphs(text) {
  return text.split(/\n{2,}/).map((p) => p.split('\n').map((l) => l.replace(/^\* /, '• ')).join('\n'));
}

const DATE_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
const MONTH_FMT = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });
const DATETIME_FMT = new Intl.DateTimeFormat(undefined, { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const fmtDate = (iso) => DATE_FMT.format(new Date(iso));
export const fmtMonth = (iso) => MONTH_FMT.format(new Date(iso));
export const fmtDateTime = (iso) => DATETIME_FMT.format(new Date(iso));
export const monthKey = (iso) => iso.slice(0, 7);
export const readMinutes = (words) => Math.max(1, Math.round(words / 230));

export function toast(msg, ms = 2400) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), ms);
}

export function debounce(fn, ms) {
  let t;
  return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}

export const icon = {
  back: '<svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3.5l2.6 5.3 5.8.8-4.2 4.1 1 5.8L12 16.8l-5.2 2.7 1-5.8L3.6 9.6l5.8-.8z"/></svg>',
  smaller: '<svg viewBox="0 0 24 24"><path d="M4 18l4-11 4 11M5.5 14h5M15 12h6"/></svg>',
  bigger: '<svg viewBox="0 0 24 24"><path d="M3 19l5-14 5 14M5 14h6M15 12h7M18.5 8.5v7"/></svg>',
  note: '<svg viewBox="0 0 24 24"><path d="M5 4h10l4 4v12H5zM14 4v5h5M8 13h8M8 17h5"/></svg>',
};
