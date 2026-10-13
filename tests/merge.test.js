import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeRecords } from '../js/merge.js';

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, deleted: false, ...extra });

test('newer incoming replaces local', () => {
  const { merged, changed } = mergeRecords([rec('a', 1, { v: 'old' })], [rec('a', 2, { v: 'new' })]);
  assert.deepEqual(merged, [rec('a', 2, { v: 'new' })]);
  assert.deepEqual(changed, [rec('a', 2, { v: 'new' })]);
});

test('older incoming is ignored', () => {
  const { merged, changed } = mergeRecords([rec('a', 5, { v: 'keep' })], [rec('a', 4, { v: 'stale' })]);
  assert.deepEqual(merged, [rec('a', 5, { v: 'keep' })]);
  assert.deepEqual(changed, []);
});

test('new id is added and reported changed; local-only records are kept', () => {
  const { merged, changed } = mergeRecords([rec('a', 1)], [rec('b', 1)]);
  assert.deepEqual(merged.map((r) => r.id), ['a', 'b']);
  assert.deepEqual(changed, [rec('b', 1)]);
});

test('tombstone with newer updatedAt wins', () => {
  const tomb = rec('a', 9, { deleted: true });
  const { merged, changed } = mergeRecords([rec('a', 3)], [tomb]);
  assert.deepEqual(merged, [tomb]);
  assert.deepEqual(changed, [tomb]);
});

test('tombstone older than local does not delete', () => {
  const { merged, changed } = mergeRecords([rec('a', 9)], [rec('a', 3, { deleted: true })]);
  assert.equal(merged[0].deleted, false);
  assert.deepEqual(changed, []);
});

test('equal updatedAt keeps local', () => {
  const { merged, changed } = mergeRecords([rec('a', 5, { v: 'local' })], [rec('a', 5, { v: 'incoming' })]);
  assert.equal(merged[0].v, 'local');
  assert.deepEqual(changed, []);
});

test('same id twice in incoming: highest wins, reported once, no duplicate', () => {
  const { merged, changed } = mergeRecords([], [rec('a', 1, { v: 'x' }), rec('a', 3, { v: 'z' }), rec('a', 2, { v: 'y' })]);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].v, 'z');
  assert.deepEqual(changed.map((r) => r.v), ['z']);
});

test('missing updatedAt counts as 0', () => {
  const { merged } = mergeRecords([{ id: 'a', v: 'old' }], [rec('a', 1, { v: 'new' })]);
  assert.equal(merged[0].v, 'new');
});

test('empty inputs', () => {
  assert.deepEqual(mergeRecords([], []), { merged: [], changed: [] });
});
