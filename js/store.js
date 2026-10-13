import * as db from './db.js';
import { DEFAULT_CATEGORIES, OTHER_ID } from './categories.js';

// The one source of truth on the phone. Every user write lands the record and its outbox
// mark in ONE transaction, so a change can never be saved without being queued for sync.
// Exported functions double as the store contract that createSync (sync.js) expects.

const STORE = { expense: 'expenses', category: 'categories' };
const META_KEY = 'meta';
const META_DEFAULTS = { passphrase: null, linked: false, lastSyncAt: null, lastError: null };

let opening = null;
const open = () => (opening ??= db.openDB().catch((e) => { opening = null; throw e; }));
const run = async (names, mode, fn) => db.tx(await open(), names, mode, fn);

const listeners = new Set();
export function onChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
function emit() {
  for (const fn of [...listeners]) {
    try { fn(); } catch (e) { console.error(e); } // a bad listener must not fail a committed write
  }
}

// Readwrite transaction, then notify listeners once it has committed.
async function write(names, fn) {
  const result = await run(names, 'readwrite', fn);
  emit();
  return result;
}

const outboxKey = (kind, id) => `${kind}:${id}`;
const mark = (s, kind, rec) =>
  db.put(s.outbox, { kind, id: rec.id, updatedAt: rec.updatedAt }, outboxKey(kind, rec.id));

// Strictly newer than the stored copy, so same-millisecond edits still win merges and clears.
const nextStamp = (prev) => Math.max(Date.now(), (prev?.updatedAt ?? 0) + 1);

// Write rec with a fresh updatedAt and queue it, inside the caller's transaction.
async function saveMarked(s, kind, prev, rec) {
  const out = { ...rec, updatedAt: nextStamp(prev) };
  await db.put(s[STORE[kind]], out);
  await mark(s, kind, out);
  return out;
}

// --- lifecycle ---

export async function init() {
  const seeded = await run(['categories', 'meta'], 'readwrite', async (s) => {
    if (await db.get(s.meta, META_KEY)) return false;
    // A meta record exists from first boot on, so a user who deletes every category is never re-seeded.
    if (!(await db.count(s.categories))) await db.putMany(s.categories, DEFAULT_CATEGORIES);
    await db.put(s.meta, { ...META_DEFAULTS }, META_KEY);
    return true;
  });
  if (seeded) emit();
}

// --- reads ---

const readAll = (name) => run([name], 'readonly', (s) => db.getAll(s[name]));
export const allExpenses = () => readAll('expenses');
export const allCategories = () => readAll('categories');
export const getOutbox = () => readAll('outbox');
export const getRecord = (kind, id) => run([STORE[kind]], 'readonly', (s) => db.get(s[STORE[kind]], id));
export const liveExpenses = async () => (await allExpenses()).filter((e) => !e.deleted);
export const liveCategories = async () =>
  (await allCategories()).filter((c) => !c.deleted).sort((a, b) => a.order - b.order);
export const isEmpty = async () => (await run(['expenses'], 'readonly', (s) => db.count(s.expenses))) === 0;
export const getMeta = async () =>
  ({ ...META_DEFAULTS, ...(await run(['meta'], 'readonly', (s) => db.get(s.meta, META_KEY))) });

// --- sync-facing writes ---

export const setMeta = (patch) => write(['meta'], async (s) => {
  const cur = { ...META_DEFAULTS, ...(await db.get(s.meta, META_KEY)) };
  await db.put(s.meta, { ...cur, ...patch }, META_KEY);
});

// Writes each record only if absent or strictly newer than the stored one; check and write share
// one transaction, so a local edit made meanwhile can never be overwritten by an older copy.
// Does not touch the outbox.
export async function putMany(kind, recs) {
  const written = await run([STORE[kind]], 'readwrite', async (s) => {
    const os = s[STORE[kind]];
    let n = 0;
    for (const rec of recs) {
      const cur = await db.get(os, rec.id);
      if (cur && (rec.updatedAt || 0) <= (cur.updatedAt || 0)) continue;
      await db.put(os, rec);
      n++;
    }
    return n;
  });
  if (written) emit();
}

// entries: {kind, id, updatedAt: stamp as sent}. An entry goes only if the record is still at the
// sent stamp (or gone); a record edited since stays queued. Check and delete are one transaction.
export async function clearOutbox(entries) {
  const cleared = await run(['outbox', 'expenses', 'categories'], 'readwrite', async (s) => {
    let n = 0;
    for (const { kind, id, updatedAt } of entries) {
      const rec = await db.get(s[STORE[kind]], id);
      if (rec && rec.updatedAt !== updatedAt) continue;
      await db.del(s.outbox, outboxKey(kind, id));
      n++;
    }
    return n;
  });
  if (cleared) emit();
}

// CSV import: writes only ids not stored yet and keeps their updatedAt (0 from fromCSV), so on a
// later restore the Sheet's newer edits and deletes win. Queued for sync. Returns the count written.
export async function importExpenses(recs) {
  const n = await run(['expenses', 'outbox'], 'readwrite', async (s) => {
    let written = 0;
    for (const rec of recs) {
      if (!Number.isSafeInteger(rec.amount) || rec.amount <= 0) throw new RangeError('amount must be a positive integer');
      if (await db.get(s.expenses, rec.id)) continue;
      await db.put(s.expenses, rec);
      await mark(s, 'expense', rec);
      written++;
    }
    return written;
  });
  if (n) emit();
  return n;
}

export const markAllDirty = () => write(['expenses', 'categories', 'outbox'], async (s) => {
  for (const kind of Object.keys(STORE)) {
    for (const rec of await db.getAll(s[STORE[kind]])) await mark(s, kind, rec);
  }
});

// --- user writes ---

export const saveExpense = (partial) => write(['expenses', 'outbox'], async (s) => {
  const prev = partial.id ? await db.get(s.expenses, partial.id) : undefined;
  const rec = {
    ...prev,
    ...partial,
    id: partial.id ?? crypto.randomUUID(),
    createdAt: prev?.createdAt ?? partial.createdAt ?? Date.now(),
    deleted: false,
  };
  if (!Number.isSafeInteger(rec.amount) || rec.amount <= 0) throw new RangeError('amount must be a positive integer');
  return saveMarked(s, 'expense', prev, rec);
});

export const deleteExpense = (id) => write(['expenses', 'outbox'], async (s) => {
  const prev = await db.get(s.expenses, id);
  if (!prev || prev.deleted) return;
  await saveMarked(s, 'expense', prev, { ...prev, deleted: true });
});

export const saveCategory = (partial) => write(['categories', 'outbox'], async (s) => {
  const prev = partial.id ? await db.get(s.categories, partial.id) : undefined;
  const rec = { ...prev, ...partial, id: partial.id ?? crypto.randomUUID(), deleted: false };
  if (rec.order === undefined) { // new category goes last
    rec.order = 1 + Math.max(-1, ...(await db.getAll(s.categories)).map((c) => c.order));
  }
  return saveMarked(s, 'category', prev, rec);
});

export async function deleteCategory(id) {
  if (id === OTHER_ID) throw new Error('the Other category cannot be deleted');
  return write(['categories', 'expenses', 'outbox'], async (s) => {
    const prev = await db.get(s.categories, id);
    if (!prev || prev.deleted) return;
    await saveMarked(s, 'category', prev, { ...prev, deleted: true });
    for (const e of await db.getAll(s.expenses)) {
      if (e.categoryId === id && !e.deleted) await saveMarked(s, 'expense', e, { ...e, categoryId: OTHER_ID });
    }
  });
}

export const reorderCategories = (ids) => write(['categories', 'outbox'], async (s) => {
  for (const [order, id] of ids.entries()) {
    const prev = await db.get(s.categories, id);
    if (prev && !prev.deleted && prev.order !== order) await saveMarked(s, 'category', prev, { ...prev, order });
  }
});
