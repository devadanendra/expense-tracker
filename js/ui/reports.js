import * as store from '../store.js';
import {
  inMonth, total, byCategory, dailyStrip, monthSummary, lastMonthSoFar, weekdayAverages, usualMonth, fixedCosts,
  topNotes, standout, billsDue,
} from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { render, openEntry } from '../app.js';
import {
  localISO, esc, safeColor, chip, monthHeader, bindMonth, emptyMonth, catOf, monthTitle, shiftMonth,
  dayGroups, dayLabel, shortDate,
} from './home.js';
import { bindRowHold } from './row-hold.js';
import { openSheet } from './settings.js';
import { icon } from '../icons.js';

const DAYS = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
const CHART_W = 320;
const CHART_H = 120;
const BAR_MAX = 76; // px height of the tallest weekday bar

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

// Details sheet pieces: label/value rows (falsy pairs skipped), a section heading, a plain note.
const rows = (pairs) => `<dl class="rd">${pairs.filter(Boolean).map(([k, v]) => `<dt>${k}</dt><dd class="num">${v}</dd>`).join('')}</dl>`;
const head = (text) => `<h3 class="rd-h">${text}</h3>`;
const note = (text) => `<p class="ce-txt">${text}</p>`;
const dayMon = (iso) => shortDate(iso).slice(0, -5);

const running = (days) => {
  let acc = 0;
  return days.map((v) => (acc += v));
};

// --- insights: each returns { title, card, detail() }, or null when it has nothing to say ---

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

  const card = `<p class="lead">${lead}</p>
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
    <p class="key"><span><i class="k-nw"></i>${monName(ym)}</span>${s.diff === null ? '' : `<span><i class="k-pv"></i>${monName(prev)}</span>`}${current ? '<span><i class="k-pj"></i>Pace</span>' : ''}</p>`;

  const detail = () => {
    const biggest = now.map((_, i) => [days[i], i]).filter(([v]) => v).sort((a, b) => b[0] - a[0]).slice(0, 3);
    return head(current ? `${monName(ym)} so far` : monName(ym)) + rows([
      ['Spent', formatRp(now[last])],
      ['Days', now.length],
      ['Per day', formatRp(s.perDay)],
      current && [`At this pace by ${monName(ym).slice(0, 3)} ${days.length}`, `<b>${formatRp(s.projected)}</b>`],
    ]) + (s.diff === null ? '' : head(versus) + rows([
      ['Spent', formatRp(now[last] - s.diff)],
      ['Difference', delta(s.diff)],
      current && [`All of ${monName(prev)}`, formatRp(before.at(-1))],
    ])) + head('Biggest days') + rows(biggest.map(([v, i]) => [dayMon(`${ym}-${String(i + 1).padStart(2, '0')}`), formatRp(v)]))
      + (current ? note('At this pace = spent so far ÷ days so far × days in the month.') : '');
  };
  return { title: 'Pace', card, detail };
}

// Daily budget left against the usual month (average of the last 3); past months say how they ended.
function safeToSpend(all, month, ym, today, fixed, s) {
  const u = usualMonth(all, ym);
  if (!u) return null;
  const usual = u.average;
  const spent = total(month);
  const bills = month.filter((e) => fixed.has(e.id));
  const billsTotal = total(bills);
  const current = s.projected !== null;
  const dueList = current ? billsDue(all, ym) : [];
  const due = total(dueList);
  const left = usual - spent - due;
  const dim = dailyStrip(all, ym).length;
  const daysLeft = dim - Number(today.slice(8, 10)) + 1;
  const perDay = Math.floor(left / daysLeft / 1000) * 1000;
  const hero = current && left > 0
    ? `Rp ${formatNum(perDay)}<small>a day</small>`
    : `Rp ${formatNum(Math.abs(left))}<small>${left >= 0 ? 'under' : 'over'}</small>`;
  const sub = current && left > 0
    ? `for the ${plural(daysLeft, 'day')} left, today included, to stay within your usual month of ${formatRp(usual)}`
    : `your usual month of ${formatRp(usual)}`;
  const scale = Math.max(usual, spent + due);
  const w = (v) => `${((v / scale) * 100).toFixed(2)}%`;
  const names = [...new Set(bills.map((e) => e.note.trim()))];
  const billLabel = names.length > 3 ? `${names.slice(0, 2).join(', ')} +${names.length - 2}` : names.join(', ');
  const card = `<p class="hero num">${hero}</p><p class="sub">${esc(sub)}</p>
    <div class="bud" aria-hidden="true"><i style="width:${w(billsTotal)};background:var(--tx)"></i><i style="width:${w(spent - billsTotal)};background:var(--ac)"></i>${due ? `<i class="due" style="width:${w(due)}"></i>` : ''}<b style="left:${w(usual)}"></b></div>
    <div class="bud-l">
      ${billsTotal ? `<i style="background:var(--tx)"></i><span>Bills (${esc(billLabel)})</span><span class="num">${formatNum(billsTotal)}</span>` : ''}
      <i style="background:var(--ac)"></i><span>${billsTotal ? 'Everything else' : 'Spent'}</span><span class="num">${formatNum(spent - billsTotal)}</span>
      ${due ? `<i class="due"></i><span>Bills still to come</span><span class="num">${formatNum(due)}</span>` : ''}
      <i style="background:var(--line)"></i><span>${left >= 0 ? 'Left of your usual month' : 'Over your usual month'}</span><span class="num">${formatNum(Math.abs(left))}</span>
    </div>`;

  const detail = () => head('Your usual month')
    + rows([...u.months.map((m) => [monthTitle(m.ym), formatRp(m.total)]), ['Average', `<b>${formatRp(usual)}</b>`]])
    + note(`The average of the last ${plural(u.months.length, 'month')} with any spending, bills included.`)
    + head(current ? `${monName(ym)} so far` : monName(ym)) + rows([
      ['Usual month', formatRp(usual)],
      ['Spent', `− ${formatRp(spent)}`],
      due && ['Bills still to come', `− ${formatRp(due)}`],
      [left >= 0 ? 'Left' : 'Over', `<b>${formatRp(Math.abs(left))}</b>`],
      current && left > 0 && [`÷ ${plural(daysLeft, 'day')} left`, `<b>${formatRp(perDay)} a day</b>`],
    ])
    + (bills.length || dueList.length ? head('Bills') + rows([
      ...bills.map((e) => [`${esc(e.note)} · ${dayMon(e.date)}`, formatRp(e.amount)]),
      ...dueList.map((e) => [`${esc(e.note)} · due around ${Number(e.date.slice(8, 10))}`, formatRp(e.amount)]),
    ]) + note('A bill is an expense with the same amount, category and note once a month for 3 months, on about the same date.') : '');
  return { title: 'Safe to spend', card, detail };
}

function weekdays(all, ym, today) {
  const avg = weekdayAverages(all, ym, today);
  const max = Math.max(...avg) || 1;
  const top = avg.indexOf(max);
  const bars = avg.map((v, i) => `<div${i === top ? ' class="m"' : ''}><i style="height:${Math.max(4, Math.round((v / max) * BAR_MAX))}px"></i>${DAYS[i].slice(0, 3)}</div>`).join('');
  const card = `<p class="lead"><b>${DAYS[top]}s</b> cost the most, about ${formatRp(Math.round(max / 1000) * 1000)} a day.</p>
    <div class="bars" aria-hidden="true">${bars}</div>
    <p class="key">Average per day over the last 3 months</p>`;
  const mean = (a) => Math.round(a.reduce((t, v) => t + v, 0) / a.length);
  const detail = () => rows(avg.map((v, i) => [DAYS[i], i === top ? `<b>${formatRp(v)}</b>` : formatRp(v)]))
    + head('Weekdays and weekends') + rows([['Monday to Friday', `${formatRp(mean(avg.slice(0, 5)))} a day`], ['Saturday and Sunday', `${formatRp(mean(avg.slice(5)))} a day`]])
    + note('What each day of the week costs on average over the last 3 months, up to today. Days with nothing spent count too.');
  return { title: 'Weekdays', card, detail };
}

function notesCard(month, cats, ym, today, s) {
  const tops = topNotes(month);
  if (!tops.length) return null;
  const [first] = tops;
  const days = s.projected === null ? 0 : Number(today.slice(8, 10));
  const pace = days ? ` That's about ${formatRp(Math.round((first.total / days) * dailyStrip([], ym).length / 1000) * 1000)} by month end.` : '';
  const list = (gs) => `<ul class="tn">${gs.map((g) => `<li>${chip(catOf(cats, g.categoryId))}<span class="mid"><span class="t1">${esc(g.note)}</span><span class="t2">${g.count}× · avg ${formatRp(Math.round(g.total / g.count))}</span></span><span class="amt num">${formatNum(g.total)}</span></li>`).join('')}</ul>`;
  const card = `<p class="lead"><b>${esc(first.note)}</b> ${first.count} times, ${formatRp(first.total)}.${pace}</p>${list(tops)}`;
  const detail = () => list(topNotes(month, 10)) + note('Notes you used more than once this month, most often first. Capitals and extra spaces are ignored.');
  return { title: 'Top notes', card, detail };
}

function standoutCard(all, ym, cats) {
  const r = standout(all, ym);
  if (!r) return null;
  const e = r.expense;
  const c = catOf(cats, e.categoryId);
  const max = e.amount * 1.06;
  const at = (v) => `${((v / max) * 100).toFixed(2)}%`;
  const open = `${chip(c)}<span class="mid"><span class="t1">${esc(e.note || c.name)}</span><span class="t2">${dayMon(e.date)}</span></span><span class="amt num">${formatNum(e.amount)}</span>`;
  const card = `<p class="lead">One expense was far above your usual ${esc(c.name)}.</p>
    <button class="odd" type="button" data-id="${esc(e.id)}">${open}</button>
    <div class="rng" aria-hidden="true"><b style="left:${at(r.low)};width:${at(r.high - r.low)}"></b><i style="left:${at(e.amount)}"></i></div>
    <p class="key">Usual ${esc(c.name)}: ${short(r.low)}–${short(r.high)}. This one is ${r.ratio.toFixed(1).replace('.', ',')}× typical.</p>`;
  const detail = () => `<button class="odd" type="button" data-id="${esc(e.id)}">${open}</button>`
    + head(`Your usual ${esc(c.name)}`) + rows([
      ['Typical expense', formatRp(r.median)],
      ['Middle half', `${formatRp(r.low)} – ${formatRp(r.high)}`],
      ['This one', `<b>${r.ratio.toFixed(1).replace('.', ',')}× typical</b>`],
    ])
    + note(`Compared with your ${r.count} ${esc(c.name)} expenses in the 3 months before. Shown when one is at least 3× the typical one. Tap it to edit.`);
  return { title: 'Stood out', card, detail };
}

// The insight cards side by side; swipe or tap a dot to move. A copy of the last card before the
// first and of the first after the last let a swipe past either end land on the other. Tap a card
// for its details.
function carousel(all, month, cats, ym, today, state) {
  const s = monthSummary(all, ym, today);
  const fixed = fixedCosts(all, ym);
  const insights = [
    pace(all, ym, today, s), safeToSpend(all, month, ym, today, fixed, s), weekdays(all, ym, today),
    notesCard(month, cats, ym, today, s), standoutCard(all, ym, cats),
  ].filter(Boolean);
  state.reportSlide = Math.min(state.reportSlide, insights.length - 1);
  const card = (ins, i, copy) => `<div class="sl" data-insight="${i}"${copy ? ' aria-hidden="true" inert' : ''}>
      <h3 class="sl-t">${ins.title}<button class="sl-m" type="button" data-insight="${i}" aria-label="${ins.title} details">Details${icon('chevron-right')}</button></h3>
      ${ins.card}
    </div>`;
  const html = `<div class="car" role="region" aria-roledescription="carousel" aria-label="Insights">
      <div class="car-t">${card(insights.at(-1), insights.length - 1, true)}${insights.map((ins, i) => card(ins, i)).join('')}${card(insights[0], 0, true)}</div>
      <div class="dots">${insights.map((_, i) => `<button type="button" data-slide="${i}" aria-label="Insight ${i + 1} of ${insights.length}"${i === state.reportSlide ? ' aria-current="true"' : ''}></button>`).join('')}</div>
    </div>`;
  return { html, insights };
}

function openDetail(ins, month) {
  const dlg = openSheet(ins.title, `<div class="rdt">${ins.detail()}</div>`);
  dlg.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-id]');
    if (!el) return;
    dlg.close();
    openEntry(month.find((e) => e.id === el.dataset.id));
  });
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

  const car = month.length ? carousel(all, month, cats, ym, today, state) : null;
  const body = !car ? emptyMonth() : car.html + categoryList(month, cats, lastMonthSoFar(all, ym, today), state.reportCat, today);

  root.innerHTML = `<header class="hd rp">${monthHeader(ym, total(month))}</header>
  <section class="body">${body}</section>`;

  bindMonth(root, state);
  const list = root.querySelector('.body');
  const track = root.querySelector('.car-t');
  // Scroll offset of insight i, at track child i + 1 after the copy of the last card. The track's
  // left padding is its scroll-padding, so child 0 sits at 0.
  const offset = (i) => track.children[i + 1].offsetLeft - track.children[0].offsetLeft;
  bindRowHold(list, (id) => month.find((e) => e.id === id));
  list.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-cat], [data-id], [data-slide], [data-insight]');
    if (!el) return;
    if (el.dataset.slide) return track.scrollTo({ left: offset(Number(el.dataset.slide)), behavior: 'smooth' });
    if (el.dataset.id) return openEntry(month.find((e) => e.id === el.dataset.id));
    if (el.dataset.insight) return openDetail(car.insights[el.dataset.insight], month);
    state.reportCat = el.dataset.cat === state.reportCat ? null : el.dataset.cat;
    render();
  });
  if (!track) return;

  const n = car.insights.length;
  // Track child on show: 0 is the copy of the last card, n + 1 the copy of the first.
  const at = () => Math.round(track.scrollLeft / (offset(0) || 1));
  // A re-render (store change, month step) keeps the slide the owner was on. Set once the track has
  // a width: a page change swaps the view in a frame or more later.
  const start = new ResizeObserver(() => {
    if (!track.clientWidth) return;
    start.disconnect();
    track.scrollLeft = offset(state.reportSlide);
  });
  start.observe(track);
  // Settled on a copy: swap in the real card, which looks the same. scrollend, with a quiet-scroll
  // timer as backup in case it never fires.
  let settle;
  const wrap = () => {
    const k = at();
    if (k <= 0) track.scrollTo({ left: offset(n - 1), behavior: 'instant' });
    else if (k > n) track.scrollTo({ left: offset(0), behavior: 'instant' });
  };
  track.addEventListener('scrollend', wrap);
  track.addEventListener('scroll', () => {
    clearTimeout(settle);
    settle = setTimeout(wrap, 150);
    const i = (at() + n - 1) % n;
    if (i === state.reportSlide) return;
    state.reportSlide = i;
    root.querySelectorAll('.dots button').forEach((b, k) => (k === i ? b.setAttribute('aria-current', 'true') : b.removeAttribute('aria-current')));
  }, { passive: true });
}
