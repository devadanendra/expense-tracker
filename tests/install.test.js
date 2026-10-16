import { test } from 'node:test';
import assert from 'node:assert/strict';

// install.js keeps module state (the deferred prompt), so each test imports a fresh copy.
let n = 0;
const fresh = () => import(`../js/install.js?${n++}`);
const DAY = 86400000;
const NOW = Date.UTC(2026, 9, 16);

function fakePrompt(outcome) {
  const e = { prevented: false, prompted: 0, preventDefault() { this.prevented = true; } };
  e.prompt = async () => { e.prompted++; };
  e.userChoice = Promise.resolve({ outcome });
  return e;
}

test('shouldShowInstallCard: hidden for 30 days after "Not now"', async () => {
  const { shouldShowInstallCard: show } = await fresh();
  assert.equal(show(NOW, null), true);
  assert.equal(show(NOW, undefined), true);
  assert.equal(show(NOW, NaN), true);
  assert.equal(show(NOW, NOW), false);
  assert.equal(show(NOW, NOW - 29 * DAY), false);
  assert.equal(show(NOW, NOW - 30 * DAY), true);
  assert.equal(show(NOW, NOW + DAY), true); // clock moved back: never hidden for good
});

test('promptInstall: unavailable without a deferred event', async () => {
  const m = await fresh();
  assert.equal(m.canPrompt(), false);
  assert.equal(await m.promptInstall(), 'unavailable');
});

test('beforeinstallprompt is kept and its default mini-infobar suppressed', async () => {
  const m = await fresh();
  const e = fakePrompt('accepted');
  let changed = 0;
  m.onInstallChange(() => changed++);
  m.onBeforeInstallPrompt(e);
  assert.equal(e.prevented, true);
  assert.equal(m.canPrompt(), true);
  assert.equal(changed, 1);
});

test('promptInstall accepted: prompts once, event is spent, app counts as installed', async () => {
  const m = await fresh();
  const e = fakePrompt('accepted');
  m.onBeforeInstallPrompt(e);
  assert.equal(await m.promptInstall(), 'accepted');
  assert.equal(e.prompted, 1);
  assert.equal(m.canPrompt(), false);
  assert.equal(m.isInstalled(), true);
  assert.equal(await m.promptInstall(), 'unavailable');
  assert.equal(e.prompted, 1);
});

test('promptInstall dismissed: event is spent, not installed', async () => {
  const m = await fresh();
  m.onBeforeInstallPrompt(fakePrompt('dismissed'));
  assert.equal(await m.promptInstall(), 'dismissed');
  assert.equal(m.canPrompt(), false);
  assert.equal(m.isInstalled(), false);
});

test('promptInstall: a throwing prompt() reads as unavailable', async () => {
  const m = await fresh();
  const e = fakePrompt('accepted');
  e.prompt = async () => { throw new Error('already used'); };
  m.onBeforeInstallPrompt(e);
  assert.equal(await m.promptInstall(), 'unavailable');
  assert.equal(m.canPrompt(), false);
});

test('appinstalled clears the event and marks installed', async () => {
  const m = await fresh();
  let changed = 0;
  m.onBeforeInstallPrompt(fakePrompt('accepted'));
  m.onInstallChange(() => changed++);
  m.onInstalled();
  assert.equal(m.canPrompt(), false);
  assert.equal(m.isInstalled(), true);
  assert.equal(changed, 1);
});

test('installCardVisible: needs a prompt, not installed, not recently dismissed', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  try {
    const m = await fresh();
    assert.equal(m.installCardVisible(NOW), false); // no event yet
    m.onBeforeInstallPrompt(fakePrompt('dismissed'));
    assert.equal(m.installCardVisible(NOW), true);
    m.dismissInstallCard(NOW);
    assert.equal(store.get('et-install-dismissed'), String(NOW));
    assert.equal(m.installCardVisible(NOW + DAY), false);
    assert.equal(m.installCardVisible(NOW + 30 * DAY), true);
    m.onInstalled();
    assert.equal(m.installCardVisible(NOW + 30 * DAY), false);
  } finally {
    delete globalThis.localStorage;
  }
});

test('storage blocked: dismissing never throws and the card stays available', async () => {
  globalThis.localStorage = { getItem() { throw new Error('blocked'); }, setItem() { throw new Error('blocked'); } };
  try {
    const m = await fresh();
    m.onBeforeInstallPrompt(fakePrompt('dismissed'));
    m.dismissInstallCard(NOW);
    assert.equal(m.installCardVisible(NOW), true);
  } finally {
    delete globalThis.localStorage;
  }
});
