# {{SITE_NAME}} blog index card-grid repair

Session-specific detail for a safe production fix to `https://{{DOMAIN}}/blog/`.

## Symptom

- Live page returned HTTP 200 and exposed headings/links in text snapshots.
- Visual page looked broken: hero rendered, then a very large blank area; after scrolling only a single/tall card appeared before footer.
- Browser accessibility snapshot still showed many blog posts, which made the issue look less severe than it was visually.

## Root cause

Recent blog-card insertions near the top of `blog/index.html` had malformed sibling structure:

- the "Cheap Marketing Services for {{AUDIENCE}}" card lacked closing `</div>` tags for `.blog-card__content` and `.blog-card` before the next card began;
- the "Google Business Profile Access" card had the same missing closure;
- the "WordPress Websites for {{AUDIENCE}}" card had the same missing closure;
- the "Digital Marketing Pricing Models" preview began but was not completed, so its heading/excerpt/read-more were effectively merged into the social-media card.

The browser tolerated the HTML, but CSS grid only saw a few direct children while the rest were nested under earlier cards.

## Useful probes

Live/local browser console:

```js
(() => {
  const grid = document.querySelector('.blog-grid');
  const cards = [...document.querySelectorAll('.blog-card')];
  return {
    count: cards.length,
    nested: cards.filter(c => c.parentElement !== grid).length,
    first12: cards.slice(0, 12).map(c => c.querySelector('.blog-card__title')?.innerText),
    bodyH: document.body.scrollHeight
  };
})()
```

Expected after repair:

- `count: 102`
- `nested: 0`
- first titles start with:
  1. Cheap Marketing Services for {{AUDIENCE}}...
  2. Google Business Profile Access for {{AUDIENCE}}...
  3. Google I/O 2026 AI Agents...
  4. WordPress Websites for {{AUDIENCE}}...
  5. Digital Marketing Pricing Models for {{AUDIENCE}}

## Repair performed

Rewrote the damaged top block from `<!-- Post: Cheap Marketing Services for {{AUDIENCE}} -->` through before `<!-- Post: Answer Engine Optimization AEO Guide for {{AUDIENCE}} -->`, making each preview a complete sibling:

```html
<div class="blog-card reveal">
  <a ...>
    <div class="blog-card__image">...</div>
  </a>
  <div class="blog-card__content">
    <div class="blog-card__meta">...</div>
    <h2 class="blog-card__title">...</h2>
    <p class="blog-card__excerpt">...</p>
    <a class="blog-card__read-more">Read Article ...</a>
  </div>
</div>
```

The Digital Marketing Pricing Models card was split out from the Social Media Marketing Cost card.

## Verification sequence used

From `/opt/client-site`:

```bash
npm test
```

Returned:

```text
Floating CTA asset validation passed.
```

Structural parser check returned:

```text
cards 102
nested_card_count 0
```

Local browser verification on `http://127.0.0.1:8087/blog/` showed rows of cards under the hero. Live verification after push showed the same and confirmed `nested: 0` in the browser console.

## Deployment note

The fix was a narrow safe HTML repair pushed directly to `master`. After push, the first live curl still returned the old body briefly with `cf-cache-status: HIT`; a subsequent fetch returned the new body size and fixed closure. Do not treat Cloudflare HIT alone as stale/fresh proof â€” compare fixed markup/body size and perform a browser DOM probe.
