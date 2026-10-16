import * as store from '../store.js';
import { SHEET_URL } from '../config.js';
import { toCSV, fromCSV } from '../csv.js';
import { mergeRecords } from '../merge.js';
import { icon } from '../icons.js';
import { sync } from '../app.js';
import { esc, localISO } from './home.js';

const NOT_SET_UP = 'Not set up — see SETUP.md';
const UNREACHABLE = "Can't reach Google — will retry";
const PASS_HINT = 'Enter the passphrase you set in the Apps Script.';
const FORM_ERRORS = { auth: 'Wrong passphrase', nourl: NOT_SET_UP }; // anything else: can't reach

const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}

// Sync row subtitle, most urgent state first.
export function syncStatus({ url, meta, pending, now }) {
  if (!url) return NOT_SET_UP;
  if (!meta.linked) return 'Not set up';
  if (meta.lastError === 'auth') return 'Wrong passphrase';
  if (meta.lastError) return UNREACHABLE;
  if (pending) return `${plural(pending, 'change')} waiting`;
  return `Synced ${ago(now - (meta.lastSyncAt ?? now))}`;
}

// What a CSV import writes: only expenses whose id is not here yet (imported rows carry
// updatedAt 0, so they never beat a local copy) and only the new categories those use.
export function planImport(text, local, categories, now) {
  const { expenses, newCategories, errors } = fromCSV(text, categories, now);
  const { changed } = mergeRecords(local, expenses);
  const used = new Set(changed.map((e) => e.categoryId));
  return { expenses: changed, categories: newCategories.filter((c) => used.has(c.id)), errors };
}

// --- toast ---

let toastEl;
let toastTimer;
// One polite live region. It moves into an open modal <dialog>, since the page behind one is inert.
export function toast(msg) {
  if (!toastEl) {
    toastEl = document.createElement('p');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
  }
  (document.querySelector('dialog[open]') ?? document.body).append(toastEl);
  toastEl.textContent = msg;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 4000);
}

// --- sheets ---

// Bottom sheet: a modal <dialog> on <body>, as the category editor, so typed text survives view
// re-renders. It removes itself on close and puts focus back on the opener's re-rendered twin.
function openSheet(title, inner) {
  const opener = document.activeElement?.id;
  const dlg = document.createElement('dialog');
  dlg.className = 'ce';
  dlg.setAttribute('aria-labelledby', 'st-title');
  dlg.innerHTML = `<div class="ce-f">
    <div class="grab" aria-hidden="true"></div>
    <div class="sh">
      <h2 id="st-title">${title}</h2>
      <button class="x" type="button" data-act="close" aria-label="Close">${icon('x')}</button>
    </div>
    ${inner}
  </div>`;
  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg || ev.target.closest('[data-act=close]')) dlg.close(); // backdrop or close
  });
  dlg.addEventListener('close', () => {
    dlg.remove();
    if (opener) document.getElementById(opener)?.focus();
  });
  document.body.append(dlg);
  dlg.showModal();
  return dlg;
}

// Error line inside the sheet, or a toast if the owner already closed it: never swallowed.
const sayIn = (dlg, el) => (msg) => {
  if (!dlg.open) return toast(msg);
  el.textContent = msg;
  el.hidden = false;
};

// Connect (sync row) or restore (home card, Settings row). A real <form> with a username/password
// pair so Chrome offers to save the passphrase. The passphrase only goes to sync: never logged.
export function openPassphrase(mode) {
  const restore = mode === 'restore';
  const verb = restore ? 'Restore' : 'Connect';
  const dlg = openSheet(restore ? 'Restore from Sheet' : 'Connect Google Sheet', `<form>
    <p class="ce-txt">${PASS_HINT}</p>
    <input type="text" name="username" autocomplete="username" value="expense-tracker" hidden>
    <input class="note" type="password" name="password" autocomplete="current-password"
      placeholder="Passphrase" aria-label="Passphrase" required autofocus>
    <p class="es-err" role="alert" hidden></p>
    <div class="btns">
      <button class="btn primary" type="submit">${verb}</button>
      <button class="btn" type="button" data-act="close" hidden>Cancel</button>
    </div>
  </form>`);
  const $ = (s) => dlg.querySelector(s);
  const [txt, input, err, submit, cancel] = ['.ce-txt', '[name=password]', '.es-err', '[type=submit]', '[data-act=close].btn'].map($);
  const say = sayIn(dlg, err);
  let count = null; // restore: the Sheet's expense count once it answered; Restore then links

  function ask(n) {
    count = n;
    txt.textContent = n === null ? PASS_HINT : `Your Sheet has ${plural(n, 'expense')}. Restore them?`;
    txt.classList.toggle('ask', n !== null);
    input.hidden = n !== null;
    cancel.hidden = n === null;
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    err.hidden = true;
    let r;
    try {
      r = restore && count === null ? await sync.remoteCount(input.value) : await sync.link(input.value);
    } catch (e) {
      console.error(e);
      r = { ok: false, msg: `Couldn't ${verb.toLowerCase()}: ${e.message ?? e}` };
    }
    submit.disabled = false;
    if (!r.ok) {
      ask(null);
      say(r.msg ?? FORM_ERRORS[r.error] ?? "Can't reach Google");
      return input.focus();
    }
    if ('count' in r) {
      ask(r.count);
      return submit.focus();
    }
    dlg.close();
    const done = restore || r.pulled ? `Restored ${plural(r.pulled, 'record')}` : 'Connected';
    toast(r.pushError ? `${done} · ${UNREACHABLE}` : done);
  });
}

async function openExport() {
  const [expenses, categories] = await Promise.all([store.liveExpenses(), store.allCategories()]);
  const csv = toCSV(expenses, categories); // built up front: clipboard needs the tap's user activation
  const dlg = openSheet('Export CSV', `<p class="ce-txt">${plural(expenses.length, 'expense')}</p>
    <p class="es-err" role="alert" hidden></p>
    <div class="btns">
      <button class="btn primary" type="button" data-act="download">Download</button>
      <button class="btn" type="button" data-act="copy">Copy</button>
    </div>`);
  const say = sayIn(dlg, dlg.querySelector('.es-err'));
  dlg.addEventListener('click', async (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'download') {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
      a.download = `expenses-${localISO()}.csv`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      dlg.close();
    } else if (act === 'copy') {
      try {
        await navigator.clipboard.writeText(csv);
      } catch {
        return say("Can't copy here — use Download");
      }
      dlg.close();
      toast(`Copied ${plural(expenses.length, 'expense')}`);
    }
  });
}

function openImport() {
  const dlg = openSheet('Import CSV', `<form>
    <button class="btn" type="button" data-act="file">Choose file</button>
    <input type="file" accept=".csv,text/csv,text/comma-separated-values" hidden>
    <p class="ce-lbl">Or paste</p>
    <textarea class="note" rows="5" required aria-label="CSV text" placeholder="date,time,amount,category,note,id"></textarea>
    <ul class="es-err imp-err" role="alert" hidden></ul>
    <button class="btn primary" type="submit">Import</button>
  </form>`);
  const [file, text, err, submit] = ['[type=file]', 'textarea', '.es-err', '[type=submit]'].map((s) => dlg.querySelector(s));

  async function run(read) {
    if (submit.disabled) return;
    submit.disabled = true;
    err.hidden = true;
    try {
      const plan = planImport(await read(), await store.allExpenses(), await store.allCategories(), Date.now());
      for (const c of plan.categories) await store.saveCategory(c); // categories first: no dangling ids
      const n = await store.importExpenses(plan.expenses); // keeps stamp 0: a later restore lets the Sheet win
      if (plan.errors.length) {
        err.innerHTML = plan.errors.map((m) => `<li>${esc(m)}</li>`).join('');
        err.hidden = false;
      } else {
        dlg.close();
      }
      toast(`Imported ${n}, skipped ${plan.errors.length}`);
    } catch (e) {
      console.error(e);
      sayIn(dlg, err)(`Couldn't import: ${e.message ?? e}`);
    }
    submit.disabled = false;
  }

  dlg.addEventListener('click', (ev) => { if (ev.target.closest('[data-act=file]')) file.click(); });
  file.addEventListener('change', () => {
    const f = file.files[0];
    file.value = ''; // the same file can be picked again
    if (f) run(() => f.text());
  });
  dlg.querySelector('form').addEventListener('submit', (ev) => {
    ev.preventDefault();
    run(() => text.value);
  });
}

// --- view ---

// One row: a button (act), a link (href), or inert text. Ids let render() keep focus on re-render.
function row({ ico, title, sub = '', end = '', act, href }) {
  const inner = `<span class="ico">${icon(ico)}</span>
    <span class="mid"><span class="t1">${title}</span>${sub ? `<span class="t2">${sub}</span>` : ''}</span>
    <span class="v">${end}${act || href ? icon('chevron-right') : ''}</span>`;
  if (href) return `<a class="sr" id="st-${ico}" href="${href}">${inner}</a>`;
  if (act) return `<button class="sr" id="st-${act}" type="button" data-act="${act}">${inner}</button>`;
  return `<div class="sr">${inner}</div>`;
}

export async function renderSettings(root) {
  const [meta, outbox, expenses, cats, persisted] = await Promise.all([
    store.getMeta(), store.getOutbox(), store.liveExpenses(), store.liveCategories(),
    Promise.resolve(navigator.storage?.persisted?.()).catch(() => false),
  ]);
  const status = syncStatus({ url: SHEET_URL, meta, pending: outbox.length, now: Date.now() });
  const fixable = SHEET_URL && (!meta.linked || meta.lastError === 'auth');
  const on = SHEET_URL && meta.linked && !meta.lastError;

  root.innerHTML = `<header class="bar"><a class="ib" href="#/" aria-label="Back">${icon('back')}</a><h1>Settings</h1></header>
  <section class="set">
    <h2 class="sg">Data safety</h2>
    <div class="lst">
      ${row({ ico: 'cloud', title: 'Google Sheet sync', sub: status, act: fixable && 'connect', end: on ? '<span class="dot"></span>On' : '' })}
      ${row({ ico: 'shield', title: 'Storage', sub: persisted ? 'Protected' : 'Not protected — install the app to your home screen' })}
      ${row({ ico: 'back', title: 'Restore from Sheet', sub: SHEET_URL ? '' : NOT_SET_UP, act: SHEET_URL && 'restore' })}
    </div>
    <h2 class="sg">Data</h2>
    <div class="lst">
      ${row({ ico: 'download', title: 'Export CSV', sub: plural(expenses.length, 'expense'), act: 'export' })}
      ${row({ ico: 'upload', title: 'Import CSV', act: 'import' })}
    </div>
    <h2 class="sg">General</h2>
    <div class="lst">
      ${row({ ico: 'tag', title: 'Categories', end: cats.length, href: '#/categories' })}
      ${row({ ico: 'theme', title: 'Appearance', end: `<span class="seg ap" role="group" aria-label="Appearance">${Object.entries(THEMES).map(([k, label]) =>
        `<button id="ap-${k}" type="button" data-ap="${k}" aria-pressed="${k === getTheme()}">${label}</button>`).join('')}</span>` })}
    </div>
  </section>`;

  root.addEventListener('click', (ev) => {
    const ap = ev.target.closest('[data-ap]');
    if (ap) {
      setTheme(ap.dataset.ap); // js/theme.js (a classic script, so a global)
      for (const b of root.querySelectorAll('[data-ap]')) b.setAttribute('aria-pressed', b === ap);
      return;
    }
    switch (ev.target.closest('[data-act]')?.dataset.act) {
      case 'connect': return openPassphrase('connect');
      case 'restore': return openPassphrase('restore');
      case 'import': return openImport();
      case 'export': return openExport().catch((e) => { console.error(e); toast(`Couldn't export: ${e.message ?? e}`); });
    }
  });
}
