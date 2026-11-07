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
// Reading speed 200 words/min, matching the Length groups below.
export const readMinutes = (words) => Math.max(1, Math.round(words / 200));

// "4 min", "1 h 10 min", "<1 min"
export function fmtMins(mins) {
  if (mins < 1) return '<1 min';
  const m = Math.round(mins);
  if (m < 60) return `${m} min`;
  return `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`;
}
export const minsLeft = (words, progress) => (words * (1 - progress)) / 200;
export const lengthLabel = (words) => `${LENGTHS.find((l) => l.test(words)).label} · ${readMinutes(words)} min`;

// Length groups (thresholds chosen from the real emails: ~880 short / ~925 medium / ~360 long).
export const LENGTHS = [
  { v: 'short', label: 'Short', hint: 'under 1 min', test: (w) => w < 200 },
  { v: 'medium', label: 'Medium', hint: '1–3 min', test: (w) => w >= 200 && w < 600 },
  { v: 'long', label: 'Long', hint: '3+ min', test: (w) => w >= 600 },
];
export const lengthOf = (words) => LENGTHS.find((l) => l.test(words)).v;

// Your own rating ladder, separate from ★ favourite.
export const RATINGS = [
  { v: 1, label: 'Like', short: '♥' },
  { v: 2, label: 'Like very much', short: '♥♥' },
  { v: 3, label: 'Timeless', short: '∞' },
];

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
