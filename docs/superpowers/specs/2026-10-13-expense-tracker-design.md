# Expense Tracker — Design

Date: 2026-10-13
Status: draft, awaiting owner approval

## Intent

A personal, single-user expense tracker that runs in the browser on an Android phone. Inspired by Natauang (web.natauang.com): same features, own look.

The reason it exists: Natauang keeps everything only in the browser's IndexedDB (PouchDB), non-persistent (`navigator.storage.persisted() === false`). The owner's data keeps vanishing without warning, most likely browser eviction or site-data clearing. This app must not lose data.

## Goals

- Log an expense in a few seconds on a phone: amount (with a calculator keypad), category, date, optional note.
- Never lose data. Survive cache/site-data clearing and browser eviction.
- Data stays on the phone by default; an automatic copy goes to the owner's own Google Sheet.
- CSV export and import.
- Very light: static files, no framework, no build step, no backend server to run.
- Feels calm, premium and simple (see Look and feel).

## Non-goals

- Multiple users, accounts, sharing.
- Income, budgets, multiple currencies (Rupiah only).
- Native app / Play Store. It is a website installed to the home screen (PWA).
- Natauang's "Sinkronisasi Data" feature beyond what's described here.

## Anti-goals (failure even if it "works")

- Any path where data silently disappears, or where a restore merges into a half-empty state and duplicates/loses entries.
- Looking like a knock-off of Apple, Nike or Natauang.
- Heavy tech: frameworks, bundlers, databases, servers to maintain.
- Anyone who finds the site URL being able to read or write the owner's data.

## Constraints

- Device: Android phone, Chrome, is the only place expenses are logged (owner decision). The laptop is not a sync client; at most it opens the Sheet. The layout should still not break on a wider screen.
- The Sheet is a read-only backup: only the app writes to it. Sync is one-way push (phone to Sheet). The only read from the Sheet is the restore pull. Hand edits in the Sheet are not supported.
- Hosting: GitHub Pages (owner has a GitHub account). Free tier means the repo is public, so no secrets in the code.
- Owner is the only user.

## Data safety (decided by owner)

Three layers:

1. **Installed PWA + persistent storage.** The app is installed via Chrome "Add to Home screen" and calls `navigator.storage.persist()`. Prevents silent eviction. Does not protect against manual "clear site data" or cleaner apps.
2. **Automatic Google Sheet sync (on by owner choice).** Every add/edit/delete is sent in the background to a Google Sheet in the owner's own Google account, via a Google Apps Script web app the owner deploys once. Offline changes queue and send when back online. The phone keeps the main copy (fast, offline); the Sheet is the safety net and doubles as the owner's spreadsheet view.
3. **CSV export/import** as the manual last resort.

**Auth: passphrase, remembered by Chrome (owner chose this over a zero-tap, no-secret option).**
- The Apps Script URL is built into the site config (not secret).
- The Apps Script rejects any request without the correct passphrase. The passphrase is set once by the owner in the Apps Script and entered once in the app.
- The app's passphrase field is a real `<form>` with `type="password"` and an `autocomplete` username/password pair so Chrome Password Manager offers to save it. Saved passwords live in the Google account, not site data, so they survive a wipe.

**Restore after a wipe (owner-approved flow):**
1. App opens with no local data.
2. Empty state offers "Restore from Google Sheet".
3. Owner taps the passphrase field, Chrome autofills, taps Restore.
4. App pulls everything from the Sheet, stores the passphrase locally again, sync resumes.

**Guard:** if local data is empty but the Sheet has data, the app must ask "Your Sheet has N expenses. Restore them?" before allowing new entries to sync, so a fresh empty state never overwrites or mixes with the Sheet.

**Also decided (my call):**
- Categories (including added, renamed, recolored, reordered) sync to the Sheet too and come back on restore.
- Restore and CSV import merge by expense ID: never duplicate, never delete local entries.

## Features (replicating Natauang)

- **Home / Transactions:** month picker (prev/next, tap title to jump back to current month); month total; comparison vs last month at the same point in the month (e.g. "↓ Rp 310.000 vs last month"); 31-day spending strip with today highlighted; expenses grouped by day with day subtotal ("Today · Tue 13"). Rows: note as main line, "Category · time" below, amount right. If no note, category name is the main line. Tap a row to edit or delete.
- **Add / edit expense:** bottom sheet (UX v2, 2026-10-16; board `Main.dc.html`). Large amount display, calculator keypad 4×5 (AC, ×, ÷, backspace, digits, 000, −, +, tall save). Shows the running expression under the amount. Category pill (opens a 4-column picker panel) plus a scrollable row of emoji circles. Date row: date (native picker) and a "Yesterday?" / "Today?" link. Note row. No X button: closes by scrim tap, drag down, Android back or Escape.
- **Categories:** start with 12, in English: Food & Drink, Transport, Groceries, Bills, Shopping, Home, Health, Fun, Subscriptions, Self-care, Business, Other. Each has an icon (emoji, see below) and a color from the app's earthy palette. Owner can add, rename, recolor, reorder, delete (delete must handle existing expenses, e.g. move them to Other).
- **Search:** across all months, by note or category name.
- **Reports:** for the selected month, segmented control: Categories (rows with icon, name, amount, proportional colored bar) and Weeks (bar chart for 1–7, 8–14, 15–21, 22–28, 29–end, current week in accent, plus a list of weekly totals).
- **Settings:** grouped. Data safety: Google Sheet sync (status "Synced 2 min ago" / pending count / error), Restore from Sheet. Data: Export CSV (download or copy, shows expense count), Import CSV (file or paste). Storage row shows protection and usage (tap asks Chrome to protect the data, else explains installing). General: Categories, Appearance (System / Light / Dark).
- **Empty month:** quiet icon, "No expenses yet", "Tap + to log your first one." (When the whole store is empty, show the restore offer instead.)
- **Language:** English UI. **Currency:** Rupiah, Indonesian grouping, e.g. `Rp 2.450.000`.

## Look and feel (decided by owner through mockups)

Reference mockup: `docs/design/mockup.html` (screens: home, add, reports ×2, settings, empty, dark home, dark add).

- **Direction:** "Stone & Ink." Calm and premium in the spirit of Apple's restraint, but its own: no iOS conventions copied, no Nike-style heavy type, no mascot.
- **Font:** Figtree (400/500/600/700; owner decision 2026-10-16, was Plus Jakarta Sans). Tabular numbers for amounts. Big total ~36px weight 600, tight letter-spacing.
- **Color tokens (light):** header/page `#e9e5de`, sheet background `#f5f3ef`, surface `#ffffff`, text `#1c1917`, muted `#78716c`, divider `#ece8e2`, accent ink `#3a4bd8`, positive `#3f7a5f`.
- **Dark (follows system setting unless Settings › Appearance forces light or dark):** warm dark, not pure black. Header `#26221e`, sheet `#141210`, surface `#1f1c19`, text `#f5f3ef`, muted `#a8a29e`, accent `#8b97ff`.
- **Category palette (earthy; shown as an 18% pastel tint behind the category emoji):** `#c2643c`, `#b8862b`, `#4d7c6b`, `#6b62b5`, `#a85a7a`, `#7a6a55`, `#c0504d`, `#3f7fa0` (+ more in the same family for 12).
- **Layout:** stone header holds month, total, comparison and strip; the content sheet (rounded top 24px) rises over it, Natauang-style. Lists are white rounded cards with hairline dividers. Floating capsule nav at bottom: Transactions · round ink "+" · Reports. Search and Settings as round icon buttons in the header.
- **Icons:** UI icons are one consistent line-icon set (SVG, ~1.8–2px stroke). Category icons are emoji on pastel circles (owner decision 2026-10-16); records keep icon keys, mapped to emoji in one table.
- **Accessibility:** tap targets ≥44px, text contrast ≥4.5:1, visible focus, respects reduced motion.

## Tech shape (my call, not discussed in depth)

- Plain HTML, CSS, vanilla JS modules. No framework, no bundler, no npm runtime dependencies.
- Local store: IndexedDB (small hand-written wrapper).
- Service worker + web manifest so it installs and works offline.
- Google Apps Script (`Code.gs`) shipped in the repo with setup steps for the owner: create Sheet, paste script, set passphrase, deploy as web app ("Execute as me", "Anyone"), copy URL into the site config.
- Hosted on GitHub Pages from the repo.

## Left to the builder

- Exact sync protocol (IDs, timestamps, tombstones for deletes, queue format, conflict handling for a single user), as long as the guard and restore flow above hold.
- Sheet column layout (keep it human-readable: date, amount, category, note at minimum).
- CSV column format (should round-trip with the app's own export; Natauang import compatibility is nice-to-have).
- Animation details, exact spacing, remaining category colors and icons.
- Repo structure and test approach.
