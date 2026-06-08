# Website/

Replace everything in this folder with your client's static site.

Typical source: a WordPress site exported to static HTML via the **Simply Static**
plugin, or custom HTML/CSS/JS. Cloudflare Pages deploys this folder.

Keep/maintain these SEO basics: `robots.txt`, `sitemap.xml`, `llms.txt`,
`_headers`, `_redirects`. The blog scaffolder (`Agentic SEO/tools/scaffold-blog.ps1`)
clones YOUR blog post markup, so point it at a real post after you import the site.
