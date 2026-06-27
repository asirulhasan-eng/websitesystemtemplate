# Website/

Replace the placeholder page content in this folder with your static site.

Typical source: a WordPress site exported to static HTML via the **Simply Static**
plugin, or custom HTML/CSS/JS. Cloudflare Pages deploys this folder.

Keep/maintain these SEO basics: `robots.txt`, `sitemap.xml`, `llms.txt`,
`_headers`, `_redirects`.

Also preserve the generic automation helpers in this folder:

- `tools/register-blog-post.ps1` — registers a post in `/blog/`, `sitemap.xml`, and `tools/link-registry.json`.
- `tools/sort-blog-index.js` — keeps `/blog/` sorted by publish date, latest first.
- `test/blog-index-sort.test.js` — guards blog index ordering and registration wiring.
- `test/sitemap-lastmod.test.js` — rejects invalid sitemap `<lastmod>` dates.
- `test/structured-data-jsonld.test.js` — catches unparsable JSON-LD structured data.

The blog scaffolder (`Agentic SEO/tools/scaffold-blog.ps1`) clones YOUR blog post markup,
so point it at a real post after you import the site. After any blog registration or manual
blog/sitemap/schema edit, run `node --test test/*.test.js` from this `Website/` directory.
