import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

// js/theme.js is a classic <head> script; run it against a fake page.
const src = readFileSync(new URL('../js/theme.js', import.meta.url), 'utf8');
const LIGHT = '#e9e5de';
const DARK = '#26221e';

function load(saved, { blocked = false } = {}) {
  const store = new Map(saved === undefined ? [] : [['et-theme', saved]]);
  const deny = () => { throw new Error('SecurityError'); };
  const localStorage = blocked ? { getItem: deny, setItem: deny }
    : { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const metas = [
    { name: 'theme-color', media: '(prefers-color-scheme: light)', content: LIGHT },
    { name: 'theme-color', media: '(prefers-color-scheme: dark)', content: DARK },
  ];
  const root = { dataset: {} };
  const page = { localStorage, document: { documentElement: root, querySelectorAll: () => metas } };
  runInNewContext(src, page);
  const colors = () => metas.map((m) => m.content);
  return { page, root, store, colors };
}

test('theme: nothing saved follows the system', () => {
  const { page, root, colors } = load();
  assert.equal(page.getTheme(), 'system');
  assert.equal(root.dataset.theme, undefined);
  assert.deepEqual(colors(), [LIGHT, DARK]);
});

test('theme: a saved light or dark choice applies before paint', () => {
  const dark = load('dark');
  assert.equal(dark.root.dataset.theme, 'dark');
  assert.deepEqual(dark.colors(), [DARK, DARK]);
  const light = load('light');
  assert.equal(light.root.dataset.theme, 'light');
  assert.deepEqual(light.colors(), [LIGHT, LIGHT]);
});

test('theme: junk in storage means system', () => {
  const { page, root } = load('blue');
  assert.equal(page.getTheme(), 'system');
  assert.equal(root.dataset.theme, undefined);
});

test('theme: setTheme persists and applies, system clears the override', () => {
  const { page, root, store, colors } = load();
  page.setTheme('dark');
  assert.equal(store.get('et-theme'), 'dark');
  assert.equal(root.dataset.theme, 'dark');
  assert.equal(page.getTheme(), 'dark');
  page.setTheme('system');
  assert.equal(store.get('et-theme'), 'system');
  assert.equal(root.dataset.theme, undefined);
  assert.deepEqual(colors(), [LIGHT, DARK]);
});

test('theme: blocked storage still loads and applies for this visit', () => {
  const { page, root, colors } = load(undefined, { blocked: true });
  assert.equal(page.getTheme(), 'system');
  page.setTheme('light');
  assert.equal(root.dataset.theme, 'light');
  assert.deepEqual(colors(), [LIGHT, LIGHT]);
});
