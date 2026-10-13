import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// Runs apps-script/Code.gs in a vm context against in-memory fakes of the Apps Script services.
const SRC = readFileSync(new URL('../apps-script/Code.gs', import.meta.url), 'utf8');
const PASS = 'test-pass';

function fakeSheet() {
  const rows = []; // rows[r - 1][c - 1]; writes start at row 1, so the last row is rows.length
  const formats = {}; // column -> number format
  let max = 1000;
  return {
    rows, formats,
    getMaxRows: () => max,
    insertRowsAfter: (_, n) => { max += n; },
    getLastRow: () => rows.length,
    setFrozenRows() {},
    getRange: (r, c, nr, nc) => ({
      setNumberFormat: (f) => { formats[c] = f; },
      getValues: () => Array.from({ length: nr }, (_, i) => Array.from({ length: nc }, (_, j) => rows[r - 1 + i]?.[c - 1 + j] ?? '')),
      setValues: (v) => v.forEach((row, i) => row.forEach((x, j) => { (rows[r - 1 + i] ??= [])[c - 1 + j] = x; })),
    }),
  };
}

function load(props = { PASSPHRASE: PASS }) {
  const sheets = new Map();
  const ss = { getSheetByName: (n) => sheets.get(n) ?? null, insertSheet: (n) => sheets.set(n, fakeSheet()).get(n) };
  const ctx = vm.createContext({
    SpreadsheetApp: { getActiveSpreadsheet: () => ss },
    PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] ?? null }) },
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() {} }) },
    ContentService: { MimeType: { JSON: 'json' }, createTextOutput: (text) => ({ text, setMimeType() { return this; } }) },
  });
  const { doPost } = vm.runInContext(`${SRC}\n;({ doPost })`, ctx);
  // JSON text out and back in: plain objects from this realm, so deepEqual compares by value.
  const post = (body) => JSON.parse(doPost({ postData: { contents: typeof body === 'string' ? body : JSON.stringify(body) } }).text);
  return { sheets, post, call: (op, extra = {}) => post({ op, pass: PASS, ...extra }) };
}

const exp = (id, extra = {}) => ({
  id, amount: 12000, categoryId: 'c1', date: '2026-10-13', time: '08:15', note: '',
  createdAt: 1000, updatedAt: 2000, deleted: false, ...extra,
});
const cat = (id, extra = {}) => ({ id, name: 'Food', icon: 'food', color: '#3a4bd8', order: 0, updatedAt: 500, deleted: false, ...extra });
const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
const AUTH = { ok: false, error: 'auth' };
const SERVER = { ok: false, error: 'server' };

test('auth: wrong or missing pass is rejected and touches nothing', () => {
  const { post, sheets } = load();
  for (const pass of ['wrong', `${PASS}x`, '', undefined]) {
    for (const op of ['count', 'pull', 'upsert']) assert.deepEqual(post({ op, pass, expenses: [exp('a')] }), AUTH);
  }
  assert.equal(sheets.size, 0);
  assert.deepEqual(load({}).post({ op: 'count', pass: '' }), AUTH, 'no PASSPHRASE property rejects all');
});

test('malformed body and unknown op are server errors', () => {
  const { post, call } = load();
  assert.deepEqual(post('{not json'), SERVER);
  assert.deepEqual(post('null'), SERVER);
  assert.deepEqual(call('drop'), SERVER);
  assert.deepEqual(call('constructor'), SERVER);
  assert.deepEqual(call('upsert', { expenses: 'nope' }), SERVER);
});

test('upsert -> pull round trip keeps stamps, odd notes and tombstones', () => {
  const { call, sheets } = load();
  const exps = [
    exp('a', { updatedAt: 0 }), // CSV import stamp
    exp('b', { note: '=1+1 \'90s 1/2' }),
    exp('c', { note: 'kopi, "susu"\nline two' }),
    exp('d', { deleted: true }),
  ];
  const cats = [cat('c1')];
  assert.deepEqual(call('upsert', { expenses: exps, categories: cats }), { ok: true });
  const got = call('pull');
  assert.deepEqual(byId(got.expenses), exps);
  assert.deepEqual(got.categories, cats);
  assert.deepEqual(call('count'), { ok: true, expenses: 3 });

  const sh = sheets.get('Expenses');
  assert.equal(sh.rows[1][4], 'Food', 'category name column');
  for (const col of [2, 7]) assert.equal(sh.formats[col], '@', `column ${col} is plain text`);
  assert.equal(sh.formats[4], undefined, 'amount stays a number');
});

test('re-upsert overwrites the row in place, no duplicate', () => {
  const { call, sheets } = load();
  call('upsert', { expenses: [exp('a'), exp('b')] });
  call('upsert', { expenses: [exp('a', { amount: 5000, updatedAt: 3000 })] });
  const got = call('pull').expenses;
  assert.deepEqual(got.map((e) => [e.id, e.amount]), [['a', 5000], ['b', 12000]]);
  assert.equal(sheets.get('Expenses').rows.length, 3); // header + 2
});
