import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const sha = (t) => `'sha256-${createHash('sha256').update(t).digest('base64')}'`;

// Editing the inline boot script or the font onload handler without updating the CSP hash blanks the app.
test('CSP hashes match the inline script and onload handler', () => {
  const csp = /Content-Security-Policy" content="([^"]*)"/.exec(html)[1];
  assert.ok(csp.includes(sha(/<script type="module">([\s\S]*?)<\/script>/.exec(html)[1])));
  assert.ok(csp.includes(sha(/onload="([^"]*)"/.exec(html)[1])));
});
