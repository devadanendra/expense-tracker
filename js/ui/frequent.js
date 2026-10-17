import * as store from '../store.js';
import { quickPicks } from '../stats.js';
import { formatNum } from '../money.js';
import { icon } from '../icons.js';
import { esc, chip, localISO } from './home.js';
import { toast } from './settings.js';

let isOpen = false;

// Menu of repeated expenses above the + button, opened by holding it. A tap adds that expense for
// today (toast with Undo); the last row opens the full sheet via onNew. Closes by tapping the dim,
// Android back or Escape.
export async function openFrequent({ onNew }) {
  if (isOpen) return;
  isOpen = true;
  let cats;
  let picks;
  try {
    [cats, picks] = await Promise.all([store.liveCategories(), store.liveExpenses().then((all) => quickPicks(all, 8))]);
  } catch (e) {
    isOpen = false;
    throw e;
  }
  picks = picks.filter((p) => cats.some((c) => c.id === p.categoryId)).slice(0, 5);
  const opener = document.activeElement;
  const tok = Date.now();
  const label = (p) => p.note || cats.find((c) => c.id === p.categoryId).name;

  const root = document.createElement('div');
  root.innerHTML = `<div class="fq-dim" aria-hidden="true"></div>
  <div class="fq" role="menu" aria-label="Frequent expenses">
    ${picks.length ? picks.map((p, i) => `<button type="button" role="menuitem" data-pick="${i}"
      aria-label="Add ${esc(label(p))}, Rp ${formatNum(p.amount)}, for today">${chip(cats.find((c) => c.id === p.categoryId))}<span class="t">${esc(label(p))}</span><span class="num">${formatNum(p.amount)}</span></button>`).join('')
    : '<p class="fq-empty">Expenses you add more than once show up here.</p>'}
    <button class="new" type="button" role="menuitem" data-new>${icon('plus')}New expense…</button>
  </div>`;

  function close(fromPopstate) {
    if (!isOpen) return;
    isOpen = false;
    root.remove();
    removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey, true);
    if (!fromPopstate && history.state?.freq === tok) history.back();
    if (opener?.isConnected) opener.focus();
  }
  const onPop = () => close(true);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  };

  root.addEventListener('click', async (ev) => {
    const el = ev.target.closest('[data-pick], [data-new]');
    if (!el) return close(); // the dim
    close();
    if (el.dataset.new != null) return onNew();
    const p = picks[el.dataset.pick];
    try {
      const saved = await store.saveExpense({
        amount: p.amount, categoryId: p.categoryId, note: p.note,
        date: localISO(), time: new Date().toTimeString().slice(0, 5),
      });
      toast(`${label(p)} · Rp ${formatNum(p.amount)} added`, { label: 'Undo', run: () => store.deleteExpense(saved.id).catch((e) => console.error(e)) });
    } catch (e) {
      console.error(e);
      toast(`Couldn't add: ${e.message ?? e}`);
    }
  });

  document.body.append(root);
  history.pushState({ freq: tok }, '');
  addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey, true);
  root.querySelector('.fq button').focus({ preventScroll: true });
}
