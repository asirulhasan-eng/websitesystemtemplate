---
name: client-blog-publisher
description: Use the {{SITE_NAME}} blog writing workflow to create SEO content
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Blog, Content]
    related_skills: [client-system-rules, client-preview-branch]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Blog Publisher

## When to Use
When user requests blog content, when opportunity scan finds content gaps, or when content strategy suggests a new blog post.

## Process (Hybrid Model)
1. Hermes decides the topic/keyword based on data.
2. Before suggesting or drafting a new support blog, run `node /opt/client-agent/cli/bin/v2.js content blog-cannibalization --topic "<working title>" --target-keyword "<primary keyword>" --support-url "<support page>" --site-root /opt/client-site --json` and inspect existing blog posts.
3. If the gate returns `refresh_existing_blog`, refresh/link the matched blog instead of creating a new URL. If it returns `differentiate_or_refresh`, document the distinct intent split before proceeding.
4. CLI creates the draft using existing content tools.
5. Validation checks the draft.
6. GitHub stores it in a preview branch.
7. Cloudflare previews it.
8. SQLite records it, including `metadata.evidence.blog_cannibalization_check`.
9. Obsidian explains it.
10. HIGH-RISK approval required before publishing.

## Brand Voice Rules
- {{AUDIENCE}}-first language
- No generic marketing jargon
- Practical, actionable advice
- Show expertise in {{NICHE}} SEO specifically
- Use internal links to service pages
- Include proper title, meta, schema

## Research Requirement
Before writing or enriching blog content, check the site repo workflow in `/opt/client-site/tools/blog-production-skill.md`. That workflow requires Serper-based research before content writing:
- Use `/opt/client-site/tools/serper-search.ps1` for SERP, PAA, related searches, Reddit/community, and data-source discovery.
- Use `/opt/client-site/tools/serper-scrape.ps1` for competitor/source scraping.
- Use `/opt/client-site/tools/serper-batch.ps1` for multi-keyword batch research.
- Do not substitute built-in web/search/browser tools for this research unless the Serper workflow is unavailable; if unavailable, report the blocker clearly.
- Keep API keys out of reports and avoid adding secrets to repo files.

## Procedure
```bash
cd /opt/client-agent

# Generate content brief / task candidates for blog
seo-agent tasks --type blog --keyword "<KEYWORD>"

# Create the draft in a preview branch
seo-agent preview --task-id <BLOG_TASK_ID>
```

## After Draft is Ready
- Create Cloudflare preview
- Send preview link to user for review
- Wait for approval (this is ALWAYS high-risk for new blog posts)
- Only publish after explicit approval
- Record all state in SQLite

## Rewrite / Enrichment Notes
- For blog rewrites and enrichment passes, use `references/serper-rewrite-validation.md` as the checklist for Serper evidence, rewrite scope, preview validation, and PR reporting.
- If the user asks whether Serper was used and it was not, do not defend the omission; run the Serper-backed rewrite/research workflow before claiming the article is complete.

## Validation Checks
- Title tag present and unique
- Meta description present
- H1 present and unique
- Schema markup (Article schema)
- Internal links to relevant service pages
- No broken links
- Images have alt text
- URL follows slug convention
