/**
 * Expense Tracker backend: a Google Apps Script web app bound to the owner's Google Sheet.
 * The phone pushes changes here (one way); the Sheet is read back only to link or restore.
 * Every request must carry the passphrase stored in Script properties as PASSPHRASE.
 * Setup: see SETUP.md.
 *
 * @OnlyCurrentDoc
 */

const APP = 'expense-tracker';

// `nonText` columns keep their native type; every other column is forced to plain text so
// Sheets never turns 2026-10-13 into a date, 08:15 into a time, or a note into a formula.
const EXPENSES = {
  name: 'Expenses',
  cols: ['id', 'date', 'time', 'amount', 'category', 'categoryId', 'note', 'createdAt', 'updatedAt', 'deleted'],
  nonText: ['amount', 'deleted'],
};
const CATEGORIES = {
  name: 'Categories',
  cols: ['id', 'name', 'icon', 'color', 'order', 'updatedAt', 'deleted'],
  nonText: ['order', 'deleted'],
};

const json_ = (obj) =>
  ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);

function doGet() {
  return json_({ ok: true, app: APP }); // health check, no data
}

function doPost(e) {
  try {
    const req = JSON.parse(e.postData.contents);
    if (!req || typeof req !== 'object') return json_({ ok: false, error: 'server' });
    const expected = PropertiesService.getScriptProperties().getProperty('PASSPHRASE');
    if (!passOk_(req.pass, expected)) return json_({ ok: false, error: 'auth' });
    if (!Object.prototype.hasOwnProperty.call(OPS, req.op)) return json_({ ok: false, error: 'server' });

    const lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      return json_(OPS[req.op](req));
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    // Never log err or the request: a JSON.parse error quotes the body, which holds the passphrase.
    return json_({ ok: false, error: 'server' });
  }
}

const OPS = {
  count: () => ({
    ok: true,
    expenses: readRows_(EXPENSES).filter(hasId_).map(toExpense_).filter((x) => !x.deleted).length,
  }),
  pull: () => ({
    ok: true,
    expenses: readRows_(EXPENSES).filter(hasId_).map(toExpense_),
    categories: readRows_(CATEGORIES).filter(hasId_).map(toCategory_),
  }),
  upsert: (req) => {
    // Validate everything before the first write so a bad record cannot leave a half-applied push.
    const cats = dedupe_(req.categories);
    const exps = dedupe_(req.expenses);
    const catRows = upsertRows_(CATEGORIES, cats, toCategoryRow_);
    // Categories go first so an expense pushed together with its new category gets the name.
    const names = new Map(catRows.filter(hasId_).map((r) => [str_(r[0]), str_(r[1])]));
    upsertRows_(EXPENSES, exps, (r) => toExpenseRow_(r, names.get(str_(r.categoryId)) || ''));
    return { ok: true };
  },
};

// Walks the whole supplied string, so timing does not reveal how much of a guess matched.
// A missing or empty PASSPHRASE rejects everything.
function passOk_(given, expected) {
  if (typeof given !== 'string' || typeof expected !== 'string' || expected === '') return false;
  let diff = given.length ^ expected.length;
  for (let i = 0; i < given.length; i++) diff |= given.charCodeAt(i) ^ expected.charCodeAt(i); // past the end: NaN counts as 0
  return diff === 0;
}

// Array of records, one per id; within a single request the higher updatedAt wins.
// The server never compares against rows already in the Sheet: the phone is the only writer.
function dedupe_(list) {
  if (list === undefined) return [];
  if (!Array.isArray(list)) throw new Error('not a list');
  const best = new Map();
  for (const r of list) {
    if (!r || typeof r.id !== 'string' || r.id === '') throw new Error('bad record');
    const cur = best.get(r.id);
    if (!cur || (Number(r.updatedAt) || 0) > (Number(cur.updatedAt) || 0)) best.set(r.id, r);
  }
  return [...best.values()];
}

function sheet_(spec) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sh = ss.getSheetByName(spec.name);
  if (!sh) {
    sh = ss.insertSheet(spec.name);
    formatText_(sh, spec, 1, sh.getMaxRows());
    sh.getRange(1, 1, 1, spec.cols.length).setValues([spec.cols]);
    sh.setFrozenRows(1);
  }
  return sh;
}

function formatText_(sh, spec, firstRow, count) {
  spec.cols.forEach((c, i) => {
    if (spec.nonText.indexOf(c) < 0) sh.getRange(firstRow, i + 1, count, 1).setNumberFormat('@');
  });
}

function readRows_(spec) {
  const sh = sheet_(spec);
  const n = Math.max(0, sh.getLastRow() - 1);
  return n ? sh.getRange(2, 1, n, spec.cols.length).getValues() : [];
}

// Overwrites rows whose id (column A) exists, appends the rest, then writes the whole data range
// back in one setValues call. Returns the rows as stored.
// shortcut: rewrites every row per upsert; fine for a personal sheet of a few thousand rows,
// switch to contiguous-range writes if pushes ever get slow.
function upsertRows_(spec, records, toRow) {
  const rows = readRows_(spec);
  if (!records.length) return rows;
  const at = new Map();
  rows.forEach((r, i) => { if (hasId_(r)) at.set(str_(r[0]), i); });
  for (const rec of records) {
    const row = toRow(rec);
    const i = at.get(row[0]);
    if (i === undefined) {
      at.set(row[0], rows.length);
      rows.push(row);
    } else {
      rows[i] = row;
    }
  }
  const sh = sheet_(spec);
  const max = sh.getMaxRows();
  if (max < rows.length + 1) {
    const add = rows.length + 1 - max + 1000; // headroom so growing is rare
    sh.insertRowsAfter(max, add);
    formatText_(sh, spec, max + 1, add);
  }
  sh.getRange(2, 1, rows.length, spec.cols.length).setValues(rows);
  return rows;
}

const hasId_ = (row) => str_(row[0]) !== '';
const str_ = (v) => (v === null || v === undefined ? '' : String(v));
const iso_ = (ms) => new Date(Number(ms) || 0).toISOString();
const ms_ = (v) => {
  const t = v instanceof Date ? v.getTime() : Date.parse(v);
  return Number.isFinite(t) ? t : 0;
};
const truthy_ = (v) => v === true || String(v).toLowerCase() === 'true';

// Plain text columns hold strings already; a Date means Sheets coerced the cell, so format it back.
function dateText_(v, fmt) {
  if (!(v instanceof Date)) return str_(v);
  return Utilities.formatDate(v, SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone(), fmt);
}

function toExpenseRow_(r, categoryName) {
  return [
    str_(r.id), str_(r.date), str_(r.time), Number(r.amount) || 0, categoryName, str_(r.categoryId),
    str_(r.note), iso_(r.createdAt), iso_(r.updatedAt), !!r.deleted,
  ];
}

function toExpense_(row) {
  return {
    id: str_(row[0]),
    categoryId: str_(row[5]),
    amount: Number(row[3]) || 0,
    date: dateText_(row[1], 'yyyy-MM-dd'),
    time: dateText_(row[2], 'HH:mm'),
    note: str_(row[6]),
    createdAt: ms_(row[7]),
    updatedAt: ms_(row[8]),
    deleted: truthy_(row[9]),
  };
}

function toCategoryRow_(r) {
  return [str_(r.id), str_(r.name), str_(r.icon), str_(r.color), Number(r.order) || 0, iso_(r.updatedAt), !!r.deleted];
}

function toCategory_(row) {
  return {
    id: str_(row[0]),
    name: str_(row[1]),
    icon: str_(row[2]),
    color: str_(row[3]),
    order: Number(row[4]) || 0,
    updatedAt: ms_(row[5]),
    deleted: truthy_(row[6]),
  };
}
