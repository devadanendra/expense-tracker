import * as store from '../store.js';
import { icon } from '../icons.js';
import { toast } from './settings.js';
import { eatNextClick } from './frequent.js';

const HOLD_MS = 450;
const SLOP = 8; // px a finger may drift before the hold counts as a scroll

// Selection mode, as in Gmail: hold an expense row (or right-click it) to select it; while any
// row is selected, taps toggle rows instead of opening the editor, and a bar on top deletes them
// all (a toast offers Undo). ×, Escape, Android back or leaving the page ends it. Survives the
// view re-rendering: each render binds its new container and the selection is re-applied.
// shortcut: Search re-filtering its list drops the checks from the rows, not the selection.
const selected = new Set();
let view = null; // { container, find } of the latest bind
let bar = null;
let tok = 0;

export function bindRowHold(container, find) {
  view = { container, find };
  paint();
  let timer = 0;
  let start = null;
  const cancel = () => { clearTimeout(timer); start = null; };
  container.addEventListener('pointerdown', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row || ev.button > 0) return;
    start = [ev.clientX, ev.clientY];
    timer = setTimeout(() => {
      cancel();
      eatNextClick();
      pick(row.dataset.id, true);
    }, HOLD_MS);
  });
  container.addEventListener('pointermove', (ev) => {
    if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > SLOP) cancel();
  });
  for (const t of ['pointerup', 'pointercancel']) container.addEventListener(t, cancel);
  container.addEventListener('contextmenu', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row) return;
    ev.preventDefault();
    cancel();
    pick(row.dataset.id, true);
  });
  // Capture, so the view's own click handler (open the editor) never sees taps while selecting.
  container.addEventListener('click', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row || !selected.size) return;
    ev.stopPropagation();
    pick(row.dataset.id);
  }, true);
}

function pick(id, on = !selected.has(id)) {
  if (on === selected.has(id) || !view.find(id)) return;
  if (on) selected.add(id);
  else selected.delete(id);
  navigator.vibrate?.(on ? 10 : 5);
  if (!selected.size) return exit();
  if (!bar) enter();
  paint();
}

function paint() {
  if (!view) return;
  for (const row of view.container.querySelectorAll('.row[data-id]')) {
    const on = selected.has(row.dataset.id);
    row.classList.toggle('sel', on);
    if (selected.size) row.setAttribute('aria-pressed', on);
    else row.removeAttribute('aria-pressed');
  }
  if (bar) bar.querySelector('.n').textContent = `${selected.size} selected`;
}

function enter() {
  bar = document.createElement('div');
  bar.className = 'selbar';
  bar.setAttribute('role', 'toolbar');
  bar.setAttribute('aria-label', 'Selected expenses');
  bar.innerHTML = `<button class="ib" type="button" data-act="x" aria-label="Cancel selection">${icon('x')}</button>
    <span class="n" aria-live="polite"></span>
    <button class="ib del" type="button" data-act="del" aria-label="Delete selected">${icon('trash')}</button>`;
  bar.addEventListener('click', (ev) => {
    const act = ev.target.closest('[data-act]')?.dataset.act;
    if (act === 'x') exit();
    if (act === 'del') remove();
  });
  document.body.append(bar);
  tok = Date.now();
  history.pushState({ sel: tok }, '');
  addEventListener('popstate', onPop);
  addEventListener('hashchange', onPop);
  document.addEventListener('keydown', onKey, true);
}

const onPop = () => exit(true);
function onKey(ev) {
  if (ev.key !== 'Escape' || document.querySelector('.es, .fq, dialog[open]')) return;
  ev.preventDefault();
  exit();
}

function exit(fromPop) {
  selected.clear();
  paint();
  if (!bar) return;
  bar.remove();
  bar = null;
  removeEventListener('popstate', onPop);
  removeEventListener('hashchange', onPop);
  document.removeEventListener('keydown', onKey, true);
  if (!fromPop && history.state?.sel === tok) history.back();
}

async function remove() {
  const recs = [...selected].map(view.find).filter(Boolean);
  exit();
  try {
    for (const e of recs) await store.deleteExpense(e.id);
    toast(`${recs.length === 1 ? '1 expense' : `${recs.length} expenses`} deleted`, {
      label: 'Undo',
      run: async () => {
        try { for (const e of recs) await store.saveExpense(e); } catch (err) { console.error(err); }
      },
    });
  } catch (err) {
    console.error(err);
    toast(`Couldn't delete: ${err.message ?? err}`);
  }
}
