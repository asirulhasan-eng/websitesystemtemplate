# Floating CTA asset-pair regression

Session learning: a blog can contain the floating call/text/WhatsApp CTA script and still render incorrectly if the CSS asset is missing. The visual symptom is a malformed or unstyled floating CTA even though `/js/floating-cta.js?v=1` exists and the DOM is present.

## Durable rule

For every {{SITE_NAME}} blog article, treat the floating CTA as an inseparable asset pair:

- `<link rel="stylesheet" href="/css/floating-cta.css?v=1">` in `<head>`
- `<script src="/js/floating-cta.js?v=1" defer></script>` before `</body>`

If one asset is present and the other is missing, the page is invalid.

## Prevention pattern

1. Add or update the article using the current scaffold/template rather than copying a partial footer/script block.
2. Run the site-level guard after blog edits:

```bash
cd /opt/client-site
npm test
# or
node scripts/check-floating-cta-assets.mjs
```

3. If a preview renderer or automation generates blog HTML, add a regression assertion that the rendered HTML includes both `/css/floating-cta.css` and `/js/floating-cta.js`.
4. For live verification, check both static asset references and rendered styles. A useful browser probe confirms:
   - CTA root/button exists
   - CSS and JS asset references exist
   - `position: fixed`
   - expected bottom/side offsets
   - high z-index
   - menu contains call/text/WhatsApp options

## Repair scope

When this mismatch is found on the latest post, search all blog HTML for the same script-without-CSS or CSS-without-script mismatch and fix the batch. Do not only patch the visibly reported URL if the same component pattern appears elsewhere.
