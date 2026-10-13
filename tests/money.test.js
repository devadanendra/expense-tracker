import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRp, formatNum, parseAmount } from '../js/money.js';

test('formatRp groups thousands with dots', () => {
  assert.equal(formatRp(2450000), 'Rp 2.450.000');
  assert.equal(formatRp(0), 'Rp 0');
  assert.equal(formatRp(500), 'Rp 500');
});

test('formatNum groups thousands with dots', () => {
  assert.equal(formatNum(1000), '1.000');
});

test('parseAmount accepts plain, dotted and Rp-prefixed input', () => {
  assert.equal(parseAmount('Rp 2.450.000'), 2450000);
  assert.equal(parseAmount('2.450.000'), 2450000);
  assert.equal(parseAmount('2450000'), 2450000);
});

test('parseAmount returns null for empty or non-numeric input', () => {
  assert.equal(parseAmount(''), null);
  assert.equal(parseAmount('abc'), null);
  assert.equal(parseAmount('Rp '), null);
});
