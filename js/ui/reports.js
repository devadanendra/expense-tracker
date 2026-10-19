import * as store from '../store.js';
import { inMonth, total, byCategory, byWeek, monthSummary, lastMonthSoFar } from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { render, openEntry } from '../app.js';
import {
  localISO, esc, safeColor, chip, monthHeader, bindMonth, emptyMonth, FALLBACK_CAT, monthTitle, shiftMonth,
  dayGroups, dayLabel, shortDate,
} from './home.js';
import { bindRowHold } from './row-hold.js';

const MODES = { categories: 'Categories', weeks: 'Weeks' };
const BAR_MAX = 72; // px height of the tallest week bar

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (share) => `${Math.round(share * 100) || '<1'}%`;
const prevName = (ym) => monthTitle(shiftMonth(ym, -1)).split(' ')[0].slice(0, 3);

// Change against last month: up is spending more, so only down is marked good.
function delta(diff) {
  if (diff > 0) return `↑ ${formatNum(diff)}`;
  if (diff < 0) return `<b class="good">↓ ${formatNum(-diff)}</b>`;
  return 'Same';
}

function summary(all, ym, today, spent) {
  const s = monthSummary(all, ym, today);
  const tile = (label, value, sub = '') => `<div class="tl"><p class="lbl">${label}</p><p class="tv num">${value}</p>${sub ? `<p class="t2">${sub}</p>` : ''}</div>`;
  const last = s.projected === null
    ? tile('Biggest', formatRp(s.biggest.amount), esc(`${s.biggest.note || 'No note'} · ${shortDate(s.biggest.date).slice(0, -5)}`))
    : tile('On pace for', formatRp(s.projected), 'by month end');
  return `<div class="tls">
    ${tile('Per day', formatRp(s.perDay), 'on average')}
    ${tile('Expenses', s.count, `${formatRp(Math.round(spent / s.count))} each`)}
    ${tile(`vs ${prevName(ym)}`, s.diff === null ? '–' : delta(s.diff),
      s.diff === null ? 'nothing logged' : s.projected === null ? 'whole month' : 'same days')}
    ${last}
  </div>`;
}

// cats includes deleted categories, so a share kept by a deleted one still shows its name and color.
// Tapping a category lists its expenses below the card; tapping it again closes the list.
function categoryList(month, cats, before, open, today) {
  const prev = new Map(byCategory(before).map((c) => [c.categoryId, c.total]));
  const nameOf = (id) => (cats.get(id) ?? { ...FALLBACK_CAT, name: id });
  const rows = byCategory(month).map(({ categoryId, total: t, share, count }) => {
    const c = nameOf(categoryId);
    return `<button class="rc-row" type="button" data-cat="${esc(categoryId)}" aria-expanded="${categoryId === open}">
      <span class="rc-top">
        ${chip(c)}
        <span class="mid"><span class="t1">${esc(c.name)}</span><span class="t2">${pct(share)} · ${plural(count, 'expense')}</span></span>
        <span class="rc-amt"><span class="amt num">${formatNum(t)}</span><span class="t2">${prev.has(categoryId) ? delta(t - prev.get(categoryId)) : 'New'}</span></span>
      </span>
      <span class="bar2" aria-hidden="true"><i style="width:${(share * 100).toFixed(2)}%;background:${safeColor(c.color)}"></i></span>
    </button>`;
  }).join('');
  const items = month.filter((e) => e.categoryId === open);
  const detail = items.length
    ? `<h2 class="dh rc-h">${esc(nameOf(open).name)}</h2>${dayGroups(items, cats, (d) => dayLabel(d, today))}`
    : '';
  return `<div class="lst rc">${rows}</div>${detail}`;
}

function weekChart(month, ym, today) {
  const weeks = byWeek(month, ym);
  const max = Math.max(...weeks.map((w) => w.total));
  const thisYm = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const future = (w) => ym > thisYm || (ym === thisYm && w.from > day);
  const bars = weeks.map((w) => {
    const cur = ym === thisYm && w.from <= day && day <= w.to;
    const h = w.total ? Math.max(6, Math.round((w.total / max) * BAR_MAX)) : 3;
    return `<div${cur ? ' class="cur"' : ''}><i${future(w) ? ' class="f"' : ` style="height:${h}px"`}></i>${w.from}–${w.to}</div>`;
  }).join('');
  const past = weeks.filter((w) => !future(w));
  const days = (w) => (ym === thisYm && w.to > day ? day : w.to) - w.from + 1;
  const list = past.length ? `<div class="lst wl">${past.map((w) => `<div class="sr">
    <span class="mid"><span class="t1">${w.label}</span><span class="t2">${plural(w.count, 'expense')} · ${formatRp(Math.round(w.total / days(w)))}/day</span></span>
    <span class="amt num">${formatRp(w.total)}</span>
  </div>`).join('')}</div>` : '';
  return `<div class="lst wkc"><div class="wk" aria-hidden="true">${bars}</div></div>${list}`;
}

export async function renderReports(root, state) {
  const [all, categories] = await Promise.all([store.liveExpenses(), store.allCategories()]);
  const today = localISO();
  const { ym } = state;
  const month = inMonth(all, ym);
  const cats = new Map(categories.map((c) => [c.id, c]));
  const mode = state.report;

  const body = !month.length ? emptyMonth() : summary(all, ym, today, total(month)) + (mode === 'weeks'
    ? weekChart(month, ym, today)
    : categoryList(month, cats, lastMonthSoFar(all, ym, today), state.reportCat, today));

  root.innerHTML = `<header class="hd rp">
    ${monthHeader(ym, total(month))}
    <div class="seg" role="group" aria-label="Report">${Object.entries(MODES).map(([k, label]) =>
      `<button id="seg-${k}" type="button" data-mode="${k}" aria-pressed="${k === mode}">${label}</button>`).join('')}
    </div>
  </header>
  <section class="body">${body}</section>`;

  bindMonth(root, state);
  root.querySelector('.seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    state.report = b.dataset.mode;
    render();
  });
  const list = root.querySelector('.body');
  bindRowHold(list, (id) => month.find((e) => e.id === id));
  list.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-cat], [data-id]');
    if (!el) return;
    if (el.dataset.id) return openEntry(month.find((e) => e.id === el.dataset.id));
    state.reportCat = el.dataset.cat === state.reportCat ? null : el.dataset.cat;
    render();
  });
}
