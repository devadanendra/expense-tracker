import * as store from './store.js';
import { SHEET_URL } from './config.js';
import { createSync } from './sync.js';
import { renderHome, localISO } from './ui/home.js';
import { openEntrySheet } from './ui/entry-sheet.js';
import { renderReports } from './ui/reports.js';
import { renderSearch } from './ui/search.js';
import { renderCategories } from './ui/categories.js';
import { renderSettings, openPassphrase } from './ui/settings.js';

// Shared UI state. ym is the selected month ('YYYY-MM'), set in boot(); report is the reports
// segment ('categories' | 'weeks'); query is the search text.
export const state = { ym: '', restoreDismissed: false, report: 'categories', query: '' };

// Opens the entry sheet (expense undefined = new). The view re-renders itself via store.onChange.
export function openEntry(expense) {
  openEntrySheet({ expense }).catch((e) => console.error(e));
}
// fetch is wrapped: an unbound window.fetch throws "Illegal invocation".
export const sync = createSync({ url: SHEET_URL, fetch: (...a) => fetch(...a), store });

// Home restore card: passphrase, "Your Sheet has N expenses. Restore them?", then link.
export function startRestore() {
  openPassphrase('restore');
}

// Push queued changes, only once linked (an unlinked device never pushes: link pull-merges first).
// A failed push mutes store-change triggers (its own meta write is one) and retries in 60 s, so
// offline never loops; going online or back to the app lifts the mute.
let pushTimer = 0;
let mutedUntil = 0;
async function autoPush() {
  clearTimeout(pushTimer);
  if (!SHEET_URL || !(await store.getMeta()).linked || !(await store.getOutbox()).length) return;
  const r = await sync.push();
  if (r.ok) return;
  mutedUntil = Date.now() + 60000;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 60000);
}
function pushNow() {
  mutedUntil = 0;
  autoPush().catch((e) => console.error(e));
}
function pushSoon() {
  if (Date.now() < mutedUntil) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 2000);
}

const ROUTES = {
  '#/': renderHome,
  '#/reports': renderReports,
  '#/search': renderSearch,
  '#/settings': renderSettings,
  '#/categories': renderCategories,
};
const NAV_ROUTES = ['#/', '#/reports'];

let seq = 0;
let shown = '';

// Renders the current route into a fresh container and swaps it in only if no newer render
// started meanwhile, so overlapping async renders never leave stale data on screen.
// A re-render of the same route keeps focus and caret on the element with the same id
// (search typing survives store changes); entering a route focuses its [autofocus] element.
export async function render() {
  const route = ROUTES[location.hash] ? location.hash : '#/';
  const my = ++seq;
  const view = document.createElement('div');
  view.className = 'view';
  try {
    await ROUTES[route](view, state);
  } catch (e) {
    console.error(e);
    view.innerHTML = '<p class="error"></p>';
    view.firstChild.textContent = `Something went wrong: ${e.message ?? e}`;
  }
  if (my !== seq) return;
  const app = document.getElementById('app');
  const prev = document.activeElement;
  const keep = route === shown && prev?.id && app.contains(prev) ? prev : null;
  const sel = [keep?.selectionStart, keep?.selectionEnd];
  app.replaceChildren(view);
  const next = keep ? document.getElementById(keep.id) : route !== shown ? view.querySelector('[autofocus]') : null;
  next?.focus({ preventScroll: true });
  if (sel[0] != null && next?.setSelectionRange) next.setSelectionRange(...sel);
  const nav = document.querySelector('.nav');
  nav.hidden = !NAV_ROUTES.includes(route);
  for (const a of nav.querySelectorAll('a')) {
    if (a.getAttribute('href') === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (route !== shown) scrollTo(0, 0);
  shown = route;
}

// Store changes re-render once a burst of writes settles: link and push each fire several
// (putMany, setMeta, markAllDirty, clearOutbox), and a CSV import one per new category.
let renderTimer = 0;
function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 30);
}

// A changed SHEET_URL points at a Sheet without what earlier pushes sent: queue everything once.
async function adoptSheetUrl() {
  const meta = await store.getMeta();
  if (!SHEET_URL || !meta.linked || meta.url === SHEET_URL) return;
  await store.markAllDirty();
  await store.setMeta({ url: SHEET_URL });
}

export async function boot() {
  state.ym = localISO().slice(0, 7);
  navigator.storage?.persist?.().catch(() => {});
  navigator.serviceWorker?.register('sw.js').catch((e) => console.error('service worker', e));
  try {
    await store.init();
  } catch (e) {
    console.error(e);
    document.getElementById('app').textContent = `Can't open storage: ${e.message}`;
    return;
  }
  await adoptSheetUrl().catch((e) => console.error(e));
  document.querySelector('.nav .p').addEventListener('click', () => openEntry());
  addEventListener('hashchange', render);
  // Back from the background on a new day: refresh "Today" labels and the strip.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render();
    pushNow();
  });
  addEventListener('online', pushNow);
  store.onChange(renderSoon);
  store.onChange(pushSoon);
  await render();
  pushNow();
}
