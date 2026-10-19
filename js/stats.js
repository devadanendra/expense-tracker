// Pure aggregations. Dates stay 'YYYY-MM-DD' strings (no timezone math); `deleted` is always ignored.
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

const live = (expenses) => expenses.filter((e) => !e.deleted);
const pad = (n) => String(n).padStart(2, '0');

function daysInMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function prevMonth(ym) {
  const [y, m] = ym.split('-').map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${pad(m - 1)}`;
}

export const inMonth = (expenses, ym) => live(expenses).filter((e) => e.date.startsWith(`${ym}-`));

export const total = (expenses) => live(expenses).reduce((s, e) => s + e.amount, 0);

export function byDay(expenses) {
  const days = new Map();
  for (const e of live(expenses)) {
    if (!days.has(e.date)) days.set(e.date, { date: e.date, total: 0, items: [] });
    const d = days.get(e.date);
    d.total += e.amount;
    d.items.push(e);
  }
  for (const d of days.values()) d.items.sort((a, b) => b.time.localeCompare(a.time));
  return [...days.values()].sort((a, b) => b.date.localeCompare(a.date));
}

export function byCategory(expenses) {
  const sums = new Map();
  const all = live(expenses);
  for (const e of all) {
    const c = sums.get(e.categoryId) ?? { total: 0, count: 0 };
    c.total += e.amount;
    c.count++;
    sums.set(e.categoryId, c);
  }
  const grand = total(all);
  return [...sums]
    .map(([categoryId, c]) => ({ categoryId, ...c, share: grand ? c.total / grand : 0 }))
    .sort((a, b) => b.total - a.total);
}

export function dailyStrip(expenses, ym) {
  const strip = new Array(daysInMonth(ym)).fill(0);
  for (const e of inMonth(expenses, ym)) strip[Number(e.date.slice(8, 10)) - 1] += e.amount;
  return strip;
}

export function compareToLastMonth(expenses, todayISO) {
  const ym = todayISO.slice(0, 7);
  const d = Number(todayISO.slice(8, 10));
  const prev = prevMonth(ym);
  const upTo = (month, day) => total(
    inMonth(expenses, month).filter((e) => e.date <= `${month}-${pad(day)}`),
  );
  return { diff: upTo(ym, d) - upTo(prev, Math.min(d, daysInMonth(prev))) };
}

// Days of ym seen so far: all of a past month, up to today in the current one, none in a future one.
function daysElapsed(ym, todayISO) {
  const thisYm = todayISO.slice(0, 7);
  if (ym > thisYm) return 0;
  return ym === thisYm ? Number(todayISO.slice(8, 10)) : daysInMonth(ym);
}

// The month before ym over the same days, so a month in progress is not compared to a whole one.
export function lastMonthSoFar(expenses, ym, todayISO) {
  const prev = prevMonth(ym);
  const cut = `${prev}-${pad(Math.min(daysElapsed(ym, todayISO), daysInMonth(prev)))}`;
  return inMonth(expenses, prev).filter((e) => e.date <= cut);
}

// Headline numbers for the reports tab. projected is the month-end total at the current
// daily pace, set only for the month in progress; diff is null when last month has nothing to compare.
export function monthSummary(expenses, ym, todayISO) {
  const month = inMonth(expenses, ym);
  const t = total(month);
  const days = daysElapsed(ym, todayISO);
  const current = ym === todayISO.slice(0, 7);
  const before = lastMonthSoFar(expenses, ym, todayISO);
  return {
    count: month.length,
    perDay: days ? Math.round(t / days) : 0,
    biggest: month.reduce((b, e) => (!b || e.amount > b.amount ? e : b), null),
    diff: before.length ? t - total(before) : null,
    projected: current ? Math.round((t / days) * daysInMonth(ym)) : null,
  };
}

// Average spend per weekday (0 = Monday) over `months` months ending with ym, days after today left out.
export function weekdayAverages(expenses, ym, todayISO, months = 3) {
  const sums = new Array(7).fill(0);
  const days = new Array(7).fill(0);
  for (let k = 0, m = ym; k < months; k++, m = prevMonth(m)) {
    dailyStrip(expenses, m).forEach((v, i) => {
      const iso = `${m}-${pad(i + 1)}`;
      if (iso > todayISO) return;
      const [y, mo, d] = iso.split('-').map(Number);
      const wd = (new Date(Date.UTC(y, mo - 1, d)).getUTCDay() + 6) % 7;
      sums[wd] += v;
      days[wd]++;
    });
  }
  return sums.map((t, i) => (days[i] ? Math.round(t / days[i]) : 0));
}

// Totals of the n months ending with ym, oldest first.
export function monthTotals(expenses, ym, n = 6) {
  const out = [];
  for (let k = 0, m = ym; k < n; k++, m = prevMonth(m)) out.unshift({ ym: m, total: total(inMonth(expenses, m)) });
  return out;
}

// Expenses worth re-adding with one tap: each amount + category + note (case and spaces ignored)
// entered more than once, most repeated first, then most recent. Keeps the latest note's spelling.
export function quickPicks(expenses, n = 8) {
  const groups = new Map();
  for (const e of live(expenses)) {
    const note = (e.note ?? '').trim();
    const k = `${e.amount}|${e.categoryId}|${note.toLowerCase()}`;
    const at = `${e.date} ${e.time}`;
    const g = groups.get(k) ?? { count: 0, at: '', pick: null };
    g.count++;
    if (at >= g.at) Object.assign(g, { at, pick: { amount: e.amount, categoryId: e.categoryId, note } });
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || b.at.localeCompare(a.at))
    .slice(0, n)
    .map((g) => ({ ...g.pick, count: g.count }));
}
