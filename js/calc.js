import { formatNum } from './money.js';

const OPS = ['+', '-', '×', '÷'];
const MAX_DIGITS = 12;
const MAX_AMOUNT = 999_999_999_999;

// tokens alternate: number string, operator, number string, ... (a trailing operator is allowed)
function evaluate(tokens) {
  if (!tokens.length || OPS.includes(tokens.at(-1))) return null;
  // Pass 1: fold × and ÷ into the running term; + and - split terms.
  const terms = [Number(tokens[0])];
  const signs = [];
  for (let i = 1; i < tokens.length; i += 2) {
    const op = tokens[i];
    const n = Number(tokens[i + 1]);
    if (op === '×') terms[terms.length - 1] *= n;
    else if (op === '÷') {
      if (n === 0) return null;
      terms[terms.length - 1] /= n;
    } else {
      signs.push(op === '+' ? 1 : -1);
      terms.push(n);
    }
  }
  // Pass 2: + and -.
  const sum = signs.reduce((acc, s, i) => acc + s * terms[i + 1], terms[0]);
  // Overflow gives Infinity/NaN; `+ 0` turns -0 (from rounding -0.3) into 0.
  return Number.isFinite(sum) ? Math.round(sum) + 0 : null;
}

// Rebuild tokens from raw text after a mid-expression edit, applying the same rules as typing:
// no leading op, one op between numbers (the later wins), no leading zeros, MAX_DIGITS per number.
// Returns the tokens and where the caret lands (count of kept chars that were before it).
function sanitize(raw, caret) {
  const out = []; // { ch, at } per kept char
  const curStart = () => {
    let i = out.length;
    while (i > 0 && !OPS.includes(out[i - 1].ch)) i--;
    return i;
  };
  [...raw].forEach((ch, at) => {
    if (OPS.includes(ch)) {
      if (!out.length) return;
      if (OPS.includes(out.at(-1).ch)) out.pop();
      out.push({ ch, at });
      return;
    }
    const from = curStart();
    const len = out.length - from;
    if (len >= MAX_DIGITS) return;
    if (len === 1 && out[from].ch === '0') out.pop(); // '05' is '5'; '00' is '0' (the new 0 re-adds)
    out.push({ ch, at });
  });
  const tokens = [];
  for (const { ch } of out) {
    if (OPS.includes(ch) || !tokens.length || OPS.includes(tokens.at(-1))) tokens.push(ch);
    else tokens[tokens.length - 1] += ch;
  }
  return { tokens, caret: out.filter((c) => c.at < caret).length };
}

export function createCalc() {
  let tokens = [];
  let caret = null; // null: typing at the end; else the number of raw chars before the cursor

  function pressDigits(key) {
    const last = tokens.at(-1);
    const cur = last === undefined || OPS.includes(last) ? '' : last;
    // No leading zeros: '000' on an empty number is a single 0.
    const digits = key === '000' && (cur === '' || cur === '0') ? '0' : key;
    if (cur === '') tokens.push(digits);
    else if (cur === '0') tokens[tokens.length - 1] = digits;
    // '000' near the cap appends only the zeros that fit.
    else tokens[tokens.length - 1] = cur + digits.slice(0, MAX_DIGITS - cur.length);
  }

  const raw = () => tokens.join('');

  // Edit in the middle: insert `text` at the caret, or delete the char before it (text '').
  function editAt(text) {
    const r = raw();
    const from = text ? caret : caret - 1;
    if (from < 0) return;
    const next = r.slice(0, from) + text + r.slice(caret);
    ({ tokens, caret } = sanitize(next, from + text.length));
    if (caret >= raw().length) caret = null;
  }

  function press(key) {
    if (key === 'AC') {
      tokens = [];
      caret = null;
    } else if (caret !== null && (key === 'back' || OPS.includes(key) || /^\d$/.test(key) || key === '000')) {
      editAt(key === 'back' ? '' : key);
    } else if (key === 'back') {
      const last = tokens.at(-1);
      if (last === undefined) return;
      if (OPS.includes(last) || last.length === 1) tokens.pop();
      else tokens[tokens.length - 1] = last.slice(0, -1);
    } else if (OPS.includes(key)) {
      if (!tokens.length) return;
      if (OPS.includes(tokens.at(-1))) tokens[tokens.length - 1] = key;
      else tokens.push(key);
    } else if (/^\d$/.test(key) || key === '000') pressDigits(key);
  }

  function value() {
    return evaluate(tokens);
  }

  return {
    press,
    expression: () => tokens.map((t) => (OPS.includes(t) ? t : formatNum(Number(t)))).join(' '),
    value,
    canSave() {
      const v = value();
      return Number.isInteger(v) && v > 0 && v <= MAX_AMOUNT;
    },
    reset() {
      tokens = [];
      caret = null;
    },
    load(n) {
      tokens = [String(Math.round(n))];
      caret = null;
    },
    // The expression char by char for tapping: pos is the caret value after that char. sep marks
    // the thousands dots, which show but never hold the caret.
    chars() {
      const out = [];
      let pos = 0;
      for (const t of tokens) {
        if (OPS.includes(t)) {
          out.push({ ch: t, pos: ++pos, op: true });
          continue;
        }
        let digits = 0;
        for (const ch of formatNum(Number(t))) {
          if (/\d/.test(ch)) {
            digits++;
            out.push({ ch, pos: pos + digits });
          } else out.push({ ch, pos: pos + digits, sep: true });
        }
        pos += digits;
      }
      return out;
    },
    caret: () => caret,
    // Put the caret after raw char `pos`; the end (or past it) goes back to plain typing.
    setCaret(pos) {
      caret = pos >= raw().length ? null : Math.max(0, pos);
    },
  };
}
