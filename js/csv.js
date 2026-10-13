import { parseAmount } from './money.js';
import { CATEGORY_COLORS, OTHER_ID } from './categories.js';

const COLUMNS = ['date', 'time', 'amount', 'category', 'note', 'id'];
const NOT_OURS = 'Not an Expense Tracker CSV';

const sortKey = (e) => `${e.date} ${e.time}`;
const quote = (s) => (/[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);

export function toCSV(expenses, categories) {
  const names = new Map(categories.map((c) => [c.id, c.name]));
  const rows = expenses
    .filter((e) => !e.deleted)
    .sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0))
    .map((e) => [e.date, e.time, e.amount, names.get(e.categoryId) ?? 'Other', e.note, e.id].map((v) => quote(String(v))).join(','));
  return [COLUMNS.join(','), ...rows].join('\r\n');
}

// RFC 4180: returns array of records (arrays of fields), or null on an unterminated quote.
function parseCSV(text) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  for (let i = text.charCodeAt(0) === 0xfeff ? 1 : 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c !== '"') field += c;
      else if (text[i + 1] === '"') { field += '"'; i++; }
      else inQuotes = false;
    } else if (c === '"' && field === '') {
      inQuotes = true;
    } else if (c === ',') {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (inQuotes) return null;
  if (field !== '' || row.length) rows.push([...row, field]);
  return rows;
}

const validDate = (s) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  return !!m && new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])).toISOString().slice(0, 10) === s;
};
const validTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);
// parseAmount strips every dot ('1.5' -> 15), so only accept dots as 3-digit thousands groups.
const AMOUNT_RE = /^(Rp\s*)?(\d+|\d{1,3}(\.\d{3})+)$/i;

// Imported expenses get updatedAt 0 so mergeRecords never lets them overwrite an existing id
// (re-import is idempotent; local tombstones stay deleted). Callers may restamp `changed` rows.
export function fromCSV(text, categories, now) {
  const fail = (msg) => ({ expenses: [], newCategories: [], errors: [msg] });
  const rows = parseCSV(text);
  if (!rows) return fail('Malformed CSV: unterminated quote');
  const header = (rows[0] || []).map((h) => h.trim().toLowerCase());
  if (!COLUMNS.every((c) => header.includes(c))) return fail(NOT_OURS);
  const col = Object.fromEntries(COLUMNS.map((c) => [c, header.indexOf(c)]));

  const all = [...categories];
  const byName = new Map();
  for (const c of categories) if (!c.deleted) byName.set(c.name.trim().toLowerCase(), c.id);
  const newCategories = [];
  const categoryFor = (name) => {
    if (!name) return OTHER_ID;
    const key = name.toLowerCase();
    if (!byName.has(key)) {
      const used = new Set(all.map((c) => c.color));
      const cat = {
        id: crypto.randomUUID(), name, icon: 'dots',
        color: CATEGORY_COLORS.find((c) => !used.has(c)) ?? CATEGORY_COLORS[all.length % CATEGORY_COLORS.length],
        order: Math.max(-1, ...all.map((c) => c.order)) + 1, updatedAt: now, deleted: false,
      };
      all.push(cat);
      newCategories.push(cat);
      byName.set(key, cat.id);
    }
    return byName.get(key);
  };

  const expenses = [];
  const errors = [];
  const seen = new Set();
  rows.forEach((r, i) => {
    if (i === 0 || (r.length === 1 && r[0].trim() === '')) return;
    const bad = (why) => errors.push(`Row ${i + 1}: ${why}`);
    if (r.length !== header.length) return bad('wrong number of columns');
    const get = (c) => r[col[c]].trim();
    const date = get('date');
    const time = get('time') || '12:00';
    const rawAmount = get('amount');
    const amount = AMOUNT_RE.test(rawAmount) ? parseAmount(rawAmount) : null;
    const id = get('id') || crypto.randomUUID();
    if (!validDate(date)) return bad('invalid date');
    if (!validTime(time)) return bad('invalid time');
    if (!Number.isSafeInteger(amount) || amount <= 0) return bad('invalid amount');
    if (seen.has(id)) return bad('duplicate id');
    seen.add(id);
    expenses.push({
      id, amount, categoryId: categoryFor(get('category')), date, time, note: r[col.note],
      createdAt: now, updatedAt: 0, deleted: false,
    });
  });
  return { expenses, newCategories, errors };
}
