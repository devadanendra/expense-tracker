// Appearance: 'system' | 'light' | 'dark', saved in localStorage 'et-theme'. A classic script in
// <head>, so a saved choice applies before first paint. Settings calls getTheme() and setTheme():
// they are globals because an ES module can't import a classic script.
function getTheme() {
  let t;
  try { t = localStorage.getItem('et-theme'); } catch { /* storage blocked: follow the system */ }
  return t === 'light' || t === 'dark' ? t : 'system';
}

function applyTheme(t) {
  const root = document.documentElement;
  if (t === 'light' || t === 'dark') root.dataset.theme = t;
  else delete root.dataset.theme;
  // Each theme-color meta keeps its media query; a forced theme gives both metas its color.
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    const dark = t === 'dark' || (t !== 'light' && m.media.includes('dark'));
    m.content = dark ? '#26221e' : '#e9e5de';
  }
}

function setTheme(t) {
  try { localStorage.setItem('et-theme', t); } catch { /* applies for this visit only */ }
  applyTheme(t);
}

applyTheme(getTheme());
