import * as store from '../store.js';
import { icon } from '../icons.js';
import { openEntry } from '../app.js';
import { localISO, dayLabel, esc, catOf, dayGroups } from './home.js';

const notice = (title, text) => `<div class="empty">
    <div class="ring">${icon('search')}</div>
    <h2>${title}</h2>
    <p>${text}</p>
  </div>`;

// Results update in place as the owner types; a store change re-renders the whole view from
// state.query, and render() keeps focus and caret on #q.
export async function renderSearch(root, state) {
  const [expenses, categories] = await Promise.all([store.liveExpenses(), store.liveCategories()]);
  const cats = new Map(categories.map((c) => [c.id, c]));
  const today = localISO();

  root.innerHTML = `<header class="hd qh">
    <div class="top">
      <a class="ib" href="#/" aria-label="Back">${icon('back')}</a>
      <label class="qf">${icon('search')}<input id="q" type="search" placeholder="Search notes and categories"
        aria-label="Search notes and categories" autocomplete="off" enterkeyhint="search" autofocus></label>
    </div>
  </header>
  <section class="body"></section>`;

  const input = root.querySelector('#q');
  const body = root.querySelector('.body');
  input.value = state.query;

  function show() {
    const q = state.query.trim().toLowerCase();
    if (!q) {
      body.innerHTML = notice('Search all months', 'Find expenses by note or category.');
      return;
    }
    const hits = expenses.filter((e) => (e.note || '').toLowerCase().includes(q)
      || catOf(cats, e.categoryId).name.toLowerCase().includes(q));
    body.innerHTML = hits.length
      ? dayGroups(hits, cats, (d) => dayLabel(d, today, true))
      : notice('No matches', `Nothing matches “${esc(state.query.trim())}”.`);
  }

  input.addEventListener('input', () => { state.query = input.value; show(); });
  body.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-id]');
    if (el) openEntry(expenses.find((e) => e.id === el.dataset.id));
  });
  show();
}
