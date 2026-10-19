import * as store from '../store.js';
import {
  inMonth, total, byCategory, dailyStrip, monthSummary, lastMonthSoFar, weekdayAverages, monthTotals,
} from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { render, openEntry } from '../app.js';
import {
  localISO, esc, safeColor, chip, monthHeader, bindMonth, emptyMonth, catOf, monthTitle, shiftMonth,
  dayGroups, dayLabel,
} from './home.js';
import { bindRowHold } from './row-hold.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHART_W = 320;
const CHART_H = 120;
const BAR_MAX = 76; // px height of the tallest weekday or month bar

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const pct = (share) => `${Math.round(share * 100) || '<1'}%`;
const monName = (ym) => monthTitle(ym).split(' ')[0];
// Compact rupiah for chart labels: 3,1 jt, 450 rb.
const short = (n) => (n >= 1e6 ? `${(n / 1e6).toFixed(1).replace('.', ',')} jt` : `${Math.round(n / 1e3)} rb`);

// Change against last month: up is spending more, so only down is marked good.
function delta(diff) {
  if (diff > 0) return `↑ ${formatNum(diff)}`;
  if (diff < 0) return `<b class="good">↓ ${formatNum(-diff)}</b>`;
  return 'Same';
}

const slide = (title, body) => `<div class="sl"><h3 class="sl-t">${title}</h3>${body}</div>`;

const running = (days) => {
  let acc = 0;
  return days.map((v) => (acc += v));
};

// --- slides ---

function pace(all, ym, today, s) {
  const prev = shiftMonth(ym, -1);
  const current = s.projected !== null;
  const days = dailyStrip(all, ym);
  const now = running(current ? days.slice(0, Number(today.slice(8, 10))) : days);
  const before = running(dailyStrip(all, prev));
  const end = current ? s.projected : now.at(-1);
  const max = Math.max(end, s.diff === null ? 0 : before.at(-1)) * 1.08 || 1;
  const span = Math.max(days.length, before.length) - 1;
  const x = (i) => ((i / span) * CHART_W).toFixed(1);
  const y = (v) => (CHART_H - (v / max) * CHART_H).toFixed(1);
  const path = (a) => a.map((v, i) => `${i ? 'L' : 'M'}${x(i)},${y(v)}`).join('');
  const last = now.length - 1;

  const spent = s.diff === null ? '' : s.diff > 0 ? `<b>Rp ${formatNum(s.diff)} more</b> than` : s.diff < 0 ? `<b class="good">Rp ${formatNum(-s.diff)} less</b> than` : 'the same as';
  const versus = current ? `${monName(prev).slice(0, 3)} 1–${today.slice(8, 10).replace(/^0/, '')}` : monName(prev);
  const lead = current
    ? `${spent ? `${spent} ${versus}. ` : ''}At this pace, about <b>Rp ${short(s.projected)}</b> by month end.`
    : spent ? `${spent.replace(/^./, (c) => c.toUpperCase())} ${versus}.` : `Rp ${formatNum(s.perDay)} a day on average.`;

  return slide('Pace', `<p class="lead">${lead}</p>
    <svg class="pc" viewBox="0 -10 ${CHART_W} ${CHART_H + 26}" aria-hidden="true">
      <line x1="0" y1="${CHART_H}" x2="${CHART_W}" y2="${CHART_H}" class="ax"/>
      ${s.diff === null ? '' : `<path d="${path(before)}" class="pv"/>`}
      <path d="${path(now)}L${x(last)},${CHART_H}L0,${CHART_H}Z" class="fl"/>
      <path d="${path(now)}" class="nw"/>
      ${current ? `<path d="M${x(last)},${y(now[last])}L${x(days.length - 1)},${y(s.projected)}" class="pj"/>` : ''}
      <circle cx="${x(last)}" cy="${y(now[last])}" r="4.5" class="dt"/>
      <text x="0" y="${CHART_H + 16}">1</text>
      ${current ? `<text x="${x(last)}" y="${CHART_H + 16}" text-anchor="middle">Today</text>` : ''}
      <text x="${x(days.length - 1)}" y="${CHART_H + 16}" text-anchor="end">${days.length}</text>
    </svg>
    <p class="key"><span><i class="k-nw"></i>${monName(ym)}</span>${s.diff === null ? '' : `<span><i class="k-pv"></i>${monName(prev)}</span>`}${current ? '<span><i class="k-pj"></i>Pace</span>' : ''}</p>`);
}

function breakdown(month, cats, s) {
  const R = 54;
  const C = 2 * Math.PI * R;
  const shares = byCategory(month);
  let off = 0;
  const arcs = shares.map((c) => {
    const len = c.share * C;
    const gap = shares.length > 1 ? 2 : 0;
    const arc = `<circle r="${R}" cx="64" cy="64" stroke="${safeColor(catOf(cats, c.categoryId).color)}" stroke-dasharray="${Math.max(0, len - gap)} ${C}" stroke-dashoffset="${-off}"/>`;
    off += len;
    return arc;
  }).join('');
  const legend = shares.slice(0, 5).map((c) => `<li><i style="background:${safeColor(catOf(cats, c.categoryId).color)}"></i><span class="n">${esc(catOf(cats, c.categoryId).name)}</span><span class="num">${pct(c.share)}</span></li>`).join('');
  const rest = shares.length > 5 ? `<li class="more">+${shares.length - 5} more below</li>` : '';
  return slide('Breakdown', `<div class="dn">
      <div class="dn-c"><svg viewBox="0 0 128 128" aria-hidden="true">${arcs}</svg>
        <span><b class="num">${short(total(month))}</b>${plural(s.count, 'expense')}</span></div>
      <ul class="dn-l">${legend}${rest}</ul>
    </div>
    <p class="key">Biggest: ${formatRp(s.biggest.amount)}${s.biggest.note ? ` · ${esc(s.biggest.note)}` : ''}</p>`);
}

function calendar(all, ym, today) {
  const days = dailyStrip(all, ym);
  const max = Math.max(...days) || 1;
  const [y, m] = ym.split('-').map(Number);
  const lead = (new Date(y, m - 1, 1).getDay() + 6) % 7; // Monday first
  const shade = (v) => `color-mix(in srgb, var(--ac) ${Math.round(14 + (v / max) * 86)}%, var(--line))`;
  const cells = days.map((v, i) => {
    const iso = `${ym}-${String(i + 1).padStart(2, '0')}`;
    if (iso > today) return `<i class="f">${i + 1}</i>`;
    const cls = [v / max > 0.45 && 'hi', iso === today && 't'].filter(Boolean).join(' ');
    return `<i${cls ? ` class="${cls}"` : ''}${v ? ` style="background:${shade(v)}"` : ''}>${i + 1}</i>`;
  }).join('');
  const busiest = days.indexOf(max);
  return slide('Calendar', `<div class="cal" aria-hidden="true">${DAYS.map((d) => `<b>${d[0]}</b>`).join('')}${'<i class="x"></i>'.repeat(lead)}${cells}</div>
    <p class="key">Busiest: ${busiest + 1} ${monName(ym).slice(0, 3)}, ${formatRp(max)}</p>`);
}

function weekdays(all, ym, today) {
  const avg = weekdayAverages(all, ym, today);
  const max = Math.max(...avg) || 1;
  const top = avg.indexOf(max);
  const bars = avg.map((v, i) => `<div${i === top ? ' class="m"' : ''}><i style="height:${Math.max(4, Math.round((v / max) * BAR_MAX))}px"></i>${DAYS[i].slice(0, 3)}</div>`).join('');
  return slide('Weekdays', `<p class="lead"><b>${DAYS[top]}s</b> cost the most, about ${formatRp(Math.round(max / 1000) * 1000)} a day.</p>
    <div class="bars" aria-hidden="true">${bars}</div>
    <p class="key">Average per day over the last 3 months</p>`);
}

function months(all, ym, s) {
  const list = monthTotals(all, ym);
  const max = Math.max(...list.map((m) => m.total), s.projected ?? 0) || 1;
  const h = (v) => Math.max(4, Math.round((v / max) * BAR_MAX));
  const bars = list.map((m) => {
    const cur = m.ym === ym;
    const ghost = cur && s.projected ? `<i class="g" style="height:${h(s.projected)}px"></i>` : '';
    return `<div${cur ? ' class="m"' : ''}><span class="num">${m.total ? short(m.total) : '–'}</span><span class="st">${ghost}<i style="height:${h(m.total)}px"></i></span>${monName(m.ym).slice(0, 3)}</div>`;
  }).join('');
  const done = list.filter((m) => m.total && !(m.ym === ym && s.projected !== null)); // a month in progress would drag it down
  const avg = done.length ? `Average month: ${formatRp(Math.round(done.reduce((t, m) => t + m.total, 0) / done.length))}` : '';
  return slide('6 months', `<div class="bars" aria-hidden="true">${bars}</div>
    <p class="key">${avg}</p>`);
}

// Pace, breakdown, calendar, weekdays and months, side by side; swipe or tap a dot to move.
function carousel(all, month, cats, ym, today, at) {
  const s = monthSummary(all, ym, today);
  const slides = [
    pace(all, ym, today, s), breakdown(month, cats, s), calendar(all, ym, today), weekdays(all, ym, today), months(all, ym, s),
  ];
  return `<div class="car" role="region" aria-roledescription="carousel" aria-label="Insights">
      <div class="car-t">${slides.join('')}</div>
      <div class="dots">${slides.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Insight ${i + 1} of ${slides.length}"${i === at ? ' aria-current="true"' : ''}></button>`).join('')}</div>
    </div>`;
}

// Tapping a category lists its expenses below the card; tapping it again closes the list.
function categoryList(month, cats, before, open, today) {
  const prev = new Map(byCategory(before).map((c) => [c.categoryId, c.total]));
  const rows = byCategory(month).map(({ categoryId, total: t, share, count }) => {
    const c = catOf(cats, categoryId);
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
    ? `<h2 class="dh rc-h">${esc(catOf(cats, open).name)}</h2>${dayGroups(items, cats, (d) => dayLabel(d, today))}`
    : '';
  return `<h2 class="dh">Categories</h2><div class="lst rc">${rows}</div>${detail}`;
}

export async function renderReports(root, state) {
  // allCategories includes deleted ones, so a share kept by a deleted category still shows its name and color.
  const [all, categories] = await Promise.all([store.liveExpenses(), store.allCategories()]);
  const today = localISO();
  const { ym } = state;
  const month = inMonth(all, ym);
  const cats = new Map(categories.map((c) => [c.id, c]));

  const body = !month.length ? emptyMonth() : carousel(all, month, cats, ym, today, state.reportSlide)
    + categoryList(month, cats, lastMonthSoFar(all, ym, today), state.reportCat, today);

  root.innerHTML = `<header class="hd rp">${monthHeader(ym, total(month))}</header>
  <section class="body">${body}</section>`;

  bindMonth(root, state);
  const list = root.querySelector('.body');
  bindRowHold(list, (id) => month.find((e) => e.id === id));
  list.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-cat], [data-id], [data-slide]');
    if (!el) return;
    if (el.dataset.slide) return track.scrollTo({ left: track.children[el.dataset.slide].offsetLeft, behavior: 'smooth' });
    if (el.dataset.id) return openEntry(month.find((e) => e.id === el.dataset.id));
    state.reportCat = el.dataset.cat === state.reportCat ? null : el.dataset.cat;
    render();
  });

  const track = root.querySelector('.car-t');
  if (!track) return;
  // A re-render (store change, month step) keeps the slide the owner was on.
  requestAnimationFrame(() => { track.scrollLeft = track.children[state.reportSlide].offsetLeft; });
  track.addEventListener('scroll', () => {
    const at = Math.round(track.scrollLeft / track.children[1].offsetLeft);
    if (at === state.reportSlide) return;
    state.reportSlide = at;
    root.querySelectorAll('.dots button').forEach((b, i) => (i === at ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }, { passive: true });
}
