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

export function createCalc() {
  let tokens = [];

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

  function press(key) {
    if (key === 'AC') tokens = [];
    else if (key === 'back') {
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
    },
    load(n) {
      tokens = [String(Math.round(n))];
    },
  };
}
