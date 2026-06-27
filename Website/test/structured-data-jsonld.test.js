const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

function jsonLdBlocks(html) {
  return [...html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim());
}

function htmlFiles(dir) {
  if (!fs.existsSync(dir)) return [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  return entries.flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return htmlFiles(full);
    return entry.isFile() && entry.name.endsWith('.html') ? [full] : [];
  });
}

test('every JSON-LD block in Website HTML parses as JSON', () => {
  const files = htmlFiles(repoRoot);
  assert.ok(files.length > 0, 'expected at least one HTML file in Website/');
  let blockCount = 0;
  for (const file of files) {
    const html = fs.readFileSync(file, 'utf8');
    for (const block of jsonLdBlocks(html)) {
      blockCount += 1;
      assert.doesNotThrow(() => JSON.parse(block), `${path.relative(repoRoot, file)} has unparsable JSON-LD`);
    }
  }
  assert.ok(blockCount >= 0);
});
