import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncStatus, planImport, storageLine } from '../js/ui/settings.js';
import { toCSV } from '../js/csv.js';
import { DEFAULT_CATEGORIES } from '../js/categories.js';

const NOW = Date.UTC(2026, 9, 13, 12);
const linked = { linked: true, lastError: null, lastSyncAt: NOW };
const status = (meta, pending = 0, url = 'https://x/exec') => syncStatus({ url, meta, pending, now: NOW });

test('syncStatus: setup and error states win over pending and synced', () => {
  assert.equal(status(linked, 3, ''), 'Not set up — see SETUP.md');
  assert.equal(status({ ...linked, linked: false }, 3), 'Not set up');
  assert.equal(status({ ...linked, lastError: 'auth' }, 3), 'Wrong passphrase');
  assert.equal(status({ ...linked, lastError: 'network' }, 3), "Can't reach Google — will retry");
  assert.equal(status({ ...linked, lastError: 'server' }), "Can't reach Google — will retry");
});

test('syncStatus: pending count, singular and plural', () => {
  assert.equal(status(linked, 1), '1 change waiting');
  assert.equal(status(linked, 3), '3 changes waiting');
});

test('syncStatus: synced age', () => {
  const at = (ms) => status({ ...linked, lastSyncAt: NOW - ms });
  assert.equal(at(5000), 'Synced just now');
  assert.equal(at(2 * 60000 + 5000), 'Synced 2 min ago');
  assert.equal(at(3 * 3600000), 'Synced 3 h ago');
  assert.equal(at(2 * 86400000 + 1), 'Synced 2 d ago');
});

const exp = (id, extra = {}) => ({
  id, amount: 12000, categoryId: 'cat-food', date: '2026-10-01', time: '09:30', note: 'kopi, "susu"',
  createdAt: 1, updatedAt: 5, deleted: false, ...extra,
});

test('planImport: re-importing the own export changes nothing', () => {
  const local = [exp('a'), exp('b', { note: 'line\nbreak' })];
  const plan = planImport(toCSV(local, DEFAULT_CATEGORIES), local, DEFAULT_CATEGORIES, NOW);
  assert.deepEqual(plan, { expenses: [], categories: [], errors: [] });
});

test('planImport: keeps only new expenses and the new categories they use', () => {
  const csv = ['date,time,amount,category,note,id',
    '2026-10-02,10:00,5000,Snacks,,a', // existing id: skipped, so Snacks is not needed
    '2026-10-03,11:00,7000,Pets,vet,n1',
    '2026-10-04,12:00,0,Food & Drink,,n2', // invalid amount
  ].join('\n');
  const plan = planImport(csv, [exp('a')], DEFAULT_CATEGORIES, NOW);
  assert.deepEqual(plan.expenses.map((e) => e.id), ['n1']);
  assert.deepEqual(plan.categories.map((c) => c.name), ['Pets']);
  assert.equal(plan.expenses[0].categoryId, plan.categories[0].id);
  assert.deepEqual(plan.errors, ['Row 4: invalid amount']);
});

test('storageLine: protection state plus usage in KB or MB, one decimal', () => {
  assert.equal(storageLine(true, 1.2 * 1024 * 1024), 'Protected · 1.2 MB used');
  assert.equal(storageLine(false, 1536), 'Not protected · 1.5 KB used');
  assert.equal(storageLine(false, 512 * 1024), 'Not protected · 512.0 KB used');
  assert.equal(storageLine(true, 1000 * 1024), 'Protected · 1.0 MB used'); // never "1024.0 KB"
  assert.equal(storageLine(true, 0), 'Protected · 0.0 KB used');
});

test('storageLine: usage left out when the browser gives none', () => {
  assert.equal(storageLine(true, undefined), 'Protected');
  assert.equal(storageLine(false, null), 'Not protected');
});
