import * as store from '../store.js';
import { formatNum } from '../money.js';
import { toast } from './settings.js';
import { eatNextClick } from './frequent.js';

const HOLD_MS = 450;
const SLOP = 8; // px a finger may drift before the hold counts as a scroll

// Hold an expense row (or right-click it) for a Delete button next to it, so deleting needs no
// trip through the edit sheet. A toast offers Undo. find(id) returns the row's expense.
export function bindRowHold(container, find) {
  let timer = 0;
  let start = null;
  let held = null;
  const cancel = () => { clearTimeout(timer); start = null; };
  const fire = (row) => {
    cancel();
    if (held === row) return;
    const e = find(row.dataset.id);
    if (!e) return;
    held = row;
    navigator.vibrate?.(10);
    openMenu(row, e, () => { held = null; });
  };
  container.addEventListener('pointerdown', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row || ev.button > 0) return;
    start = [ev.clientX, ev.clientY];
    timer = setTimeout(() => { eatNextClick(); fire(row); }, HOLD_MS);
  });
  container.addEventListener('pointermove', (ev) => {
    if (start && Math.hypot(ev.clientX - start[0], ev.clientY - start[1]) > SLOP) cancel();
  });
  for (const t of ['pointerup', 'pointercancel']) container.addEventListener(t, cancel);
  container.addEventListener('contextmenu', (ev) => {
    const row = ev.target.closest('.row[data-id]');
    if (!row) return;
    ev.preventDefault();
    fire(row);
  });
}

function openMenu(row, e, onClose) {
  const box = row.getBoundingClientRect();
  const below = box.bottom + 64 < innerHeight - 96; // keep clear of the nav bar
  const root = document.createElement('div');
  root.className = 'rh';
  root.innerHTML = `<div class="rh-dim" aria-hidden="true"></div>
    <button class="rh-del" type="button" style="right:${innerWidth - box.right + 8}px;${
      below ? `top:${box.bottom + 6}px` : `bottom:${innerHeight - box.top + 6}px`}">Delete</button>`;
  row.classList.add('held');
  const close = () => {
    root.remove();
    row.classList.remove('held');
    document.removeEventListener('keydown', onKey, true);
    removeEventListener('hashchange', close);
    removeEventListener('scroll', close, true);
    onClose();
  };
  const onKey = (ev) => {
    if (ev.key !== 'Escape') return;
    ev.preventDefault();
    close();
    row.focus({ preventScroll: true });
  };
  root.addEventListener('click', async (ev) => {
    const del = ev.target.closest('.rh-del');
    close();
    if (!del) return;
    try {
      await store.deleteExpense(e.id);
      toast(`Deleted · Rp ${formatNum(e.amount)}`, {
        label: 'Undo', run: () => store.saveExpense(e).catch((err) => console.error(err)),
      });
    } catch (err) {
      console.error(err);
      toast(`Couldn't delete: ${err.message ?? err}`);
    }
  });
  document.body.append(root);
  document.addEventListener('keydown', onKey, true);
  addEventListener('hashchange', close);
  addEventListener('scroll', close, true);
  root.querySelector('.rh-del').focus({ preventScroll: true });
}
