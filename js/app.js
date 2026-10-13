import * as store from './store.js';
import { icon } from './icons.js';
import { renderHome, localISO } from './ui/home.js';

// Shared UI state. ym is the selected month ('YYYY-MM'), set in boot().
export const state = { ym: '', restoreDismissed: false };

// Hooks later tasks fill in: Task 8 opens the entry sheet (expense undefined = new), Task 10 the restore flow.
export function openEntry(expense) {}
export function startRestore() {}

const placeholder = (title) => (root) => {
  root.innerHTML = `<header class="bar"><a class="ib" href="#/" aria-label="Back">${icon('back')}</a><h1>${title}</h1></header>`;
};

const ROUTES = {
  '#/': renderHome,
  '#/reports': placeholder('Reports'),
  '#/search': placeholder('Search'),
  '#/settings': placeholder('Settings'),
  '#/categories': placeholder('Categories'),
};
const NAV_ROUTES = ['#/', '#/reports'];

let seq = 0;
let shown = '';

// Renders the current route into a fresh container and swaps it in only if no newer render
// started meanwhile, so overlapping async renders never leave stale data on screen.
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
  document.getElementById('app').replaceChildren(view);
  const nav = document.querySelector('.nav');
  nav.hidden = !NAV_ROUTES.includes(route);
  for (const a of nav.querySelectorAll('a')) {
    if (a.getAttribute('href') === route) a.setAttribute('aria-current', 'page');
    else a.removeAttribute('aria-current');
  }
  if (route !== shown) scrollTo(0, 0);
  shown = route;
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
  document.querySelector('.nav .p').addEventListener('click', () => openEntry());
  addEventListener('hashchange', render);
  // Back from the background on a new day: refresh "Today" labels and the strip.
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
  store.onChange(render);
  await render();
}
