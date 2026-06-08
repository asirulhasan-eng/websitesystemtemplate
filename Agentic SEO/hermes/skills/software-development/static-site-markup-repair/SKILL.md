---
name: static-site-markup-repair
description: Diagnose and fix broken static-site HTML markup/layout regressions, especially malformed card grids that still return HTTP 200 but render blank or nested.
---

# Static Site Markup Repair

Use this skill when a static HTML page renders visually broken even though it returns HTTP 200: huge blank areas, cards missing from a grid, footer appearing after an empty stretch, text snapshots showing content that is not visually visible, or recent manual/agent insertions into a repeated HTML pattern.

## Workflow

1. **Classify scope and risk**
   - Pure HTML structure repairs that restore existing visible content are usually safe technical fixes.
   - Do not change copy, page intent, canonicals, schema, or production SEO strategy while repairing markup unless the user explicitly asks.

2. **Reproduce with both HTTP and visual checks**
   - Fetch the live page with headers and body size:
     ```bash
     curl -L -sS -D /tmp/page_headers.txt -o /tmp/page.html https://example.com/path/
     ```
   - Open the page in a browser and inspect visually. Accessibility/text snapshots can be misleading because malformed HTML may still expose headings/links while CSS layout is broken.

3. **Find malformed repeated blocks**
   - Inspect the repeated container and the newest/recently edited entries first.
   - Common causes:
     - missing closing tag for a card content wrapper
     - missing closing tag for a whole card
     - a new card starts before the prior card closes
     - two previews/items accidentally share one card/content block

4. **Verify DOM shape, not just parser tolerance**
   - For grid/card layouts, all cards should usually be direct children of the grid container. Use a browser-console probe like:
     ```js
     (() => {
       const grid = document.querySelector('.blog-grid, .card-grid, [data-grid]');
       const cards = [...document.querySelectorAll('.blog-card, .card')];
       return {
         count: cards.length,
         nested: grid ? cards.filter(c => c.parentElement !== grid).length : 'no grid found',
         firstTitles: cards.slice(0, 12).map(c => c.querySelector('h2, h3, .blog-card__title, .card__title')?.innerText),
         bodyH: document.body.scrollHeight
       };
     })()
     ```
   - Expected for a healthy grid: `nested: 0` or an equivalent known-good direct-child count.

5. **Repair by restoring the repeated template shape**
   - Prefer rewriting the damaged repeated block into clean sibling elements over tiny tag patches that leave ambiguous nesting.
   - Example blog-card shape:
     ```html
     <div class="blog-card reveal">
       <a class="blog-card__image-link" href="...">
         <div class="blog-card__image"><img src="..." alt="..."></div>
       </a>
       <div class="blog-card__content">
         <div class="blog-card__meta">...</div>
         <h2 class="blog-card__title"><a href="...">...</a></h2>
         <p class="blog-card__excerpt">...</p>
         <a class="blog-card__read-more" href="...">Read Article</a>
       </div>
     </div>
     ```

6. **Validate before push**
   - Run the repoâ€™s existing tests (`npm test`, etc.).
   - Run a small structural parser check for nested cards when applicable:
     ```bash
     python3 - <<'PY'
     from pathlib import Path
     from html.parser import HTMLParser
     html = Path('blog/index.html').read_text()
     class Checker(HTMLParser):
         def __init__(self):
             super().__init__(); self.stack=[]; self.nested=0
         def handle_starttag(self, tag, attrs):
             cls = dict(attrs).get('class','')
             if 'blog-card' in cls.split() and any('blog-card' in c for _, c in self.stack):
                 self.nested += 1
             if tag not in {'meta','link','img','br','hr','input','source','track','area','base','col','embed','param','wbr'}:
                 self.stack.append((tag, cls))
         def handle_endtag(self, tag):
             for i in range(len(self.stack)-1, -1, -1):
                 if self.stack[i][0] == tag:
                     self.stack = self.stack[:i]
                     break
     p = Checker(); p.feed(html)
     print('cards', html.count('class="blog-card reveal"'))
     print('nested_card_count', p.nested)
     PY
     ```
   - Serve locally and visually inspect the affected page before committing:
     ```bash
     python3 -m http.server 8087 --bind 127.0.0.1
     ```

7. **Push and verify production**
   - Commit a narrow fix.
   - Push to the expected branch.
   - Confirm the remote branch points at the new commit.
   - Re-fetch the live URL after deploy/cache refresh and verify both content and visual layout. CDN headers like `cf-cache-status: HIT` do not alone prove stale content; compare body size or fixed markup fragment.

## Pitfalls

- Do not stop at HTTP 200/title/H1 checks. Layout regressions often require screenshot/visual verification.
- Do not trust text snapshots alone; they can show deeply nested/invisible content.
- Do not only count tags globally. Confirm the DOM parent-child shape expected by CSS grid/flex rules.
- If reveal/scroll animation hides later cards until intersection, distinguish animation opacity from structural nesting by checking parent relationships and scrolling through the page.

## References

- `references/blog-index-card-markup-repair.md` â€” {{SITE_NAME}} `/blog/` card-grid repair pattern and verification probes.
