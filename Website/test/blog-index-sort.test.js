const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');

const forbiddenAssociation = new RegExp([
  'small' + 'businessseo',
  'Small Business' + ' SEO',
  'As' + 'irul',
  'small' + 'businessseo\\.services',
].join('|'), 'i');

const repoRoot = path.resolve(__dirname, '..');
const blogIndexPath = path.join(repoRoot, 'blog/index.html');
const registerScriptPath = path.join(repoRoot, 'tools/register-blog-post.ps1');
const { sortBlogIndex, parsePublishDate } = require(path.join(repoRoot, 'tools/sort-blog-index.js'));

function realCardsFromIndex(html) {
  const marker = '          <!-- ADD NEW BLOG CARDS ABOVE THIS LINE -->';
  const exampleEnd = html.indexOf('\n          -->');
  const searchFrom = exampleEnd === -1 ? 0 : exampleEnd + '\n          -->'.length;
  const firstCardIndex = html.indexOf('\n          <div class="blog-card reveal">', searchFrom);
  const markerIndex = html.indexOf(`\n${marker}`);
  assert.ok(markerIndex > -1, 'blog marker should exist');
  if (firstCardIndex === -1 || firstCardIndex > markerIndex) return [];
  return html
    .slice(firstCardIndex + 1, markerIndex)
    .trim()
    .split(/\n(?=          <div class="blog-card reveal">)/)
    .filter(Boolean);
}

test('sortBlogIndex sorts sample cards latest first and is idempotent', () => {
  const sample = `<!doctype html>
<body>
          <!-- example card
          <div class="blog-card reveal"><div class="blog-card__meta"><span>Example</span> &bull; January 1, 1999</div></div>
          -->
          <div class="blog-card reveal">
            <div class="blog-card__content">
              <div class="blog-card__meta"><span>Guide</span> &bull; May 1, 2026</div>
              <h2 class="blog-card__title"><a href="/blog/older">Older</a></h2>
            </div>
          </div>

          <div class="blog-card reveal">
            <div class="blog-card__content">
              <div class="blog-card__meta"><span>Guide</span> &bull; June 1, 2026</div>
              <h2 class="blog-card__title"><a href="/blog/newer">Newer</a></h2>
            </div>
          </div>
          <!-- ADD NEW BLOG CARDS ABOVE THIS LINE -->
</body>`;
  const result = sortBlogIndex(sample);
  assert.equal(result.count, 2);
  assert.equal(result.changed, true);
  assert.match(result.html, /Newer[\s\S]*Older/);
  const second = sortBlogIndex(result.html);
  assert.equal(second.changed, false);
});

test('real blog index is sorted when present', (t) => {
  if (!fs.existsSync(blogIndexPath)) {
    t.skip('Website/blog/index.html not present in the base template yet');
    return;
  }
  const html = fs.readFileSync(blogIndexPath, 'utf8');
  if (!html.includes('<!-- ADD NEW BLOG CARDS ABOVE THIS LINE -->')) {
    t.skip('blog index marker not present');
    return;
  }
  const cards = realCardsFromIndex(html);
  if (cards.length === 0) {
    assert.equal(sortBlogIndex(html).count, 0);
    return;
  }
  const timestamps = cards.map((card, index) => {
    const parsed = parsePublishDate(card);
    assert.ok(parsed.time, `card ${index + 1} should have a parseable date`);
    return parsed.time;
  });
  for (let i = 1; i < timestamps.length; i += 1) {
    assert.ok(timestamps[i - 1] >= timestamps[i], `card ${i} should not be older than card ${i + 1}`);
  }
});

test('blog registration scaffolding sorts the index and validates sitemap lastmod', () => {
  const script = fs.readFileSync(registerScriptPath, 'utf8');
  assert.match(script, /function Sort-BlogIndexByPublishDate/);
  assert.match(script, /sort-blog-index\.js/);
  assert.match(script, /function Assert-SitemapLastMod/);
  assert.doesNotMatch(script, forbiddenAssociation);

  const addCardIndex = script.indexOf('Add-BlogIndexCard `');
  const sortIndex = script.indexOf('Sort-BlogIndexByPublishDate -Path $blogIndexPath');
  const sitemapIndex = script.indexOf('Add-SitemapEntry -Path $sitemapPath');
  assert.ok(addCardIndex >= 0, 'registration script should add a blog card');
  assert.ok(sortIndex > addCardIndex, 'registration script should sort after adding the card');
  assert.ok(sitemapIndex < 0 || sortIndex < sitemapIndex, 'registration script should sort before finishing integration updates');
});
