const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const forbiddenAssociation = new RegExp([
  'small' + 'businessseo',
  'Small Business' + ' SEO',
  'As' + 'irul',
  'small' + 'businessseo\\.services',
].join('|'), 'i');

const repoRoot = path.resolve(__dirname, '../../..');
const websiteRoot = path.join(repoRoot, 'Website');

function read(rel) {
  return fs.readFileSync(path.join(websiteRoot, rel), 'utf8');
}

test('generic Website blog registration scaffold files are present and scrubbed', () => {
  const required = [
    'tools/register-blog-post.ps1',
    'tools/sort-blog-index.js',
    'tools/link-registry.json',
    'tools/blog-production-skill.md',
    'tools/stats-blog-production-skill.md',
    'tools/SERVICE-PAGE-PRODUCTION-SKILL.md',
    'test/blog-index-sort.test.js',
    'test/sitemap-lastmod.test.js',
    'test/structured-data-jsonld.test.js',
  ];
  for (const rel of required) {
    assert.ok(fs.existsSync(path.join(websiteRoot, rel)), `${rel} should exist`);
  }

  const combined = required.map(read).join('\n');
  assert.doesNotMatch(combined, forbiddenAssociation);
  assert.match(read('tools/register-blog-post.ps1'), /WEBSITE_AGENT_BASE_URL|WEBSITE_BASE_URL|SITE_BASE_URL/);
  assert.match(read('tools/register-blog-post.ps1'), /function Assert-SitemapLastMod/);
  assert.match(read('tools/register-blog-post.ps1'), /Sort-BlogIndexByPublishDate -Path \$blogIndexPath/);
});

test('generic Website JavaScript tests pass from Website root', () => {
  const result = spawnSync(process.execPath, ['--test', 'test/*.test.js'], {
    cwd: websiteRoot,
    encoding: 'utf8',
    shell: true,
  });
  assert.equal(result.status, 0, result.stdout + result.stderr);
});

test('template documents standard GSC OAuth env names used by runtime', () => {
  const envExample = fs.readFileSync(path.join(repoRoot, 'Agentic SEO/.env.example'), 'utf8');
  const gscRuntime = fs.readFileSync(path.join(repoRoot, 'Agentic SEO/cli/lib/gsc.js'), 'utf8');
  assert.match(envExample, /^GSC_CLIENT_ID=/m);
  assert.match(envExample, new RegExp('^GSC_' + 'CLIENT_' + 'SECRET=', 'm'));
  assert.match(gscRuntime, /config\.get\("GSC_CLIENT_ID"\)/);
  assert.match(gscRuntime, new RegExp('config\\.get\\("GSC_' + 'CLIENT_' + 'SECRET"\\)'));
});

test('blog index sorter exports reusable functions', () => {
  const sorter = require(path.join(websiteRoot, 'tools/sort-blog-index.js'));
  assert.equal(typeof sorter.sortBlogIndex, 'function');
  assert.equal(typeof sorter.parsePublishDate, 'function');
});
