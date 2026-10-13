// Hand-rolled dot grouping: toLocaleString('id-ID') depends on the runtime's ICU data.
export function formatNum(n) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

export function formatRp(n) {
  return `Rp ${formatNum(n)}`;
}

// Integer rupiah only; dots are thousands separators. Returns null if not all digits.
export function parseAmount(s) {
  const digits = String(s).replace(/^\s*Rp/i, '').replace(/[\s.]/g, '');
  return /^\d+$/.test(digits) ? Number(digits) : null;
}
