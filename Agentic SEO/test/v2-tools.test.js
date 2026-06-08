const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const CLI = path.resolve(__dirname, '../cli/bin/v2.js');

function runV2(args) {
  const result = spawnSync('node', [CLI, ...args], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr || result.stdout);
  return JSON.parse(result.stdout);
}

function makeSite() {
  const siteRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'v2-tools-site-'));
  fs.mkdirSync(path.join(siteRoot, 'services'), { recursive: true });
  fs.mkdirSync(path.join(siteRoot, 'blog'), { recursive: true });

  fs.writeFileSync(path.join(siteRoot, 'index.html'), `
    <!doctype html>
    <title>{{SITE_NAME}}</title>
    <h1>SEO for {{NICHE}} companies</h1>
    <a href="/old-service">Old service page</a>
    <a href="/services/{{NICHE}}-seo">{{NICHE}} SEO services</a>
  `);
  fs.writeFileSync(path.join(siteRoot, 'services', '{{NICHE}}-seo.html'), `
    <!doctype html>
    <title>{{NICHE}} SEO Services for Contractors</title>
    <meta name="description" content="SEO campaigns for {{AUDIENCE}}, drain cleaning companies, and {{NICHE}} contractors.">
    <link rel="canonical" href="https://{{DOMAIN}}/services/{{NICHE}}-seo">
    <h1>{{NICHE}} SEO Services</h1>
    <h2>Local search and service-area growth</h2>
    <p>Our {{NICHE}} SEO service improves organic visibility, local rankings, and qualified {{NICHE}} leads.</p>
  `);
  fs.writeFileSync(path.join(siteRoot, 'blog', '{{NICHE}}-seo-tips.html'), `
    <!doctype html>
    <title>{{NICHE}} SEO Tips</title>
    <h1>SEO tips for {{AUDIENCE}}</h1>
    <h2>Improve local search visibility</h2>
    <p>{{NICHE}} companies can improve rankings with useful service pages, Google Business Profile work, and internal links.</p>
    <a href="/services/{{NICHE}}-seo">learn about {{NICHE}} SEO services</a>
  `);
  fs.writeFileSync(path.join(siteRoot, 'sitemap.xml'), `
    <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
      <url><loc>https://{{DOMAIN}}/</loc></url>
      <url><loc>https://{{DOMAIN}}/services/{{NICHE}}-seo</loc><lastmod>2026-06-03</lastmod></url>
      <url><loc>https://{{DOMAIN}}/blog/{{NICHE}}-seo-tips</loc></url>
    </urlset>
  `);

  return siteRoot;
}

test('semantic-match scores related local pages', () => {
  const siteRoot = makeSite();
  const parsed = runV2([
    'semantic-match',
    '--source-url', '/blog/{{NICHE}}-seo-tips',
    '--target-url', '/services/{{NICHE}}-seo',
    '--site-root', siteRoot,
    '--threshold', '0.1',
    '--json',
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.tool, 'semantic-match');
  assert.ok(parsed.score >= 0.1);
  assert.equal(parsed.pass, true);
  assert.ok(parsed.shared_terms.some((term) => term.term === '{{NICHE}}'));
});

test('sitemap-audit parses local sitemap and contains checks without fetching', () => {
  const siteRoot = makeSite();
  const parsed = runV2([
    'sitemap-audit',
    '--from-file', path.join(siteRoot, 'sitemap.xml'),
    '--no-fetch',
    '--contains', '/services/{{NICHE}}-seo',
    '--json',
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.tool, 'sitemap-audit');
  assert.equal(parsed.url_count, 3);
  assert.equal(parsed.contains_checks[0].present, true);
  assert.equal(parsed.issues.length, 0);
});

test('index-inspect sample normalizes indexed response', () => {
  const parsed = runV2([
    'index-inspect',
    '--url', 'https://{{DOMAIN}}/services/{{NICHE}}-seo',
    '--sample',
    '--json',
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.tool, 'index-inspect');
  assert.equal(parsed.verified_in_google_index, true);
  assert.equal(parsed.decision, 'indexed');
});

test('manual and security report wrappers normalize sample findings', () => {
  const manual = runV2(['manual-actions-check', '--sample', '--state', 'action', '--json']);
  assert.equal(manual.ok, true);
  assert.equal(manual.has_manual_actions, true);
  assert.equal(manual.blocking, true);

  const security = runV2(['security-issues-check', '--sample', '--state', 'issue', '--json']);
  assert.equal(security.ok, true);
  assert.equal(security.has_security_issues, true);
  assert.equal(security.blocking, true);
});

test('link-check finds internal links to a target URL', () => {
  const siteRoot = makeSite();
  const parsed = runV2([
    'link-check',
    '--target-url', '/old-service',
    '--site-root', siteRoot,
    '--json',
  ]);

  assert.equal(parsed.ok, true);
  assert.equal(parsed.tool, 'link-check');
  assert.equal(parsed.match_count, 1);
  assert.equal(parsed.matches[0].source_file, 'index.html');
});
