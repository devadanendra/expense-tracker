import * as store from '../store.js';
import { inMonth, total, byCategory, byWeek } from '../stats.js';
import { formatNum, formatRp } from '../money.js';
import { icon } from '../icons.js';
import { render } from '../app.js';
import { localISO, esc, monthHeader, bindMonth, emptyMonth, FALLBACK_CAT } from './home.js';

const MODES = { categories: 'Categories', weeks: 'Weeks' };
const BAR_MAX = 72; // px height of the tallest week bar

// cats includes deleted categories, so a share kept by a deleted one still shows its name and color.
function categoryList(month, cats) {
  return `<div class="lst rc">${byCategory(month).map(({ categoryId, total: t, share }) => {
    const c = cats.get(categoryId) ?? { ...FALLBACK_CAT, name: categoryId };
    return `<div class="rc-row">
      <div class="rc-top">
        <span class="chip" style="background:${esc(c.color)}">${icon(c.icon)}</span>
        <span class="t1">${esc(c.name)}</span>
        <span class="amt num">${formatNum(t)}</span>
      </div>
      <div class="bar2" aria-hidden="true"><i style="width:${(share * 100).toFixed(2)}%;background:${esc(c.color)}"></i></div>
    </div>`;
  }).join('')}</div>`;
}

function weekChart(month, ym, today) {
  const weeks = byWeek(month, ym);
  const max = Math.max(...weeks.map((w) => w.total));
  const thisYm = today.slice(0, 7);
  const day = Number(today.slice(8, 10));
  const future = (w) => ym > thisYm || (ym === thisYm && w.from > day);
  const bars = weeks.map((w) => {
    const cur = ym === thisYm && w.from <= day && day <= w.to;
    const h = w.total ? Math.max(6, Math.round((w.total / max) * BAR_MAX)) : 3;
    return `<div${cur ? ' class="cur"' : ''}><i${future(w) ? ' class="f"' : ` style="height:${h}px"`}></i>${w.from}–${w.to}</div>`;
  }).join('');
  const past = weeks.filter((w) => !future(w));
  const list = past.length ? `<div class="lst wl">${past.map((w) => `<div class="sr"><span class="t1">${w.label}</span><span class="amt num">${formatRp(w.total)}</span></div>`).join('')}</div>` : '';
  return `<div class="lst wkc"><div class="wk" aria-hidden="true">${bars}</div></div>${list}`;
}

export async function renderReports(root, state) {
  const [all, categories] = await Promise.all([store.liveExpenses(), store.allCategories()]);
  const today = localISO();
  const { ym } = state;
  const month = inMonth(all, ym);
  const cats = new Map(categories.map((c) => [c.id, c]));
  const mode = state.report;

  let body;
  if (mode === 'weeks') body = weekChart(month, ym, today);
  else body = month.length ? categoryList(month, cats) : emptyMonth();

  root.innerHTML = `<header class="hd rp">
    ${monthHeader(ym, total(month))}
    <div class="seg" role="group" aria-label="Report">${Object.entries(MODES).map(([k, label]) =>
      `<button id="seg-${k}" type="button" data-mode="${k}" aria-pressed="${k === mode}">${label}</button>`).join('')}
    </div>
  </header>
  <section class="body">${body}</section>`;

  bindMonth(root, state);
  root.querySelector('.seg').addEventListener('click', (ev) => {
    const b = ev.target.closest('[data-mode]');
    if (!b || b.dataset.mode === mode) return;
    state.report = b.dataset.mode;
    render();
  });
}
