# Google I/O 2026 agentic-search blog run (2026-06-02)

## What was built
- Title: `Google I/O 2026: The Rise of AI Agents: What {{AUDIENCE}} Need to Know`
- Slug: `google-io-2026-ai-agents-what-{{AUDIENCE}}-need-to-know`
- Category: `AI & Search Strategy`
- Source scaffold: `google-ai-overviews-{{NICHE}}-seo.html`

## Scaffold command used
```powershell
pwsh -NoLogo -NoProfile -File tools/scaffold-blog.ps1 -Title 'Google I/O 2026: The Rise of AI Agents: What {{AUDIENCE}} Need to Know' -Slug 'google-io-2026-ai-agents-what-{{AUDIENCE}}-need-to-know' -Category 'AI & Search Strategy' -Description 'Google I/O 2026 made Search more agentic. Learn what the new AI agents, Search changes, and Google guidance mean for {{NICHE}} leads.' -ReadTime '11 min read' -SourcePost 'google-ai-overviews-{{NICHE}}-seo.html' -Date 'June 2, 2026'
```

## Visual assets
Generated four dense infographic concepts, then copied/conformed them to the site repo as WebP assets under `assets/images/blog/`.

## Validation notes
- Local browser preview was used to verify the article layout.
- The browser title was shortened while the on-page H1 kept the full editorial title; that mismatch was intentional and acceptable.
- Final browser checks confirmed 4 article images and 5 FAQ items.
- Sitewide discoverability updates were made: blog index card, sitemap entry, and internal link registry entry.

## Practical lessons
- For dense AI/Search blog posts, start from an existing production post with `tools/scaffold-blog.ps1` so nav/footer/schema patterns stay consistent.
- Use the scaffold as the shell, then add research, FAQ, related posts, and infographic placement around the section that each image supports.
- After scaffold generation, verify the browser pageâ€”not just the fileâ€”so image count, FAQ count, and section ordering are actually rendered.
- When a scaffold run creates log noise or temp artifacts, keep the commit scope clean and exclude those files unless they are intentionally part of the workflow.
