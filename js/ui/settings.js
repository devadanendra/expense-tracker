import * as store from '../store.js';
import { toCSV, fromCSV } from '../csv.js';
import { mergeRecords } from '../merge.js';
import { icon } from '../icons.js';
import { canPrompt, isInstalled, promptInstall } from '../install.js';
import { sync, syncNow, render } from '../app.js';
import { esc, localISO } from './home.js';

const UNREACHABLE = "Can't reach Google — will retry";
const BAD_REPLY = 'Unexpected reply from the script — try redeploying';
const REASONS = { offline: "You're offline — will retry", timeout: 'Google took too long — will retry', 'bad-reply': BAD_REPLY, script: BAD_REPLY };
const PASS_HINT = 'Enter your Apps Script web app URL and the passphrase you set in it.';
const FORM_ERRORS = { auth: 'Wrong passphrase', nourl: 'Paste the web app URL ending in /exec' }; // anything else: can't reach

const PROTECT_HINT = "Chrome protects this app's data once it's installed. Open Chrome's ⋮ menu › Add to Home screen"
  + ' (or Install app), then open the app from your home screen. Keep Sheet sync or a CSV export as a backup.';
const INSTALL_HINT = 'In Chrome, tap ⋮ (top right) › Add to Home screen or Install app. Then open Expenses from your home screen.';
const THEMES = { system: 'System', light: 'Light', dark: 'Dark' };

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;

function ago(ms) {
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'just now';
  if (min < 60) return `${min} min ago`;
  if (min < 1440) return `${Math.floor(min / 60)} h ago`;
  return `${Math.floor(min / 1440)} d ago`;
}

// Why a push failed, from sync.js's error and detail: the sync row and its "Sync now" toast.
function failReason(error, detail) {
  if (error === 'auth') return 'Wrong passphrase';
  const http = /^http (\d+)$/.exec(detail);
  return http ? `Google returned an error (HTTP ${http[1]})` : REASONS[detail] ?? UNREACHABLE;
}

// Sync row subtitle, most urgent state first.
export function syncStatus({ meta, pending, now }) {
  if (!meta.linked) return 'Not set up';
  if (meta.lastError) return failReason(meta.lastError, meta.lastErrorDetail);
  if (pending) return `${plural(pending, 'change')} waiting`;
  return `Synced ${ago(now - (meta.lastSyncAt ?? now))}`;
}

// Storage row subtitle. usage in bytes from navigator.storage.estimate(); left out when unknown.
export function storageLine(persisted, usage) {
  const state = persisted ? 'Protected' : 'Not protected';
  if (typeof usage !== 'number') return state;
  const kb = usage / 1024;
  return `${state} · ${kb < 1000 ? `${kb.toFixed(1)} KB` : `${(kb / 1024).toFixed(1)} MB`} used`;
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
// action ({ label, run }) adds a button, such as Undo, that clears the toast when tapped.
export function toast(msg, action) {
  if (!toastEl) {
    toastEl = document.createElement('p');
    toastEl.className = 'toast';
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
  }
  (document.querySelector('dialog[open]') ?? document.body).append(toastEl);
  toastEl.textContent = msg;
  if (action) {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = action.label;
    b.addEventListener('click', () => {
      toastEl.textContent = '';
      action.run();
    }, { once: true });
    toastEl.append(b);
  }
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toastEl.textContent = ''; }, 4000);
}

// --- sheets ---

// Bottom sheet: a modal <dialog> on <body>, as the category editor, so typed text survives view
// re-renders. It removes itself on close and puts focus back on the opener's re-rendered twin.
export function openSheet(title, inner) {
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
  dragToClose(dlg);
  return dlg;
}

const CLOSE_DRAG = 0.25; // share of the sheet's height a drag must pass to close it
const FLING = 0.5; // px/ms downward that closes it anyway

// Drag down to close, from the grabber and title row only (the rest scrolls or holds inputs), as
// the entry sheet does: the sheet follows the finger and the backdrop fades with it; on release it
// closes past CLOSE_DRAG of its height or on a downward fling, else springs back.
function dragToClose(dlg) {
  let drag = null;
  const follow = (dy) => {
    dlg.style.transform = dy ? `translateY(${dy}px)` : '';
    dlg.style.setProperty('--bd', dy ? Math.max(0, 1 - dy / dlg.offsetHeight) : '');
  };
  dlg.addEventListener('pointerdown', (e) => {
    if (drag || !e.isPrimary || e.button > 0 || !e.target.closest('.grab, .sh') || e.target.closest('button')) return;
    drag = { id: e.pointerId, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    dlg.setPointerCapture(e.pointerId);
    dlg.classList.add('drag');
  });
  // Only the dragging pointer counts.
  dlg.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.timeStamp > drag.t) drag.v = (e.clientY - drag.y) / (e.timeStamp - drag.t);
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    follow(Math.max(0, e.clientY - drag.y0));
  });
  const release = (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y0);
    // A fling needs a recent fast move and some distance, so a tap's jitter never closes.
    const fling = drag.v > FLING && e.timeStamp - drag.t < 100 && dy > 16;
    drag = null;
    dlg.classList.remove('drag');
    if (e.type === 'pointerup' && (dy > dlg.offsetHeight * CLOSE_DRAG || fling)) {
      follow(dlg.offsetHeight);
      setTimeout(() => dlg.close(), matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    } else {
      follow(0);
    }
  };
  dlg.addEventListener('pointerup', release);
  dlg.addEventListener('pointercancel', release);
}

// Error line inside the sheet, or a toast if the owner already closed it: never swallowed.
const sayIn = (dlg, el) => (msg) => {
  if (!dlg.open) return toast(msg);
  el.textContent = msg;
  el.hidden = false;
};

// Connect (sync row) or restore (home card, Settings row). A real <form> whose username is the web
// app URL, so Chrome saves URL and passphrase together and fills both on a new phone. Neither is
// in the public code; the passphrase only goes to sync and is never logged.
export function openPassphrase(mode) {
  const restore = mode === 'restore';
  const verb = restore ? 'Restore' : 'Connect';
  const dlg = openSheet(restore ? 'Restore from Sheet' : 'Connect Google Sheet', `<form>
    <p class="ce-txt">${PASS_HINT}</p>
    <input class="note" type="url" name="username" autocomplete="username" inputmode="url" spellcheck="false"
      placeholder="https://script.google.com/macros/s/…/exec" aria-label="Web app URL" required autofocus>
    <input class="note" type="password" name="password" autocomplete="current-password"
      placeholder="Passphrase" aria-label="Passphrase" required>
    <p class="es-err" role="alert" hidden></p>
    <div class="btns">
      <button class="btn primary" type="submit">${verb}</button>
      <button class="btn" type="button" data-act="close" hidden>Cancel</button>
    </div>
  </form>`);
  const $ = (s) => dlg.querySelector(s);
  const [txt, url, input, err, submit, cancel] = ['.ce-txt', '[name=username]', '[name=password]', '.es-err', '[type=submit]', '[data-act=close].btn'].map($);
  // A linked phone (reconnecting after a wrong passphrase) already knows its URL.
  store.getMeta().then((m) => {
    if (!m.url || url.value) return;
    url.value = m.url;
    input.focus();
  }).catch(() => {});
  const say = sayIn(dlg, err);
  let count = null; // restore: the Sheet's expense count once it answered; Restore then links

  function ask(n) {
    count = n;
    txt.textContent = n === null ? PASS_HINT : `Your Sheet has ${plural(n, 'expense')}. Restore them?`;
    txt.classList.toggle('ask', n !== null);
    url.hidden = input.hidden = n !== null;
    cancel.hidden = n === null;
  }

  $('form').addEventListener('submit', async (ev) => {
    ev.preventDefault();
    if (submit.disabled) return;
    submit.disabled = true;
    err.hidden = true;
    let r;
    try {
      const u = url.value.trim();
      r = restore && count === null ? await sync.remoteCount(input.value, u) : await sync.link(input.value, u);
    } catch (e) {
      console.error(e);
      r = { ok: false, msg: `Couldn't ${verb.toLowerCase()}: ${e.message ?? e}` };
    }
    submit.disabled = false;
    if (!r.ok) {
      ask(null);
      say(r.msg ?? FORM_ERRORS[r.error] ?? "Can't reach Google");
      return (r.error === 'nourl' ? url : input).focus();
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

// Chrome's install dialog (home card, Settings row, info sheet). Needs the tap's user activation.
export async function install() {
  if ((await promptInstall()) === 'accepted') toast('Installing…');
}

// Info sheet with OK, plus an Install button when Chrome offers the prompt.
function openInfo(title, text) {
  const can = canPrompt();
  const dlg = openSheet(title, `<p class="ce-txt">${text}</p>
    <div class="btns">
      ${can ? '<button class="btn primary" type="button" data-act="install">Install app</button>' : ''}
      <button class="btn${can ? '' : ' primary'}" type="button" data-act="close">OK</button>
    </div>`);
  dlg.addEventListener('click', (ev) => {
    if (!ev.target.closest('[data-act=install]')) return;
    dlg.close();
    install();
  });
}

// Sync row "Sync now": the app's auto-push, so a success also lifts its retry mute.
// syncing keeps the row on "Syncing…" (disabled) through the re-renders the push's writes cause.
let syncing = false;
async function syncRow() {
  if (syncing) return;
  syncing = true;
  render();
  let r;
  try {
    r = await syncNow();
  } catch (e) {
    console.error(e);
    r = { ok: false, msg: `Couldn't sync: ${e.message ?? e}` };
  }
  syncing = false;
  toast(r?.ok === false ? r.msg ?? failReason(r.error, r.detail) : 'Synced'); // no result: nothing was queued
  render();
}

// Storage row: ask Chrome to keep the data (it says yes once the app is installed), else explain.
async function protect() {
  let ok = false;
  try { ok = await navigator.storage.persist(); } catch { /* no Storage API: same advice */ }
  if (!ok) return openInfo('Protect your data', PROTECT_HINT);
  toast('Storage protected');
  render();
}

// --- view ---

// One row: a button (act), a link (href), or inert text. Ids let render() keep focus on re-render.
function row({ ico, title, sub = '', end = '', act, href, disabled }) {
  const inner = `<span class="ico">${icon(ico)}</span>
    <span class="mid"><span class="t1">${title}</span>${sub ? `<span class="t2">${sub}</span>` : ''}</span>
    <span class="v">${end}${act || href ? icon('chevron-right') : ''}</span>`;
  if (href) return `<a class="sr" id="st-${ico}" href="${href}">${inner}</a>`;
  if (act) return `<button class="sr" id="st-${act}" type="button" data-act="${act}"${disabled ? ' disabled' : ''}>${inner}</button>`;
  return `<div class="sr">${inner}</div>`;
}

export async function renderSettings(root) {
  const [meta, outbox, expenses, cats, persisted, estimate] = await Promise.all([
    store.getMeta(), store.getOutbox(), store.liveExpenses(), store.liveCategories(),
    Promise.resolve(navigator.storage?.persisted?.()).catch(() => false),
    Promise.resolve(navigator.storage?.estimate?.()).catch(() => undefined),
  ]);
  const status = syncing ? 'Syncing…' : syncStatus({ meta, pending: outbox.length, now: Date.now() });
  const fixable = !meta.linked || meta.lastError === 'auth';
  const on = meta.linked && !meta.lastError;
  // Linked with a network/server error or changes waiting: a tap syncs now.
  const tap = fixable ? 'connect' : meta.linked && (syncing || meta.lastError || outbox.length) && 'sync';

  root.innerHTML = `<header class="bar"><a class="ib" href="#/" aria-label="Back">${icon('back')}</a><h1>Settings</h1></header>
  <section class="set">
    <h2 class="sg">Data safety</h2>
    <div class="lst">
      ${row({ ico: 'cloud', title: 'Google Sheet sync', sub: status, act: tap, disabled: syncing, end: on ? '<span class="dot"></span>On' : '' })}
      ${row({ ico: 'shield', title: 'Storage', sub: storageLine(persisted, estimate?.usage), act: 'storage' })}
      ${row({ ico: 'back', title: 'Restore from Sheet', act: 'restore' })}
    </div>
    <h2 class="sg">Data</h2>
    <div class="lst">
      ${row({ ico: 'download', title: 'Export CSV', sub: plural(expenses.length, 'expense'), act: 'export' })}
      ${row({ ico: 'upload', title: 'Import CSV', act: 'import' })}
    </div>
    <h2 class="sg">General</h2>
    <div class="lst">
      ${isInstalled() ? '' : row({ ico: 'phone', title: 'Install app', sub: 'Add to your home screen', act: 'install' })}
      ${row({ ico: 'tag', title: 'Categories', end: cats.length, href: '#/categories' })}
      ${row({ ico: 'theme', title: 'Appearance', end: `<span class="seg ap" role="group" aria-label="Appearance">${Object.entries(THEMES).map(([k, label]) =>
        `<button id="ap-${k}" type="button" data-ap="${k}" aria-pressed="${k === (globalThis.getTheme?.() ?? 'system')}">${label}</button>`).join('')}</span>` })}
    </div>
  </section>`;

  root.addEventListener('click', (ev) => {
    const ap = ev.target.closest('[data-ap]');
    if (ap) {
      globalThis.setTheme?.(ap.dataset.ap); // js/theme.js, a classic script; missing, Settings still renders
      for (const b of root.querySelectorAll('[data-ap]')) b.setAttribute('aria-pressed', b === ap);
      return;
    }
    switch (ev.target.closest('[data-act]')?.dataset.act) {
      case 'connect': return openPassphrase('connect');
      case 'sync': return syncRow();
      case 'restore': return openPassphrase('restore');
      case 'import': return openImport();
      case 'storage': return protect();
      case 'install': return canPrompt() ? install() : openInfo('Install the app', INSTALL_HINT);
      case 'export': return openExport().catch((e) => { console.error(e); toast(`Couldn't export: ${e.message ?? e}`); });
    }
  });
}
