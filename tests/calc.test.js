import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalc } from '../js/calc.js';

function run(keys) {
  const c = createCalc();
  for (const k of keys) c.press(k);
  return c;
}

test('adds two grouped amounts', () => {
  const c = run(['3', '5', '000', '+', '2', '4', '000']);
  assert.equal(c.value(), 59000);
  assert.equal(c.expression(), '35.000 + 24.000');
  assert.equal(c.canSave(), true);
});

test('multiplication binds tighter than addition', () => {
  assert.equal(run(['1', '0', '×', '3', '+', '5']).value(), 35);
  assert.equal(run(['5', '+', '1', '0', '×', '3']).value(), 35);
});

test('division binds tighter than subtraction', () => {
  assert.equal(run(['9', '-', '6', '÷', '3']).value(), 7);
});

test('result is rounded with Math.round', () => {
  assert.equal(run(['1', '0', '0', '÷', '3']).value(), 33);
  assert.equal(run(['2', '0', '0', '÷', '3']).value(), 67);
});

test('rounds once at the end, not per step', () => {
  assert.equal(run(['1', '0', '÷', '4', '×', '2']).value(), 5);
});

test('divide by zero gives null and cannot save', () => {
  const c = run(['5', '÷', '0']);
  assert.equal(c.value(), null);
  assert.equal(c.canSave(), false);
});

test('divide by zero anywhere poisons the result', () => {
  assert.equal(run(['5', '÷', '0', '+', '3']).value(), null);
});

test('trailing operator gives null and cannot save', () => {
  const c = run(['5', '+']);
  assert.equal(c.value(), null);
  assert.equal(c.canSave(), false);
});

test('empty calc has no value and cannot save', () => {
  const c = createCalc();
  assert.equal(c.expression(), '');
  assert.equal(c.value(), null);
  assert.equal(c.canSave(), false);
});

test('operator first is ignored', () => {
  for (const op of ['+', '-', '×', '÷']) {
    const c = run([op]);
    assert.equal(c.expression(), '');
    assert.equal(c.value(), null);
  }
  assert.equal(run(['+', '5']).expression(), '5');
});

test('second operator in a row replaces the first', () => {
  assert.equal(run(['5', '+', '×']).expression(), '5 ×');
  assert.equal(run(['5', '+', '×', '-']).expression(), '5 -');
});

test('leading zeros are collapsed', () => {
  assert.equal(run(['0', '0', '5']).expression(), '5');
  assert.equal(run(['0']).expression(), '0');
  assert.equal(run(['0', '0']).expression(), '0');
});

test('000 on empty or after an operator behaves like 0', () => {
  assert.equal(run(['000']).expression(), '0');
  assert.equal(run(['000', '5']).expression(), '5');
  assert.equal(run(['5', '+', '000']).expression(), '5 + 0');
  assert.equal(run(['5', '+', '000', '7']).expression(), '5 + 7');
});

test('000 after digits appends three zeros', () => {
  assert.equal(run(['5', '000']).value(), 5000);
});

test('13th digit in one number is ignored', () => {
  const c = run('1234567890123'.split(''));
  assert.equal(c.value(), 123456789012);
  assert.equal(c.expression(), '123.456.789.012');
});

test('000 appends only the zeros that fit in 12 digits', () => {
  const c = run([...'1234567890'.split(''), '000']);
  assert.equal(c.value(), 123456789000);
  assert.equal(run([...'123456789012'.split(''), '000']).value(), 123456789012);
});

test('digit cap applies per number, not per expression', () => {
  const c = run([...'123456789012'.split(''), '+', '5']);
  assert.equal(c.expression(), '123.456.789.012 + 5');
});

test('negative result is evaluated but cannot save', () => {
  const c = run(['1', '0', '-', '2', '0']);
  assert.equal(c.value(), -10);
  assert.equal(c.canSave(), false);
});

test('zero result cannot save', () => {
  const c = run(['5', '-', '5']);
  assert.equal(c.value(), 0);
  assert.equal(c.canSave(), false);
});

test('result above 999.999.999.999 cannot save', () => {
  const max = run('999999999999'.split(''));
  assert.equal(max.canSave(), true);
  const over = run([...'999999999999'.split(''), '+', '1']);
  assert.equal(over.value(), 1000000000000);
  assert.equal(over.canSave(), false);
  const huge = run([...'999999999999'.split(''), '×', ...'999999999999'.split('')]);
  assert.equal(huge.canSave(), false);
});

test('overflow to Infinity or NaN gives null', () => {
  const big = '999999999999'.split('');
  const keys = [...big];
  for (let i = 0; i < 26; i++) keys.push('×', ...big);
  assert.equal(run(keys).value(), null);
  assert.equal(run(keys).canSave(), false);
  assert.equal(run([...keys, '-', ...keys]).value(), null);
});

test('tiny negative result rounds to 0, not -0', () => {
  assert.equal(run(['0', '-', '1', '÷', '3']).value(), 0);
});

test('back removes the last digit, or a trailing operator', () => {
  const c = run(['3', '5', '+', '2']);
  c.press('back');
  assert.equal(c.expression(), '35 +');
  c.press('back');
  assert.equal(c.expression(), '35');
  c.press('back');
  assert.equal(c.expression(), '3');
  c.press('back');
  assert.equal(c.expression(), '');
  c.press('back');
  assert.equal(c.expression(), '');
  assert.equal(c.value(), null);
});

test('back after 000 removes one zero', () => {
  const c = run(['5', '000']);
  c.press('back');
  assert.equal(c.expression(), '500');
});

test('AC and reset clear everything', () => {
  const c = run(['5', '+', '3']);
  c.press('AC');
  assert.equal(c.expression(), '');
  assert.equal(c.value(), null);
  const d = run(['5', '+', '3']);
  d.reset();
  assert.equal(d.expression(), '');
});

test('load replaces state with a single number', () => {
  const c = run(['1', '+', '2']);
  c.load(59000);
  assert.equal(c.expression(), '59.000');
  assert.equal(c.value(), 59000);
  assert.equal(c.canSave(), true);
  c.press('back');
  assert.equal(c.expression(), '5.900');
  c.load(7);
  c.press('5');
  assert.equal(c.expression(), '75');
});

test('unknown keys are ignored', () => {
  const c = run(['5', 'x', '', '=', '.']);
  assert.equal(c.expression(), '5');
});
