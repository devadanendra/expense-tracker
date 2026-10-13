# Expense Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A single-user, offline-first expense tracker PWA for an Android phone that never loses data: IndexedDB on the phone, one-way automatic backup to the owner's Google Sheet, CSV export/import.

**Architecture:** Static site (plain HTML/CSS/ES modules, no build) on GitHub Pages. Pure logic modules (money, calculator, stats, CSV, merge, sync) are DOM-free and tested with Node's built-in test runner. A thin IndexedDB adapter and thin UI view modules sit around them. A Google Apps Script web app writes/reads the Sheet, gated by a passphrase that Chrome Password Manager remembers.

**Tech Stack:** HTML, CSS, vanilla JS ES modules, IndexedDB, Service Worker + Web App Manifest, Google Apps Script, `node --test` (Node 24, zero npm dependencies).

**Spec:** `docs/superpowers/specs/2026-10-13-expense-tracker-design.md`
**Visual reference:** `docs/design/mockup.html` (open it; copy tokens and layout from it).

## Global Constraints

- No runtime or dev npm dependencies. `package.json` exists only for `"type": "module"` and the `test` script.
- No secrets in the repo (it is public). The passphrase is never committed, logged, or put in a URL.
- English UI copy. Currency Rupiah only, formatted `Rp 2.450.000` (dot thousands, no decimals).
- Font: Plus Jakarta Sans 400/500/600/700 from Google Fonts; amounts use `font-variant-numeric: tabular-nums`.
- Light tokens: header/page `#e9e5de`, sheet bg `#f5f3ef`, surface `#ffffff`, text `#1c1917`, muted `#78716c`, divider `#ece8e2`, accent `#3a4bd8`, positive `#3f7a5f`.
- Dark tokens (`prefers-color-scheme: dark`): header `#26221e`, sheet bg `#141210`, surface `#1f1c19`, text `#f5f3ef`, muted `#a8a29e`, divider `#2e2a26`, accent `#8b97ff`, positive `#7fc4a0`.
- Line SVG icons only (no emoji as icons). Tap targets ≥ 44px. Visible focus. Respect `prefers-reduced-motion`.
- Sync is one-way push phone→Sheet; the only Sheet read is restore/link. Sheet hand edits unsupported.
- Merges are by `id`; higher `updatedAt` wins; never duplicate; restore/import never delete local records.

## Review Focus

1. **Wiped phone, then the owner logs a new expense before restoring** → that expense must not push to the Sheet until the device is linked (link always pull-merges first), and nothing on the Sheet is lost. Test: Task 5 `push is blocked while unlinked`.
2. **Offline or Apps Script error mid-push** → outbox keeps every unsent change; the next push resends them; no change is dropped. Test: Task 5 `failed push keeps outbox`.
3. **Wrong passphrase** → clear "Wrong passphrase" error, nothing stored, nothing linked. Test: Task 5 `auth error does not link`.
4. **Calculator garbage** (`5 ÷ 0`, trailing operator, result ≤ 0, > 12 digits) → save disabled or input ignored, never NaN/Infinity stored. Test: Task 2 cases.
5. **CSV import of the app's own export, twice** → second import changes nothing (no duplicates); notes with commas, quotes, newlines round-trip. Test: Task 4 `round-trip` and `idempotent import`.

---

## File Structure

```
index.html                 app shell, all screen containers, font + manifest links
styles.css                 tokens (light/dark), layout, components
manifest.webmanifest       name "Expense Tracker", display standalone, theme #e9e5de, icons
sw.js                      cache-first app shell, versioned cache name
icons/icon.svg, icon-192.png, icon-512.png, icon-maskable-512.png
js/config.js               export const SHEET_URL = '' (owner fills after deploy)
js/money.js                format/parse Rupiah
js/calc.js                 keypad expression state machine + evaluator
js/stats.js                month/day/category/week/strip/compare aggregations
js/csv.js                  export/import CSV
js/merge.js                mergeRecords
js/sync.js                 outbox push, link (pull+merge), restore, count
js/db.js                   IndexedDB adapter (stores: expenses, categories, meta, outbox)
js/store.js                app data API over db + outbox marking + change events
js/categories.js           DEFAULT_CATEGORIES, CATEGORY_COLORS
js/icons.js                icon(name) -> SVG string
js/ui/home.js, ui/entry-sheet.js, ui/reports.js, ui/search.js, ui/settings.js, ui/categories.js
js/app.js                  boot, routing (#/, #/reports, #/search, #/settings, #/categories), persist()
apps-script/Code.gs        doPost handler
apps-script/SETUP.md       owner deployment steps
tests/*.test.js            node --test
package.json               {"type":"module","private":true,"scripts":{"test":"node --test tests/"}}
README.md                  run locally, deploy, install on phone
.gitignore                 .superpowers/
```

## Data Model (shared by all tasks)

```js
// Expense
{ id: string /* crypto.randomUUID() */, amount: number /* integer rupiah > 0 */,
  categoryId: string, date: 'YYYY-MM-DD', time: 'HH:MM', note: string /* may be '' */,
  createdAt: number /* ms */, updatedAt: number /* ms */, deleted: boolean }
// Category
{ id: string, name: string, icon: string /* key in icons.js */, color: string /* hex */,
  order: number, updatedAt: number, deleted: boolean }
// Meta (single record, key 'meta')
{ passphrase: string|null, linked: boolean, lastSyncAt: number|null, lastError: string|null }
// Outbox entry (key `${kind}:${id}`)
{ kind: 'expense'|'category', id: string }
```

Deletes are tombstones (`deleted: true`, `updatedAt` bumped) so they sync and merge correctly; UI and stats ignore `deleted` records.

---

### Task 1: Project skeleton, money formatting, test runner

**Files:**
- Create: `package.json`, `.gitignore`, `README.md` (stub), `js/money.js`, `tests/money.test.js`

**Interfaces:**
- Produces: `formatRp(n: number) -> string` (`"Rp 2.450.000"`), `formatNum(n: number) -> string` (`"2.450.000"`), `parseAmount(s: string) -> number|null` (accepts `"2.450.000"`, `"2450000"`, `"Rp 2.450.000"`; returns null for non-numeric/empty).

- [ ] **Step 1:** `git init`, create `package.json` and `.gitignore` (contents in File Structure). Copy the spec into the repo as-is (already at `docs/superpowers/specs/`).
- [ ] **Step 2: Write failing tests** in `tests/money.test.js` using `node:test` + `node:assert/strict`:
  - `formatRp(2450000) === 'Rp 2.450.000'`, `formatRp(0) === 'Rp 0'`, `formatRp(500) === 'Rp 500'`
  - `formatNum(1000) === '1.000'`
  - `parseAmount('Rp 2.450.000') === 2450000`, `parseAmount('2450000') === 2450000`, `parseAmount('') === null`, `parseAmount('abc') === null`
- [ ] **Step 3:** Run `npm test` → FAIL (module not found).
- [ ] **Step 4:** Implement in `js/money.js` (dot grouping by hand or `toLocaleString('id-ID')`; verify output in Node matches exactly).
- [ ] **Step 5:** Run `npm test` → PASS.
- [ ] **Step 6:** Commit `chore: project skeleton and money formatting`.

### Task 2: Calculator keypad engine

**Files:** Create `js/calc.js`, `tests/calc.test.js`

**Interfaces:**
- Produces: `createCalc() -> { press(key: string): void, expression(): string, value(): number|null, canSave(): boolean, reset(): void, load(n: number): void }`
- Keys: `'0'..'9'`, `'000'`, `'+'`, `'-'`, `'×'`, `'÷'`, `'back'`, `'AC'`.
- `expression()` is the display string with formatted numbers and spaced operators, e.g. `"35.000 + 24.000"`. `value()` is the evaluated integer (× ÷ before + −, rounded with `Math.round`), or null if incomplete/invalid.
- `canSave()` is true only when `value()` is an integer `> 0` and `≤ 999_999_999_999`.

- [ ] **Step 1: Failing tests:**
  - keys `3,5,000,+,2,4,000` → `value() === 59000`, `expression() === '35.000 + 24.000'`
  - `1,0,×,3,+,5` → 35 (precedence)
  - `1,0,0,÷,3` → 33 (rounded)
  - `5,÷,0` → `value() === null`, `canSave() === false`
  - trailing operator `5,+` → `value() === null`, `canSave() === false`
  - operator first `+` → ignored (expression stays `''`)
  - two operators in a row `5,+,×` → second replaces first (`'5 ×'`)
  - leading zeros `0,0,5` → `'5'`
  - 13th digit in one number is ignored
  - `1,0,-,2,0` → `value() === -10`, `canSave() === false`
  - `back` removes last char; `AC` clears
  - `load(59000)` → `expression() === '59.000'`, `value() === 59000` (used when editing)
- [ ] **Step 2:** `npm test` → FAIL.
- [ ] **Step 3:** Implement. Store tokens as array of number strings and operators; evaluate with a two-pass (×÷ then +−) loop; no `eval`.
- [ ] **Step 4:** `npm test` → PASS.
- [ ] **Step 5:** Commit `feat: calculator keypad engine`.

### Task 3: Stats and categories data

**Files:** Create `js/stats.js`, `js/categories.js`, `tests/stats.test.js`

**Interfaces:**
- Produces in `categories.js`: `DEFAULT_CATEGORIES: Category[]` — 12 entries, order 0–11: Food & Drink (`food`, `#c2643c`), Transport (`car`, `#b8862b`), Groceries (`cart`, `#4d7c6b`), Bills (`bill`, `#6b62b5`), Shopping (`bag`, `#a85a7a`), Home (`home`, `#7a6a55`), Health (`heart`, `#c0504d`), Fun (`play`, `#3f7fa0`), Subscriptions (`repeat`, `#5f6fb0`), Self-care (`sparkle`, `#b0707a`), Business (`briefcase`, `#5a6b4a`), Other (`dots`, `#8a8178`). Stable ids `cat-food`, `cat-transport`, … `cat-other`. `CATEGORY_COLORS: string[]` = those 12 colors (for recolor picker). `OTHER_ID = 'cat-other'`.
- Produces in `stats.js` (all ignore `deleted` records; `ym` = `'YYYY-MM'`):
  - `inMonth(expenses, ym) -> Expense[]`
  - `total(expenses) -> number`
  - `byDay(expenses) -> Array<{date, total, items: Expense[]}>` newest date first, items newest `time` first
  - `byCategory(expenses) -> Array<{categoryId, total, share}>` sorted by total desc, `share` 0–1
  - `byWeek(expenses, ym) -> Array<{label, from, to, total}>` buckets 1–7, 8–14, 15–21, 22–28, 29–end (omit last bucket if month has 28 days); labels `'Oct 1–7'` style
  - `dailyStrip(expenses, ym) -> number[]` length = days in month
  - `compareToLastMonth(expenses, todayISO) -> {diff: number}` = this month days 1..d minus last month days 1..min(d, lastMonthDays)

- [ ] **Step 1: Failing tests** with a small fixture (≥ 6 expenses across Sep/Oct 2026, one deleted): totals exclude deleted; `byWeek` for `'2026-02'` has 4 buckets and for `'2026-10'` 5 buckets with last `to === 31`; `dailyStrip('2026-10').length === 31`; `compareToLastMonth` on `'2026-10-13'` compares Oct 1–13 vs Sep 1–13; on `'2026-03-31'` compares Mar 1–31 vs Feb 1–28; `byDay` ordering; `DEFAULT_CATEGORIES.length === 12` and ids unique.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: stats aggregations and default categories`.

### Task 4: CSV export/import and merge

**Files:** Create `js/csv.js`, `js/merge.js`, `tests/csv.test.js`, `tests/merge.test.js`

**Interfaces:**
- `mergeRecords(local: Rec[], incoming: Rec[]) -> { merged: Rec[], changed: Rec[] }` — by `id`; incoming wins only if `updatedAt` greater; `changed` = incoming records that were added or won.
- `toCSV(expenses, categories) -> string` — header exactly `date,time,amount,category,note,id`, non-deleted only, sorted by date then time ascending, RFC 4180 quoting (fields with `,` `"` or newline wrapped in quotes, `"` doubled), `\r\n` line endings, category as name.
- `fromCSV(text, categories, now: number) -> { expenses: Expense[], newCategories: Category[], errors: string[] }` — requires that header (case-insensitive, any column order); `amount` via `parseAmount`; unknown category name creates a new category (next unused color from `CATEGORY_COLORS`, icon `dots`); missing `id` → `crypto.randomUUID()`; missing `time` → `'12:00'`; bad row → skipped with `errors` entry `"Row N: <reason>"`; wrong header → no rows, one error `"Not an Expense Tracker CSV"`.

- [ ] **Step 1: Failing tests:**
  - merge: newer incoming replaces; older incoming ignored; new id added; tombstone with newer `updatedAt` wins; equal `updatedAt` keeps local.
  - `round-trip`: notes `'a, b'`, `'say "hi"'`, `'line1\nline2'` survive `fromCSV(toCSV(x))`.
  - `idempotent import`: import twice then `mergeRecords` → same count, `changed` empty second time.
  - unknown category creates one category, reused for later rows with the same name.
  - bad amount row reported as `Row 3: invalid amount`; wrong header rejected.
- [ ] **Step 2:** FAIL. **Step 3:** Implement (hand-written CSV parser handling quoted fields with newlines). **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: csv export/import and record merge`.

### Task 5: Sync engine

**Files:** Create `js/sync.js`, `tests/sync.test.js`

**Interfaces:**
- Consumes: `mergeRecords` (Task 4).
- Produces: `createSync({ url: string, fetch, store }) -> { push(): Promise<Result>, link(passphrase): Promise<Result>, remoteCount(passphrase): Promise<{ok, count?, error?}> }` where `Result = { ok: boolean, error?: 'auth'|'network'|'server'|'unlinked'|'nourl', pushed?: number, pulled?: number }`.
- `store` is the dependency (implemented in Task 6, faked in tests) with: `getMeta()`, `setMeta(patch)`, `getOutbox() -> OutboxEntry[]`, `clearOutbox(entries)`, `getRecord(kind, id)`, `allExpenses()`, `allCategories()`, `putMany(kind, recs)` (writes without re-marking outbox), `markAllDirty()`.
- Wire protocol (POST, header `Content-Type: text/plain;charset=utf-8` to avoid CORS preflight, body JSON; response JSON):
  - `{op:'count', pass}` → `{ok:true, expenses:number}`
  - `{op:'pull', pass}` → `{ok:true, expenses:Expense[], categories:Category[]}`
  - `{op:'upsert', pass, expenses:Expense[], categories:Category[]}` → `{ok:true}`
  - any op with wrong pass → `{ok:false, error:'auth'}`
- Behavior:
  - `push()`: if `!SHEET_URL` → `nourl`; if `!meta.linked` → `unlinked` (no request); else send current records for all outbox entries in one upsert; on `ok` clear exactly those entries and set `lastSyncAt`; on failure keep outbox, set `lastError`.
  - `link(pass)`: pull with pass; on auth error return `auth` and store nothing; on success `mergeRecords` into local for both kinds (`putMany`), set `{passphrase: pass, linked: true}`, `markAllDirty()`, then `push()`. Return `pulled` = count of changed records.
  - `remoteCount(pass)`: count op, for the "Your Sheet has N expenses" prompt.

- [ ] **Step 1: Failing tests** with a fake `fetch` and in-memory fake store:
  - `push is blocked while unlinked` → returns `{ok:false,error:'unlinked'}`, fetch never called.
  - `failed push keeps outbox` (fetch rejects) → outbox unchanged, `lastError` set, `error:'network'`.
  - `auth error does not link` → meta.passphrase stays null, linked false.
  - `link merges then pushes` → remote has 3 expenses, local has 1 different → local ends with 4, upsert body contains all 4.
  - push sends request `Content-Type` `text/plain;charset=utf-8` and never puts pass in the URL.
- [ ] **Step 2:** FAIL. **Step 3:** Implement. **Step 4:** PASS.
- [ ] **Step 5:** Commit `feat: sync engine with link and outbox push`.

### Task 6: IndexedDB store

**Files:** Create `js/db.js`, `js/store.js`

**Interfaces:**
- `db.js`: `openDB() -> Promise<IDBDatabase>` (name `expense-tracker`, version 1, stores `expenses`, `categories` keyPath `id`; `meta`, `outbox` out-of-line keys). Small promise helpers `get/put/putMany/getAll/del/clear`.
- `store.js` (implements the Task 5 store contract plus):
  - `init() -> Promise<void>` — seeds `DEFAULT_CATEGORIES` only if categories store is empty **and** meta is absent.
  - `saveExpense(partial) -> Promise<Expense>` (new: sets id/createdAt; always bumps `updatedAt`, marks outbox)
  - `deleteExpense(id)` (tombstone + outbox), `saveCategory(partial)`, `deleteCategory(id)` (tombstone; reassigns its live expenses to `OTHER_ID`, saving each), `reorderCategories(ids: string[])`
  - `liveExpenses() -> Expense[]`, `liveCategories() -> Category[]` (sorted by order), `isEmpty() -> boolean` (no expenses at all, deleted included)
  - `onChange(fn)` — called after every write
- No Node tests (IndexedDB is browser-only); verified in Task 7's browser run. Keep logic thin; all decisions live in tested modules.

- [ ] **Step 1:** Implement both files.
- [ ] **Step 2:** Verify in browser console on `python -m http.server 8080` page: `saveExpense` then reload → still there; `deleteCategory('cat-fun')` moves its expenses to Other.
- [ ] **Step 3:** Commit `feat: indexeddb store`.

### Task 7: App shell, PWA, styles, home screen

**Files:** Create `index.html`, `styles.css`, `manifest.webmanifest`, `sw.js`, `icons/*`, `js/icons.js`, `js/config.js`, `js/app.js`, `js/ui/home.js`; add `.claude/launch.json` entry `{"name":"static","runtimeExecutable":"python","runtimeArgs":["-m","http.server","8080"],"port":8080}`

**Interfaces:**
- `icons.js`: `icon(name: string) -> string` SVG markup, `aria-hidden="true"`, stroke 1.8, keys used across tasks: `food car cart bill bag home heart play repeat sparkle briefcase dots search gear plus cal note check back x chevron-down chevron-right cloud download upload tag inbox`.
- `app.js`: `boot()` — `navigator.storage.persist()`, `store.init()`, register `sw.js`, hash router rendering the view for `#/`, `#/reports`, `#/search`, `#/settings`, `#/categories`; holds `state.ym` (selected month).
- `home.js`: `renderHome(root, state)` — header (month title with chevron opens native `<input type="month">`; prev/next buttons; tap title resets to current month), "Spent this month" total, compare line (`↓ Rp 310.000 vs last month` in positive color when diff<0, `↑ … ` muted when >0, hidden on non-current months), 31-day strip (today = accent, future = flat), day groups `Today · Tue 13` / `Yesterday · Mon 12` / `Sun 11 Oct` with subtotal, rows (note main line, else category name; second line `Category · HH:MM`), floating capsule nav. Empty month: inbox icon, "No expenses yet", "Tap + to log your first one." When `store.isEmpty()` and not linked: restore card (Task 10 fills its action).
- Layout and tokens per Global Constraints and the reference mockup; header and sheet structure as in `docs/design/mockup.html`.
- `sw.js`: cache name `et-v1`; precache shell files; cache-first for same-origin GET; bump name on each release (note in README).

- [ ] **Step 1:** Generate PNG icons from `icon.svg` (ink "Rp" mark on stone; any local method) and write manifest (`start_url: "./"`, `scope: "./"`, `display: "standalone"`, `background_color: "#f5f3ef"`, `theme_color: "#e9e5de"`).
- [ ] **Step 2:** Implement shell, styles, router, home.
- [ ] **Step 3:** Run preview (`static`), seed a few expenses from console, check at 375px light and dark: totals, grouping, strip, empty state; Chrome DevTools Application tab shows manifest installable and SW active; offline reload works.
- [ ] **Step 4:** Commit `feat: app shell, pwa and home screen`.

### Task 8: Entry sheet (add / edit / delete)

**Files:** Create `js/ui/entry-sheet.js`; modify `js/app.js`, `js/ui/home.js`

**Interfaces:**
- Consumes: `createCalc` (Task 2), `store.saveExpense/deleteExpense` (Task 6).
- Produces: `openEntrySheet({ expense?: Expense, onDone })`.
- Bottom sheet with drag handle and close button; title "New expense" / "Edit expense"; amount `Rp` + `calc.expression()` big, running expression line below when it contains an operator; 4-column category grid (all live categories, selected ring in accent); date chips Today (default) / Yesterday / calendar (native `<input type="date">`); Note chip reveals a text input (max 120 chars); keypad grid per mockup with save key spanning 2 rows, disabled unless `calc.canSave()`. Edit mode adds a "Delete" text button with a confirm. Time = current `HH:MM` on create, unchanged on edit. Opens from nav "+" and from row tap. Closes on save, X, scrim tap, or Android back (push a history state on open).
- Physical keyboard digits/operators/Enter/Backspace also work (laptop nicety, cheap).

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** In preview: add `35000 + 24000` as Food → home shows Rp 59.000 today; edit to Transport; delete; Android-back closes sheet without leaving app.
- [ ] **Step 3:** Commit `feat: add/edit expense sheet`.

### Task 9: Reports, search, categories screens

**Files:** Create `js/ui/reports.js`, `js/ui/search.js`, `js/ui/categories.js`; modify `js/app.js`

**Interfaces:**
- Consumes: `stats.*` (Task 3), `store.*` (Task 6).
- `renderReports(root, state)`: header with month + total; segmented control Categories | Weeks. Categories: rows icon, name, amount, bar width = share, bar in category color. Weeks: bar chart (current week accent, past bars `--bar`, future flat) + list of `label` / amount.
- `renderSearch(root)`: autofocus input; matches note or category name, case-insensitive, all months, live non-deleted; results grouped by day like home with month-year in day header; tapping opens entry sheet.
- `renderCategories(root)`: list with move up/down buttons (no drag), tap to edit name/color (swatches from `CATEGORY_COLORS`)/icon (grid of category icon keys); "Add category"; delete with confirm text "Expenses in X will move to Other." `cat-other` cannot be deleted.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** Preview check with seeded data: report totals equal home total; Feb 2026 shows 4 week bars; search "padang" finds the expense from another month; deleting a category moves its expenses to Other.
- [ ] **Step 3:** Commit `feat: reports, search and categories`.

### Task 10: Settings, CSV UI, sync UI and restore flow

**Files:** Create `js/ui/settings.js`; modify `js/app.js`, `js/ui/home.js`

**Interfaces:**
- Consumes: `createSync` (Task 5), `toCSV/fromCSV/mergeRecords` (Task 4), store.
- Settings groups (copy exact):
  - **Data safety:** "Google Sheet sync" row → status text: `Not set up` / `Synced 2 min ago` / `3 changes waiting` / `Wrong passphrase` / `Can't reach Google — will retry`. "Storage" row: `Protected` if `navigator.storage.persisted()` else `Not protected — install the app to your home screen`. "Restore from Sheet" row.
  - **Data:** "Export CSV" (`N expenses`) → Download (`expenses-YYYY-MM-DD.csv`) or Copy; "Import CSV" → choose file or paste; result toast `Imported 12, skipped 1` and list errors.
  - **General:** Categories → `#/categories`.
- Passphrase form (used by set-up and restore): a real `<form>` with hidden `<input autocomplete="username" value="expense-tracker">` and `<input type="password" name="password" autocomplete="current-password">`, submit button "Connect" / "Restore". On submit call `sync.link(pass)`; on `auth` show "Wrong passphrase"; on success the browser offers to save the password.
- Restore prompt: before link from the empty-state card, call `remoteCount`; show "Your Sheet has N expenses. Restore them?" → Restore runs `link`.
- Empty-store card on home (when `store.isEmpty()` and not linked): title "Restore your data", text "Have a Google Sheet backup? Restore it in two taps.", buttons "Restore" (opens passphrase form) and "Start fresh" (dismisses for this session).
- Auto push: after each `store.onChange` (debounced 2 s), on `online` event, and on app start, if linked.
- `SHEET_URL` empty → sync rows show `Not set up — see SETUP.md` and are inert.

- [ ] **Step 1:** Implement.
- [ ] **Step 2:** With a fake endpoint (temporary local Python handler or the real Apps Script from Task 11): link, add expense → Sheet row appears; DevTools "Clear site data" → reopen → restore card → passphrase autofill offered → Restore → all data back; offline add → back online → pushed.
- [ ] **Step 3:** Export → import same file → `Imported 0` changes, no duplicates.
- [ ] **Step 4:** Commit `feat: settings, csv and sync ui with restore`.

### Task 11: Apps Script backend and owner setup guide

**Files:** Create `apps-script/Code.gs`, `apps-script/SETUP.md`; modify `README.md`

**Interfaces:**
- Consumes: wire protocol from Task 5 (exact op names and shapes).
- `Code.gs`: `doPost(e)` parses `e.postData.contents`; compares `pass` with `PropertiesService.getScriptProperties().getProperty('PASSPHRASE')` using a constant-time-ish compare; uses `LockService.getScriptLock()` around writes; returns `ContentService.createTextOutput(JSON.stringify(...)).setMimeType(ContentService.MimeType.JSON)`.
  - Sheet `Expenses` columns: `id, date, time, amount, category, categoryId, note, createdAt, updatedAt, deleted` (timestamps as ISO strings in the sheet, ms numbers in the API). Sheet `Categories`: `id, name, icon, color, order, updatedAt, deleted`. Create sheets with header rows if missing.
  - upsert: index existing rows by `id` (column A) and overwrite or append in one `setValues` batch per sheet.
  - pull: return all rows converted back to API shape (numbers, booleans).
  - count: number of non-deleted expense rows.
  - `doGet` returns `{ok:true, app:'expense-tracker'}` (health check, no data).
- `SETUP.md` steps for the owner: create Google Sheet → Extensions › Apps Script → paste `Code.gs` → Project Settings › Script properties › add `PASSPHRASE` (pick a long one) → Deploy › New deployment › Web app, Execute as **Me**, Who has access **Anyone** → authorize → copy URL into `js/config.js` `SHEET_URL` → commit/push. Plus how to redeploy after edits (Manage deployments › Edit › New version, URL unchanged).
- `README.md`: run locally (`python -m http.server 8080`), tests (`npm test`), deploy to GitHub Pages (Settings › Pages › Deploy from branch `main` / root), install on phone (Chrome › ⋮ › Add to Home screen / Install app), bump `sw.js` cache name on release.

- [ ] **Step 1:** Implement `Code.gs` as plain JS; syntax-check by copying to a temp `.js` file and running `node --check` on it → no output.
- [ ] **Step 2:** Write SETUP.md and README.
- [ ] **Step 3:** Owner-assisted check (needs the owner's Google account; ask before doing anything there): deploy, set `SHEET_URL`, run Task 10 Step 2 against the real endpoint.
- [ ] **Step 4:** Commit `feat: apps script backend and setup docs`.

### Task 12: Publish and phone check

**Files:** none new (maybe `sw.js` cache bump)

- [ ] **Step 1:** Ask the owner before creating the GitHub repo and pushing (outward-facing). Create public repo, push `main`, enable Pages.
- [ ] **Step 2:** Owner installs on phone; checklist: installs as app, Settings shows Storage `Protected`, add expense offline, comes back online and syncs, CSV download lands in Downloads, dark mode follows phone.
- [ ] **Step 3:** Final `npm test` → all PASS; commit any fixes `chore: release v1`.
