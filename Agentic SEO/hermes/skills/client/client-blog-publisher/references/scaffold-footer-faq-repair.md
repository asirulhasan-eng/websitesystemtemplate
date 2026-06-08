# Scaffold, Footer, and FAQ Repair Notes

Use these notes when rewriting or repairing an existing {{SITE_NAME}} blog post.

## Trigger
A blog rewrite or refresh changes page structure, footer, FAQ, related posts, CTA, or CSS, or the user notes that CSS/footer/FAQ does not match the rest of the site.

## Durable lessons from the {{AUDIENCE}} web-design rewrite

- The repo already has scaffolding in `tools/`; inspect and use it before manually rebuilding HTML.
- A visually wrong footer can happen when the article shell diverges from the scaffold/blog index. Use scaffold output or `blog/index.html` as the canonical footer reference.
- FAQ can look broken when raw `<details><summary>` is inserted into a site that expects the JS accordion pattern. Convert to `.faq-question` buttons and `.faq-answer__inner` wrappers so `js/main.js` can control open/close state.
- Custom classes like `.article-cta` and `.keep-reading` are risky unless CSS already exists. Prefer established `.cta-box`, `.bottom-cta`, and `.related-posts` components.
- BeautifulSoup rewrites can accidentally remove or orphan JSON-LD. Always re-parse every JSON-LD block and confirm FAQPage question count equals the visible FAQ count.
- After pushing, Cloudflare preview may show cached/older HTML. Recheck with a cache-busting query string and look for the exact changed classes/IDs.

## Verification pattern

Run checks equivalent to:

```bash
# HTTP smoke checks
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8087/blog/<slug>.html
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:8087/blog/
```

Structural checks should confirm:

- one H1
- no raw details/summary FAQ unless intentionally supported
- visible FAQ count equals FAQPage schema count
- no unsupported one-off core classes such as `.article-cta` or `.keep-reading`
- footer outer HTML/text matches `blog/index.html` or the scaffold reference
- all JSON-LD parses
- local relative asset/link refs resolve
- blog index contains the slug/current title and no stale title after a rewrite
- sitemap contains exactly one canonical `<loc>` for the slug
- browser click opens the first FAQ and changes `aria-expanded` from `false` to `true`

For branch preview, fetch with a cache-busting query string after push and confirm deployed HTML contains the updated FAQ class, footer, schema, and CTA IDs/classes.
