import * as store from '../store.js';
import {
  inMonth, total, byCategory, dailyStrip, monthSummary, lastMonthSoFar, weekdayAverages, usualMonth, fixedCosts,
  timeOfDay, topNotes, noSpendDays, standout, billsDue,
} from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { render, openEntry } from '../app.js';
import {
  localISO, esc, safeColor, chip, monthHeader, bindMonth, emptyMonth, catOf, monthTitle, shiftMonth,
  dayGroups, dayLabel, shortDate,
} from './home.js';
import { bindRowHold } from './row-hold.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHART_W = 320;
const CHART_H = 120;
const BAR_MAX = 76; // px height of the tallest weekday bar
const SLOTS = [['🌅', 'Morning', '05–11'], ['☀️', 'Afternoon', '11–17'], ['🌆', 'Evening', '17–22'], ['🌙', 'Late night', '22–05']];
const SLOT_WHEN = ['before 11:00', 'between 11:00 and 17:00', 'after 17:00', 'after 22:00'];

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

// Daily budget left against the usual month (average of the last 3); past months say how they ended.
function safeToSpend(all, month, ym, today, fixed, s) {
  const usual = usualMonth(all, ym);
  if (!usual) return '';
  const spent = total(month);
  const bills = month.filter((e) => fixed.has(e.id));
  const billsTotal = total(bills);
  const current = s.projected !== null;
  const due = current ? total(billsDue(all, ym)) : 0;
  const left = usual - spent - due;
  const dim = dailyStrip(all, ym).length;
  const daysLeft = dim - Number(today.slice(8, 10)) + 1;
  const hero = current && left > 0
    ? `Rp ${formatNum(Math.floor(left / daysLeft / 1000) * 1000)}<small>a day</small>`
    : `Rp ${formatNum(Math.abs(left))}<small>${left >= 0 ? 'under' : 'over'}</small>`;
  const sub = current && left > 0
    ? `for the ${plural(daysLeft, 'day')} left, today included, to stay within your usual month of ${formatRp(usual)}`
    : `your usual month of ${formatRp(usual)}`;
  const scale = Math.max(usual, spent + due);
  const w = (v) => `${((v / scale) * 100).toFixed(2)}%`;
  const names = [...new Set(bills.map((e) => e.note.trim()))];
  const billLabel = names.length > 3 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  return slide('Safe to spend', `<p class="hero num">${hero}</p><p class="sub">${esc(sub)}</p>
    <div class="bud" aria-hidden="true"><i style="width:${w(billsTotal)};background:var(--tx)"></i><i style="width:${w(spent - billsTotal)};background:var(--ac)"></i>${due ? `<i class="due" style="width:${w(due)}"></i>` : ''}<b style="left:${w(usual)}"></b></div>
    <div class="bud-l">
      ${billsTotal ? `<i style="background:var(--tx)"></i><span>Bills (${esc(billLabel)})</span><span class="num">${formatNum(billsTotal)}</span>` : ''}
      <i style="background:var(--ac)"></i><span>${billsTotal ? 'Everything else' : 'Spent'}</span><span class="num">${formatNum(spent - billsTotal)}</span>
      ${due ? `<i class="due"></i><span>Bills still to come</span><span class="num">${formatNum(due)}</span>` : ''}
      <i style="background:var(--line)"></i><span>${left >= 0 ? 'Left of your usual month' : 'Over your usual month'}</span><span class="num">${formatNum(Math.abs(left))}</span>
    </div>`);
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

function timeCard(month, fixed) {
  const sums = timeOfDay(month.filter((e) => !fixed.has(e.id)));
  const sum = sums.reduce((a, b) => a + b, 0);
  if (!sum) return '';
  const max = Math.max(...sums);
  const top = sums.indexOf(max);
  const rows = SLOTS.map(([icon, name, hours], i) => `<div${i === top ? ' class="m"' : ''}>
      <span class="e" aria-hidden="true">${icon}</span><span>${name}<br><span class="t2">${hours}</span></span>
      <span class="tr" aria-hidden="true"><i style="width:${((sums[i] / max) * 100).toFixed(1)}%"></i></span><span class="p num">${pct(sums[i] / sum)}</span>
    </div>`).join('');
  return slide('Time of day', `<p class="lead"><b>${SLOTS[top][1]}s</b> cost the most: ${pct(max / sum)} of your spending happens ${SLOT_WHEN[top]}.</p>
    <div class="tod">${rows}</div>
    ${fixed.size ? '<p class="key">Bills left out</p>' : ''}`);
}

function notesCard(month, cats, ym, today, s) {
  const tops = topNotes(month);
  if (!tops.length) return '';
  const [first] = tops;
  const days = s.projected === null ? 0 : Number(today.slice(8, 10));
  const pace = days ? ` That's about ${formatRp(Math.round((first.total / days) * dailyStrip([], ym).length / 1000) * 1000)} by month end.` : '';
  const rows = tops.map((g) => `<li>${chip(catOf(cats, g.categoryId))}<span class="mid"><span class="t1">${esc(g.note)}</span><span class="t2">${g.count}× · avg ${formatRp(Math.round(g.total / g.count))}</span></span><span class="amt num">${formatNum(g.total)}</span></li>`).join('');
  return slide('Top notes', `<p class="lead"><b>${esc(first.note)}</b> ${first.count} times, ${formatRp(first.total)}.${pace}</p>
    <ul class="tn">${rows}</ul>`);
}

function noSpend(all, ym, today, fixed) {
  const prev = shiftMonth(ym, -1);
  const prevFixed = fixedCosts(all, prev);
  const r = noSpendDays(all.filter((e) => !fixed.has(e.id)), ym, today);
  const elapsed = r.spent.filter((d) => d !== null).length;
  const before = noSpendDays(all.filter((e) => !prevFixed.has(e.id)), prev, today).spent.slice(0, elapsed).filter((d) => d === false).length;
  const todayIdx = ym === today.slice(0, 7) ? Number(today.slice(8, 10)) - 1 : -1;
  const dots = r.spent.map((d, i) => `<i class="${d === null ? 'f' : d ? '' : 'z'}${i === todayIdx ? ' t' : ''}"></i>`).join('');
  return slide('No-spend days', `<p class="lead"><b>${plural(r.count, 'day')}</b> without spending. ${monName(prev)} had ${before}${todayIdx >= 0 ? ' by this day' : ''}.</p>
    <div class="nsd" aria-hidden="true">${dots}</div>
    <div class="ns-n"><div><b class="num">${r.count}</b>no-spend days</div><div><b class="num">${r.best}</b>best streak</div><div><b class="num">${r.current}</b>current streak</div></div>
    <p class="key"><span><i class="k-z"></i>No spending</span><span><i class="k-s"></i>Spent</span>${fixed.size ? '<span>Bills don’t count</span>' : ''}</p>`);
}

function standoutCard(all, ym, cats) {
  const r = standout(all, ym);
  if (!r) return '';
  const e = r.expense;
  const c = catOf(cats, e.categoryId);
  const max = e.amount * 1.06;
  const at = (v) => `${((v / max) * 100).toFixed(2)}%`;
  return slide('Stood out', `<p class="lead">One expense was far above your usual ${esc(c.name)}.</p>
    <button class="odd" type="button" data-id="${esc(e.id)}">${chip(c)}<span class="mid"><span class="t1">${esc(e.note || c.name)}</span><span class="t2">${shortDate(e.date).slice(0, -5)}</span></span><span class="amt num">${formatNum(e.amount)}</span></button>
    <div class="rng" aria-hidden="true"><b style="left:${at(r.low)};width:${at(r.high - r.low)}"></b><i style="left:${at(e.amount)}"></i></div>
    <p class="key">Usual ${esc(c.name)}: ${short(r.low)}–${short(r.high)}. This one is ${r.ratio.toFixed(1).replace('.', ',')}× typical.</p>`);
}

// The insight cards side by side; swipe or tap a dot to move. Cards with nothing to say are left out.
function carousel(all, month, cats, ym, today, state) {
  const s = monthSummary(all, ym, today);
  const fixed = fixedCosts(all, ym);
  const slides = [
    pace(all, ym, today, s), safeToSpend(all, month, ym, today, fixed, s), weekdays(all, ym, today), timeCard(month, fixed),
    notesCard(month, cats, ym, today, s), noSpend(all, ym, today, fixed), standoutCard(all, ym, cats),
  ].filter(Boolean);
  state.reportSlide = Math.min(state.reportSlide, slides.length - 1);
  return `<div class="car" role="region" aria-roledescription="carousel" aria-label="Insights">
      <div class="car-t">${slides.join('')}</div>
      <div class="dots">${slides.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Insight ${i + 1} of ${slides.length}"${i === state.reportSlide ? ' aria-current="true"' : ''}></button>`).join('')}</div>
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

  const body = !month.length ? emptyMonth() : carousel(all, month, cats, ym, today, state)
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
