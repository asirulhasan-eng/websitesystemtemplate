const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');
const sitemapPath = path.join(repoRoot, 'sitemap.xml');
const registerScriptPath = path.join(repoRoot, 'tools/register-blog-post.ps1');

function isValidIsoDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return false;
  return date.toISOString().slice(0, 10) === value;
}

test('sitemap lastmod values are valid YYYY-MM-DD dates', (t) => {
  if (!fs.existsSync(sitemapPath)) {
    t.skip('sitemap.xml not present');
    return;
  }
  const xml = fs.readFileSync(sitemapPath, 'utf8');
  const lastmods = [...xml.matchAll(/<lastmod>\s*([^<\s]+)\s*<\/lastmod>/g)].map((match) => match[1]);
  for (const value of lastmods) {
    assert.ok(isValidIsoDate(value), `invalid sitemap lastmod: ${value}`);
  }
});

test('blog registration rejects malformed sitemap LastMod values', () => {
  const script = fs.readFileSync(registerScriptPath, 'utf8');
  assert.match(script, /function Assert-SitemapLastMod/);
  assert.match(script, /YYYY-MM-DD/);
  assert.match(script, /ParseExact\(\$Value, 'yyyy-MM-dd'/);
});
