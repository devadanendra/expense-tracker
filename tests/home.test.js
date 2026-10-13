import { test } from 'node:test';
import assert from 'node:assert/strict';
import { localISO, shiftMonth, monthTitle, dayLabel } from '../js/ui/home.js';

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
