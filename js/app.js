import { onInstallChange } from './install.js';
import * as store from './store.js';
import { createSync } from './sync.js';
import { renderHome, localISO } from './ui/home.js';
import { openEntrySheet } from './ui/entry-sheet.js';
import { openFrequent } from './ui/frequent.js';
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
export const sync = createSync({ fetch: (...a) => fetch(...a), store });

// Home restore card: passphrase, "Your Sheet has N expenses. Restore them?", then link.
export function startRestore() {
  openPassphrase('restore');
}

// Push queued changes, only once linked (an unlinked device never pushes: link pull-merges first).
// A failed push mutes store-change triggers (its own meta write is one) and retries in 60 s, so
// offline never loops; going online, back to the app or Settings' "Sync now" lifts the mute.
// Resolves sync.push()'s result, or undefined when there is nothing to push.
let pushTimer = 0;
let mutedUntil = 0;
async function autoPush() {
  clearTimeout(pushTimer);
  if (!(await store.getMeta()).linked || !(await store.getOutbox()).length) return;
  const r = await sync.push();
  if (r.ok) return r;
  mutedUntil = Date.now() + 60000;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(pushNow, 60000);
  return r;
}
export function syncNow() {
  mutedUntil = 0;
  return autoPush();
}
function pushNow() {
  syncNow().catch((e) => console.error(e));
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
const routeOf = (hash) => (ROUTES[hash] ? hash : '#/');
const page = () => routeOf(location.hash);
const depth = (route) => (route === '#/' ? 0 : 1);

// Transactions (#/) is the history root and every other page sits one entry above it, so one
// system back returns home and back on home leaves the app. Every in-app link comes through here.
// goingHome stops a double tap on a link home from going back twice, out of the app.
let goingHome = false;
function navigate(hash) {
  const from = page();
  uaAnimated = false;
  if (hash === from || goingHome) return;
  if (hash === '#/' && history.state?.sub) {
    goingHome = true;
    return history.back(); // hashchange renders home
  }
  if (hash === '#/') history.replaceState(null, '', '#/');
  else if (from === '#/') history.pushState({ sub: 1 }, '', hash);
  else history.replaceState({ sub: 1 }, '', hash);
  render();
}

let seq = 0;
let shown = '';
// Set by popstate when the browser already animated the back (Android gesture): skip ours then.
let uaAnimated = false;

// Renders the current route into a fresh container and swaps it in only if no newer render
// started meanwhile, so overlapping async renders never leave stale data on screen.
// A re-render of the same route keeps focus and caret on the element with the same id
// (search typing survives store changes); entering a route focuses its [autofocus] element.
export async function render() {
  const route = page();
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
  const swap = () => {
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
  };
  const animate = shown && route !== shown && !uaAnimated && document.startViewTransition;
  uaAnimated = false;
  if (!animate) return swap();
  // Page change: the new page slides in over a fade, from the side matching its depth (styles.css).
  const dir = depth(route) - depth(shown);
  document.documentElement.dataset.vt = dir > 0 ? 'fwd' : dir < 0 ? 'back' : 'fade';
  const t = document.startViewTransition(swap);
  t.finished.finally(() => delete document.documentElement.dataset.vt);
  await t.updateCallbackDone;
}

// Store changes re-render once a burst of writes settles: link and push each fire several
// (putMany, setMeta, markAllDirty, clearOutbox), and a CSV import one per new category.
let renderTimer = 0;
function renderSoon() {
  clearTimeout(renderTimer);
  renderTimer = setTimeout(render, 30);
}

// The "New expense" app shortcut opens #/add: land on home (replacing the hash, so back never
// loops), then open the entry sheet.
async function route() {
  goingHome = false;
  const add = location.hash === '#/add';
  if (add) history.replaceState(null, '', '#/');
  await render();
  if (add) openEntry();
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
  // Tap + for the entry sheet; hold it (or the menu key) for the Frequent arc, which follows the
  // still-held finger. A ring fills while holding (.holding). The tap that ends a hold only
  // releases it.
  const plus = document.querySelector('.nav .p');
  let holdTimer = 0;
  let held = false;
  let downId;
  const hold = () => {
    clearTimeout(holdTimer);
    plus.classList.remove('holding');
    held = true;
    navigator.vibrate?.(10);
    openFrequent({ plus, pointerId: downId }).catch((e) => console.error(e));
  };
  plus.addEventListener('pointerdown', (e) => {
    held = false;
    downId = undefined;
    if (e.button > 0) return;
    downId = e.pointerId;
    plus.classList.add('holding');
    holdTimer = setTimeout(hold, 450);
  });
  for (const t of ['pointerup', 'pointercancel', 'pointerleave']) {
    plus.addEventListener(t, () => {
      clearTimeout(holdTimer);
      plus.classList.remove('holding');
      if (t !== 'pointerleave') downId = undefined;
    });
  }
  plus.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    if (!held) hold();
  });
  plus.addEventListener('click', () => {
    if (held) held = false;
    else openEntry();
  });
  // Links, tapped or Enter-activated (both fire click). Back/forward still render via hashchange.
  document.addEventListener('click', (ev) => {
    const a = ev.target.closest('a[href^="#/"]');
    if (!a) return;
    ev.preventDefault();
    navigate(a.getAttribute('href'));
  });
  // Builds before et-v8 pushed an entry per link, and a reload or update keeps those, so back
  // walked through every page visited. Collapse to the app's first entry, then rebuild
  // Transactions plus at most the page shown. Needs the Navigation API (Chromium, Android PWA).
  const nav = window.navigation;
  const i = nav?.currentEntry?.index ?? 0;
  const onePage = i === 1 && history.state?.sub && routeOf(new URL(nav.entries()[0].url).hash) === '#/';
  let fresh = !history.state;
  if (i > 0 && !onePage) {
    const hash = location.hash;
    // An entry from before a reload is another document: traversing there reloads, and boot reruns.
    await nav.traverseTo(nav.entries()[0].key).finished.catch(() => {});
    history.replaceState(null, '', hash || '#/');
    fresh = true;
  }
  addEventListener('popstate', (e) => (uaAnimated = !!e.hasUAVisualTransition));
  addEventListener('hashchange', route);
  // Cold start on another page: put Transactions under it, so the first back lands there.
  // A reload or restored tab keeps its own state and already has it.
  if (page() !== '#/' && fresh) {
    const hash = location.hash;
    history.replaceState(null, '', '#/');
    history.pushState({ sub: 1 }, '', hash);
  }
  // Back from the background on a new day: refresh "Today" labels and the strip.
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    render();
    pushNow();
  });
  addEventListener('online', pushNow);
  store.onChange(renderSoon);
  store.onChange(pushSoon);
  onInstallChange(renderSoon);
  await route();
  pushNow();
}
