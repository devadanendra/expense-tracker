// Install prompt state. Chrome fires beforeinstallprompt once, early, so app.js imports this first.
// Views read canPrompt()/isInstalled() and re-render through onInstallChange().
const DISMISS_KEY = 'et-install-dismissed';
const HIDE_MS = 30 * 86400000;

let deferred = null;
let installed = false;
const listeners = new Set();
const emit = () => listeners.forEach((fn) => fn());

export const onInstallChange = (fn) => listeners.add(fn);

export function onBeforeInstallPrompt(e) {
  e.preventDefault(); // no mini-infobar: the app offers its own button
  deferred = e;
  emit();
}

export function onInstalled() {
  deferred = null;
  installed = true;
  emit();
}

if (typeof addEventListener === 'function') {
  addEventListener('beforeinstallprompt', onBeforeInstallPrompt);
  addEventListener('appinstalled', onInstalled);
}

export const canPrompt = () => deferred !== null;

export const isInstalled = () => installed
  || !!globalThis.matchMedia?.('(display-mode: standalone)').matches
  || globalThis.navigator?.standalone === true; // iOS home-screen apps

// 'accepted' | 'dismissed' | 'unavailable'. The event is single-use, so it is dropped at once.
export async function promptInstall() {
  const e = deferred;
  if (!e) return 'unavailable';
  deferred = null;
  try {
    await e.prompt();
    const { outcome } = await e.userChoice;
    installed ||= outcome === 'accepted';
    return outcome === 'accepted' ? 'accepted' : 'dismissed';
  } catch (err) {
    console.error(err);
    return 'unavailable';
  } finally {
    emit();
  }
}

// Home card: after "Not now", stay hidden for 30 days. A dismissal time in the future (clock set
// back) counts as not dismissed.
export function shouldShowInstallCard(now, dismissedAt) {
  const age = now - dismissedAt;
  return !(age >= 0 && age < HIDE_MS);
}

function dismissedAt() {
  try { return Number(localStorage.getItem(DISMISS_KEY)); } catch { return NaN; } // blocked storage: show
}

export function dismissInstallCard(now = Date.now()) {
  try { localStorage.setItem(DISMISS_KEY, String(now)); } catch { /* hidden until reload */ }
}

export const installCardVisible = (now = Date.now()) =>
  !isInstalled() && canPrompt() && shouldShowInstallCard(now, dismissedAt());
