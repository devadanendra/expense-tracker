import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localISO, shiftMonth, monthTitle, dayLabel, shortDate, byAmount } from '../js/ui/home.js';

test('localISO uses local date fields, not UTC', () => {
  assert.equal(localISO(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
  assert.equal(localISO(new Date(2026, 9, 13, 0, 1)), '2026-10-13');
});

test('shiftMonth crosses year boundaries', () => {
  assert.equal(shiftMonth('2026-10', 1), '2026-11');
  assert.equal(shiftMonth('2026-12', 1), '2027-01');
  assert.equal(shiftMonth('2026-01', -1), '2025-12');
});

test('monthTitle', () => {
  assert.equal(monthTitle('2026-10'), 'October 2026');
  assert.equal(monthTitle('2027-01'), 'January 2027');
});

test('dayLabel: today, yesterday, older', () => {
  assert.equal(dayLabel('2026-10-13', '2026-10-13'), 'Today · Tue 13');
  assert.equal(dayLabel('2026-10-12', '2026-10-13'), 'Yesterday · Mon 12');
  assert.equal(dayLabel('2026-10-11', '2026-10-13'), 'Sun 11 Oct');
  assert.equal(dayLabel('2026-09-30', '2026-10-13'), 'Wed 30 Sep');
});

test('dayLabel: yesterday across month and year boundaries', () => {
  assert.equal(dayLabel('2026-10-31', '2026-11-01'), 'Yesterday · Sat 31');
  assert.equal(dayLabel('2026-12-31', '2027-01-01'), 'Yesterday · Thu 31');
  assert.equal(dayLabel('2026-02-28', '2026-03-01'), 'Yesterday · Sat 28');
});

test('dayLabel: withYear adds the year to older days only', () => {
  assert.equal(dayLabel('2026-02-11', '2026-10-13', true), 'Wed 11 Feb 2026');
  assert.equal(dayLabel('2026-10-12', '2026-10-13', true), 'Yesterday · Mon 12');
});

test('shortDate: day, short month, year', () => {
  assert.equal(shortDate('2026-10-16'), '16 Oct 2026');
  assert.equal(shortDate('2027-01-05'), '5 Jan 2027');
});

test('byAmount: largest or smallest first, ties newest first', () => {
  const e = (id, amount, date, time = '12:00') => ({ id, amount, date, time });
  const list = [e('a', 5000, '2026-10-01'), e('b', 90000, '2026-10-02'), e('c', 5000, '2026-10-03'), e('d', 5000, '2026-10-03', '18:00')];
  assert.deepEqual(byAmount(list).map((x) => x.id), ['b', 'd', 'c', 'a']);
  assert.deepEqual(byAmount(list, true).map((x) => x.id), ['d', 'c', 'a', 'b']);
});
