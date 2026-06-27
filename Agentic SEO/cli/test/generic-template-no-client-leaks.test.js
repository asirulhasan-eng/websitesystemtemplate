const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '../../..');
const forbidden = [
  /smallbusinessseo/i,
  /smallbusinessseo\.services/i,
  /Small Business SEO/i,
  /Asirul/i,
  /asirul/i,
  /\/opt\/smallbusinessseo/i,
  /BEGIN OPENSSH PRIVATE KEY/,
  /BEGIN RSA PRIVATE KEY/,
];
const ignoredDirs = new Set(['.git', 'node_modules']);
const ignoredExt = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.pdf', '.db', '.sqlite', '.log']);

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (ignoredDirs.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (!ignoredExt.has(path.extname(entry.name).toLowerCase())) out.push(full);
  }
  return out;
}

test('template source contains no client-specific SBS or secret strings', () => {
  const offenders = [];
  for (const file of walk(repoRoot)) {
    const rel = path.relative(repoRoot, file);
    if (rel === 'Agentic SEO/cli/test/generic-template-no-client-leaks.test.js') continue;
    const text = fs.readFileSync(file, 'utf8');
    for (const rx of forbidden) {
      if (rx.test(text)) offenders.push(`${rel}: ${rx}`);
    }
  }
  assert.deepEqual(offenders, []);
});
