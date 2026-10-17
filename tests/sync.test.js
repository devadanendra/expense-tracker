import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSync } from '../js/sync.js';
import { toCSV } from '../js/csv.js';
import { planImport } from '../js/ui/settings.js';
import { DEFAULT_CATEGORIES } from '../js/categories.js';

const URL_ = 'https://script.example/exec';
const PASS = 'secret-pass';

const exp = (id, updatedAt, extra = {}) => ({
  id, amount: 1000, categoryId: 'c1', date: '2026-10-01', time: '10:00',
  note: '', createdAt: 1, updatedAt, deleted: false, ...extra,
});
const cat = (id, updatedAt, extra = {}) => ({
  id, name: id, icon: 'tag', color: '#000000', order: 0, updatedAt, deleted: false, ...extra,
});

// In-memory store. `edit` mimics the app: write a record and re-mark it in the outbox.
function fakeStore({ meta = {}, expenses = [], categories = [], outbox = [] } = {}) {
  const recs = { expense: new Map(), category: new Map() };
  expenses.forEach((r) => recs.expense.set(r.id, r));
  categories.forEach((r) => recs.category.set(r.id, r));
  const box = new Map(outbox.map((e) => [`${e.kind}:${e.id}`, e]));
  const m = { passphrase: null, linked: false, lastSyncAt: null, lastError: null, ...meta };
  const s = {
    meta: m, recs, box, putManyCalls: [],
    getMeta: async () => ({ ...m }),
    setMeta: async (patch) => { Object.assign(m, patch); },
    getOutbox: async () => [...box.values()],
    // Same contract as store.js: an entry goes only if its record is still at the sent stamp (or gone).
    clearOutbox: async (entries) => entries.forEach((e) => {
      const rec = recs[e.kind].get(e.id);
      if (!rec || rec.updatedAt === e.updatedAt) box.delete(`${e.kind}:${e.id}`);
    }),
    getRecord: async (kind, id) => recs[kind].get(id),
    allExpenses: async () => [...recs.expense.values()],
    allCategories: async () => [...recs.category.values()],
    putMany: async (kind, list) => {
      s.putManyCalls.push([kind, list]);
      list.forEach((r) => recs[kind].set(r.id, r));
    },
    markAllDirty: async () => {
      for (const kind of ['expense', 'category'])
        for (const [id, r] of recs[kind]) box.set(`${kind}:${id}`, { kind, id, updatedAt: r.updatedAt });
    },
    // Same contract as store.js: only absent ids, stamp kept, queued.
    importExpenses: async (list) => {
      const fresh = list.filter((r) => !recs.expense.has(r.id));
      fresh.forEach((r) => s.edit('expense', r));
      return fresh.length;
    },
    edit(kind, rec) {
      recs[kind].set(rec.id, rec);
      box.set(`${kind}:${rec.id}`, { kind, id: rec.id, updatedAt: rec.updatedAt });
    },
  };
  return s;
}

const reply = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

// handler(body, init) -> body object | response | throws. Records every call.
function fakeFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, init, body });
    const out = await handler(body, init);
    return out && typeof out.json === 'function' ? out : reply(out);
  };
  fn.calls = calls;
  return fn;
}

const linkedMeta = { passphrase: PASS, linked: true };
const mk = (store, fetch, url = URL_) => createSync({ url, fetch, store });

test('nourl: push, link and remoteCount make no request', async () => {
  const fetch = fakeFetch(() => ({ ok: true }));
  const store = fakeStore({ meta: linkedMeta, outbox: [{ kind: 'expense', id: 'a' }] });
  const sync = mk(store, fetch, '');
  assert.deepEqual(await sync.push(), { ok: false, error: 'nourl' });
  assert.deepEqual(await sync.link(PASS), { ok: false, error: 'nourl' });
  assert.deepEqual(await sync.remoteCount(PASS), { ok: false, error: 'nourl' });
  assert.equal(fetch.calls.length, 0);
});

test('push is blocked while unlinked', async () => {
  const fetch = fakeFetch(() => ({ ok: true }));
  const store = fakeStore({ expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }] });
  const res = await mk(store, fetch).push();
  assert.deepEqual(res, { ok: false, error: 'unlinked' });
  assert.equal(fetch.calls.length, 0);
  assert.equal(store.box.size, 1);
});

test('failed push keeps outbox', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1), exp('b', 2)],
    outbox: [{ kind: 'expense', id: 'a' }, { kind: 'expense', id: 'b' }],
  });
  const fetch = async () => { throw new TypeError('offline'); };
  const res = await mk(store, fetch).push();
  assert.deepEqual(res, { ok: false, error: 'network', detail: 'network' });
  assert.equal(store.box.size, 2);
  assert.equal(store.meta.lastError, 'network');
  assert.equal(store.meta.lastErrorDetail, 'network');
  assert.equal(store.meta.lastSyncAt, null);
});

test('aborted (timed-out) request maps to network/timeout and keeps outbox; next push is not wedged', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  let hang = true;
  const fetch = async () => {
    if (hang) throw new DOMException('The operation was aborted.', 'AbortError');
    return reply({ ok: true });
  };
  const sync = mk(store, fetch);
  assert.deepEqual(await sync.push(), { ok: false, error: 'network', detail: 'timeout' });
  assert.equal(store.box.size, 1);
  hang = false;
  assert.deepEqual(await sync.push(), { ok: true, pushed: 1 });
});

test('push hands clearOutbox the stamp it sent, not the current one', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 7)], outbox: [{ kind: 'expense', id: 'a', updatedAt: 3 }], // stamp at mark time, older than the record's
  });
  let cleared;
  const real = store.clearOutbox;
  store.clearOutbox = async (entries) => { cleared = entries; return real(entries); };
  await mk(store, fakeFetch(() => ({ ok: true }))).push();
  assert.deepEqual(cleared, [{ kind: 'expense', id: 'a', updatedAt: 7 }]);
});

test('next push resends everything a failed push left behind', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  let online = false;
  const fetch = fakeFetch(() => { if (!online) throw new TypeError('offline'); return { ok: true }; });
  const sync = mk(store, fetch);
  assert.equal((await sync.push()).ok, false);
  online = true;
  assert.deepEqual(await sync.push(), { ok: true, pushed: 1 });
  assert.equal(fetch.calls.length, 2);
  assert.deepEqual(fetch.calls[1].body.expenses, [exp('a', 1)]);
  assert.equal(store.box.size, 0);
});

for (const [name, handler, want, detail] of [
  ['fetch rejected', () => { throw new TypeError('Failed to fetch'); }, 'network', 'network'],
  ['timeout', () => { throw new DOMException('The operation timed out.', 'TimeoutError'); }, 'network', 'timeout'],
  ['abort', () => { throw new DOMException('The operation was aborted.', 'AbortError'); }, 'network', 'timeout'],
  ['HTTP 500', () => reply({ ok: true }, 500), 'server', 'http 500'],
  ['HTTP 404', () => reply({}, 404), 'server', 'http 404'],
  ['unparseable JSON', () => ({ ok: true, status: 200, json: async () => { throw new SyntaxError('bad'); } }), 'server', 'bad-reply'],
  ['ok:false auth', () => ({ ok: false, error: 'auth' }), 'auth', undefined],
  ['ok:false other', () => ({ ok: false, error: 'boom' }), 'server', 'script'],
  ['ok:false no error', () => ({ ok: false }), 'server', 'script'],
]) {
  test(`push error mapping: ${name} -> ${want}/${detail}, outbox kept, lastError and detail set`, async () => {
    const store = fakeStore({
      meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
    });
    const res = await mk(store, fakeFetch(handler)).push();
    assert.deepEqual(res, detail ? { ok: false, error: want, detail } : { ok: false, error: want });
    assert.equal(store.box.size, 1);
    assert.equal(store.meta.lastError, want);
    assert.equal(store.meta.lastErrorDetail, detail ?? null);
  });
}

test('push error mapping: fetch rejected while the browser is offline -> network/offline', async (t) => {
  Object.defineProperty(navigator, 'onLine', { value: false, configurable: true });
  t.after(() => { delete navigator.onLine; });
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  const res = await mk(store, async () => { throw new TypeError('Failed to fetch'); }).push();
  assert.deepEqual(res, { ok: false, error: 'network', detail: 'offline' });
  assert.equal(store.meta.lastErrorDetail, 'offline');
});

// n records: the first nc are categories, queued after the expenses to check categories go first.
function bigStore(n, nc = 0) {
  const expenses = Array.from({ length: n - nc }, (_, i) => exp(`e${i}`, 1));
  const categories = Array.from({ length: nc }, (_, i) => cat(`c${i}`, 1));
  const outbox = [...expenses.map((r) => ({ kind: 'expense', id: r.id })), ...categories.map((r) => ({ kind: 'category', id: r.id }))];
  return fakeStore({ meta: linkedMeta, expenses, categories, outbox });
}
const sizes = (fetch) => fetch.calls.map((c) => c.body.expenses.length + c.body.categories.length);

test('push sends 200 records per request, categories first, clearing each chunk as it lands', async () => {
  const store = bigStore(450, 30);
  const left = [];
  const fetch = fakeFetch(() => { left.push(store.box.size); return { ok: true }; });
  const res = await mk(store, fetch).push();
  assert.deepEqual(res, { ok: true, pushed: 450 });
  assert.deepEqual(sizes(fetch), [200, 200, 50]);
  assert.equal(fetch.calls[0].body.categories.length, 30);
  assert.ok(fetch.calls.slice(1).every((c) => c.body.categories.length === 0));
  assert.ok(fetch.calls.every((c) => c.body.op === 'upsert' && c.body.pass === PASS));
  assert.deepEqual(left, [450, 250, 50], 'each chunk cleared before the next is sent');
  assert.equal(store.box.size, 0);
  assert.equal(store.meta.lastError, null);
});

test('push stops at the first failed chunk: earlier chunks stay cleared, the rest stay queued', async () => {
  const store = bigStore(450);
  const fetch = fakeFetch(() => (fetch.calls.length === 2 ? reply({}, 500) : { ok: true }));
  const res = await mk(store, fetch).push();
  assert.deepEqual(res, { ok: false, error: 'server', detail: 'http 500' });
  assert.deepEqual(sizes(fetch), [200, 200]);
  assert.equal(store.box.size, 250);
  const sent1 = fetch.calls[0].body.expenses.map((e) => `expense:${e.id}`);
  assert.ok(sent1.every((k) => !store.box.has(k)), 'chunk 1 cleared');
  assert.equal(store.meta.lastError, 'server');
  assert.equal(store.meta.lastErrorDetail, 'http 500');
  assert.ok(store.meta.lastSyncAt > 0, 'chunk 1 recorded its sync time');

  const again = await mk(store, fakeFetch(() => ({ ok: true }))).push();
  assert.deepEqual(again, { ok: true, pushed: 250 });
  assert.equal(store.box.size, 0);
  assert.equal(store.meta.lastError, null);
  assert.equal(store.meta.lastErrorDetail, null);
});

test('successful push sends one upsert, clears sent entries, records sync time', async () => {
  const store = fakeStore({
    meta: { ...linkedMeta, lastError: 'network', lastErrorDetail: 'timeout' },
    expenses: [exp('a', 1), exp('b', 2)], categories: [cat('c1', 3)],
    outbox: [{ kind: 'expense', id: 'a' }, { kind: 'category', id: 'c1' }],
  });
  const fetch = fakeFetch(() => ({ ok: true }));
  const before = Date.now();
  const res = await mk(store, fetch).push();
  assert.deepEqual(res, { ok: true, pushed: 2 });
  assert.equal(fetch.calls.length, 1);
  const { url, init, body } = fetch.calls[0];
  assert.equal(url, URL_);
  assert.equal(init.method, 'POST');
  assert.deepEqual(init.headers, { 'Content-Type': 'text/plain;charset=utf-8' });
  assert.ok(init.signal instanceof AbortSignal, 'request must carry a timeout signal');
  assert.deepEqual(body, { op: 'upsert', pass: PASS, expenses: [exp('a', 1)], categories: [cat('c1', 3)] });
  assert.equal(store.box.size, 0);
  assert.equal(store.meta.lastError, null);
  assert.equal(store.meta.lastErrorDetail, null);
  assert.ok(store.meta.lastSyncAt >= before);
});

test('passphrase never appears in the request URL', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  const fetch = fakeFetch((body) =>
    body.op === 'pull' ? { ok: true, expenses: [], categories: [] } : { ok: true, expenses: 1 });
  const sync = mk(store, fetch);
  await sync.push();
  await sync.remoteCount(PASS);
  await sync.link(PASS);
  assert.ok(fetch.calls.length >= 3);
  for (const c of fetch.calls) assert.ok(!c.url.includes(PASS), 'pass leaked into URL');
});

test('empty outbox while linked: ok, pushed 0, no request', async () => {
  const fetch = fakeFetch(() => ({ ok: true }));
  const store = fakeStore({ meta: linkedMeta, expenses: [exp('a', 1)] });
  assert.deepEqual(await mk(store, fetch).push(), { ok: true, pushed: 0 });
  assert.equal(fetch.calls.length, 0);
});

test('empty outbox clears a stale error, no request', async () => {
  const fetch = fakeFetch(() => ({ ok: true }));
  const store = fakeStore({ meta: { ...linkedMeta, lastError: 'network', lastErrorDetail: 'timeout' } });
  assert.deepEqual(await mk(store, fetch).push(), { ok: true, pushed: 0 });
  assert.equal(fetch.calls.length, 0);
  assert.equal((await store.getMeta()).lastError, null);
  assert.equal((await store.getMeta()).lastErrorDetail, null);
});

test('record re-edited during push stays in the outbox and is resent next time', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1), exp('b', 1)],
    outbox: [{ kind: 'expense', id: 'a' }, { kind: 'expense', id: 'b' }],
  });
  const fetch = fakeFetch((body) => {
    if (fetch.calls.length === 1) store.edit('expense', exp('a', 2, { amount: 5000 })); // mid-flight edit
    return { ok: true };
  });
  const sync = mk(store, fetch);
  assert.deepEqual(await sync.push(), { ok: true, pushed: 2 });
  assert.deepEqual([...store.box.keys()], ['expense:a']);

  assert.deepEqual(await sync.push(), { ok: true, pushed: 1 });
  assert.deepEqual(fetch.calls[1].body.expenses, [exp('a', 2, { amount: 5000 })]);
  assert.equal(store.box.size, 0);
});

test('outbox entry whose record is gone is cleared and not sent', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('b', 1)],
    outbox: [{ kind: 'expense', id: 'ghost' }, { kind: 'expense', id: 'b' }],
  });
  const fetch = fakeFetch(() => ({ ok: true }));
  const sync = mk(store, fetch);
  assert.deepEqual(await sync.push(), { ok: true, pushed: 1 });
  assert.deepEqual(fetch.calls[0].body.expenses, [exp('b', 1)]);
  assert.equal(store.box.size, 0);

  store.box.set('expense:ghost', { kind: 'expense', id: 'ghost' });
  assert.deepEqual(await sync.push(), { ok: true, pushed: 0 });
  assert.equal(fetch.calls.length, 1);
  assert.equal(store.box.size, 0);
});

test('push while a push is in flight returns the in-flight promise', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  let release;
  const gate = new Promise((r) => { release = r; });
  const fetch = fakeFetch(async () => { await gate; return { ok: true }; });
  const sync = mk(store, fetch);
  const p1 = sync.push();
  const p2 = sync.push();
  assert.equal(p1, p2);
  release();
  assert.deepEqual(await p1, { ok: true, pushed: 1 });
  assert.equal(fetch.calls.length, 1);

  store.edit('expense', exp('a', 2));
  const p3 = sync.push();
  assert.notEqual(p3, p1);
  assert.deepEqual(await p3, { ok: true, pushed: 1 });
  assert.equal(fetch.calls.length, 2);
});

test('failed push does not wedge single flight', async () => {
  const store = fakeStore({
    meta: linkedMeta, expenses: [exp('a', 1)], outbox: [{ kind: 'expense', id: 'a' }],
  });
  let fail = true;
  const fetch = fakeFetch(() => { if (fail) throw new TypeError('x'); return { ok: true }; });
  const sync = mk(store, fetch);
  assert.equal((await sync.push()).error, 'network');
  fail = false;
  assert.equal((await sync.push()).ok, true);
});

test('auth error does not link', async () => {
  const store = fakeStore({ expenses: [exp('a', 1)] });
  const fetch = fakeFetch(() => ({ ok: false, error: 'auth' }));
  const res = await mk(store, fetch).link('wrong');
  assert.deepEqual(res, { ok: false, error: 'auth' });
  assert.equal(store.meta.passphrase, null);
  assert.equal(store.meta.linked, false);
  assert.equal(store.putManyCalls.length, 0);
  assert.equal(store.box.size, 0);
  assert.equal(fetch.calls.length, 1);
  assert.equal(fetch.calls[0].body.op, 'pull');
});

for (const [name, handler, want, detail] of [
  ['network', () => { throw new TypeError('offline'); }, 'network', 'network'],
  ['HTTP 500', () => reply({}, 500), 'server', 'http 500'],
  ['ok:false other', () => ({ ok: false, error: 'x' }), 'server', 'script'],
  ['malformed pull body', () => ({ ok: true }), 'server', 'bad-reply'],
]) {
  test(`link pull error (${name}) returns ${want} and stores nothing`, async () => {
    const store = fakeStore({ expenses: [exp('a', 1)] });
    const res = await mk(store, fakeFetch(handler)).link(PASS);
    assert.deepEqual(res, { ok: false, error: want, detail });
    assert.equal(store.meta.passphrase, null);
    assert.equal(store.meta.linked, false);
    assert.equal(store.putManyCalls.length, 0);
    assert.equal(store.box.size, 0);
  });
}

test('link merges then pushes', async () => {
  const store = fakeStore({
    expenses: [exp('local1', 1)], categories: [cat('c1', 1)],
    outbox: [{ kind: 'expense', id: 'local1' }, { kind: 'category', id: 'c1' }],
  });
  const remote = [exp('r1', 1), exp('r2', 2), exp('r3', 3)];
  const fetch = fakeFetch((body) =>
    body.op === 'pull' ? { ok: true, expenses: remote, categories: [cat('c2', 2)] } : { ok: true });
  const res = await mk(store, fetch).link(PASS);

  assert.deepEqual(res, { ok: true, pulled: 4, pushed: 6 });
  assert.equal(store.recs.expense.size, 4);
  assert.equal(store.meta.passphrase, PASS);
  assert.equal(store.meta.linked, true);
  assert.equal(store.meta.lastError, null);
  assert.deepEqual(fetch.calls.map((c) => c.body.op), ['pull', 'upsert']);
  assert.equal(fetch.calls[0].body.pass, PASS);
  const up = fetch.calls[1].body;
  assert.deepEqual(up.expenses.map((e) => e.id).sort(), ['local1', 'r1', 'r2', 'r3']);
  assert.deepEqual(up.categories.map((c) => c.id).sort(), ['c1', 'c2']);
  assert.equal(store.box.size, 0);
});

test('link stores the Sheet url it linked to', async () => {
  const store = fakeStore();
  const fetch = fakeFetch((body) => (body.op === 'pull' ? { ok: true, expenses: [], categories: [] } : { ok: true }));
  await mk(store, fetch).link(PASS);
  assert.equal(store.meta.url, URL_);
});

test('csv import on a wiped phone, then restore: the Sheet\'s newer edit and delete win', async () => {
  const T_EXPORT = Date.UTC(2026, 8, 1);
  const T_EDIT = Date.UTC(2026, 9, 1);
  const old = [
    exp('a', T_EXPORT, { categoryId: 'cat-food', amount: 50000, note: 'typo amount' }),
    exp('b', T_EXPORT, { categoryId: 'cat-food', note: 'deleted later' }),
    exp('c', T_EXPORT, { categoryId: 'cat-food', note: 'never synced' }),
  ];
  const csv = toCSV(old, DEFAULT_CATEGORIES); // exported Sep 1
  const sheet = [
    { ...old[0], amount: 5000, updatedAt: T_EDIT }, // fixed in Oct
    { ...old[1], deleted: true, updatedAt: T_EDIT }, // deleted in Oct
  ];
  const store = fakeStore({ categories: DEFAULT_CATEGORIES }); // wiped and reseeded
  const plan = planImport(csv, await store.allExpenses(), await store.allCategories(), Date.UTC(2026, 9, 13));
  assert.equal(await store.importExpenses(plan.expenses), 3);

  const fetch = fakeFetch((body) => (body.op === 'pull' ? { ok: true, expenses: sheet, categories: [] } : { ok: true }));
  const res = await mk(store, fetch).link(PASS);
  assert.equal(res.pulled, 2);
  const local = (id) => store.recs.expense.get(id);
  assert.equal(local('a').amount, 5000);
  assert.equal(local('b').deleted, true);
  assert.equal(local('c').updatedAt, 0);
  const pushed = new Map(fetch.calls[1].body.expenses.map((e) => [e.id, e]));
  assert.deepEqual(pushed.get('a'), sheet[0]);
  assert.deepEqual(pushed.get('b'), sheet[1]);
  assert.equal(pushed.get('c').note, 'never synced');
  assert.equal(store.box.size, 0, 'stamp-0 entries clear like any other');
});

test('link writes only changed records and never overwrites newer local data', async () => {
  const newerLocal = exp('a', 10, { amount: 777 });
  const store = fakeStore({
    expenses: [newerLocal, exp('same', 5)], categories: [cat('c1', 9)],
  });
  const fetch = fakeFetch((body) => body.op === 'pull'
    ? { ok: true, expenses: [exp('a', 3, { amount: 1 }), exp('same', 5), exp('new', 1)], categories: [cat('c1', 2)] }
    : { ok: true });
  const res = await mk(store, fetch).link(PASS);
  assert.equal(res.pulled, 1);
  assert.deepEqual(store.putManyCalls, [['expense', [exp('new', 1)]]]);
  assert.deepEqual(store.recs.expense.get('a'), newerLocal);
  // local winners still reach the Sheet via markAllDirty
  const sent = fetch.calls[1].body.expenses.find((e) => e.id === 'a');
  assert.equal(sent.amount, 777);
});

test('link merges against local tombstones: a delete is not resurrected', async () => {
  const tomb = exp('a', 10, { deleted: true });
  const store = fakeStore({ expenses: [tomb] });
  const fetch = fakeFetch((body) =>
    body.op === 'pull' ? { ok: true, expenses: [exp('a', 5)], categories: [] } : { ok: true });
  const res = await mk(store, fetch).link(PASS);
  assert.equal(res.pulled, 0);
  assert.deepEqual(store.recs.expense.get('a'), tomb);
  assert.deepEqual(fetch.calls[1].body.expenses, [tomb]);
});

test('link still succeeds when the follow-up push fails; outbox keeps the changes', async () => {
  const store = fakeStore({ expenses: [exp('local1', 1)] });
  const fetch = fakeFetch((body) => {
    if (body.op === 'pull') return { ok: true, expenses: [exp('r1', 1)], categories: [] };
    throw new TypeError('offline');
  });
  const res = await mk(store, fetch).link(PASS);
  assert.deepEqual(res, { ok: true, pulled: 1, pushed: 0, pushError: 'network' });
  assert.equal(store.meta.linked, true);
  assert.equal(store.meta.passphrase, PASS);
  assert.equal(store.meta.lastError, 'network');
  assert.deepEqual([...store.box.keys()].sort(), ['expense:local1', 'expense:r1']);
});

test('remoteCount returns the Sheet expense count', async () => {
  const fetch = fakeFetch((body) => (body.pass === PASS ? { ok: true, expenses: 42 } : { ok: false, error: 'auth' }));
  const sync = mk(fakeStore(), fetch);
  assert.deepEqual(await sync.remoteCount(PASS), { ok: true, count: 42 });
  assert.equal(fetch.calls[0].body.op, 'count');
  assert.deepEqual(await sync.remoteCount('nope'), { ok: false, error: 'auth' });
});

test('remoteCount maps network and server errors', async () => {
  const store = fakeStore();
  const down = async () => { throw new TypeError('offline'); };
  assert.deepEqual(await mk(store, down).remoteCount(PASS), { ok: false, error: 'network', detail: 'network' });
  assert.deepEqual(await mk(store, fakeFetch(() => reply({}, 502))).remoteCount(PASS), { ok: false, error: 'server', detail: 'http 502' });
  assert.deepEqual(await mk(store, fakeFetch(() => ({ ok: true }))).remoteCount(PASS), { ok: false, error: 'server', detail: 'bad-reply' });
});

test('link skips pulled records a hand edit in the Sheet broke, keeps the rest', async () => {
  const store = fakeStore();
  const remote = [
    exp('ok', 1), exp('bad-date', 1, { date: 'Tue Oct 17 2026' }), exp('bad-time', 1, { time: '25:00' }),
    exp('zero', 1, { amount: 0 }), exp('no-note', 1, { note: undefined }),
  ];
  const fetch = fakeFetch((body) =>
    body.op === 'pull' ? { ok: true, expenses: remote, categories: [cat('c1', 1), cat('nameless', 1, { name: 5 })] } : { ok: true });
  const res = await mk(store, fetch).link(PASS);
  assert.equal(res.ok, true);
  assert.deepEqual([...store.recs.expense.keys()], ['ok']);
  assert.deepEqual([...store.recs.category.keys()], ['c1']);
});
