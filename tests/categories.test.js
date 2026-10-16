import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CATEGORIES, EMOJI, emoji } from '../js/categories.js';

test('emoji: every default category icon key maps to its emoji', () => {
  assert.deepEqual(DEFAULT_CATEGORIES.map((c) => emoji(c.icon)),
    ['🍜', '🚗', '🛒', '🧾', '🛍️', '🏠', '💊', '🎬', '🔁', '💅', '💼', '📌']);
});

test('emoji: unknown or inherited keys fall back to 📌', () => {
  for (const k of ['nope', '', undefined, null, 'toString', '__proto__']) assert.equal(emoji(k), '📌');
});

test('EMOJI: picker offers 24 distinct choices, defaults first', () => {
  const keys = Object.keys(EMOJI);
  assert.equal(keys.length, 24);
  assert.deepEqual(keys.slice(0, 12), DEFAULT_CATEGORIES.map((c) => c.icon));
  assert.equal(new Set(Object.values(EMOJI)).size, 24);
});
