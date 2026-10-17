import { mergeRecords } from './merge.js';
import { validDate, validTime } from './csv.js';

const KINDS = [
  ['expense', 'allExpenses', 'expenses'],
  ['category', 'allCategories', 'categories'],
];
// Sheet cells are free text: a pulled record a hand edit broke is skipped, not stored to crash a view.
const VALID = {
  expenses: (e) => validDate(e.date) && validTime(e.time) && Number.isSafeInteger(e.amount) && e.amount > 0
    && typeof e.categoryId === 'string' && typeof e.note === 'string',
  categories: (c) => typeof c.name === 'string',
};
const CHUNK = 200; // records per upsert: a big outbox (after link) never makes one request slow enough to time out
// detail, on network/server failures only, says why for the sync row:
// offline | timeout | network | http <status> | bad-reply | script.
const fail = (error, detail) => ({ ok: false, error, ...(detail && { detail }) });

// The web app URL is a second secret next to the passphrase: it is typed in once per phone and
// kept in meta, never in the public code. Only an Apps Script web app gets the passphrase.
export const validUrl = (u) => /^https:\/\/script\.google\.com\/macros\/s\/[\w-]+\/exec$/.test(u);

// One-way push to the owner's Sheet (Apps Script web app) plus link/restore.
// The passphrase only ever travels in the POST body, never the URL, and is never logged.
export function createSync({ fetch, store }) {
  let inflight = null;

  // POST one op. Resolves {ok:true, data} or {ok:false, error, detail?}; never rejects.
  async function call(url, payload) {
    let res;
    try {
      res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, // simple request: no CORS preflight
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(60000), // a hung request must not block every later push (single flight)
      });
    } catch (e) {
      return fail('network', globalThis.navigator?.onLine === false ? 'offline'
        : e?.name === 'TimeoutError' || e?.name === 'AbortError' ? 'timeout' : 'network');
    }
    if (!res.ok) return fail('server', `http ${res.status}`);
    let data;
    try {
      data = await res.json();
    } catch {
      return fail('server', 'bad-reply');
    }
    if (data?.ok === true) return { ok: true, data };
    return data?.error === 'auth' ? fail('auth') : fail('server', 'script');
  }

  async function doPush() {
    const meta = await store.getMeta();
    if (!meta.linked) return fail('unlinked');
    if (!validUrl(meta.url)) return fail('nourl');

    const outbox = await store.getOutbox();
    const gone = []; // entries whose record no longer exists: nothing to send
    const sent = []; // [{ kind, id, updatedAt } as sent, record]
    for (const entry of outbox) {
      const rec = await store.getRecord(entry.kind, entry.id);
      if (!rec) { gone.push(entry); continue; }
      sent.push([{ kind: entry.kind, id: entry.id, updatedAt: rec.updatedAt }, rec]);
    }
    if (gone.length) await store.clearOutbox(gone);
    // Nothing left to send: an error saved by an earlier attempt no longer applies.
    if (!sent.length && meta.lastError && meta.lastError !== 'auth') await store.setMeta({ lastError: null, lastErrorDetail: null });

    // Categories first (stable sort), so the Sheet never holds an expense before its category.
    // Chunks go one at a time; a failed one stops the push and leaves it and the rest queued.
    sent.sort((a, b) => (a[0].kind === 'expense') - (b[0].kind === 'expense'));
    for (let i = 0; i < sent.length; i += CHUNK) {
      const chunk = sent.slice(i, i + CHUNK);
      const body = { op: 'upsert', pass: meta.passphrase, expenses: [], categories: [] };
      for (const [{ kind }, rec] of chunk) body[kind === 'expense' ? 'expenses' : 'categories'].push(rec);
      const r = await call(meta.url, body);
      if (!r.ok) {
        await store.setMeta({ lastError: r.error, lastErrorDetail: r.detail ?? null });
        return r;
      }
      // The store clears an entry only if its record is still at the sent updatedAt, atomically,
      // so a record re-edited mid-flight stays queued.
      await store.clearOutbox(chunk.map(([entry]) => entry));
      await store.setMeta({ lastError: null, lastErrorDetail: null, lastSyncAt: Date.now() });
    }
    return { ok: true, pushed: sent.length };
  }

  function push() {
    if (!inflight) inflight = doPush().finally(() => { inflight = null; });
    return inflight;
  }

  async function link(pass, url) {
    if (!validUrl(url)) return fail('nourl');
    const r = await call(url, { op: 'pull', pass });
    if (!r.ok) return r;
    const { data } = r;
    if (!Array.isArray(data.expenses) || !Array.isArray(data.categories)) return fail('server', 'bad-reply');

    let pulled = 0;
    for (const [kind, readLocal, key] of KINDS) {
      const { changed } = mergeRecords(await store[readLocal](), data[key].filter(VALID[key]));
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

  async function remoteCount(pass, url) {
    if (!validUrl(url)) return fail('nourl');
    const r = await call(url, { op: 'count', pass });
    if (!r.ok) return r;
    return typeof r.data.expenses === 'number' ? { ok: true, count: r.data.expenses } : fail('server', 'bad-reply');
  }

  return { push, link, remoteCount };
}
