import * as store from '../store.js';
import { createCalc } from '../calc.js';
import { formatNum } from '../money.js';
import { OTHER_ID } from '../categories.js';
import { icon } from '../icons.js';
import { esc, chip, localISO, dayLabel } from './home.js';

const OP_LABELS = { AC: 'Clear', '÷': 'Divide', '×': 'Multiply', back: 'Backspace', '-': 'Minus', '+': 'Plus' };
const FACES = { back: icon('back'), '-': '−' };
const KEY_MAP = { Backspace: 'back', '*': '×', '/': '÷' };
const KEYBOARD_KEYS = /^([0-9+\-×÷]|back)$/;

const key = (k) => `<button class="k${OP_LABELS[k] ? ' op' : ''}" type="button" data-k="${k}"${
  OP_LABELS[k] ? ` aria-label="${OP_LABELS[k]}"` : ''}>${FACES[k] ?? k}</button>`;
// Grid order per mockup; the save key spans rows 4-5 of the last column.
const PAD = ['AC', '÷', '×', 'back', '7', '8', '9', '-', '4', '5', '6', '+', '1', '2', '3'].map(key).join('')
  + `<button class="k go" type="button" data-act="save" aria-label="Save">${icon('check')}</button>`
  + ['0', '000'].map(key).join('');

const nowHHMM = () => new Date().toTimeString().slice(0, 5);
const daysAgo = (n) => { const d = new Date(); d.setDate(d.getDate() - n); return localISO(d); };

let isOpen = false;

// Bottom sheet to add (no expense) or edit/delete an expense. Mounted on <body>, outside the
// view root, so store re-renders of the page underneath leave it alone.
// onDone(saved expense | undefined after delete) runs after a successful write.
export async function openEntrySheet({ expense, onDone } = {}) {
  if (isOpen) return;
  isOpen = true; // blocks a second tap while categories load
  let cats;
  try {
    cats = await store.liveCategories();
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
  const behind = [document.getElementById('app'), document.querySelector('.nav')];

  const root = document.createElement('div');
  root.className = 'es';
  root.innerHTML = `<div class="scrim" data-act="close"></div>
  <section class="sheet" role="dialog" aria-modal="true" aria-labelledby="es-title" tabindex="-1">
    <div class="grab" aria-hidden="true"></div>
    <div class="sh">
      <h2 id="es-title">${expense ? 'Edit expense' : 'New expense'}</h2>
      ${expense ? '<button class="del" type="button" data-act="delete">Delete</button>' : ''}
      <button class="x" type="button" data-act="close" aria-label="Close">${icon('x')}</button>
    </div>
    <p class="amtIn num" aria-live="polite"><span class="rp">Rp</span><span class="v"></span></p>
    <p class="expr num"></p>
    <div class="grid" role="group" aria-label="Category">${cats.map((c) => `<button class="gc" type="button" data-cat="${esc(c.id)}">
      ${chip(c)}<span class="gl">${esc(c.name)}</span></button>`).join('')}
    </div>
    <div class="chips" role="group" aria-label="Date">
      <button class="dc" type="button" data-date="${today}">Today</button>
      <button class="dc" type="button" data-date="${yesterday}">Yesterday</button>
      <button class="dc" type="button" data-act="cal" aria-label="Pick a date">${icon('cal')}<span></span></button>
      <input class="dt-input" type="date" max="${today}" tabindex="-1" aria-hidden="true">
      <button class="dc nc" type="button" data-act="note" aria-expanded="false">${icon('note')}Note</button>
    </div>
    <input class="note" type="text" maxlength="120" placeholder="Note" aria-label="Note" autocomplete="off" hidden>
    <p class="es-err" role="alert" hidden></p>
    <div class="pad num">${PAD}</div>
  </section>`;

  const $ = (s) => root.querySelector(s);
  const sheet = $('.sheet');
  const note = $('.note');
  const picker = $('.dt-input');
  const err = $('.es-err');
  if (expense?.note) {
    note.value = expense.note;
    note.hidden = false;
    $('.nc').setAttribute('aria-expanded', 'true');
  }

  function update() {
    const expr = calc.expression();
    const v = calc.value();
    if (v !== null || !expr) shown = v ?? 0; // trailing operator or ÷ 0: keep the last good total
    const text = formatNum(shown);
    $('.amtIn .v').textContent = text;
    $('.amtIn').style.fontSize = text.length > 15 ? '24px' : text.length > 11 ? '30px' : '';
    $('.expr').textContent = /[-+×÷]/.test(expr) ? expr : '';
    $('[data-act=save]').disabled = busy || !calc.canSave();
    if (expense) $('[data-act=delete]').disabled = busy;
    for (const b of root.querySelectorAll('[data-cat]')) b.setAttribute('aria-pressed', b.dataset.cat === categoryId);
    for (const b of root.querySelectorAll('[data-date]')) b.setAttribute('aria-pressed', b.dataset.date === date);
    const custom = date !== today && date !== yesterday;
    const label = custom ? dayLabel(date, today) : '';
    $('[data-act=cal]').setAttribute('aria-pressed', custom);
    $('[data-act=cal]').setAttribute('aria-label', custom ? `Pick a date, ${label}` : 'Pick a date');
    $('[data-act=cal] span').textContent = label;
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

  function close(fromPopstate) {
    if (closed) return;
    closed = true;
    isOpen = false;
    root.remove();
    removeEventListener('popstate', onPop);
    document.removeEventListener('keydown', onKey);
    for (const el of behind) el.inert = false;
    if (!fromPopstate && history.state?.sheet) history.back();
    if (opener?.isConnected) opener.focus();
  }

  const onPop = () => close(true);

  function onKey(e) {
    if (e.target === note || e.target === picker || e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
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
    const el = ev.target.closest('[data-act], [data-k], [data-cat], [data-date]');
    if (!el || el.disabled) return;
    // A tap or mouse click hands focus back to the sheet, so physical keys (Enter) keep working.
    if (ev.detail) sheet.focus({ preventScroll: true });
    const { act, k, cat, date: d } = el.dataset;
    if (k) return press(k);
    if (cat) categoryId = cat;
    else if (d) date = d;
    switch (act) {
      case 'close': return close();
      case 'save': return save();
      case 'delete': return remove();
      case 'note':
        note.hidden = false;
        el.setAttribute('aria-expanded', 'true');
        return note.focus();
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

  update();
  isOpen = true;
  document.body.append(root);
  for (const el of behind) el.inert = true;
  history.pushState({ sheet: 1 }, '');
  addEventListener('popstate', onPop);
  document.addEventListener('keydown', onKey);
  sheet.focus();
}
