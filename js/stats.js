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
  const t = total(inMonth(expenses, ym));
  const days = daysElapsed(ym, todayISO);
  const current = ym === todayISO.slice(0, 7);
  const before = lastMonthSoFar(expenses, ym, todayISO);
  return {
    perDay: days ? Math.round(t / days) : 0,
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

// Average total of the up to n months before ym that have any spending, with the months it used
// (newest first); null when none do.
export function usualMonth(expenses, ym, n = 3) {
  const months = [];
  for (let k = 0, m = prevMonth(ym); k < n; k++, m = prevMonth(m)) {
    const t = total(inMonth(expenses, m));
    if (t) months.push({ ym: m, total: t });
  }
  if (!months.length) return null;
  return { average: Math.round(months.reduce((a, m) => a + m.total, 0) / months.length), months };
}

const noteKey = (e) => (e.note ?? '').trim().toLowerCase();

// Bills: expenses whose amount, category and note appear exactly once in ym and in each of the two
// months before, within 5 days of the same day of the month. A habit bought at the same price (a daily
// coffee) repeats within a month, and a one-off that happens to match lands on a random day.
// Returns the set of their ids so other insights can leave them out.
export function fixedCosts(expenses, ym) {
  const key = (e) => `${e.amount}|${e.categoryId}|${noteKey(e)}`;
  const once = (es) => {
    const seen = new Map();
    for (const e of es) if (noteKey(e)) seen.set(key(e), seen.has(key(e)) ? null : e);
    return seen;
  };
  const before = [prevMonth(ym), prevMonth(prevMonth(ym))].map((m) => once(inMonth(expenses, m)));
  const day = (e) => Number(e.date.slice(8, 10));
  const recurs = ([k, e]) => e && before.every((b) => b.get(k) && Math.abs(day(b.get(k)) - day(e)) <= 5);
  return new Set([...once(inMonth(expenses, ym))].filter(recurs).map(([, e]) => e.id));
}

// Last month's bills not yet paid in ym: what the rest of a month in progress still owes.
export function billsDue(expenses, ym) {
  const key = (e) => `${e.amount}|${e.categoryId}|${noteKey(e)}`;
  const paid = new Set(inMonth(expenses, ym).map(key));
  const prev = prevMonth(ym);
  const bills = fixedCosts(expenses, prev);
  return inMonth(expenses, prev).filter((e) => bills.has(e.id) && !paid.has(key(e)));
}

// Time-of-day slot of an 'HH:MM' time: 0 morning 05–11, 1 afternoon 11–17, 2 evening 17–22, 3 late night 22–05.
export function slotOf(time) {
  const h = Number(time.slice(0, 2));
  return h < 5 || h >= 22 ? 3 : h < 11 ? 0 : h < 17 ? 1 : 2;
}

export function timeOfDay(expenses) {
  const sums = [0, 0, 0, 0];
  for (const e of live(expenses)) sums[slotOf(e.time)] += e.amount;
  return sums;
}

// Notes entered more than once (case and spaces ignored), most frequent first, then biggest total.
// Keeps the latest spelling and category.
export function topNotes(expenses, n = 4) {
  const groups = new Map();
  for (const e of live(expenses)) {
    const k = noteKey(e);
    if (!k) continue;
    const at = `${e.date} ${e.time}`;
    const g = groups.get(k) ?? { count: 0, total: 0, at: '' };
    g.count++;
    g.total += e.amount;
    if (at >= g.at) Object.assign(g, { at, note: e.note.trim(), categoryId: e.categoryId });
    groups.set(k, g);
  }
  return [...groups.values()]
    .filter((g) => g.count > 1)
    .sort((a, b) => b.count - a.count || b.total - a.total)
    .slice(0, n)
    .map(({ note, categoryId, count, total: t }) => ({ note, categoryId, count, total: t }));
}

// Days of ym up to today with nothing spent, plus the longest and the current run of them.
// spent[i] is false for a no-spend day and null for a day still to come.
export function noSpendDays(expenses, ym, todayISO) {
  const elapsed = daysElapsed(ym, todayISO);
  const spent = dailyStrip(expenses, ym).map((v, i) => (i < elapsed ? v > 0 : null));
  let best = 0;
  let run = 0;
  for (const s of spent.slice(0, elapsed)) {
    run = s ? 0 : run + 1;
    best = Math.max(best, run);
  }
  return { spent, count: spent.filter((s) => s === false).length, best, current: run };
}

// The expense in ym furthest above its category's median over the 3 months before it, if at
// least 3 times that median. Needs 5 earlier expenses in the category to know what is usual.
// low/high bound the middle half of those earlier amounts; count is how many there were.
export function standout(expenses, ym) {
  const history = new Map();
  for (let k = 0, m = prevMonth(ym); k < 3; k++, m = prevMonth(m)) {
    for (const e of inMonth(expenses, m)) {
      if (!history.has(e.categoryId)) history.set(e.categoryId, []);
      history.get(e.categoryId).push(e.amount);
    }
  }
  let best = null;
  for (const e of inMonth(expenses, ym)) {
    const past = history.get(e.categoryId);
    if (!past || past.length < 5) continue;
    const sorted = [...past].sort((a, b) => a - b);
    const at = (q) => sorted[Math.floor(q * (sorted.length - 1))];
    const ratio = e.amount / at(0.5);
    if (ratio >= 3 && (!best || ratio > best.ratio)) {
      best = { expense: e, ratio, median: at(0.5), low: at(0.25), high: at(0.75), count: sorted.length };
    }
  }
  return best;
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
