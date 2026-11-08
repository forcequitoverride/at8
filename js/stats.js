// Stats: when and how you use the app, built from the activity log.
// App sessions come from app-open / app-show (start) and app-hide {seconds} (end, v5+).
// Older sessions with no app-hide are estimated from their first to last activity.
// By default, left-out periods (Data → What counts) are not shown; "Everything" shows them.
import * as db from './db.js';
import { getExclusions } from './counting.js';
import { esc, fmtMins } from './util.js';

const pad = (n) => String(n).padStart(2, '0');
const dayKey = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const keyToDate = (k) => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const wd = (d) => (d.getDay() + 6) % 7;   // Monday = 0
const timeOf = (t) => new Date(t).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
const dayLabel = (d) => d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
const mins = (s) => s / 60;
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;
const ATTACH_GAP = 60_000;          // activity up to 1 min after leaving still belongs to that session
const MAX_ESTIMATE = 2 * 3600;      // cap for sessions estimated without an end
const IDLE_GAP = 30 * 60_000;       // with no recorded end, 30 min of nothing starts a new session

export function buildSessions(events) {
  const sessions = [];
  let cur = null;
  // A session can be on screen in several stretches (a quick look at another app and back).
  // base = seconds from earlier stretches; since = when the current stretch began.
  const finishEstimate = (s) => {
    if (s.seconds == null) { s.seconds = s.base + Math.min(MAX_ESTIMATE, Math.max(s.readSecs - s.base, (new Date(s.end) - new Date(s.since)) / 1000, 0)); s.estimated = true; }
    s.closed = true;
  };
  const begin = (t) => { if (cur && !cur.closed) finishEstimate(cur); cur = { start: t, since: t, end: t, base: 0, seconds: null, closed: false, opened: new Set(), reads: 0, skims: 0, readSecs: 0 }; sessions.push(cur); };
  for (const ev of events) {
    if (ev.type === 'app-open' || ev.type === 'app-show') {
      // Back within a minute of leaving: same session continues.
      if (cur && cur.closed && new Date(ev.t) - new Date(cur.end) <= ATTACH_GAP) { cur.base = cur.seconds; cur.seconds = null; cur.closed = false; cur.since = ev.t; cur.end = ev.t; }
      else begin(ev.t);
      continue;
    }
    if (ev.type === 'app-hide') {
      if (cur && !cur.closed) { cur.seconds = cur.base + (ev.data?.seconds ?? 0); cur.end = ev.t; cur.closed = true; }
      continue;
    }
    // Any other activity: attach to the current session, or start an inferred one.
    const gap = cur ? new Date(ev.t) - new Date(cur.end) : Infinity;
    if (!cur || gap > (cur.closed ? ATTACH_GAP : IDLE_GAP)) begin(ev.t);
    if (!cur.closed && ev.t > cur.end) cur.end = ev.t;
    const d = ev.data || {};
    if (ev.type === 'open' && ev.emailId) cur.opened.add(ev.emailId);
    if (ev.type === 'leave') {
      cur.readSecs += d.seconds || 0;
      if (d.skim) cur.skims += 1;
      else if ((d.visitMax ?? 0) >= 0.95) cur.reads += 1;
    }
  }
  if (cur && !cur.closed) finishEstimate(cur);
  return sessions;
}

function summarise(sessions) {
  const days = new Map();   // dayKey -> {seconds, sessions, opened:Set, reads}
  const hours = Array.from({ length: 24 }, () => ({ seconds: 0, sessions: 0 }));
  const weekdays = Array.from({ length: 7 }, () => ({ seconds: 0, sessions: 0 }));
  for (const s of sessions) {
    const k = dayKey(s.start);
    if (!days.has(k)) days.set(k, { seconds: 0, sessions: [], opened: new Set(), reads: 0, readSecs: 0 });
    const d = days.get(k);
    d.seconds += s.seconds; d.sessions.push(s); d.reads += s.reads; d.readSecs += s.readSecs;
    s.opened.forEach((id) => d.opened.add(id));
    const at = new Date(s.start);
    hours[at.getHours()].seconds += s.seconds; hours[at.getHours()].sessions += 1;
    weekdays[wd(at)].seconds += s.seconds; weekdays[wd(at)].sessions += 1;
  }
  // Streak: consecutive days with a session, ending today (or yesterday if not opened yet today).
  let streak = 0;
  const day = new Date(); day.setHours(0, 0, 0, 0);
  if (!days.has(dayKey(day))) day.setDate(day.getDate() - 1);
  while (days.has(dayKey(day))) { streak += 1; day.setDate(day.getDate() - 1); }
  let longest = 0, run = 0, prev = null;
  for (const k of [...days.keys()].sort()) {
    const d = keyToDate(k);
    run = prev && (d - prev) / 86_400_000 < 1.5 ? run + 1 : 1;
    longest = Math.max(longest, run); prev = d;
  }
  return { days, hours, weekdays, streak, longest };
}

// Single-hue scale: 0 = empty, 1–4 = more time.
const level = (v, max) => (!v ? 0 : max <= 0 ? 1 : Math.min(4, 1 + Math.floor((v / max) * 3.999)));

function bars(items, labelAt, tipOf, name) {
  const max = Math.max(1, ...items.map((x) => x.seconds));
  return `<div class="bars" role="img" aria-label="${name}">
    ${items.map((x, i) => `<button class="bar" data-tip="${esc(tipOf(x, i))}" aria-label="${esc(tipOf(x, i))}"><i style="height:${x.seconds ? Math.max(4, (x.seconds / max) * 100) : 0}%"></i></button>`).join('')}
  </div>
  <div class="bar-axis">${items.map((x, i) => `<span>${labelAt(i) ?? ''}</span>`).join('')}</div>`;
}

function calendar(month, days) {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const count = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const inMonth = [...days.entries()].filter(([k]) => k.startsWith(`${first.getFullYear()}-${pad(first.getMonth() + 1)}`));
  const max = Math.max(0, ...inMonth.map(([, d]) => d.seconds));
  const today = dayKey(Date.now());
  let cells = '<span class="cal-blank"></span>'.repeat(wd(first));
  for (let n = 1; n <= count; n++) {
    const k = `${first.getFullYear()}-${pad(first.getMonth() + 1)}-${pad(n)}`;
    const d = days.get(k);
    const tip = d ? `${dayLabel(keyToDate(k))} · ${plural(d.sessions.length, 'session')} · ${fmtMins(mins(d.seconds))}` : `${dayLabel(keyToDate(k))} · not opened`;
    cells += `<button class="cal-day l${level(d?.seconds, max)}${k === today ? ' today' : ''}" data-day="${k}" aria-label="${esc(tip)}">${n}</button>`;
  }
  const opened = inMonth.length;
  return `<div class="cal-head">
      <button class="icon-btn" data-month="-1" aria-label="Previous month">‹</button>
      <b>${first.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })}</b>
      <button class="icon-btn" data-month="1" aria-label="Next month">›</button>
    </div>
    <div class="cal">${WEEKDAYS.map((w) => `<span class="cal-wd">${w[0]}</span>`).join('')}${cells}</div>
    <div class="cal-foot"><span>${plural(opened, 'day')} opened this month</span>
      <span class="cal-legend">Less <i class="l1"></i><i class="l2"></i><i class="l3"></i><i class="l4"></i> More</span></div>`;
}

function sessionRow(s) {
  const bits = [];
  if (s.opened.size) bits.push(plural(s.opened.size, 'email') + ' opened');
  if (s.reads) bits.push(`${s.reads} read`);
  if (s.skims) bits.push(`${s.skims} skimmed`);
  return `<div class="session"><div><b>${timeOf(s.start)}</b> <span class="muted">· ${s.estimated ? '≈ ' : ''}${fmtMins(mins(s.seconds))}</span></div>
    <small>${bits.join(' · ') || 'Browsing only'}</small></div>`;
}

function dayDetail(k, days) {
  const d = days.get(k);
  if (!d) return `<p class="hint">${dayLabel(keyToDate(k))}: the app wasn't opened.</p>`;
  return `<div class="section-title">${dayLabel(keyToDate(k))}</div>
    <p class="hint">${plural(d.sessions.length, 'session')} · ${fmtMins(mins(d.seconds))} in the app · ${fmtMins(mins(d.readSecs))} reading · ${plural(d.opened.size, 'email')} opened</p>
    ${d.sessions.slice().reverse().map(sessionRow).join('')}`;
}

let shownMonth = null;
let pickedDay = null;

export async function renderStats(root) {
  const scope = localStorage.getItem('statsScope') || 'counted';
  const [events, exclusions] = await Promise.all([db.getAll('events'), getExclusions()]);
  events.sort((a, b) => a.t.localeCompare(b.t) || a.eid - b.eid);
  const left = (t) => exclusions.some((p) => t >= p.from && (!p.to || t <= p.to));
  const shown = scope === 'all' ? events : events.filter((e) => !left(e.t));
  const sessions = buildSessions(shown);
  const { days, hours, weekdays, streak, longest } = summarise(sessions);
  const total = sessions.reduce((n, s) => n + s.seconds, 0);
  const reading = sessions.reduce((n, s) => n + s.readSecs, 0);
  const hidden = events.length - shown.length;
  if (!shownMonth) { shownMonth = new Date(); shownMonth.setDate(1); }
  if (!pickedDay) pickedDay = dayKey(Date.now());
  const since = sessions[0] ? keyToDate(dayKey(sessions[0].start)) : null;

  const hourTip = (x, i) => `${pad(i)}:00–${pad((i + 1) % 24)}:00 · ${plural(x.sessions, 'session')} · ${fmtMins(mins(x.seconds))}`;
  const wdTip = (x, i) => `${WEEKDAYS[i]} · ${plural(x.sessions, 'session')} · ${fmtMins(mins(x.seconds))}`;

  root.innerHTML = `<div class="page">
    <div class="page-head"><h1>Stats</h1><p>When and how you use the app${since ? `, since ${dayLabel(since)}` : ''}.</p></div>
    <div class="seg" role="group" aria-label="What to include">
      <button data-scope="counted" aria-pressed="${scope !== 'all'}">Counted only</button>
      <button data-scope="all" aria-pressed="${scope === 'all'}">Everything</button>
    </div>
    ${scope !== 'all' && hidden ? `<p class="hint">${hidden.toLocaleString()} activity records from left-out periods aren't shown. Change them in <a href="#/data">Data → What counts</a>.</p>` : ''}

    ${!sessions.length ? '<div class="empty"><p>No app sessions to show yet.</p></div>' : `
    <section class="card">
      <h2>Overview</h2>
      <div class="stats">
        <div class="stat"><b>${days.size}</b><span>days opened</span></div>
        <div class="stat"><b>${sessions.length}</b><span>sessions</span></div>
        <div class="stat"><b>${fmtMins(mins(total))}</b><span>in the app</span></div>
        <div class="stat"><b>${fmtMins(mins(total / sessions.length))}</b><span>per session</span></div>
        <div class="stat"><b>${fmtMins(mins(reading))}</b><span>reading</span></div>
        <div class="stat"><b>${streak}</b><span>day streak · best ${longest}</span></div>
      </div>
    </section>

    <section class="card">
      <h2>Days you opened it</h2>
      ${calendar(shownMonth, days)}
      <div id="dayDetail">${dayDetail(pickedDay, days)}</div>
    </section>

    <section class="card">
      <h2>Time of day</h2>
      <p>Time in the app by the hour each session started. Tap a bar.</p>
      ${bars(hours, (i) => (i % 6 === 0 ? pad(i) : ''), hourTip, 'Time in the app by hour of day')}
      <p class="tip" data-for="hours">&nbsp;</p>
    </section>

    <section class="card">
      <h2>Day of the week</h2>
      ${bars(weekdays, (i) => WEEKDAYS[i][0], wdTip, 'Time in the app by day of the week')}
      <p class="tip">&nbsp;</p>
    </section>

    <section class="card">
      <h2>Recent sessions</h2>
      ${[...days.keys()].sort().reverse().slice(0, 7).map((k) => `<div class="section-title">${dayLabel(keyToDate(k))}</div>${days.get(k).sessions.slice().reverse().map(sessionRow).join('')}`).join('')}
      <p class="hint" style="margin-top:10px">≈ means estimated: older sessions, from before v5, have no recorded end.</p>
    </section>`}
  </div>`;

  root.querySelectorAll('[data-scope]').forEach((b) => b.addEventListener('click', () => { localStorage.setItem('statsScope', b.dataset.scope); renderStats(root); }));
  root.querySelectorAll('[data-month]').forEach((b) => b.addEventListener('click', () => {
    shownMonth = new Date(shownMonth.getFullYear(), shownMonth.getMonth() + Number(b.dataset.month), 1);
    renderStats(root);
  }));
  root.querySelectorAll('[data-day]').forEach((b) => b.addEventListener('click', () => {
    pickedDay = b.dataset.day;
    root.querySelectorAll('.cal-day.picked').forEach((x) => x.classList.remove('picked'));
    b.classList.add('picked');
    root.querySelector('#dayDetail').innerHTML = dayDetail(pickedDay, days);
  }));
  root.querySelector(`[data-day="${pickedDay}"]`)?.classList.add('picked');
  // Tap or hover a bar: its value appears in the line under the chart.
  root.querySelectorAll('.card').forEach((card) => {
    const tip = card.querySelector('.tip');
    if (!tip) return;
    card.querySelectorAll('.bar').forEach((b) => {
      const show = () => { card.querySelectorAll('.bar.on').forEach((x) => x.classList.remove('on')); b.classList.add('on'); tip.textContent = b.dataset.tip; };
      b.addEventListener('click', show); b.addEventListener('pointerenter', show);
    });
  });
}
