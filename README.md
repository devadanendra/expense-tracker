# Expense Tracker

Single-user, offline-first Rupiah expense tracker. A plain HTML/JS PWA: no build step, no dependencies.

## Run locally

```
python3 -m http.server 8080
```

Open http://localhost:8080.

## Tests

```
npm test
```

## Deploy to GitHub Pages

Repository **Settings › Pages › Build and deployment › Deploy from a branch**, branch `main`, folder `/ (root)`.

**Give the app its own origin.** The browser walls off data by origin (`https://host`), not by path. On `<user>.github.io/expense-tracker`, every other page under `<user>.github.io`, such as the user site or another repo's Pages, can read the app's expenses and its saved passphrase. Serve it where nothing else runs: a custom subdomain (a `CNAME` file), or a GitHub account or organization that hosts nothing else on Pages. Moving origin starts the phone empty: connect it with **Restore** to pull everything back from the Sheet.

## Install on your phone

Open the Pages URL in Chrome, then **⋮ › Add to Home screen** (or **Install app**).

## Release

Bump `CACHE` in `sw.js` (`et-v1` → `et-v2` …) on every deploy, including the `js/config.js` change in [SETUP step 10](apps-script/SETUP.md), or installed phones keep the old files.

## Google Sheet backup

Optional one-way backup to your own Google Sheet: follow [apps-script/SETUP.md](apps-script/SETUP.md).

## Your data

The phone is the main copy. The Sheet is a one-way backup: the app writes your changes to it and reads it only when you restore or connect a phone. Edits made by hand in the Sheet are not read back. As a last resort, **Settings › Export CSV** saves everything as a file you can keep.
