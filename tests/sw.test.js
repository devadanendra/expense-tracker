import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

// Guards the offline cache: a module missing from SHELL breaks the installed app offline.
const root = fileURLToPath(new URL('..', import.meta.url));
const src = readFileSync(join(root, 'sw.js'), 'utf8');
const shell = [...src.match(/const SHELL = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);

test('every js module on disk is precached', () => {
  const modules = readdirSync(join(root, 'js'), { recursive: true })
    .filter((f) => f.endsWith('.js'))
    .map((f) => `js/${f.split('\\').join('/')}`);
  assert.ok(modules.length > 0);
  assert.deepEqual(modules.filter((m) => !shell.includes(m)), []);
});

test('every SHELL entry exists on disk', () => {
  assert.deepEqual(shell.filter((p) => p !== './' && !existsSync(join(root, p))), []);
});

test('manifest: "New expense" shortcut opens #/add; every manifest icon is precached', () => {
  const m = JSON.parse(readFileSync(join(root, 'manifest.webmanifest'), 'utf8'));
  assert.equal(m.shortcuts[0].url, './#/add');
  const icons = [...m.icons, ...m.shortcuts.flatMap((s) => s.icons)].map((i) => i.src);
  assert.deepEqual(icons.filter((src) => !shell.includes(src)), []);
});
