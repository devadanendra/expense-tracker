// IndexedDB adapter: open the database and thin promise helpers over one object store.
// Helpers take an IDBObjectStore so several can share a single transaction (see tx).
const NAME = 'expense-tracker';
const VERSION = 1;

const req = (r) => new Promise((resolve, reject) => {
  r.onsuccess = () => resolve(r.result);
  r.onerror = () => reject(r.error);
});

export function openDB() {
  return new Promise((resolve, reject) => {
    const r = indexedDB.open(NAME, VERSION);
    r.onupgradeneeded = () => {
      const db = r.result;
      db.createObjectStore('expenses', { keyPath: 'id' });
      db.createObjectStore('categories', { keyPath: 'id' });
      db.createObjectStore('meta'); // out-of-line keys
      db.createObjectStore('outbox');
    };
    r.onsuccess = () => resolve(r.result);
    r.onerror = () => reject(r.error);
    r.onblocked = () => reject(new Error('database blocked by another tab'));
  });
}

// Run fn({storeName: IDBObjectStore}) in one transaction; resolves with fn's result once the
// transaction has committed. If fn throws, the whole transaction is rolled back.
// fn may only await the helpers below: awaiting anything else lets the transaction auto-commit.
export function tx(db, names, mode, fn) {
  return new Promise((resolve, reject) => {
    // strict durability: flushed to disk before `complete`, so a killed tab cannot lose a save
    const t = db.transaction(names, mode, mode === 'readwrite' ? { durability: 'strict' } : undefined);
    const stores = Object.fromEntries(names.map((n) => [n, t.objectStore(n)]));
    let result;
    t.oncomplete = () => resolve(result);
    t.onabort = () => reject(t.error ?? new Error('transaction aborted'));
    let p;
    try { p = Promise.resolve(fn(stores)); } catch (e) { p = Promise.reject(e); }
    p.then((r) => { result = r; }, (e) => {
      reject(e);
      try { t.abort(); } catch { /* already finished */ }
    });
  });
}

export const get = (os, key) => req(os.get(key));
export const put = (os, value, key) => req(key === undefined ? os.put(value) : os.put(value, key));
export const putMany = (os, values) => Promise.all(values.map((v) => put(os, v)));
export const getAll = (os) => req(os.getAll());
export const count = (os) => req(os.count());
export const del = (os, key) => req(os.delete(key));
export const clear = (os) => req(os.clear());
