import * as store from '../store.js';
import { CATEGORY_COLORS, EMOJI, OTHER_ID } from '../categories.js';
import { icon } from '../icons.js';
import { NAME_MAX } from '../csv.js';
import { esc, safeColor, chip } from './home.js';

const ICONS = Object.keys(EMOJI);

// Add / edit / delete sheet. A native modal <dialog> on <body>: it survives view re-renders, makes
// the page behind inert, and closes on Escape (and Android back, Chrome 120+).
function openEditor(cat, cats) {
  const used = new Set(cats.map((c) => c.color));
  let color = cat?.color ?? CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[0];
  let ico = cat?.icon ?? 'dots';
  let busy = false;

  const dlg = document.createElement('dialog');
  dlg.className = 'ce';
  dlg.setAttribute('aria-labelledby', 'ce-title');
  dlg.toggleAttribute('autofocus', !!cat); // editing: don't pop the keyboard; adding: focus the name
  dlg.innerHTML = `<form class="ce-f">
    <div class="grab" aria-hidden="true"></div>
    <div class="sh">
      <h2 id="ce-title">${cat ? 'Edit category' : 'New category'}</h2>
      ${cat && cat.id !== OTHER_ID ? '<button class="del" type="button" data-act="delete">Delete</button>' : ''}
      <button class="x" type="button" data-act="close" aria-label="Close">${icon('x')}</button>
    </div>
    <input class="note" type="text" maxlength="${NAME_MAX}" placeholder="Name" aria-label="Name" autocomplete="off" required${cat ? '' : ' autofocus'}>
    <p class="ce-lbl">Color</p>
    <div class="pick" role="group" aria-label="Color">${CATEGORY_COLORS.map((c) =>
      `<button type="button" data-color="${c}" aria-label="Color ${c}"><span class="chip" style="background:${c}"></span></button>`).join('')}
    </div>
    <p class="ce-lbl">Icon</p>
    <div class="pick" role="group" aria-label="Icon">${ICONS.map((k) =>
      `<button type="button" data-icon="${k}" aria-label="Icon ${k}"><span class="chip">${EMOJI[k]}</span></button>`).join('')}
    </div>
    <p class="es-err" role="alert" hidden></p>
    <button class="btn primary" type="submit">Save</button>
  </form>`;

  const name = dlg.querySelector('input');
  const err = dlg.querySelector('.es-err');
  name.value = cat?.name ?? '';

  function update() {
    for (const b of dlg.querySelectorAll('[data-color]')) b.setAttribute('aria-pressed', b.dataset.color === color);
    for (const b of dlg.querySelectorAll('[data-icon]')) {
      b.setAttribute('aria-pressed', b.dataset.icon === ico);
      b.firstChild.style.setProperty('--c', safeColor(color));
    }
    dlg.querySelector('[type=submit]').disabled = busy || !name.value.trim();
    const del = dlg.querySelector('[data-act=delete]');
    if (del) del.disabled = busy;
  }

  async function run(fn, verb) {
    busy = true;
    err.hidden = true;
    update();
    try {
      await fn();
      dlg.close();
    } catch (e) {
      console.error(e);
      err.textContent = `Couldn't ${verb}: ${e.message ?? e}`;
      err.hidden = false;
    }
    busy = false;
    update();
  }

  dlg.addEventListener('click', (ev) => {
    if (ev.target === dlg) return dlg.close(); // backdrop
    const el = ev.target.closest('[data-color], [data-icon], [data-act]');
    if (!el || el.disabled) return;
    if (el.dataset.color) color = el.dataset.color;
    if (el.dataset.icon) ico = el.dataset.icon;
    if (el.dataset.act === 'close') return dlg.close();
    if (el.dataset.act === 'delete') {
      if (!confirm(`Expenses in ${cat.name} will move to Other.`)) return;
      return run(() => store.deleteCategory(cat.id), 'delete');
    }
    update();
  });
  name.addEventListener('input', update);
  dlg.addEventListener('submit', (ev) => {
    ev.preventDefault();
    if (busy || !name.value.trim()) return;
    run(() => store.saveCategory({ ...(cat && { id: cat.id }), name: name.value.trim().slice(0, 40), color, icon: ico }), 'save');
  });
  dlg.addEventListener('close', () => dlg.remove());

  update();
  document.body.append(dlg);
  dlg.showModal();
}

export async function renderCategories(root) {
  const cats = await store.liveCategories();
  root.innerHTML = `<header class="bar"><a class="ib" href="#/settings" aria-label="Back">${icon('back')}</a><h1>Categories</h1></header>
  <section class="cats">
    <div class="lst">${cats.map((c, i) => `<div class="cat">
      <button class="row" type="button" data-edit="${i}">
        ${chip(c)}
        <span class="t1">${esc(c.name)}</span>
      </button>
      <button class="mv" id="up-${esc(c.id)}" type="button" data-move="${i}" data-to="${i - 1}" aria-label="Move ${esc(c.name)} up"${i ? '' : ' disabled'}>${icon('chevron-up')}</button>
      <button class="mv" id="down-${esc(c.id)}" type="button" data-move="${i}" data-to="${i + 1}" aria-label="Move ${esc(c.name)} down"${i < cats.length - 1 ? '' : ' disabled'}>${icon('chevron-down')}</button>
    </div>`).join('')}</div>
    <div class="lst add">
      <button class="row" type="button" data-act="add"><span class="chip">${icon('plus')}</span><span class="t1">Add category</span></button>
    </div>
  </section>`;

  root.addEventListener('click', (ev) => {
    const el = ev.target.closest('[data-edit], [data-move], [data-act]');
    if (!el || el.disabled) return;
    if (el.dataset.move) {
      const ids = cats.map((c) => c.id);
      const [i, j] = [Number(el.dataset.move), Number(el.dataset.to)];
      [ids[i], ids[j]] = [ids[j], ids[i]];
      store.reorderCategories(ids).catch((e) => console.error(e));
    } else {
      openEditor(cats[el.dataset.edit], cats); // data-act=add: no data-edit, so a new category
    }
  });
}
