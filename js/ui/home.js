import * as store from '../store.js';
import { inMonth, total, byDay, dailyStrip, compareToLastMonth } from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { DEFAULT_CATEGORIES, OTHER_ID } from '../categories.js';
import { icon } from '../icons.js';
import { openEntry, startRestore, render } from '../app.js';

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August',
  'September', 'October', 'November', 'December'];
const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const FALLBACK_CAT = DEFAULT_CATEGORIES.find((c) => c.id === OTHER_ID);

const pad = (n) => String(n).padStart(2, '0');
const parts = (iso) => iso.split('-').map(Number);

// --- date helpers (local time; exported for tests) ---

export const localISO = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

export function shiftMonth(ym, n) {
  const [y, m] = parts(ym);
  return localISO(new Date(y, m - 1 + n, 1)).slice(0, 7);
}

export const monthTitle = (ym) => `${MONTHS[parts(ym)[1] - 1]} ${parts(ym)[0]}`;

export function dayLabel(iso, todayISO) {
  const [y, m, d] = parts(iso);
  const day = `${DAYS[new Date(y, m - 1, d).getDay()]} ${d}`;
  if (iso === todayISO) return `Today · ${day}`;
  const [ty, tm, td] = parts(todayISO);
  if (iso === localISO(new Date(ty, tm - 1, td - 1))) return `Yesterday · ${day}`;
  return `${day} ${MONTHS[m - 1].slice(0, 3)}`;
}

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// --- pieces ---

function compareLine(expenses, ym, today) {
  if (ym !== today.slice(0, 7)) return '';
  const { diff } = compareToLastMonth(expenses, today);
  if (diff < 0) return `<b class="good">↓ ${formatRp(-diff)}</b> vs last month`;
  if (diff > 0) return `↑ ${formatRp(diff)} vs last month`;
  return '';
}

function strip(expenses, ym, today) {
  const days = dailyStrip(expenses, ym);
  const max = Math.max(...days);
  const bars = days.map((v, i) => {
    const iso = `${ym}-${pad(i + 1)}`;
    if (iso > today) return '<i class="f"></i>';
    const h = v ? Math.max(18, Math.round((v / max) * 100)) : 6; // small days stay visibly above zero
    return `<i${iso === today ? ' class="t"' : ''} style="height:${h}%"></i>`;
  }).join('');

  // Scale: month start and end, plus "Today" under today's bar (replacing an edge label it would hit).
  const mon = MONTHS[parts(ym)[1] - 1].slice(0, 3);
  const n = days.length;
  const d = ym === today.slice(0, 7) ? parts(today)[2] : 0;
  const nearStart = d && d <= 4;
  const nearEnd = d && d > n - 4;
  let todayTag = '';
  if (d) {
    const pos = nearStart ? 'left:0' : nearEnd ? 'right:0' : `left:${(((d - 0.5) / n) * 100).toFixed(2)}%;transform:translateX(-50%)`;
    todayTag = `<span class="sc-today" style="${pos}">Today</span>`;
  }
  return `<div class="strip" aria-hidden="true">${bars}</div>
    <div class="sc" aria-hidden="true"><span>${nearStart ? '' : `${mon} 1`}</span>${todayTag}<span>${nearEnd ? '' : `${mon} ${n}`}</span></div>`;
}

function row(e, cats) {
  const c = cats.get(e.categoryId) ?? FALLBACK_CAT;
  return `<button class="row" type="button" data-id="${esc(e.id)}">
    <span class="chip" style="background:${esc(c.color)}">${icon(c.icon)}</span>
    <span class="mid"><span class="t1">${esc(e.note || c.name)}</span><span class="t2">${esc(c.name)} · ${esc(e.time)}</span></span>
    <span class="amt num">${formatNum(e.amount)}</span>
  </button>`;
}

const restoreCard = () => `<div class="card restore">
    <div class="ring">${icon('cloud')}</div>
    <h2>Restore your data</h2>
    <p>Have a Google Sheet backup? Restore it in two taps.</p>
    <div class="btns">
      <button class="btn primary" type="button" data-act="restore">Restore</button>
      <button class="btn" type="button" data-act="fresh">Start fresh</button>
    </div>
  </div>`;

const emptyMonth = () => `<div class="empty">
    <div class="ring">${icon('inbox')}</div>
    <h2>No expenses yet</h2>
    <p>Tap + to log your first one.</p>
  </div>`;

// --- view ---

export async function renderHome(root, state) {
  const [all, categories, storeEmpty, meta] = await Promise.all([
    store.liveExpenses(), store.liveCategories(), store.isEmpty(), store.getMeta(),
  ]);
  const today = localISO();
  const { ym } = state;
  const month = inMonth(all, ym);
  const cats = new Map(categories.map((c) => [c.id, c]));
  const current = ym === today.slice(0, 7);
  const title = monthTitle(ym);

  let body;
  if (storeEmpty && !meta.linked && !state.restoreDismissed) body = restoreCard();
  else if (!month.length) body = emptyMonth();
  else {
    body = byDay(month).map((g) => `<h2 class="dh"><span>${dayLabel(g.date, today)}</span><span class="num">${formatRp(g.total)}</span></h2>
      <div class="lst">${g.items.map((e) => row(e, cats)).join('')}</div>`).join('');
  }

  root.innerHTML = `<header class="hd">
    <div class="top">
      <div class="mo">
        <h1><button class="mo-title" type="button" data-act="now"${current ? '' : ` aria-label="${title}, go to current month"`}>${title}</button></h1>
        <button class="mo-pick" type="button" data-act="pick" aria-label="Choose month">${icon('chevron-down')}</button>
        <input class="mo-input" type="month" value="${ym}" tabindex="-1" aria-hidden="true">
      </div>
      <div class="acts">
        <a class="ib" href="#/search" aria-label="Search">${icon('search')}</a>
        <a class="ib" href="#/settings" aria-label="Settings">${icon('gear')}</a>
      </div>
    </div>
    <div class="sum">
      <div>
        <p class="lbl">${current ? 'Spent this month' : `Spent in ${MONTHS[parts(ym)[1] - 1]}`}</p>
        <p class="big num"><span class="rp">Rp</span>${formatNum(total(month))}</p>
      </div>
      <div class="step">
        <button class="ib" type="button" data-act="prev" aria-label="Previous month">${icon('chevron-left')}</button>
        <button class="ib" type="button" data-act="next" aria-label="Next month">${icon('chevron-right')}</button>
      </div>
    </div>
    <p class="vs">${compareLine(all, ym, today) || '&nbsp;'}</p>
    ${strip(all, ym, today)}
  </header>
  <section class="body">${body}</section>`;

  const go = (next) => { state.ym = next; render(); };
  const picker = root.querySelector('.mo-input');
  picker.addEventListener('change', () => { if (picker.value) go(picker.value); });
  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-act], [data-id]');
    if (!el) return;
    if (el.dataset.id) return openEntry(month.find((e) => e.id === el.dataset.id));
    switch (el.dataset.act) {
      case 'now': return go(today.slice(0, 7));
      case 'prev': return go(shiftMonth(ym, -1));
      case 'next': return go(shiftMonth(ym, 1));
      case 'pick': try { picker.showPicker(); } catch { picker.focus(); picker.click(); } return;
      case 'restore': return startRestore();
      case 'fresh': state.restoreDismissed = true; return render();
    }
  });
}
