import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  inMonth, total, byDay, byCategory, byWeek, dailyStrip, compareToLastMonth, quickPicks,
  lastMonthSoFar, monthSummary,
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

test('byWeek: Feb 2026 has 4 buckets', () => {
  const w = byWeek([ex('2026-02-28', '10:00', 5)], '2026-02');
  assert.equal(w.length, 4);
  assert.deepEqual(w.map((b) => b.label), ['Feb 1–7', 'Feb 8–14', 'Feb 15–21', 'Feb 22–28']);
  assert.equal(w[3].total, 5);
});

test('byWeek: Oct 2026 has 5 buckets, last ends on 31', () => {
  const w = byWeek(fixture, '2026-10');
  assert.equal(w.length, 5);
  assert.deepEqual(w.map((b) => [b.from, b.to]), [[1, 7], [8, 14], [15, 21], [22, 28], [29, 31]]);
  assert.equal(w[4].label, 'Oct 29–31');
  assert.equal(w[0].label, 'Oct 1–7');
  assert.deepEqual(w.map((b) => b.total), [175000, 230000, 0, 0, 70000]);
});

test('byWeek: Sep 2026 last bucket ends on 30; leap Feb 2028 gets 29-29', () => {
  assert.equal(byWeek([], '2026-09')[4].to, 30);
  const leap = byWeek([], '2028-02');
  assert.equal(leap.length, 5);
  assert.equal(leap[4].label, 'Feb 29–29');
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

test('byCategory and byWeek count expenses', () => {
  const oct = inMonth(fixture, '2026-10');
  assert.deepEqual(byCategory(oct).map((c) => c.count), [1, 3, 1, 1]);
  assert.deepEqual(byWeek(fixture, '2026-10').map((w) => w.count), [3, 2, 0, 0, 1]);
});

test('lastMonthSoFar cuts last month at today for the month in progress, keeps all of it otherwise', () => {
  const ids = (es) => es.map((e) => e.date);
  assert.deepEqual(ids(lastMonthSoFar(fixture, '2026-10', '2026-10-13')), ['2026-09-03', '2026-09-13']);
  assert.equal(lastMonthSoFar(fixture, '2026-10', '2026-11-02').length, 3);
  assert.equal(lastMonthSoFar(fixture, '2026-10', '2026-09-30').length, 0);
});

test('monthSummary: current month has a pace, a past one does not', () => {
  const now = monthSummary(fixture, '2026-10', '2026-10-13');
  assert.equal(now.count, 6);
  assert.equal(now.perDay, Math.round(475000 / 13));
  assert.equal(now.projected, Math.round((475000 / 13) * 31));
  assert.equal(now.diff, 475000 - 100000);
  assert.equal(now.biggest.amount, 200000);

  const past = monthSummary(fixture, '2026-09', '2026-10-13');
  assert.equal(past.projected, null);
  assert.equal(past.perDay, 20000);
  assert.equal(past.diff, null);

  const future = monthSummary(fixture, '2026-12', '2026-10-13');
  assert.deepEqual([future.count, future.perDay, future.biggest], [0, 0, null]);
});
