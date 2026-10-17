import * as store from '../store.js';
import { quickPicks } from '../stats.js';
import { formatNum } from '../money.js';
import { icon } from '../icons.js';
import { esc, chip, localISO } from './home.js';
import { toast } from './settings.js';

const RADIUS = 130; // px from the + button's centre to each circle's centre
const REACH = 48; // px around a circle's centre that still selects it while sliding

let isOpen = false;

// Lifting a held finger can still fire a click at whatever is under it (the ×, the dim, a list
// row once the arc closes): swallow the one that follows.
function eatNextClick() {
  const eat = (e) => {
    e.stopPropagation();
    e.preventDefault();
  };
  document.addEventListener('click', eat, { capture: true, once: true });
  setTimeout(() => document.removeEventListener('click', eat, true), 400);
}

// Repeated expenses fanned out in an arc over the + button, opened by holding it. Keep the finger
// down, slide onto one and let go to add it for today; or let go anywhere and tap one. Either way a
// toast offers Undo. × , the dim, Android back and Escape close it. pointerId is the holding
// pointer (none when opened from the keyboard).
export async function openFrequent({ plus, pointerId }) {
  if (isOpen) return;
  isOpen = true;
  // A finger lifted while the picks load leaves the arc open for tapping.
  let lifted = false;
  const early = (e) => {
    if (e.pointerId !== pointerId) return;
    lifted = true;
    eatNextClick();
  };
  if (pointerId != null) {
    document.addEventListener('pointerup', early);
    document.addEventListener('pointercancel', early);
  }
  let cats;
  let picks;
  try {
    [cats, picks] = await Promise.all([store.liveCategories(), store.liveExpenses().then((all) => quickPicks(all, 8))]);
  } catch (e) {
    isOpen = false;
    throw e;
  } finally {
    document.removeEventListener('pointerup', early);
    document.removeEventListener('pointercancel', early);
  }
  if (lifted) pointerId = undefined;
  picks = picks.filter((p) => cats.some((c) => c.id === p.categoryId)).slice(0, 5);
  const label = (p) => p.note || cats.find((c) => c.id === p.categoryId).name;
  const tok = Date.now();
  const hint = picks.length ? 'Slide or tap to add for today' : 'Expenses you add more than once show up here.';

  // Fan from 150° to 30° around the + centre, the most repeated straight above it and the rest
  // alternating outwards (left, right, ...).
  const box = plus.getBoundingClientRect();
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  const slots = picks.map((_, i) => (picks.length === 1 ? 90 : 150 - (120 * i) / (picks.length - 1)))
    .sort((a, b) => Math.abs(a - 90) - Math.abs(b - 90) || b - a);
  const at = (i) => {
    const a = (Math.PI / 180) * slots[i];
    return [cx + Math.cos(a) * RADIUS, cy - Math.sin(a) * RADIUS];
  };

  const root = document.createElement('div');
  root.className = 'fq';
  root.innerHTML = `<div class="fq-dim" aria-hidden="true"></div>
  <p class="fq-tip" aria-live="polite" style="bottom:${innerHeight - cy + RADIUS + 64}px">${hint}</p>
  <div role="menu" aria-label="Frequent expenses">${picks.map((p, i) => {
    const [x, y] = at(i);
    return `<button class="fq-it" type="button" role="menuitem" data-pick="${i}" style="left:${x}px;top:${y}px;--d:${i * 25}ms"
      aria-label="Add ${esc(label(p))}, Rp ${formatNum(p.amount)}, for today">${chip(cats.find((c) => c.id === p.categoryId))}<span class="num">${formatNum(p.amount)}</span></button>`;
  }).join('')}</div>
  <button class="fq-x" type="button" aria-label="Close" style="left:${cx}px;top:${cy}px">${icon('plus')}</button>`;
  const tip = root.querySelector('.fq-tip');
  const items = [...root.querySelectorAll('.fq-it')];

  let active = null;
  function select(el) {
    if (el === active) return;
    active?.classList.remove('on');
    active = el;
    el?.classList.add('on');
    if (el) navigator.vibrate?.(5);
    const p = el && picks[el.dataset.pick];
    tip.innerHTML = p ? `${esc(label(p))}<span class="num">Rp ${formatNum(p.amount)}</span>` : hint;
  }
  const nearest = (x, y) => items.find((el) => Math.hypot(x - parseFloat(el.style.left), y - parseFloat(el.style.top)) <= REACH);

  async function add(p) {
    try {
      const saved = await store.saveExpense({
        amount: p.amount, categoryId: p.categoryId, note: p.note,
        date: localISO(), time: new Date().toTimeString().slice(0, 5),
      });
      toast(`${label(p)} · Rp ${formatNum(p.amount)} added`, {
        label: 'Undo', run: () => store.deleteExpense(saved.id).catch((e) => console.error(e)),
      });
    } catch (e) {
      console.error(e);
      toast(`Couldn't add: ${e.message ?? e}`);
    }
  }

  function close(fromPopstate) {
    if (!isOpen) return;
    isOpen = false;
    root.remove();
    removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey, true);
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    document.removeEventListener('pointercancel', onUp);
    if (!fromPopstate && history.state?.freq === tok) history.back();
    plus.focus({ preventScroll: true });
  }
  const onPop = () => close(true);
  const onKey = (e) => {
    if (e.key !== 'Escape') return;
    e.preventDefault();
    close();
  };
  // The finger that opened the arc: slide to select, lift to add. Lifting on nothing leaves it open.
  const onMove = (e) => e.pointerId === pointerId && select(nearest(e.clientX, e.clientY));
  const onUp = (e) => {
    if (e.pointerId !== pointerId) return;
    pointerId = undefined;
    eatNextClick();
    const p = e.type === 'pointerup' && active && picks[active.dataset.pick];
    select(null);
    if (!p) return;
    close();
    add(p);
  };

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-pick]');
    close(); // a pick, × or the dim
    if (el) add(picks[el.dataset.pick]);
  });

  document.body.append(root);
  history.pushState({ freq: tok }, '');
  addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey, true);
  if (pointerId != null) {
    document.addEventListener('pointermove', onMove);
    document.addEventListener('pointerup', onUp);
    document.addEventListener('pointercancel', onUp);
  } else {
    (items[0] ?? root.querySelector('.fq-x')).focus({ preventScroll: true });
  }
}
