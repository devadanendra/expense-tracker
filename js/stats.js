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
  for (const e of all) sums.set(e.categoryId, (sums.get(e.categoryId) || 0) + e.amount);
  const grand = total(all);
  return [...sums]
    .map(([categoryId, t]) => ({ categoryId, total: t, share: grand ? t / grand : 0 }))
    .sort((a, b) => b.total - a.total);
}

export function byWeek(expenses, ym) {
  const month = MONTHS[Number(ym.slice(5, 7)) - 1];
  const last = daysInMonth(ym);
  const weeks = [];
  for (let from = 1; from <= last; from += 7) {
    const to = from === 29 ? last : from + 6;
    weeks.push({ label: `${month} ${from}–${to}`, from, to, total: 0 });
  }
  for (const e of inMonth(expenses, ym)) {
    const day = Number(e.date.slice(8, 10));
    weeks[Math.floor((day - 1) / 7)].total += e.amount;
  }
  return weeks;
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

// Expenses worth re-adding with one tap: each amount + category + note (case and spaces ignored)
// since sinceISO, most repeated first, then most recent. Keeps the latest note's spelling.
export function quickPicks(expenses, sinceISO, n = 6) {
  const groups = new Map();
  for (const e of live(expenses)) {
    if (e.date < sinceISO) continue;
    const note = (e.note ?? '').trim();
    const k = `${e.amount}|${e.categoryId}|${note.toLowerCase()}`;
    const at = `${e.date} ${e.time}`;
    const g = groups.get(k) ?? { count: 0, at: '', pick: null };
    g.count++;
    if (at >= g.at) Object.assign(g, { at, pick: { amount: e.amount, categoryId: e.categoryId, note } });
    groups.set(k, g);
  }
  return [...groups.values()]
    .sort((a, b) => b.count - a.count || b.at.localeCompare(a.at))
    .slice(0, n)
    .map((g) => g.pick);
}
