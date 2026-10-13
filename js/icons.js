// Line icons on a 24px grid. Stroke styling lives on the <svg> so CSS can override stroke-width.
const PATHS = {
  food: '<path d="M3 11h18M5 11l1 9h12l1-9M9 7a3 3 0 0 1 6 0"/>',
  car: '<rect x="3" y="7" width="18" height="10" rx="2"/><circle cx="7" cy="17" r="2"/><circle cx="17" cy="17" r="2"/>',
  cart: '<path d="M6 6h15l-2 9H8L6 3H3"/><circle cx="9" cy="20" r="1"/><circle cx="18" cy="20" r="1"/>',
  bill: '<path d="M6 3h12v18l-3-2-3 2-3-2-3 2z"/><path d="M9 8h6M9 12h6"/>',
  bag: '<path d="M6 7h12l1 13H5z"/><path d="M9 7a3 3 0 0 1 6 0"/>',
  home: '<path d="M3 11 12 4l9 7v9H3z"/>',
  heart: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>',
  play: '<circle cx="12" cy="12" r="9"/><path d="m10 8 6 4-6 4z"/>',
  repeat: '<path d="m17 3 3 3-3 3"/><path d="M4 11V9a3 3 0 0 1 3-3h13"/><path d="m7 21-3-3 3-3"/><path d="M20 13v2a3 3 0 0 1-3 3H4"/>',
  sparkle: '<path d="M12 4c.7 4.3 3.7 7.3 8 8-4.3.7-7.3 3.7-8 8-.7-4.3-3.7-7.3-8-8 4.3-.7 7.3-3.7 8-8z"/>',
  briefcase: '<rect x="3" y="7" width="18" height="13" rx="2"/><path d="M9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M3 13h18"/>',
  dots: '<circle cx="6" cy="12" r="1.2"/><circle cx="12" cy="12" r="1.2"/><circle cx="18" cy="12" r="1.2"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/>',
  gear: '<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1 7 17M17 7l2.1-2.1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  cal: '<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>',
  note: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  back: '<path d="M20 12H8l4-4M8 12l4 4"/>',
  x: '<path d="M6 6l12 12M18 6 6 18"/>',
  'chevron-up': '<path d="m18 15-6-6-6 6"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  'chevron-left': '<path d="m15 18-6-6 6-6"/>',
  'chevron-right': '<path d="m9 18 6-6-6-6"/>',
  cloud: '<path d="M7 18h10a4 4 0 0 0 .5-8A6 6 0 0 0 6 9a4.5 4.5 0 0 0 1 9z"/>',
  download: '<path d="M12 4v12M6 11l6 6 6-6M4 20h16"/>',
  upload: '<path d="M12 20V8M6 13l6-6 6 6M4 4h16"/>',
  tag: '<path d="M3 12V4h8l10 10-8 8z"/><circle cx="8" cy="8" r="1.5"/>',
  inbox: '<path d="M3 13h5l1 3h6l1-3h5"/><path d="M5 5h14l2 8v6H3v-6z"/>',
  shield: '<path d="M12 3 5 6v5c0 4.4 2.9 8.3 7 10 4.1-1.7 7-5.6 7-10V6z"/>',
};

// Unknown names (e.g. a category icon key from a restored Sheet) fall back to `dots`.
export const icon = (name) =>
  `<svg class="i" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round">${Object.hasOwn(PATHS, name) ? PATHS[name] : PATHS.dots}</svg>`;
