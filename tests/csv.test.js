import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toCSV, fromCSV } from '../js/csv.js';
import { mergeRecords } from '../js/merge.js';
import { DEFAULT_CATEGORIES, CATEGORY_COLORS, OTHER_ID } from '../js/categories.js';

const HEADER = 'date,time,amount,category,note,id';
const cats = DEFAULT_CATEGORIES;
const exp = (id, over = {}) => ({
  id, amount: 25000, categoryId: 'cat-food', date: '2026-10-01', time: '08:30', note: '',
  createdAt: 1000, updatedAt: 2000, deleted: false, ...over,
});
const NOW = 5000;

test('toCSV: header, CRLF, category name, sorted by date then time, skips deleted', () => {
  const rows = [
    exp('c', { date: '2026-10-02', time: '07:00' }),
    exp('a', { date: '2026-10-01', time: '20:00', categoryId: 'cat-transport', amount: 1500000 }),
    exp('b', { date: '2026-10-01', time: '09:15' }),
    exp('x', { date: '2026-09-01', deleted: true }),
  ];
  const lines = toCSV(rows, cats).split('\r\n');
  assert.deepEqual(lines, [
    HEADER,
    '2026-10-01,09:15,25000,Food & Drink,,b',
    '2026-10-01,20:00,1500000,Transport,,a',
    '2026-10-02,07:00,25000,Food & Drink,,c',
  ]);
});

test('toCSV: empty list is header only', () => {
  assert.equal(toCSV([], cats), HEADER);
});

test('toCSV: RFC 4180 quoting', () => {
  const out = toCSV([exp('a', { note: 'a, b' }), exp('b', { note: 'say "hi"', time: '09:00' }), exp('c', { note: 'l1\nl2', time: '10:00' })], cats);
  assert.ok(out.includes(',"a, b",a'));
  assert.ok(out.includes(',"say ""hi""",b'));
  assert.ok(out.includes(',"l1\nl2",c'));
});

test('toCSV: expense in a deleted category still exports its name', () => {
  const c = [{ ...cats[0], deleted: true }, ...cats.slice(1)];
  assert.ok(toCSV([exp('a')], c).includes(',Food & Drink,'));
});

test('round-trip: notes with comma, quote, newline survive', () => {
  const notes = ['a, b', 'say "hi"', 'line1\nline2', 'crlf\r\ninside', '  spaced  ', ''];
  const src = notes.map((note, i) => exp(`id-${i}`, { note, time: `0${i}:00` }));
  const { expenses, newCategories, errors } = fromCSV(toCSV(src, cats), cats, NOW);
  assert.deepEqual(errors, []);
  assert.deepEqual(newCategories, []);
  assert.deepEqual(expenses.map((e) => [e.id, e.amount, e.categoryId, e.date, e.time, e.note]),
    src.map((e) => [e.id, e.amount, e.categoryId, e.date, e.time, e.note]));
});

test('idempotent import: own export into same device changes nothing', () => {
  const src = [exp('a'), exp('b', { time: '09:00' })];
  const csv = toCSV(src, cats);
  const first = mergeRecords(src, fromCSV(csv, cats, 9000).expenses);
  assert.equal(first.merged.length, 2);
  assert.deepEqual(first.changed, []);
  assert.deepEqual(first.merged, src);
});

test('idempotent import: fresh device adds once, second import changes nothing', () => {
  const custom = { id: 'cat-coffee', name: 'Coffee', icon: 'food', color: '#000000', order: 12, updatedAt: 1, deleted: false };
  const src = [exp('a', { categoryId: 'cat-coffee' }), exp('b', { time: '09:00' })];
  const csv = toCSV(src, [...cats, custom]);

  const one = fromCSV(csv, cats, 9000);
  assert.equal(one.newCategories.length, 1);
  const m1 = mergeRecords([], one.expenses);
  assert.equal(m1.merged.length, 2);
  assert.equal(m1.changed.length, 2);

  const catsAfter = [...cats, ...one.newCategories];
  const two = fromCSV(csv, catsAfter, 99000);
  assert.deepEqual(two.newCategories, []);
  const m2 = mergeRecords(m1.merged, two.expenses);
  assert.equal(m2.merged.length, 2);
  assert.deepEqual(m2.changed, []);
});

test('import never overwrites an existing id, even a tombstone', () => {
  const tomb = exp('a', { deleted: true, updatedAt: 3000 });
  const { merged, changed } = mergeRecords([tomb], fromCSV(toCSV([exp('a')], cats), cats, 9000).expenses);
  assert.deepEqual(changed, []);
  assert.equal(merged[0].deleted, true);
});

test('imported expense shape', () => {
  const [e] = fromCSV(`${HEADER}\r\n2026-10-01,08:30,25.000,Food & Drink,hi,abc`, cats, NOW).expenses;
  assert.deepEqual(e, {
    id: 'abc', amount: 25000, categoryId: 'cat-food', date: '2026-10-01', time: '08:30', note: 'hi',
    createdAt: NOW, updatedAt: 0, deleted: false,
  });
});

test('unknown category creates one category, reused by later rows', () => {
  const csv = [HEADER, '2026-10-01,08:00,1000,Pets,,a', '2026-10-02,08:00,2000,pets ,,b', '2026-10-03,08:00,3000,Fish,,c'].join('\n');
  const { expenses, newCategories, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, []);
  assert.equal(newCategories.length, 2);
  const [pets, fish] = newCategories;
  assert.equal(pets.name, 'Pets');
  assert.deepEqual(expenses.map((e) => e.categoryId), [pets.id, pets.id, fish.id]);
  assert.match(pets.id, /^[0-9a-f-]{36}$/);
  assert.equal(pets.icon, 'dots');
  assert.equal(pets.updatedAt, NOW);
  assert.equal(pets.deleted, false);
  assert.equal(pets.order, 12);
  assert.equal(fish.order, 13);
});

test('new category colors: next unused, then cycle when all used', () => {
  const used = cats.slice(0, 11); // 'Other' color is the only free one
  const { newCategories } = fromCSV(`${HEADER}\n2026-10-01,08:00,1000,Pets,,a`, used, NOW);
  assert.equal(newCategories[0].color, CATEGORY_COLORS[11]);

  const all = fromCSV(`${HEADER}\n2026-10-01,08:00,1000,Pets,,a\n2026-10-01,08:00,1000,Fish,,b`, cats, NOW).newCategories;
  assert.ok(CATEGORY_COLORS.includes(all[0].color) && CATEGORY_COLORS.includes(all[1].color));
});

test('category match is case-insensitive, trimmed, live categories only', () => {
  const live = fromCSV(`${HEADER}\n2026-10-01,08:00,1000,  FOOD & drink ,,a`, cats, NOW);
  assert.equal(live.expenses[0].categoryId, 'cat-food');
  assert.deepEqual(live.newCategories, []);

  const gone = cats.map((c) => (c.id === 'cat-food' ? { ...c, deleted: true } : c));
  const re = fromCSV(`${HEADER}\n2026-10-01,08:00,1000,Food & Drink,,a`, gone, NOW);
  assert.equal(re.newCategories.length, 1);
  assert.equal(re.expenses[0].categoryId, re.newCategories[0].id);
});

test('empty category falls back to Other without creating a category', () => {
  const r = fromCSV(`${HEADER}\n2026-10-01,08:00,1000, ,,a`, cats, NOW);
  assert.equal(r.expenses[0].categoryId, OTHER_ID);
  assert.deepEqual(r.newCategories, []);
});

test('missing id gets a uuid, missing time becomes 12:00', () => {
  const [a, b] = fromCSV(`${HEADER}\n2026-10-01,,1000,Food & Drink,,\n2026-10-01,,1000,Food & Drink,,`, cats, NOW).expenses;
  assert.equal(a.time, '12:00');
  assert.match(a.id, /^[0-9a-f-]{36}$/);
  assert.notEqual(a.id, b.id);
});

test('header: case-insensitive, any column order', () => {
  const csv = 'ID,Note,Category,Amount,Time,Date\r\nabc,hello,Transport,5000,09:00,2026-10-01';
  const { expenses, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, []);
  assert.deepEqual([expenses[0].id, expenses[0].note, expenses[0].categoryId, expenses[0].amount, expenses[0].time, expenses[0].date],
    ['abc', 'hello', 'cat-transport', 5000, '09:00', '2026-10-01']);
});

test('wrong header rejected, nothing imported', () => {
  for (const csv of ['', 'foo,bar\n1,2', 'date,amount\n2026-10-01,5000', 'Date,Description,Amount\n2026-10-01,x,5000']) {
    assert.deepEqual(fromCSV(csv, cats, NOW), { expenses: [], newCategories: [], errors: ['Not an Expense Tracker CSV'] });
  }
});

test('bad rows are skipped and reported; header is row 1', () => {
  const csv = [HEADER,
    '2026-10-01,08:00,1000,Transport,,ok',
    '2026-10-01,08:00,abc,Transport,,bad',
    '2026-10-01,08:00,1000,Transport,,ok2'].join('\r\n');
  const { expenses, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, ['Row 3: invalid amount']);
  assert.deepEqual(expenses.map((e) => e.id), ['ok', 'ok2']);
});

test('amount must be an integer > 0', () => {
  for (const amt of ['0', '', '1.5', '1234.56', '-5', '12e3', '99999999999999999999']) {
    const { expenses, errors } = fromCSV(`${HEADER}\n2026-10-01,08:00,${amt},Transport,,a`, cats, NOW);
    assert.deepEqual(errors, ['Row 2: invalid amount'], amt);
    assert.deepEqual(expenses, []);
  }
  for (const amt of ['1500', '1.500', 'Rp 1.500.000']) {
    assert.equal(fromCSV(`${HEADER}\n2026-10-01,08:00,"${amt}",Transport,,a`, cats, NOW).errors.length, 0, amt);
  }
});

test('invalid date and time are reported', () => {
  const csv = [HEADER,
    '2026-13-01,08:00,1000,Transport,,a',
    '2026-02-30,08:00,1000,Transport,,b',
    '01/10/2026,08:00,1000,Transport,,c',
    ',08:00,1000,Transport,,d',
    '2026-10-01,25:00,1000,Transport,,e',
    '2026-10-01,8:00,1000,Transport,,f',
    '2026-10-01,08:60,1000,Transport,,g'].join('\n');
  const { expenses, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, [
    'Row 2: invalid date', 'Row 3: invalid date', 'Row 4: invalid date', 'Row 5: invalid date',
    'Row 6: invalid time', 'Row 7: invalid time', 'Row 8: invalid time']);
  assert.deepEqual(expenses, []);
});

test('wrong column count and duplicate id within file are reported', () => {
  const csv = [HEADER, '2026-10-01,08:00,1000,Transport', '2026-10-01,08:00,1000,Transport,,dup', '2026-10-02,08:00,2000,Transport,,dup'].join('\n');
  const { expenses, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, ['Row 2: wrong number of columns', 'Row 4: duplicate id']);
  assert.deepEqual(expenses.map((e) => e.amount), [1000]);
});

test('blank lines, trailing newlines and BOM are tolerated', () => {
  const csv = `﻿${HEADER}\r\n2026-10-01,08:00,1000,Transport,,a\r\n\r\n\r\n`;
  const { expenses, errors } = fromCSV(csv, cats, NOW);
  assert.deepEqual(errors, []);
  assert.equal(expenses.length, 1);
});

test('row numbers count records, so a multi-line note does not shift them', () => {
  const csv = [HEADER, '2026-10-01,08:00,1000,Transport,"a\nb",a', '2026-10-01,08:00,zz,Transport,,b'].join('\n');
  assert.deepEqual(fromCSV(csv, cats, NOW).errors, ['Row 3: invalid amount']);
});

test('unterminated quote rejects the file instead of eating rows', () => {
  const csv = [HEADER, '2026-10-01,08:00,1000,Transport,"oops,a', '2026-10-02,08:00,2000,Transport,,b'].join('\n');
  const r = fromCSV(csv, cats, NOW);
  assert.deepEqual(r.expenses, []);
  assert.deepEqual(r.errors, ['Malformed CSV: unterminated quote']);
});

test('toCSV defuses formula-leading fields', () => {
  const e = { id: 'a', date: '2026-01-01', time: '10:00', amount: 5, categoryId: 'x', note: '=HYPERLINK("x")', deleted: false };
  const out = toCSV([e], [{ id: 'x', name: '@evil' }]);
  assert.ok(out.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(out.includes(",'@evil,"));
});
