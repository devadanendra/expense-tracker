import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inMonth, total, byDay, byCategory, dailyStrip, compareToLastMonth, quickPicks,
  lastMonthSoFar, monthSummary, weekdayAverages, usualMonth, fixedCosts, timeOfDay, topNotes,
  noSpendDays, standout, billsDue,
} from '../js/stats.js';
import { DEFAULT_CATEGORIES, CATEGORY_COLORS, OTHER_ID } from '../js/categories.js';

let n = 0;
const ex = (date, time, amount, categoryId, extra = {}) => ({
  id: `e${++n}`, amount, categoryId, date, time, note: '',
  createdAt: 0, updatedAt: 0, deleted: false, ...extra,
});

const fixture = [
  ex('2026-10-02', '08:30', 25000, 'cat-food'),
  ex('2026-10-02', '19:15', 50000, 'cat-food'),
  ex('2026-10-02', '12:00', 100000, 'cat-transport'),
  ex('2026-10-09', '10:00', 200000, 'cat-bills'),
  ex('2026-10-13', '07:45', 30000, 'cat-food'),
  ex('2026-10-31', '21:00', 70000, 'cat-fun'),
  ex('2026-10-05', '09:00', 999999, 'cat-food', { deleted: true }),
  ex('2026-09-03', '09:00', 40000, 'cat-food'),
  ex('2026-09-13', '18:00', 60000, 'cat-groceries'),
  ex('2026-09-20', '18:00', 500000, 'cat-bills'),
];

test('inMonth filters by month and ignores deleted', () => {
  const oct = inMonth(fixture, '2026-10');
  assert.equal(oct.length, 6);
  assert.ok(oct.every((e) => e.date.startsWith('2026-10') && !e.deleted));
  assert.equal(inMonth(fixture, '2026-09').length, 3);
  assert.equal(inMonth(fixture, '2026-08').length, 0);
});

test('total sums amounts and excludes deleted', () => {
  assert.equal(total(inMonth(fixture, '2026-10')), 475000);
  assert.equal(total(fixture), 475000 + 600000);
  assert.equal(total([]), 0);
});

test('byDay groups newest date first, items newest time first', () => {
  const days = byDay(fixture);
  assert.deepEqual(days.map((d) => d.date), [
    '2026-10-31', '2026-10-13', '2026-10-09', '2026-10-02',
    '2026-09-20', '2026-09-13', '2026-09-03',
  ]);
  const d2 = days.find((d) => d.date === '2026-10-02');
  assert.equal(d2.total, 175000);
  assert.deepEqual(d2.items.map((e) => e.time), ['19:15', '12:00', '08:30']);
  assert.equal(days.some((d) => d.date === '2026-10-05'), false);
});

test('byCategory sorts by total desc with share of total', () => {
  const cats = byCategory(inMonth(fixture, '2026-10'));
  assert.deepEqual(cats.map((c) => c.categoryId), [
    'cat-bills', 'cat-food', 'cat-transport', 'cat-fun',
  ]);
  assert.deepEqual(cats.map((c) => c.total), [200000, 105000, 100000, 70000]);
  assert.equal(cats[0].share, 200000 / 475000);
  const sum = cats.reduce((s, c) => s + c.share, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
});

test('byCategory on empty input is empty; share is 0 when total is 0', () => {
  assert.deepEqual(byCategory([]), []);
  assert.deepEqual(byCategory([ex('2026-10-01', '00:00', 1, 'x', { deleted: true })]), []);
});

test('dailyStrip has one entry per day of the month', () => {
  const strip = dailyStrip(fixture, '2026-10');
  assert.equal(strip.length, 31);
  assert.equal(strip[1], 175000);
  assert.equal(strip[30], 70000);
  assert.equal(strip[0], 0);
  assert.equal(dailyStrip([], '2026-02').length, 28);
  assert.equal(dailyStrip([], '2028-02').length, 29);
});

test('compareToLastMonth: Oct 1-13 vs Sep 1-13', () => {
  // Oct 1-13 = 25000+50000+100000+200000+30000 = 405000; Sep 1-13 = 100000
  assert.deepEqual(compareToLastMonth(fixture, '2026-10-13'), { diff: 305000 });
});

test('compareToLastMonth: Mar 31 compares Mar 1-31 vs Feb 1-28', () => {
  const data = [
    ex('2026-03-01', '10:00', 300),
    ex('2026-03-31', '10:00', 200),
    ex('2026-02-01', '10:00', 100),
    ex('2026-02-28', '10:00', 50),
    ex('2026-03-15', '10:00', 7, 'x', { deleted: true }),
  ];
  assert.deepEqual(compareToLastMonth(data, '2026-03-31'), { diff: 500 - 150 });
});

test('compareToLastMonth: January compares against December of previous year', () => {
  const data = [
    ex('2026-01-02', '10:00', 100),
    ex('2026-01-20', '10:00', 900),
    ex('2025-12-05', '10:00', 400),
    ex('2025-12-31', '10:00', 1000),
  ];
  assert.deepEqual(compareToLastMonth(data, '2026-01-10'), { diff: 100 - 400 });
});

test('compareToLastMonth: negative when spending less', () => {
  const data = [ex('2026-10-01', '10:00', 10), ex('2026-09-01', '10:00', 60)];
  assert.equal(compareToLastMonth(data, '2026-10-05').diff, -50);
});

test('DEFAULT_CATEGORIES: 12 unique full records ordered 0-11', () => {
  assert.equal(DEFAULT_CATEGORIES.length, 12);
  assert.equal(new Set(DEFAULT_CATEGORIES.map((c) => c.id)).size, 12);
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => c.order), [...Array(12).keys()]);
  for (const c of DEFAULT_CATEGORIES) {
    assert.deepEqual(Object.keys(c).sort(), ['color', 'deleted', 'icon', 'id', 'name', 'order', 'updatedAt']);
    assert.equal(c.updatedAt, 0);
    assert.equal(c.deleted, false);
    assert.match(c.color, /^#[0-9a-f]{6}$/);
  }
  assert.deepEqual(DEFAULT_CATEGORIES[0], {
    id: 'cat-food', name: 'Food & Drink', icon: 'food', color: '#c2643c',
    order: 0, updatedAt: 0, deleted: false,
  });
  assert.equal(OTHER_ID, 'cat-other');
  assert.equal(DEFAULT_CATEGORIES[11].id, OTHER_ID);
  assert.deepEqual(CATEGORY_COLORS, DEFAULT_CATEGORIES.map((c) => c.color));
});

test('quickPicks: repeats only, most first, then latest; same amount, category and note count as one', () => {
  const picks = quickPicks([
    ex('2026-10-01', '08:00', 25000, 'cat-food', { note: 'Coffee' }),
    ex('2026-10-02', '08:00', 25000, 'cat-food', { note: 'coffee ' }),
    ex('2026-10-03', '08:00', 25000, 'cat-food', { note: 'Coffee' }),
    ex('2026-10-03', '12:00', 15000, 'cat-transport', { note: 'Bus' }),
    ex('2026-10-04', '09:00', 15000, 'cat-transport', { note: 'Bus' }),
    ex('2026-10-05', '19:00', 80000, 'cat-fun'),
    ex('2026-10-05', '20:00', 80000, 'cat-fun', { deleted: true }),
    ex('2025-08-01', '08:00', 5000, 'cat-food'),
    ex('2025-08-02', '08:00', 5000, 'cat-food'),
  ], 8);
  assert.deepEqual(picks, [
    { amount: 25000, categoryId: 'cat-food', note: 'Coffee', count: 3 },
    { amount: 15000, categoryId: 'cat-transport', note: 'Bus', count: 2 },
    { amount: 5000, categoryId: 'cat-food', note: '', count: 2 },
  ]);
});

test('quickPicks keeps at most n', () => {
  const many = Array.from({ length: 20 }, (_, i) => ex('2026-10-10', `${10 + i}:00`, 1000 * (i % 10 + 1), 'cat-food'));
  assert.equal(quickPicks(many).length, 8);
  assert.deepEqual(quickPicks(many, 2).map((p) => p.amount), [10000, 9000]);
});

test('byCategory counts expenses', () => {
  assert.deepEqual(byCategory(inMonth(fixture, '2026-10')).map((c) => c.count), [1, 3, 1, 1]);
});

test('lastMonthSoFar cuts last month at today for the month in progress, keeps all of it otherwise', () => {
  const ids = (es) => es.map((e) => e.date);
  assert.deepEqual(ids(lastMonthSoFar(fixture, '2026-10', '2026-10-13')), ['2026-09-03', '2026-09-13']);
  assert.equal(lastMonthSoFar(fixture, '2026-10', '2026-11-02').length, 3);
  assert.equal(lastMonthSoFar(fixture, '2026-10', '2026-09-30').length, 0);
});

test('monthSummary: current month has a pace, a past one does not', () => {
  const now = monthSummary(fixture, '2026-10', '2026-10-13');
  assert.equal(now.perDay, Math.round(475000 / 13));
  assert.equal(now.projected, Math.round((475000 / 13) * 31));
  assert.equal(now.diff, 475000 - 100000);

  const past = monthSummary(fixture, '2026-09', '2026-10-13');
  assert.equal(past.projected, null);
  assert.equal(past.perDay, 20000);
  assert.equal(past.diff, null);

  const future = monthSummary(fixture, '2026-12', '2026-10-13');
  assert.deepEqual([future.perDay, future.projected, future.diff], [0, null, null]);
});

test('weekdayAverages averages each weekday over the months ending with ym, up to today', () => {
  // 2026-10-05 and 2026-10-12 are Mondays; Sep 2026 has 4 Mondays, Oct up to the 13th has 2.
  const es = [ex('2026-10-05', '09:00', 60000, 'cat-food'), ex('2026-10-12', '09:00', 30000, 'cat-food'), ex('2026-10-20', '09:00', 999, 'cat-food')];
  const avg = weekdayAverages(es, '2026-10', '2026-10-13', 2);
  assert.equal(avg.length, 7);
  assert.equal(avg[0], Math.round(90000 / 6));
  assert.equal(avg[1], 0);
});

test('usualMonth averages the months before ym that have spending', () => {
  assert.equal(usualMonth(fixture, '2026-11'), Math.round((475000 + 600000) / 2));
  assert.equal(usualMonth(fixture, '2026-10'), 600000);
  assert.equal(usualMonth(fixture, '2026-09'), null);
});

test('fixedCosts finds expenses repeated once a month for 3 months with the same amount, category and note', () => {
  const es = [
    ex('2026-08-05', '09:00', 450000, 'cat-bills', { note: 'Listrik' }),
    ex('2026-09-05', '09:00', 450000, 'cat-bills', { note: 'Listrik' }),
    ex('2026-10-05', '09:00', 450000, 'cat-bills', { id: 'bill', note: ' listrik ' }),
    ex('2026-09-08', '09:00', 30000, 'cat-food', { note: 'Bakso' }),
    ex('2026-10-08', '09:00', 30000, 'cat-food', { note: 'Bakso' }),
    ...['2026-08-02', '2026-09-20', '2026-10-03'].map((d) => ex(d, '09:00', 25000, 'cat-transport', { note: 'Gojek' })),
    ex('2026-10-06', '09:00', 460000, 'cat-bills', { note: 'Listrik' }),
    ex('2026-09-07', '09:00', 20000, 'cat-food'),
    ex('2026-10-07', '09:00', 20000, 'cat-food'),
    ...['2026-09-01', '2026-10-01', '2026-10-02'].map((d) => ex(d, '08:00', 25000, 'cat-food', { note: 'Kopi' })),
  ];
  assert.deepEqual([...fixedCosts(es, '2026-10')], ['bill']);
});

test('timeOfDay buckets by hour; late night wraps past midnight', () => {
  const es = ['04:59', '05:00', '10:59', '11:00', '17:00', '21:59', '22:00', '23:30'].map((t) => ex('2026-10-01', t, 1, 'cat-food'));
  assert.deepEqual(timeOfDay(es), [2, 1, 2, 3]);
});

test('topNotes groups notes ignoring case and spaces, most frequent first, latest spelling kept', () => {
  const es = [
    ex('2026-10-01', '08:00', 25000, 'cat-food', { note: 'kopi' }),
    ex('2026-10-02', '08:00', 30000, 'cat-food', { note: 'Kopi ' }),
    ex('2026-10-03', '08:00', 25000, 'cat-food', { note: 'Kopi' }),
    ex('2026-10-01', '12:00', 90000, 'cat-transport', { note: 'Gojek' }),
    ex('2026-10-02', '12:00', 90000, 'cat-transport', { note: 'Gojek' }),
    ex('2026-10-03', '12:00', 500000, 'cat-shopping', { note: 'Once' }),
    ex('2026-10-04', '12:00', 9000, 'cat-food'),
    ex('2026-10-05', '12:00', 9000, 'cat-food'),
  ];
  assert.deepEqual(topNotes(es), [
    { note: 'Kopi', categoryId: 'cat-food', count: 3, total: 80000 },
    { note: 'Gojek', categoryId: 'cat-transport', count: 2, total: 180000 },
  ]);
});

test('noSpendDays counts empty days up to today with the best and current runs', () => {
  const es = ['2026-10-01', '2026-10-04', '2026-10-05'].map((d) => ex(d, '09:00', 1, 'cat-food'));
  const r = noSpendDays(es, '2026-10', '2026-10-08');
  assert.deepEqual(r.spent.slice(0, 9), [true, false, false, true, true, false, false, false, null]);
  assert.equal(r.spent.length, 31);
  assert.deepEqual([r.count, r.best, r.current], [5, 3, 3]);
  assert.deepEqual(noSpendDays([], '2026-09', '2026-10-08').count, 30);
});

test('standout picks the expense at least 3x its category median of the 3 earlier months', () => {
  const past = [50, 60, 70, 80, 100].map((k, i) => ex(`2026-0${7 + (i % 3)}-1${i}`, '10:00', k * 1000, 'cat-shopping'));
  const big = ex('2026-10-14', '20:00', 640000, 'cat-shopping', { note: 'Sneakers' });
  const r = standout([...past, big, ex('2026-10-15', '10:00', 150000, 'cat-shopping')], '2026-10');
  assert.equal(r.expense, big);
  assert.equal(r.median, 70000);
  assert.deepEqual([r.low, r.high], [60000, 80000]);
  assert.equal(standout([...past.slice(0, 4), big], '2026-10'), null, 'too little history');
  assert.equal(standout([...past, ex('2026-10-14', '20:00', 200000, 'cat-shopping')], '2026-10'), null, 'under 3x');
});

test('billsDue lists bills from last month not yet repeated this month', () => {
  const bill = (d, amount, note) => ex(d, '09:00', amount, 'cat-bills', { note });
  const es = [
    ...['2026-07-05', '2026-08-05', '2026-09-05', '2026-10-05'].map((d) => bill(d, 450000, 'Listrik')),
    ...['2026-07-25', '2026-08-25'].map((d) => bill(d, 300000, 'Kos')),
    bill('2026-09-25', 300000, 'Kos'),
  ];
  assert.deepEqual(billsDue(es, '2026-10').map((e) => e.note), ['Kos']);
});
