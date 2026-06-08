const test = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

const CLI = path.resolve(__dirname, '../cli/bin/v2.js');

test('gsc-fetch --sample --json works', (t) => {
  const result = spawnSync('node', [CLI, 'gsc-fetch', '--sample', '--json'], { encoding: 'utf8' });
  
  assert.strictEqual(result.status, 0, 'CLI should exit with status 0');
  
  const parsed = JSON.parse(result.stdout);
  assert.strictEqual(parsed.ok, true, 'Result should be ok');
  assert.strictEqual(parsed.tool, 'gsc-fetch', 'Tool name should match');
  assert.ok(Array.isArray(parsed.rows), 'Rows should be an array');
  assert.ok(parsed.rows.length > 0, 'Should return sample rows');
});
