import * as store from '../store.js';
import { createCalc } from '../calc.js';
import { formatNum } from '../money.js';
import { OTHER_ID } from '../categories.js';
import { quickPicks } from '../stats.js';
import { icon } from '../icons.js';
import { esc, chip, localISO, shortDate } from './home.js';

const OP_LABELS = { AC: 'Clear', '÷': 'Divide', '×': 'Multiply', back: 'Backspace', '-': 'Minus', '+': 'Plus' };
const FACES = { back: icon('backspace'), '-': '−' };
const KEY_MAP = { Backspace: 'back', '*': '×', '/': '÷' };
const KEYBOARD_KEYS = /^([0-9+\-×÷]|back)$/;

const key = (k) => `<button class="k${OP_LABELS[k] ? ' op' : ''}" type="button" data-k="${k}"${
  OP_LABELS[k] ? ` aria-label="${OP_LABELS[k]}"` : ''}>${FACES[k] ?? k}</button>`;
// Grid order per mockup; the save key spans rows 4-5 of the last column.
const PAD = ['AC', '×', '÷', 'back', '7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3'].map(key).join('')
  + `<button class="k go" type="button" data-act="save" aria-label="Save">${icon('check')}</button>`
  + ['0', '000'].map(key).join('');

const CLOSE_DRAG = 0.25; // share of the sheet's height a drag must pass to close it
const FLING = 0.5; // px/ms downward that closes it anyway

const nowHHMM = () => new Date().toTimeString().slice(0, 5);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

let isOpen = false;

// Bottom sheet to add (no expense) or edit/delete an expense. Mounted on <body>, outside the
// view root, so store re-renders of the page underneath leave it alone. Closes by scrim tap,
// drag down, Android back, Escape or the screen-reader Close button; no visible X.
// onDone(saved expense | undefined after delete) runs after a successful write.
export async function openEntrySheet({ expense, onDone } = {}) {
  if (isOpen) return;
  isOpen = true; // blocks a second tap while categories load
  let cats;
  let picks = [];
  try {
    cats = await store.liveCategories();
    if (!expense) picks = quickPicks(await store.liveExpenses())
      .filter((p) => cats.some((c) => c.id === p.categoryId));
  } finally {
    isOpen = false; // set again at mount, so a throw below never leaves the + button dead
  }

  const calc = createCalc();
  if (expense) calc.load(expense.amount);
  const today = localISO();
  const yesterday = daysAgo(1);
  let date = expense?.date ?? today;
  let categoryId = !expense ? cats[0].id
    : cats.some((c) => c.id === expense.categoryId) ? expense.categoryId : OTHER_ID;
  let shown = 0;
  let busy = false;
  let closed = false;
  const opener = document.activeElement;
  // Marks this open's history entries: a {sheet} entry left by a reload or tab restore is not ours.
  const tok = Date.now();
  const behind = [document.getElementById('app'), document.querySelector('.nav')];

  const root = document.createElement('div');
  root.className = 'es';
  root.innerHTML = `<div class="scrim" data-act="close" aria-hidden="true"></div>
  <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="es-title" tabindex="-1">
    <button class="vh" type="button" data-act="close">Close</button>
    <div class="es-head">
      <div class="grab" aria-hidden="true"></div>
      <h2 id="es-title">${expense ? 'Edit expense' : 'New expense'}</h2>
      ${expense ? '<button class="del" type="button" data-act="delete">Delete</button>'
        : `<button class="ib hist" type="button" data-act="hist" aria-label="Frequent expenses" aria-expanded="false">${icon('history')}</button>`}
    </div>
    <div class="es-amt">
      <p class="amtIn num" aria-live="polite"><span class="rp">Rp</span><span class="v"></span></p>
      <p class="expr num"></p>
    </div>
    <div class="es-mid">
      <div class="es-cat">
        <button class="pill" type="button" data-act="cats" aria-expanded="false"><span></span>${icon('chevron-down')}</button>
        <div class="es-cs" role="group" aria-label="Category">${cats.map((c) =>
          `<button type="button" data-cat="${esc(c.id)}" aria-label="${esc(c.name)}">${chip(c)}</button>`).join('')}</div>
      </div>
      <div class="fld">${icon('cal')}<button class="dt" type="button" data-act="cal"></button>
        <input class="dt-input" type="date" max="${today}" tabindex="-1" aria-hidden="true">
        <button class="lnk" type="button" data-date=""></button>
      </div>
      <label class="fld">${icon('note')}<input class="es-note" type="text" maxlength="120" placeholder="Add a note…" aria-label="Note" autocomplete="off"></label>
      <p class="es-err" role="alert" hidden></p>
    </div>
    <div class="pad num">${PAD}</div>
    <div class="cp" hidden>
      <div class="cp-card" role="group" aria-labelledby="cp-title">
        <div class="grab" aria-hidden="true"></div>
        <h3 id="cp-title">Category</h3>
        <div class="cp-grid">${cats.map((c) =>
          `<button class="gc" type="button" data-cat="${esc(c.id)}">${chip(c)}<span class="gl">${esc(c.name)}</span></button>`).join('')}</div>
      </div>
    </div>
    ${expense ? '' : `<div class="cp hp" hidden>
      <div class="cp-card" role="dialog" aria-modal="true" aria-labelledby="hp-title">
        <div class="hp-head"><h3 id="hp-title">Frequent</h3><button class="ib" type="button" data-act="unpanel" aria-label="Close">${icon('x')}</button></div>
        ${picks.length ? picks.map((p, i) => {
          const cat = cats.find((c) => c.id === p.categoryId);
          const label = p.note || cat.name;
          return `<button class="hp-row" type="button" data-pick="${i}" aria-label="${esc(label)}, Rp ${formatNum(p.amount)}, added ${p.count} times">${chip(cat)}<span class="hp-t">${esc(label)}</span><span class="hp-n">${p.count}×</span><span class="num">${formatNum(p.amount)}</span></button>`;
        }).join('') : '<p class="hp-empty">Expenses you add more than once show up here.</p>'}
      </div>
    </div>`}
  </section>`;

  const $ = (s) => root.querySelector(s);
  const scrim = $('.scrim');
  const sheet = $('.sheet');
  const note = $('.es-note');
  const picker = $('.dt-input');
  const err = $('.es-err');
  const pill = $('.pill');
  const strip = $('.es-cs');
  const catPanel = $('.cp:not(.hp)');
  const histPanel = $('.hp');
  note.value = expense?.note ?? '';

  function update() {
    const expr = calc.expression();
    const v = calc.value();
    if (v !== null || !expr) shown = v ?? 0; // trailing operator or ÷ 0: keep the last good total
    const text = formatNum(shown);
    $('.amtIn .v').textContent = text;
    $('.amtIn .v').style.fontSize = text.length > 13 ? '32px' : text.length > 9 ? '40px' : '';
    $('.expr').textContent = /[-+×÷]/.test(expr) ? expr : '';
    $('[data-act=save]').disabled = busy || !calc.canSave();
    if (expense) $('[data-act=delete]').disabled = busy;
    for (const b of root.querySelectorAll('[data-cat]')) b.setAttribute('aria-pressed', b.dataset.cat === categoryId);
    const name = cats.find((c) => c.id === categoryId)?.name ?? '';
    $('.pill span').textContent = name;
    pill.setAttribute('aria-label', `Category: ${name}. All categories`);
    $('.dt').textContent = shortDate(date);
    $('.dt').setAttribute('aria-label', `Date: ${shortDate(date)}. Change date`);
    const lnk = $('.lnk');
    lnk.dataset.date = date === today ? yesterday : today;
    lnk.textContent = date === today ? 'Yesterday?' : 'Today?';
  }

  // Scroll the strip so the selected circle sits mid-row.
  function reveal() {
    const b = strip.querySelector('[aria-pressed="true"]');
    if (b) strip.scrollLeft = b.offsetLeft - (strip.clientWidth - b.offsetWidth) / 2;
  }

  const press = (k) => { calc.press(k); update(); };

  async function run(fn, verb) {
    busy = true;
    err.hidden = true;
    update();
    let out;
    try {
      out = await fn();
    } catch (e) {
      console.error(e);
      busy = false;
      err.textContent = `Couldn't ${verb}: ${e.message ?? e}`;
      err.hidden = false;
      return update();
    }
    close();
    onDone?.(out);
  }

  function save() {
    if (busy || !calc.canSave()) return;
    run(() => store.saveExpense({
      ...(expense && { id: expense.id }),
      amount: calc.value(),
      categoryId,
      date,
      time: expense?.time ?? nowHHMM(),
      note: note.value.trim(),
    }), 'save');
  }

  function remove() {
    if (busy || !confirm('Delete this expense?')) return;
    run(() => store.deleteExpense(expense.id), 'delete');
  }

  // Category and Frequent panels: cards over the sheet, each with its own history entry, so
  // Android back closes the panel, not the sheet. active is the open one ({ el, btn }) or null.
  let active = null;
  function showPanel(el, btn) {
    if ((active?.el ?? null) === (el ?? null)) return;
    const was = active;
    if (was) {
      was.el.hidden = true;
      was.btn.setAttribute('aria-expanded', false);
    }
    active = el ? { el, btn } : null;
    if (el) {
      el.hidden = false;
      btn.setAttribute('aria-expanded', true);
    }
    for (const c of sheet.children) if (!c.classList.contains('cp')) c.inert = !!el;
    (el ? el.querySelector('[aria-pressed="true"], button') ?? el.querySelector('.cp-card') : was.btn).focus();
  }
  function openPanel(el, btn) {
    showPanel(el, btn);
    history.pushState({ sheet: tok, panel: 1 }, '');
  }
  function closePanel() {
    showPanel(null);
    if (history.state?.sheet === tok && history.state.panel) history.back();
  }

  function close(fromPopstate) {
    if (closed) return;
    closed = true;
    isOpen = false;
    root.remove();
    removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    for (const el of behind) el.inert = false;
    if (!fromPopstate && history.state?.sheet === tok) history.go(history.state.panel ? -2 : -1);
    if (opener?.isConnected) opener.focus();
  }

  // Back from the panel's entry lands on the sheet's own: only the panel closes.
  const onPop = () => (history.state?.sheet === tok ? showPanel(null) : close(true));

  function onKey(e) {
    if (e.target === note || e.target === picker || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      if (!active) close();
      else closePanel();
    } else if (active) {
      return; // a panel covers the keypad
    } else if (e.key === 'Enter') {
      if (e.target.closest?.('button')) return; // keyboard users activating a focused button
      e.preventDefault();
      save();
    } else {
      const k = KEY_MAP[e.key] ?? e.key;
      if (!KEYBOARD_KEYS.test(k)) return;
      e.preventDefault();
      press(k);
    }
  }

  root.addEventListener('click', (ev) => {
    if (ev.target === active?.el) return closePanel(); // dimmed sheet around the panel's card
    const el = ev.target.closest('[data-act], [data-k], [data-cat], [data-date], [data-pick]');
    if (!el || el.disabled) return;
    // A tap or mouse click hands focus back to the sheet, so physical keys (Enter) keep working.
    if (ev.detail) sheet.focus({ preventScroll: true });
    const { act, k, cat, date: d, pick } = el.dataset;
    if (k) return press(k);
    if (pick) {
      // Fills the form; the date stays as picked and ✓ saves, so a pick can still be tweaked.
      const p = picks[pick];
      calc.load(p.amount);
      categoryId = p.categoryId;
      note.value = p.note;
      update();
      closePanel();
      return reveal();
    }
    if (cat) {
      categoryId = cat;
      update();
      if (active) closePanel();
      return reveal();
    }
    if (d) date = d;
    switch (act) {
      case 'close': return close();
      case 'save': return save();
      case 'delete': return remove();
      case 'cats': return openPanel(catPanel, pill);
      case 'hist': return openPanel(histPanel, $('.hist'));
      case 'unpanel': return closePanel();
      case 'cal':
        picker.value = date;
        try { picker.showPicker(); } catch { picker.focus(); picker.click(); }
        return;
    }
    update();
  });
  picker.addEventListener('change', () => {
    if (!picker.value) return;
    date = picker.value;
    update();
  });

  // Drag down to close, from the grabber, title and amount only (never the keypad, strip or
  // inputs). The sheet follows the finger and the scrim fades with it; on release it closes
  // past CLOSE_DRAG of its height or on a downward fling, else springs back (CSS transition;
  // prefers-reduced-motion makes both instant).
  let drag = null;
  function follow(dy) {
    sheet.style.transform = dy ? `translateY(${dy}px)` : '';
    scrim.style.opacity = dy ? Math.max(0, 1 - dy / sheet.offsetHeight) : '';
  }
  sheet.addEventListener('pointerdown', (e) => {
    if (drag || busy || !e.isPrimary || e.button > 0 || !e.target.closest('.es-head, .es-amt') || e.target.closest('button')) return;
    drag = { id: e.pointerId, y0: e.clientY, y: e.clientY, t: e.timeStamp, v: 0 };
    sheet.setPointerCapture(e.pointerId);
    root.classList.add('drag');
  });
  // Only the dragging pointer counts: a second finger tapping a key must not end the drag.
  sheet.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    if (e.timeStamp > drag.t) drag.v = (e.clientY - drag.y) / (e.timeStamp - drag.t);
    drag.y = e.clientY;
    drag.t = e.timeStamp;
    follow(Math.max(0, e.clientY - drag.y0));
  });
  function release(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const dy = Math.max(0, e.clientY - drag.y0);
    // A fling needs a recent fast move and some distance, so a tap's jitter never closes.
    const fling = drag.v > FLING && e.timeStamp - drag.t < 100 && dy > 16;
    drag = null;
    root.classList.remove('drag');
    if (e.type === 'pointerup' && (dy > sheet.offsetHeight * CLOSE_DRAG || fling)) {
      follow(sheet.offsetHeight);
      setTimeout(close, matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : 200);
    } else {
      follow(0);
    }
  }
  sheet.addEventListener('pointerup', release);
  sheet.addEventListener('pointercancel', release);

  update();
  isOpen = true;
  document.body.append(root);
  for (const el of behind) el.inert = true;
  history.pushState({ sheet: tok }, '');
  addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  reveal();
  sheet.focus();
}
