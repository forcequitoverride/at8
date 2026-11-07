// Reader: comfortable reading view that records how you read.
import { store, stateOf, saveState, status } from './store.js';
import * as db from './db.js';
import { esc, linkify, paragraphs, fmtDate, readMinutes, toast, icon, fmtMins, minsLeft, lengthLabel, SENDER_NAME, RATINGS, LENGTHS, lengthOf } from './util.js';
import { noteHtml, noteFormHtml, wireNoteForm, wireNoteList } from './notes.js';

const FINISHED = 0.95;   // scrolled 95% of the way = read
const SIZES = [16, 17, 18, 19, 20, 22, 24, 26];

export async function renderReader(root, id) {
  const e = store.byId.get(id);
  if (!e) {
    root.innerHTML = `<div class="page"><div class="empty"><p>That email isn't on this device.</p><a class="btn" href="#/">Back to library</a></div></div>`;
    return () => {};
  }

  const st = { ...stateOf(id), highlights: [...stateOf(id).highlights] };
  st.skims ||= 0;
  const wasFinished = st.reads > 0;
  const now = new Date().toISOString();
  st.opens += 1;
  st.firstOpened ||= now;
  st.lastOpened = now;
  await saveState(st);
  db.logEvent('open', id, { from: store.lastOpenedId, opens: st.opens });
  store.lastOpenedId = id;

  const idx = store.emails.indexOf(e);
  const prev = store.emails[idx - 1];
  const next = store.emails[idx + 1];
  const nextSame = store.emails.slice(idx + 1).find((x) => x.sender === e.sender);
  const notes = (await db.getAll('notes')).filter((n) => n.emailId === id);
  const size = Number(localStorage.getItem('readerSize')) || 19;
  document.documentElement.style.setProperty('--reader-size', `${size}px`);

  let skimThisVisit = false;
  let finishedThisVisit = false;
  // Your history with this email — re-reads are shown plainly.
  const historyLine = () => {
    const parts = [];
    if (st.opens === 1 && !st.reads && !st.skims) parts.push('First time here');
    else {
      parts.push(st.reads ? `<b>Read ${st.reads === 1 ? 'once' : `${st.reads} times`}</b>` : 'Not read to the end yet');
      if (st.skims) parts.push(`skimmed ${st.skims}×`);
      parts.push(`opened ${st.opens}×`);
    }
    return parts.join(' · ');
  };
  root.innerHTML = `<div class="reader" data-sender="${e.sender}">
    <div class="readbar">
      <a class="icon-btn" href="#/" aria-label="Back to library">${icon.back}</a>
      <span class="time-left" id="timeLeft" aria-live="off"></span>
      <span class="spacer"></span>
      <button class="icon-btn" id="smaller" aria-label="Smaller text">${icon.smaller}</button>
      <button class="icon-btn" id="bigger" aria-label="Bigger text">${icon.bigger}</button>
      <button class="icon-btn" id="noteBtn" aria-label="Add a note">${icon.note}</button>
      <button class="icon-btn" id="fav" aria-label="Favourite" aria-pressed="${st.favourite}">${icon.star}</button>
      <div class="bar" id="bar"></div>
    </div>
    <article class="page">
      <header>
        <div class="meta"><span class="who">${SENDER_NAME[e.sender]}</span> · ${fmtDate(e.date)} · ${LENGTHS.find((l) => l.v === lengthOf(e.words)).label}, ${readMinutes(e.words)} min read</div>
        <h1>${esc(e.subject || '(no subject)')}</h1>
        <div class="history-row"><span class="meta" id="history">${historyLine()}</span>
          <button class="chip skim" id="skim" aria-pressed="false" title="This visit won't count as a read">Just skimming</button></div>
      </header>
      ${rateRow(st.rating)}
      <p class="hint">Tap a paragraph to highlight it.</p>
      <div class="body" id="body">${paragraphs(e.text).map((p, i) => `<p data-i="${i}" class="${st.highlights.includes(i) ? 'hl' : ''}">${linkify(p).replace(/\n/g, '<br>')}</p>`).join('')}</div>

      <div class="section-title">How did this one land?</div>
      ${rateRow(st.rating)}

      <div class="section-title">Your notes</div>
      <div class="notes" id="notes">${notes.map((n) => noteHtml(n)).join('') || '<p class="hint" id="noNotes">No notes on this email yet.</p>'}</div>
      ${noteFormHtml('What stood out? A thought, a question, a reminder…')}

      <nav class="nav-next" aria-label="More emails">
        ${prev ? `<a href="#/read/${prev.id}"><small>← Earlier · ${SENDER_NAME[prev.sender]}</small><span>${esc(prev.subject)}</span><small>${lengthLabel(prev.words)}</small></a>` : '<span></span>'}
        ${next ? `<a href="#/read/${next.id}"><small>Later · ${SENDER_NAME[next.sender]} →</small><span>${esc(next.subject)}</span><small>${lengthLabel(next.words)}</small></a>` : '<span></span>'}
        ${nextSame && nextSame !== next ? `<a class="wide" href="#/read/${nextSame.id}"><small>Next from ${SENDER_NAME[e.sender]} →</small><span>${esc(nextSame.subject)}</span><small>${lengthLabel(nextSame.words)}</small></a>` : ''}
      </nav>
    </article>
  </div>`;

  // --- reading progress -----------------------------------------------------
  const bar = root.querySelector('#bar');
  const timeLeft = root.querySelector('#timeLeft');
  let saveTimer = null;
  const progress = () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    const body = root.querySelector('#body');
    // Progress measures the email body only, not the notes below it.
    const end = body.offsetTop + body.offsetHeight - window.innerHeight;
    return end <= 0 || h <= 0 ? 1 : Math.min(1, Math.max(0, window.scrollY / end));
  };
  const onScroll = () => {
    const p = progress();
    bar.style.width = `${p * 100}%`;
    timeLeft.textContent = p >= FINISHED ? 'Finished' : `${fmtMins(minsLeft(e.words, p))} left`;
    if (p > st.maxProgress) st.maxProgress = p;
    st.scrollPos = window.scrollY;
    if (p >= FINISHED && !finishedThisVisit) {
      finishedThisVisit = true;
      if (!skimThisVisit) {
        st.reads += 1;
        db.logEvent('finish', id, { reads: st.reads });
        toast(st.reads === 1 ? 'Marked as read' : `Read ${st.reads} times now`);
        root.querySelector('#history').innerHTML = historyLine();
      }
    }
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveState(st), 800);
  };

  // Resume where you left off if it was never finished.
  requestAnimationFrame(() => {
    if (!wasFinished && st.scrollPos > 200) { window.scrollTo(0, st.scrollPos); toast('Resumed where you left off'); }
    else window.scrollTo(0, 0);
    onScroll();
  });
  window.addEventListener('scroll', onScroll, { passive: true });

  // --- time spent (only while the screen is visible) -------------------------
  let visibleSince = document.visibilityState === 'visible' ? Date.now() : null;
  const flushTime = () => {
    if (visibleSince) { st.seconds += Math.round((Date.now() - visibleSince) / 1000); visibleSince = null; }
  };
  const onVisibility = () => {
    if (document.visibilityState === 'visible') visibleSince = Date.now();
    else { flushTime(); saveState(st); }
  };
  document.addEventListener('visibilitychange', onVisibility);
  const startSeconds = st.seconds;

  // --- actions --------------------------------------------------------------
  root.querySelector('#body').addEventListener('click', (ev) => {
    if (ev.target.closest('a')) return;
    const p = ev.target.closest('p[data-i]');
    if (!p) return;
    const i = Number(p.dataset.i);
    const on = !st.highlights.includes(i);
    st.highlights = on ? [...st.highlights, i].sort((a, b) => a - b) : st.highlights.filter((x) => x !== i);
    p.classList.toggle('hl', on);
    saveState(st);
    db.logEvent(on ? 'highlight' : 'unhighlight', id, { p: i });
  });

  root.querySelector('#fav').addEventListener('click', (ev) => {
    st.favourite = !st.favourite;
    ev.currentTarget.setAttribute('aria-pressed', st.favourite);
    saveState(st);
    db.logEvent('favourite', id, { on: st.favourite });
    toast(st.favourite ? 'Added to favourites' : 'Removed from favourites');
  });

  // "Just skimming": this visit counts as a skim, not a read — even if you reach the end.
  root.querySelector('#skim').addEventListener('click', (ev) => {
    skimThisVisit = !skimThisVisit;
    ev.currentTarget.setAttribute('aria-pressed', skimThisVisit);
    if (skimThisVisit) {
      st.skims += 1;
      if (finishedThisVisit) st.reads = Math.max(0, st.reads - 1);   // undo this visit's read
    } else {
      st.skims = Math.max(0, st.skims - 1);
      if (finishedThisVisit) st.reads += 1;
    }
    root.querySelector('#history').innerHTML = historyLine();
    saveState(st);
    db.logEvent('skim', id, { on: skimThisVisit });
    toast(skimThisVisit ? 'Counted as a skim, not a read' : 'Counting this as a proper read again');
  });

  // Rating ladder: tap a level to set it, tap the current level again to clear.
  root.querySelectorAll('.rate button').forEach((b) => b.addEventListener('click', () => {
    const v = Number(b.dataset.v);
    st.rating = st.rating === v ? 0 : v;
    root.querySelectorAll('.rate button').forEach((x) => x.setAttribute('aria-pressed', Number(x.dataset.v) === st.rating));
    saveState(st);
    db.logEvent('rate', id, { rating: st.rating });
    toast(st.rating ? `Rated: ${RATINGS[st.rating - 1].label}` : 'Rating cleared');
  }));

  const setSize = (d) => {
    const cur = Number(localStorage.getItem('readerSize')) || 19;
    const i = Math.max(0, Math.min(SIZES.length - 1, SIZES.indexOf(SIZES.reduce((a, b) => (Math.abs(b - cur) < Math.abs(a - cur) ? b : a))) + d));
    localStorage.setItem('readerSize', SIZES[i]);
    document.documentElement.style.setProperty('--reader-size', `${SIZES[i]}px`);
  };
  root.querySelector('#smaller').addEventListener('click', () => setSize(-1));
  root.querySelector('#bigger').addEventListener('click', () => setSize(1));
  const noteForm = root.querySelector('[data-note-form]');
  root.querySelector('#noteBtn').addEventListener('click', () => {
    noteForm.scrollIntoView({ behavior: 'smooth', block: 'center' });
    noteForm.querySelector('textarea').focus({ preventScroll: true });
  });
  wireNoteForm(noteForm, {
    emailId: id,
    getProgress: progress,
    onSaved: (note) => {
      root.querySelector('#noNotes')?.remove();
      root.querySelector('#notes').insertAdjacentHTML('beforeend', noteHtml(note));
    },
  });
  wireNoteList(root.querySelector('#notes'));

  // Cleanup when leaving this email.
  return () => {
    window.removeEventListener('scroll', onScroll);
    document.removeEventListener('visibilitychange', onVisibility);
    clearTimeout(saveTimer);
    flushTime();
    saveState(st);
    db.logEvent('leave', id, { seconds: st.seconds - startSeconds, maxProgress: Math.round(st.maxProgress * 100) / 100, status: status(id), skim: skimThisVisit });
  };
}

function rateRow(rating = 0) {
  return `<div class="rate" role="group" aria-label="Your rating">${RATINGS.map((r) =>
    `<button data-v="${r.v}" aria-pressed="${rating === r.v}"><b>${r.short}</b>${r.label}</button>`).join('')}</div>`;
}
