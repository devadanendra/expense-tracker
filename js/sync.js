import { mergeRecords } from './merge.js';

const KINDS = [
  ['expense', 'allExpenses', 'expenses'],
  ['category', 'allCategories', 'categories'],
];
const fail = (error) => ({ ok: false, error });

// One-way push to the owner's Sheet (Apps Script web app) plus link/restore.
// The passphrase only ever travels in the POST body, never the URL, and is never logged.
export function createSync({ url, fetch, store }) {
  let inflight = null;

  // POST one op. Resolves {ok:true, data} or {ok:false, error}; never rejects.
  async function call(payload) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: no CORS preflight
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000), // a hung request must not block every later push (single flight)
      });
    } catch {
      return fail('network');
    }
    if (!res.ok) return fail('server');
    let data;
    try {
      data = await res.json();
    } catch {
      return fail('server');
    }
    if (!data || data.ok !== true) return fail(data && data.error === 'auth' ? 'auth' : 'server');
    return { ok: true, data };
  }

  async function doPush() {
    const meta = await store.getMeta();
    if (!meta.linked) return fail('unlinked');

    const outbox = await store.getOutbox();
    const gone = []; // entries whose record no longer exists: nothing to send
    const sent = []; // { kind, id, updatedAt } as sent
    const body = { op: 'upsert', pass: meta.passphrase, expenses: [], categories: [] };
    for (const entry of outbox) {
      const rec = await store.getRecord(entry.kind, entry.id);
      if (!rec) { gone.push(entry); continue; }
      sent.push({ kind: entry.kind, id: entry.id, updatedAt: rec.updatedAt });
      body[entry.kind === 'expense' ? 'expenses' : 'categories'].push(rec);
    }
    if (!sent.length) {
      if (gone.length) await store.clearOutbox(gone);
      return { ok: true, pushed: 0 };
    }

    const r = await call(body);
    if (!r.ok) {
      await store.setMeta({ lastError: r.error });
      return r;
    }
    // The store clears an entry only if its record is still at the sent updatedAt, atomically,
    // so a record re-edited mid-flight stays queued.
    await store.clearOutbox([...gone, ...sent]);
    await store.setMeta({ lastError: null, lastSyncAt: Date.now() });
    return { ok: true, pushed: sent.length };
  }

  function push() {
    if (!url) return Promise.resolve(fail('nourl'));
    if (!inflight) inflight = doPush().finally(() => { inflight = null; });
    return inflight;
  }

  async function link(pass) {
    if (!url) return fail('nourl');
    const r = await call({ op: 'pull', pass });
    if (!r.ok) return r;
    const { data } = r;
    if (!Array.isArray(data.expenses) || !Array.isArray(data.categories)) return fail('server');

    let pulled = 0;
    for (const [kind, readLocal, key] of KINDS) {
      const { changed } = mergeRecords(await store[readLocal](), data[key]);
      if (changed.length) await store.putMany(kind, changed);
      pulled += changed.length;
    }
    await store.setMeta({ passphrase: pass, linked: true, lastError: null, url });
    await store.markAllDirty();
    // Let a push already running finish so the marked entries go out in a fresh one.
    if (inflight) await inflight.catch(() => {});
    const p = await push();
    return p.ok
      ? { ok: true, pulled, pushed: p.pushed ?? 0 }
      : { ok: true, pulled, pushed: 0, pushError: p.error };
  }

  async function remoteCount(pass) {
    if (!url) return fail('nourl');
    const r = await call({ op: 'count', pass });
    if (!r.ok) return r;
    return typeof r.data.expenses === 'number' ? { ok: true, count: r.data.expenses } : fail('server');
  }

  return { push, link, remoteCount };
}
