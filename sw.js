// Bump on every release (et-v1 -> et-v2 ...) so installed phones fetch the new files.
const CACHE = 'et-v11';
const SHELL = [
  './',
  'index.html',
  'styles.css',
  'manifest.webmanifest',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-maskable-512.png',
  'icons/shortcut-add-96.png',
  'js/app.js',
  'js/calc.js',
  'js/categories.js',
  'js/config.js',
  'js/csv.js',
  'js/db.js',
  'js/icons.js',
  'js/install.js',
  'js/merge.js',
  'js/money.js',
  'js/stats.js',
  'js/store.js',
  'js/sync.js',
  'js/theme.js',
  'js/ui/categories.js',
  'js/ui/entry-sheet.js',
  'js/ui/frequent.js',
  'js/ui/home.js',
  'js/ui/reports.js',
  'js/ui/search.js',
  'js/ui/settings.js',
];

self.addEventListener('install', (e) => {
  // cache: 'reload' skips the HTTP cache (Pages sends max-age=600), so a bumped cache never stores stale copies.
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL.map((u) => new Request(u, { cache: 'reload' })))));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// Cache-first for same-origin GETs. Everything else (Google Fonts, the Apps Script sync POSTs)
// goes straight to the network untouched.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(caches.match(req).then((hit) => hit || fetch(req)));
});
