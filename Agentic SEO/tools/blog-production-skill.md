# Blog Production Skill 

Repeatable process for data-driven, interactive blog posts. Proven on: *"{{NICHE}} SEO vs PPC: Which Gets More Calls in 2026?"* Last updated: 2026-06-07 (added YouTube transcript mining to research).

## Contents
1. Overview & SEO rules
2. Phase 1 â€” Research
3. Phase 2 â€” Planning
4. Phase 3 â€” Assets
5. **Voice Guide** â† applies during writing only
6. Phase 4 â€” Writing
7. Phase 4b â€” Linking
8. Phase 5 â€” Integration
9. Phase 6 â€” QA
10. Constraints
11. Parallel agent strategy
12. Templates & checklist

---

## 1. Overview

Posts must be:
- **Data-driven** â€” real stats from live SERP + competitor scraping (never invented)
- **Infographic-heavy** â€” 3â€“5 custom visuals per post (primary differentiator)
- **Interactive** â€” calculators, FAQ accordions, animated counters where relevant
- **SEO-optimized** â€” Article + FAQ schema, OG, Twitter Cards, canonical
- **Visually rich** â€” data tables, comparison cards, scenario boxes, optional embeds (YouTube/Twitter/Reddit)
- **Conversion-optimized** â€” TLDR, inline CTAs, bottom CTA with pulse animation
- **Uniquely structured** â€” every topic gets its own outline. NO fixed template.


### Project Structure
```
{{NICHE}} website 2/
â”œâ”€â”€ blog/
â”‚   â”œâ”€â”€ index.html                          â† Add new card here
â”‚   â”œâ”€â”€ google-maps-seo-for-{{AUDIENCE}}.html   â† Scaffold source post
â”‚   â””â”€â”€ [new-post-slug].html                â† New post
â”œâ”€â”€ css/
â”‚   â”œâ”€â”€ main.css        â† DO NOT modify
â”‚   â”œâ”€â”€ blog.css        â† Extend here
â”‚   â””â”€â”€ pages.css
â”œâ”€â”€ assets/images/blog/                     â† Infographics
â”œâ”€â”€ tools/
â”‚   â”œâ”€â”€ scaffold-blog.ps1   â† â˜… STEP 1: Run this FIRST for every new post
â”‚   â”œâ”€â”€ serper-search.ps1
â”‚   â”œâ”€â”€ serper-scrape.ps1
â”‚   â”œâ”€â”€ serper-batch.ps1
â”‚   â”œâ”€â”€ youtube-transcript.ps1  â† Pull video subtitles as plain text for research
â”‚   â”œâ”€â”€ keywords.txt
â”‚   â””â”€â”€ link-registry.json
â”œâ”€â”€ js/{main.js, animations.js}
â””â”€â”€ sitemap.xml
```


## 2. Phase 1 â€” Research (NO code yet)

> **HARD RULE: DO NOT scaffold, create files, or write any content until Phases 1â€“3 (Research, Planning, Assets) are fully complete.** The scaffold script runs at the START of Phase 4, not before. If the HTML file does not exist yet, you cannot skip research. This is intentional.

> **RESEARCH TOOLS: Use ONLY the project's PowerShell scripts for all research.** `serper-search.ps1` for searches, `serper-scrape.ps1` for scraping written pages, and `youtube-transcript.ps1` for reading video subtitles. Do NOT use built-in AI tools (`search_web`, `read_url_content`, `browser_subagent`) for research. These scripts use the project's API keys, return structured data, and produce consistent results. Built-in tools bypass this workflow and produce unreliable, non-reproducible research.

> **READ VIDEOS, DON'T JUST EMBED THEM.** Research is no longer text-only. When a YouTube video ranks for the topic, pull its transcript with `youtube-transcript.ps1` and mine it for data, expert claims, and angles the same way you mine a scraped article. A 15-minute expert video often holds insight no written competitor has. Treat the transcript as a first-class source: extract stats, quotes, and gaps, and always backlink the video when you use its content.

### 1.1 Primary SERP Analysis (4â€“7 searches)
```powershell
cd "c:\Users\Administrator\Documents\{{NICHE}} website 2\tools"
.\serper-search.ps1 -Query "[YOUR BLOG TOPIC]" -Mode all -Num 10
.\serper-search.ps1 -Query "[topic] cost data 2026" -Mode all -Num 10
.\serper-search.ps1 -Query "[topic] case study ROI" -Mode all -Num 10
.\serper-search.ps1 -Query "[topic] for {{AUDIENCE}}" -Mode paa -Num 10
and more...
```
Extract: top 5 ranking URLs (competitors), PAA questions (â†’ FAQ), related searches (secondary keywords), Knowledge Graph data.

### 1.2 Competitor Scraping (top 4â€“7)
```powershell
.\serper-scrape.ps1 -Url "https://competitor-url.com/article" -Mode text
```
Analyze: word count (match or exceed), H2/H3 outline, data points (find newer/better), content gaps, CTA strategy.

### 1.2b Reddit + Community Mining (MANDATORY)

Goal: real-world opinions, pain points, horror stories, practitioner insights competitors lack. This is the unique-angle layer.

**Reddit searches:**
```powershell
.\serper-search.ps1 -Query "site:reddit.com [TOPIC] {{AUDIENCE}}" -Mode organic -Num 10
.\serper-search.ps1 -Query "site:reddit.com [TOPIC] small business" -Mode organic -Num 10
.\serper-search.ps1 -Query "site:reddit.com [TOPIC] contractor" -Mode organic -Num 10
```
Scrape top 4â€“7 threads:
```powershell
.\serper-scrape.ps1 -Url "https://www.reddit.com/r/[subreddit]/comments/..." -Mode text
```
**Target subs (not limited to):** r/{{NICHE}}, r/smallbusiness, r/Entrepreneur, r/SEO, r/digital_marketing, r/HomeImprovement, topic-specific subs.

**Extract from Reddit:** real pain points ("spent $X on SEO, got nothing"), success stories with numbers, misconceptions to correct, recurring questions (content gaps), vendor/tool recommendations, horror stories (for "what to avoid").

**Lateral deep-dives:**
```powershell
.\serper-search.ps1 -Query "[TOPIC] industry report 2025 2026" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] survey results data" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] expert analysis" -Mode organic -Num 10
.\serper-search.ps1 -Query "[RELATED ANGLE] for service businesses" -Mode organic -Num 10
.\serper-search.ps1 -Query "[RELATED ANGLE] {{NICHE}} HVAC contractors" -Mode organic -Num 10
```
Scrape best 2â€“3 for deep data. **Look for:** uncited stats, real case-study numbers, contrarian viewpoints, adjacent-industry data (HVAC/electrical/roofing applicable to {{NICHE}}), government/regulatory data, seasonal/geographic trends. **Always backlink the source.**

**Other communities (if relevant):**
```powershell
.\serper-search.ps1 -Query "site:quora.com [TOPIC] {{AUDIENCE}}" -Mode organic -Num 5
.\serper-search.ps1 -Query "[TOPIC] youtube" -Mode organic -Num 5
.\serper-search.ps1 -Query "site:facebook.com [TOPIC]" -Mode organic -Num 5
.\serper-search.ps1 -Query "site:x.com [TOPIC]" -Mode organic -Num 5
```

> **DEPTH TARGET:** â‰¥5â€“8 unique data points or insights that top competitors lack. This is your edge.
> **PARALLEL TIP:** Fire 5â€“8 search queries simultaneously; scrape best results in a second parallel batch.

### 1.2c YouTube Transcript Mining (MANDATORY when a relevant video ranks)

Goal: read what experts and practitioners actually *say* on camera on the youtube video already ranking. Video creators (contractors, marketers, industry channels) often share numbers, processes, and opinions that never make it into written articles. This is a second unique-angle layer alongside Reddit.



**Pull the transcript (text only, no timestamps) for the upto 3 videos:**
```powershell
# Accepts a full URL or bare 11-char video ID; output is clean prose for reading
.\youtube-transcript.ps1 -Video "https://www.youtube.com/watch?v=VIDEO_ID"
.\youtube-transcript.ps1 -Video VIDEO_ID
.\youtube-transcript.ps1 -Video 1gI65iIxbXI | clip      # copy to clipboard
.\youtube-transcript.ps1 -Video 1gI65iIxbXI -Raw        # line-per-caption
```

**Extract from transcripts:** on-camera stats and benchmarks, step-by-step processes the creator walks through, strong opinions/contrarian takes, real client numbers or case-study results, tool/vendor mentions, common mistakes called out. **Always backlink the video** when you use its content, and attribute claims to the creator ("One {{NICHE}} marketer breaks down...").

> **CAVEAT:** Transcripts are auto-captions. Numbers can be mis-transcribed and homophones garbled. Sanity-check any stat from a transcript before citing it, and never present a transcript-only number as hard data without a corroborating source. Treat the transcript as expert *commentary and angle*, not a citable dataset on its own.

### 1.3 Data Source Mining
```powershell
.\serper-search.ps1 -Query "[industry] benchmarks 2026 data" -Mode organic -Num 10
.\serper-scrape.ps1 -Url "https://data-source.com/benchmarks" -Mode text
```
**You MUST have â‰¥6 credible data points before writing.** Never invent data without a source.

### 1.4 (Optional) Find YouTube/Twitter/Reddit Embed
You likely already surfaced strong videos in 1.2c. Reuse the best one here: if a video you transcribed is genuinely relevant, professional, and adds value text can't, embed it (and you can quote its transcript in the surrounding copy). Confirm a transcript exists before embedding so you can write real context around it, not a bare player.
```powershell
.\serper-search.ps1 -Query "[topic] for {{AUDIENCE}} explained youtube" -Mode organic -Num 5
.\youtube-transcript.ps1 -Video "[candidate video URL]"   # verify it has usable captions
```
Only embed if genuinely relevant, professional, adds value text can't. **Do NOT force an embed.** Skip if no quality match.

### 1.5 Identify Infographic Opportunities (MOST IMPORTANT SUB-STEP)
Target: **3â€“5 infographics per post.** No invented data. Types: comparison chart, process/timeline flow, statistical breakdown, cost/ROI visual, checklist/decision tree, before/after, benchmark table, industry landscape map.

> **PARALLEL TIP:** Steps 1.1â€“1.5 all run as parallel tool calls.
>
> **CHECKPOINT before Phase 2:**
> - â‰¥4â€“7 Reddit threads analyzed
> - â‰¥2â€“4 YouTube transcripts read (when relevant videos rank)
> - â‰¥5â€“7 unique data points competitors lack
> - â‰¥1â€“3 lateral angles for depth
> - Real quotes/anecdotes from practitioners (anonymize if needed)

---

## 3. Phase 2 â€” Planning

### 2.1 Build a Unique Outline From Research

**NO fixed section template.** Derive structure from research:
1. **Study competitor outlines** â€” what H2/H3 do top 3â€“5 share? What do they all miss?
2. **Map reader's journey** â€” what question brought them here? What's the logical flow to action?
3. **Find your angle** â€” what can you cover that competitors don't? (newer data, {{AUDIENCE}}-specific framing, interactive tools, deeper analysis)
4. **Design for infographics** â€” pick 3â€“5 places where a visual beats text; build the outline around those anchors.

**Fixed elements:**
```
ALWAYS:
  - Article header (title, date, breadcrumbs, read time)
  - TLDR box (3 bullets for busy {{AUDIENCE}})
  - FAQ section (from PAA, schema-ready)
  - Bottom CTA
  - 3â€“5 infographics throughout

WHEN RELEVANT:
  - Stat grid (if 3+ striking numbers)
  - Comparison table (if X vs Y)
  - Scenario/cost modeling (if money topic)
  - Interactive calculator (if reader benefits from personalized numbers)
  - Video/social embed (ONLY if quality match exists)
  - Inline CTA (if post is long)
```

Treat each post as a unique editorial piece, not template fill-in.

### 2.1b Blog Angle Formula (narrative arc)
1. **Start with a real owner problem** â€” quiet phones, wrong-area calls, competitors above you, slow weeks hitting payroll.
2. **Explain what's probably leaking** â€” where calls, trust, visibility are slipping, and why the owner doesn't see it.
3. **Show what to fix** â€” clear, practical guidance and why it matters.
4. **Connect fix to real outcomes** â€” calls, booked jobs, trust, service areas, trucks on the road, money saved.
5. **End with a practical next step** â€” not "contact us," a concrete action.

> **ANGLE CHECK:** Does this help a {{NICHE}} owner get found, get trusted, get calls, keep moving? If not, rework.

### 2.2 Keywords
```
Primary:    [exact match]
Secondary:  [3â€“5 from SERP]
Long-tail:  [2â€“3 from PAA]
```

### 2.3 Plan Infographics (MANDATORY 3â€“5)
```
Infographic 1: [Type] â€” [Data] â€” [Placement]
Infographic 2: [Type] â€” [Data] â€” [Placement]
Infographic 3: [Type] â€” [Data] â€” [Placement]
Infographic 4: [Type] â€” [Data] â€” [Placement]  (optional)
Infographic 5: [Type] â€” [Data] â€” [Placement]  (optional)
```
Types: comparison chart, process flow, cost breakdown, statistical highlight, checklist, timeline, benchmark table, decision tree, before/after.

> **NO-DUPLICATION RULE:** Plan surrounding text alongside each infographic. Text must NOT repeat infographic data. Text should: provide context/interpretation, add a real-world anecdote or Reddit insight, give actionable advice, tease the visual ("Here's how the numbers break down:") and let it speak.

### 2.4 Other Assets
- **Data tables** â€” HTML-styled, complement infographics
- **Interactive** â€” calculator/quiz/comparison widget (if it adds value)
- **Social embed** â€” YouTube/Reddit/Twitter (only if quality match)
- **Schema** â€” Article (always) + FAQPage (always)

---

## 4. Phase 3 â€” Asset Generation

### 3.1 Generate Infographics (3â€“5)

Use `image_generate`. This means the AI image model/tool, not a hand-written SVG, HTML chart, canvas chart, screenshot, or Sharp-created graphic. Prompts must be information-dense and include exact researched data, labels, hierarchy, brand palette, and source citation. Save/download the generated image and optimize the delivered asset as WebP. Do **not** satisfy infographic requirements with programmatic SVG/HTML/canvas/Sharp layouts. For scheduled/autopilot publishing, if `image_generate` is unavailable or fails, stop as blocked instead of using a fallback generator. Only use a non-AI fallback when the user explicitly requests it in the current task, and disclose it clearly.

Pattern:
```
"Professional infographic titled '[TITLE]' for {{NICHE}} companies.
Dark navy background (#0F2A44).
[Describe data, layout, structure IN DETAIL â€” every column, every
number, every label, comparisons, visual hierarchy].
Clean sans-serif typography, subtle grid lines, professional data
visualization style.
Bottom text: 'Source: [source] | {{SITE_NAME}}.agency'.
No stock photos, pure data visualization.
Do NOT include any watermarks, AI attribution text, metadata labels,
or generation tool references."
```

**Always append (anti-metadata):**
- "No watermarks."
- "No AI-generated labels or attribution text."
- "No metadata or generation tool references."
- "No 'created with' or 'made by' text."
- "No small print disclaimers unless it is the source citation."

**Brand palette:**
- Navy bg: `#0F2A44`
- Primary accent: `#176B9A` (teal/blue)
- Alert/negative: `#E94743` (red)
- Success/positive: `#74C9A7` (green)
- Highlight: `#F4D77A` (yellow)
- Text on dark: `#FAFAF7` (off-white)

**Prompt patterns:**
| Type | Structure |
|------|-----------|
| Comparison (X vs Y) | "Side-by-side columns, left [X] teal, right [Y] red, N rows comparing [metrics]" |
| Process/Timeline | "Horizontal timeline [start]â†’[end], N phases, each labeled [details]" |
| Cost Breakdown | "Two-column cost analysis, left [scenario A], right [scenario B]" |
| Stat Highlight | "Large central number [N] with context, surrounded by 3â€“4 smaller stats" |
| Checklist | "Vertical checklist, N items, green âœ“ included, red âœ— missing" |
| Benchmark Table | "Clean data table, N rows Ã— M cols, [metrics] across [categories]" |

### 3.2 Infographic QA â€” Strip AI Metadata (MANDATORY)

After generation, `view_file` each image. Regenerate if you see:
- "AI generated" / "Generated by" text
- Watermarks or tool attribution
- Gibberish/garbled text (common in AI image gen)
- Lorem ipsum / placeholder
- Tiny disclaimers (other than source citation)
- "Stock photo" / licensing text

If regenerating, add explicit: "Do not include any watermarks, attribution, AI-generated labels, or metadata text." Crop if a small flaw is cheaper to remove than regenerate.

> **RULE:** Never deploy an infographic with visible AI metadata or garbled text. It destroys credibility instantly.

### 3.3 Deploy Images
```powershell
New-Item -ItemType Directory -Path "assets\images\blog" -Force
Copy-Item "[source-path-1]" "assets\images\blog\[descriptive-name-1].png"
Copy-Item "[source-path-2]" "assets\images\blog\[descriptive-name-2].png"
# ...etc
```

> **PARALLEL TIP:** All 3â€“5 generations run in parallel. Biggest time-save in the process.

---

## {{SITE_NAME}} Voice Guide

> **APPLY DURING PHASE 4 ONLY.** This guide governs writing tone and style. Read it before you start writing, not before research. Do NOT let this section cause you to skip Phases 1-3.

Write as a tradesman-turned-owner speaking to another {{NICHE}} business owner. You have carried payroll, handled late calls, sent trucks across town, dealt with bad jobs, and learned SEO the practical way. Do not sound like an agency rep or content marketer.

Primary reader: {{NICHE}} company owner. They carry payroll, insurance, dispatch, trucks, customers, calls, and families depending on the company. They may be skeptical of agency talk. Secondary readers are techs, apprentices, and office managers, but write to the owner.

Every sentence must pass this test: Does it help the owner get found, get trusted, get calls, and keep the trucks moving? If not, cut or rewrite it.

Voice pillars:
1. Plainspoken. Short paragraphs. Honest sentences. No fancy marketing language.
2. Owner-pressure aware. Start with the real business problem: quiet phones, wrong-area calls, competitors ranking above them, wasted drives, leads that do not close.
3. Translate SEO to business outcomes. Do not stop at rankings, traffic, or impressions. Connect it to calls, booked jobs, trucks on the road, jobs on the board, payroll, and the right kind of work.

Use language like:
phone doesnâ€™t quit ringing, keep the trucks moving, get in front of the right people, provide good service, take care of the customer, take care of the crew, families depending on the company, service area, routes, dispatch, jobs on the board, slow weeks, busy weeks, no callbacks, double-check for leaks, make sure everything is covered, figure it out, nobodyâ€™s coming to bail you out, invest back into the company, tools that make the job easier, show up where customers are searching, donâ€™t put all your eggs in one basket, be okay with change, service is its own animal.

Avoid language like:
digital ecosystem, scalable growth framework, omnichannel visibility, demand generation engine, customer acquisition ecosystem, unlock growth, revolutionary strategy, maximize online potential, dominate the market, passive lead machine, guaranteed rankings, secret SEO hacks, high-converting funnel architecture.

Do not use em dashes. Use periods or commas.

Humor:
Use lightly. One small joke every two or three sections at most. Keep it dry, practical, and trade-friendly. Best places are openings, transitions, section endings, simple comparisons, and boring SEO explanations. Avoid jokes around payroll, families depending on the company, legal issues, insurance, safety, serious damage, or business loss.

Good humor style:
- Rule of three.
- Punchline at the end.
- Dry owner reality check.
- Jobsite comparison.
- Light jab at jargon, not people.
- Google as confusing but important.

Allowed example:
Bad SEO is like a slow drain. You can ignore it for a while, but eventually it backs up somewhere ugly.

Never use crude humor, politics, or jokes about customers, workers, competitors, race, religion, gender, income, appearance, or disability.

Opinion:
Every post should take a clear practical position, not a fake hot take. Use this formula:
1. State the position.
2. Explain the owner-side reason.
3. Give a quick real-world example.
4. Tie it back to calls, jobs, trucks, or wasted time.

Useful opinion phrases:
In my opinion, The way I see it, Here is the problem, Here is what most agencies miss, That sounds good on paper, but, In the real world, For a {{NICHE}} owner, that matters because, Iâ€™d fix this first, This is where calls leak away, That is not growth, that is noise, The report may look good, but the phone tells the truth.

Keep opinions practical. Use â€œmost,â€ â€œin my experience,â€ and â€œfor a lot of local {{AUDIENCE}}â€ when needed. Do not sound arrogant, guarantee results, get political, or claim every situation is the same.

Add strong owner-pressure thread throughout. For example, after SEO explanations, keep asking: â€œDoes this help the right customer find you before they call the other shop?â€

Before writing, check:
1. Does the opening start with the ownerâ€™s pain, not an SEO lecture?
2. Is the strongest opinion clearly stated?
3. Does every SEO point connect to phone calls or booked jobs?
4. Is the humor light, not the main event?
5. Does it sound like an owner talking near a truck, not an agency pitch?


### SEO Meta & Branding Rules

> **CONTENT-FIRST PRINCIPLE:** Titles, meta descriptions, OG titles, Twitter titles must be 100% content-driven. Do NOT append brand names, domains, taglines, or signatures. Brand goes in `og:site_name`, schema, and the URL only.

| Element | Max Length | Brand Suffix? |
|---|---|---|
| `<title>` | â‰¤ 60 chars | **NO** |
| `<meta description>` | â‰¤ 155 chars | **NO** |
| `<h1>` | â‰¤ 80 chars (soft) | **NO** |
| `og:title` | â‰¤ 95 chars | **NO** |
| `og:description` | â‰¤ 200 chars | **NO** |
| `og:site_name` | â€” | **YES** â†’ `{{SITE_NAME}}.agency` |
| `twitter:title` | â‰¤ 70 chars | **NO** |
| `twitter:description` | â‰¤ 200 chars | **NO** |
| Schema `headline` | matches `<title>` | **NO** |
| Schema `author`/`publisher` | â€” | **YES** â†’ `{{SITE_NAME}}.agency` |

**Why no brand in titles/descriptions?** Google appends site name automatically; every brand char is a lost keyword char; social shows site_name separately; content-focused titles have higher CTR for informational queries.

**Examples:**
```
âœ… "Best SEO for {{AUDIENCE}} in 2026 | Ranked Buyer Guide"
âŒ "Best SEO for {{AUDIENCE}} in 2026 | {{NICHE}} SEO Agency for {{AUDIENCE}}"

âœ… "Compare the top SEO services for {{NICHE}} companies. Pricing, red flags, and which provider fits your shop."
âŒ "{{SITE_NAME}}.agency compares the top SEO services for {{NICHE}} companies."
```
---

## 5. Phase 4 â€” Writing the HTML

### STEP 1: Scaffold (MANDATORY â€” run AFTER research, planning, and assets)

> **DO NOT generate HTML boilerplate with AI.** Use the scaffold script instead.
> **DO NOT run the scaffold until Phases 1â€“3 are complete.** Research informs the title, category, and description parameters. Running the scaffold early tempts you to skip research and start writing.

```powershell
cd tools
.\scaffold-blog.ps1 -Title "Your Post Title" -Category "SEO Guide" -Description "Meta description here."
```

This generates a complete, validated HTML file with:
- Full `<head>` (GA tag, meta, OG, Twitter, BlogPosting schema, BreadcrumbList schema, favicons)
- Topbar + Header + Mobile Nav (cloned verbatim from source post)
- Article header (breadcrumbs, h1, category badge, date, read time)
- TLDR box with 3 placeholder items
- Content area with PART1/PART2/PART3 markers
- FAQ, Related Posts, CTA, and FAQ Schema markers
- Full footer + scripts (cloned verbatim, FAQ schema stripped)
- 27-point validation check (schema, meta, links, structure)

**Script parameters:**

| Param | Required | Default |
|---|---|---|
| `-Title` | Yes | â€” |
| `-Slug` | No | Auto from title |
| `-Category` | No | `"SEO Guide"` |
| `-Description` | No | Placeholder |
| `-ReadTime` | No | `"8 min read"` |
| `-SourcePost` | No | `google-maps-seo-for-{{AUDIENCE}}.html` |
| `-Date` | No | Today |

**Output:** `blog/[slug].html` (329 lines, all boilerplate done).

### STEP 1b: Existing-Post Repair / Rewrite Safety

When rewriting or repairing an existing post, do **not** hand-build the shell. Use the scaffold script as a reference even if the target file already exists:

```powershell
cd tools
.\scaffold-blog.ps1 -Title "Final Title" -Slug "scaffold-temp-[topic]-fix" -Category "Category" -Description "Final meta description" -SourcePost "google-maps-seo-for-{{AUDIENCE}}.html"
```

Then copy the scaffolded structure, footer, and scripts into the target post while preserving the researched content, canonical URL, OG image, and schema. Delete the temp scaffold file after validation.

**Repair rules learned from the {{AUDIENCE}} web design rewrite:**
- Footer must match the blog index/source post footer exactly. Do not compress, rewrite, or manually recreate footer markup.
- Use the scaffold/footer from `tools/scaffold-blog.ps1` or `blog/index.html` as the canonical footer reference.
- FAQ markup must use the project accordion pattern: `.faq-section` â†’ `.faq-accordion` â†’ `.faq-item` â†’ `button.faq-question` + `.faq-answer > .faq-answer__inner`. Do **not** use raw `<details><summary>` unless matching CSS/JS is added.
- Related posts must use `.related-posts`, not ad-hoc `.keep-reading`, because the CSS already exists for `.related-posts__grid` and cards.
- Bottom CTA should use an existing styled component such as `.cta-box` or `.bottom-cta`, not a new unstyled `.article-cta` class.
- Keep article HTML readable and component-based. Do not minify long article/footer sections into single lines.

### STEP 2: Content Injection (AI work starts here)

Use `replace_file_content` to surgically inject content at each marker:

**4.1 TLDR items** (replace `<!-- TLDR_ITEM_1 -->`, `_2`, `_3`):
- 3 punchy one-liner takeaways

**4.2 Sections 1â€“3** (`replace_file_content` targeting `<!-- PART1_MARKER -->`):
- Opening hook, context, first data section
- First 1â€“2 infographics

**4.3 Sections 4â€“6** (`replace_file_content` targeting `<!-- PART2_MARKER -->`):
- Data comparison (table + infographic)
- Cost breakdown / scenarios
- Strategy cards

**4.4 Sections 7â€“9** (`replace_file_content` targeting `<!-- PART3_MARKER -->`):
- Hybrid strategy, video embed (if any)

**4.5 FAQ accordion** (`replace_file_content` targeting `<!-- FAQ_MARKER -->`):
- 5â€“8 FAQ items with accordion HTML

**4.6 Related posts** (`replace_file_content` targeting `<!-- RELATED_POSTS_MARKER -->`):
- 3 sibling article cards

**4.7 Bottom CTA** (`replace_file_content` targeting `<!-- CTA_MARKER -->`):
- CTA box with headline + button

**4.8 FAQ Schema** (`replace_file_content` targeting `<!-- FAQSCHEMA_MARKER -->`):
- FAQPage JSON-LD script block

**Why this works:** scaffold gives a valid HTML shell from second zero; each injection is small (under 30K tokens); file is always renderable; if a step fails, redo only that marker.

**DO NOT:** use `write_to_file` for the initial file; generate `<head>`, nav, or footer with AI; re-read the full file between steps (use line ranges).

### CRITICAL: Infographic/Text Non-Duplication

Do NOT restate infographic data in body text. If a chart shows "SEO $1,500/mo vs PPC $3,000/mo," the paragraph next to it must NOT say the same thing.

| âŒ Don't | âœ… Do instead |
|---|---|
| Restate every number | Explain *why* it matters for the reader |
| "As you can see..." | Give a takeaway or recommendation |
| List the same comparisons in bullets | Share a real anecdote, Reddit quote, or case study |
| Narrate the visual layout | Ask a provocative question the data raises |

**Pattern around an infographic:**
```
1. Brief intro tease (1 line max)
2. THE INFOGRAPHIC
3. Interpretation â€” what this means for a {{NICHE}} owner
4. Actionable next step or real example
```

> **RULE:** If a paragraph can be deleted and the infographic still communicates the same info, rewrite it to add NEW value.

### 4.5 CSS Additions

Append new component styles to `css/blog.css` via `replace_file_content`. **Do not modify main.css.**

**Existing components:**
```
.tldr-box                â€” Navy gradient summary box
.compare-grid            â€” Side-by-side card grid
.compare-card            â€” Bordered cards (--seo / --ppc variants)
.stat-grid / .stat-card  â€” 3-column stat counters
.data-table-wrapper      â€” Styled comparison table
.video-wrapper           â€” YouTube embed with branded header
.calculator              â€” Interactive slider widget
.infographic             â€” Image with caption
.scenario-grid           â€” Side-by-side scenarios
.scenario                â€” Individual (--ppc / --seo variants)
.related-posts           â€” Related articles grid
.related-posts__card     â€” Clickable article card w/ hover
```

---

## 6. Phase 4b â€” Internal & External Linking (MANDATORY)

After each fragment, scan text for linking opportunities using `tools/link-registry.json`.

### 4b.1 Internal Linking (natural only)

Insert contextual links to sibling posts and service pages â€” only where they fit logically. **Two great links > five awkward ones.**

**How:** Open `link-registry.json`. After each section, ask: "Does this paragraph naturally reference a topic covered elsewhere?" If yes, weave a link. If no, move on.

**Rules:**
- No fixed count â€” as few or many as fit naturally
- Must feel like a human editor added it, not an SEO checkbox
- Max 1 link per target page
- Vary anchor text across posts
- No self-linking
- Only link when target genuinely expands the current point
- Use `title=""` with target's full title

**Example:**
```html
<!-- GOOD: natural, contextual -->
<p>If you're unsure what fair pricing looks like, read our
<a href="/blog/{{NICHE}}-seo-pricing" title="{{NICHE}} SEO Pricing Explained">complete {{NICHE}} SEO pricing guide</a>.</p>

<!-- BAD: forced, listy -->
<p>Related: <a href="/blog/pricing">Pricing</a>, <a href="/blog/hiring">Hiring</a></p>
```

### 4b.2 External Authority Linking (natural only)

Link to external sources **where text already references them**. If you cite a study, name a tool, mention a company â€” link to it. Don't invent reasons.

**Rules:**
- No fixed count â€” link wherever you cite a source, name a tool, reference external data
- Link to whoever's relevant (no whitelist; competitors included if you discuss them)
- Contextual citation only
- Always `rel="noopener" target="_blank"`
- No affiliate/paid links â€” purely editorial
- Prefer primary sources over summaries

**Example:**
```html
<p>Your <a href="https://support.google.com/business/answer/6300717"
   target="_blank" rel="noopener"
   title="Google Business Profile Help">Google Business Profile</a>
   is the engine behind your Maps ranking.</p>
```

### 4b.3 Related Posts Component (MANDATORY)

Add "Keep Reading" section above bottom CTA, linking to 3 most topically relevant siblings:

```html
<div class="related-posts">
  <h2 class="related-posts__title">Keep Reading</h2>
  <div class="related-posts__grid">
    <a href="/blog/[sibling-1-slug]" class="related-posts__card">
      <span class="related-posts__card-category">[Category]</span>
      <span class="related-posts__card-title">[Full Title]</span>
      <span class="related-posts__card-arrow">Read Article &rarr;</span>
    </a>
    <a href="/blog/[sibling-2-slug]" class="related-posts__card">
      <span class="related-posts__card-category">[Category]</span>
      <span class="related-posts__card-title">[Full Title]</span>
      <span class="related-posts__card-arrow">Read Article &rarr;</span>
    </a>
    <a href="/blog/[sibling-3-slug]" class="related-posts__card">
      <span class="related-posts__card-category">[Category]</span>
      <span class="related-posts__card-title">[Full Title]</span>
      <span class="related-posts__card-arrow">Read Article &rarr;</span>
    </a>
  </div>
</div>
```

CSS components available: `.related-posts`, `.related-posts__title`, `.related-posts__grid`, `.related-posts__card`, `.related-posts__card-category`, `.related-posts__card-title`, `.related-posts__card-arrow`.

> **Dark-background posts** (e.g., `how-much-should-a-{{NICHE}}-company-spend-on-seo.html`): override card styles inline â†’ `style="background: rgba(250,250,247,0.05); border-color: rgba(250,250,247,0.1);"` and card title `style="color: var(--off-white);"`.

---

## 7. Phase 5 â€” Site Integration

### 5.1 Add Blog Card to Index
Edit `blog/index.html` â€” insert new card BEFORE existing cards (newest first):
```html
<div class="blog-card reveal">
  <div class="blog-card__image" style="background:linear-gradient(...);">
    <svg>...</svg>
  </div>
  <div class="blog-card__content">
    <div class="blog-card__meta">
      <span>[Category]</span> &bull; [Date]
    </div>
    <h2 class="blog-card__title">
      <a href="/blog/[slug]">[Title]</a>
    </h2>
    <p class="blog-card__excerpt">[1â€“2 sentence excerpt]</p>
    <a href="/blog/[slug]" class="blog-card__read-more">Read Article ...</a>
  </div>
</div>
```

### 5.2 Update Sitemap
```xml
<url>
  <loc>https://{{DOMAIN}}/blog/[slug]</loc>
  <lastmod>[YYYY-MM-DD]</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.6</priority>
</url>
```

### 5.3 Update Link Registry
Append to `internal.blog` array in `tools/link-registry.json`:
```json
{
  "slug": "/blog/[new-post-slug]",
  "title": "[Full Title]",
  "topics": ["keyword1", "keyword2", "keyword3"],
  "anchors": ["suggested anchor 1", "suggested anchor 2"]
}
```

---

## 8. Phase 6 â€” QA & Verification

### 6.1 SEO and Structure Checklist
- [ ] `<title>` has primary keyword, content-focused, NO brand suffix, â‰¤ 60 chars
- [ ] `<meta description>` compelling, content-driven, NO brand, â‰¤ 155 chars
- [ ] `<h1>` content-focused (NOT brand)
- [ ] `<link rel="canonical">` set
- [ ] OG tags present (title, description, image, url, type)
- [ ] `og:title` descriptive, content-focused, NO brand suffix
- [ ] `og:description` â‰¤ 200 chars
- [ ] Twitter Card tags present
- [ ] `twitter:title` matches `og:title`, NO brand
- [ ] Article schema JSON-LD valid
- [ ] FAQPage schema has all questions
- [ ] Single `<h1>`
- [ ] H2/H3 hierarchy logical
- [ ] Descriptive alt text on images
- [ ] Internal links work (no forced links)
- [ ] External links cite sources (`target="_blank" rel="noopener"`)
- [ ] Related Posts section with 3 siblings
- [ ] New post added to `link-registry.json`
- [ ] Footer markup matches the scaffold/blog-index footer, including scripts and `footer-year`
- [ ] FAQ uses `.faq-question` buttons and opens/closes through `js/main.js`
- [ ] No unsupported one-off classes remain for core components (`.article-cta`, `.keep-reading`, raw `details` FAQ)
- [ ] Local render checked with HTTP 200 for the article and `/blog/`
- [ ] Visual/browser check confirms footer and FAQ styling match the site

### 6.2 Serper Research Accounting

After research, report actual Serper usage from saved logs instead of guessing:
- Batch search count = keyword rows in the batch log.
- Scrape credits = sum of `Credits used:` lines in scrape logs.
- Failed scrape attempts without a `Credits used:` line should be reported separately.
- Reddit/old.reddit can return blocked text while still consuming scrape credits. Treat those as failed community research for content purposes, and do not cite blocked Reddit pages.

---

## 9. Critical Constraints & Workarounds

### âš ï¸ GOLDEN RULE: Save as .html, NEVER link as .html

Files on disk stay as `[slug].html`. **All `href`, canonical, og:url, sitemap `<loc>`, and JSON references use clean URLs WITHOUT `.html`.**

| Context | âœ… Correct | âŒ Wrong |
|---|---|---|
| `href` in `<a>` | `/blog/my-post` | `/blog/my-post.html` |
| `<link rel="canonical">` | `https://{{DOMAIN}}/blog/my-post` | `...my-post.html` |
| `og:url` | `https://{{DOMAIN}}/blog/my-post` | `...my-post.html` |
| Sitemap `<loc>` | `https://{{DOMAIN}}/blog/my-post` | `...my-post.html` |
| Link registry `slug` | `/blog/my-post` | `/blog/my-post.html` |
| Nav/footer | `/pages/pricing` | `/pages/pricing.html` |

Cloudflare Workers strips `.html`. Live URL is `{{DOMAIN}}/blog/my-post`; linking the `.html` version creates a redirect chain that hurts SEO.

### Token Limit (50K output)
Full blog HTML + tool metadata > limit. **Solution:** fragment into 4â€“8 `replace_file_content` calls with marker comments. **Rule:** never write >~150 lines of HTML per tool call.

### PowerShell Emoji Encoding
Emoji (ðŸ”âŒâœ…) corrupt in `.ps1` files. **Use ASCII alternatives:** `[SEARCH]`, `[ERROR]`, `[OK]`. Never use emoji in `.ps1`.

### No Em Dashes in Blog Writing
Never use em dash (â€”) in the blog body copy.

### File Size
Posts can hit 500+ lines. **Keep CSS in blog.css, not inline.** Article HTML is content only â€” no repeated header/footer markup editing.

### Research Tool Enforcement
**ALL research must use the project PowerShell scripts:**
- `serper-search.ps1` for SERP queries, PAA, related searches
- `serper-scrape.ps1` for competitor articles, Reddit threads, data sources
- `youtube-transcript.ps1` for reading ranking videos (subtitles â†’ plain text, no timestamps)

**Do NOT use these AI built-in tools for research:**
- `search_web` â€” bypasses serper API, inconsistent results
- `read_url_content` â€” bypasses serper scraping, no structured output
- built-in video/caption readers â€” use `youtube-transcript.ps1` so video research is reproducible and uses the project's API key

These scripts are the single source of truth for research data. Using built-in tools creates a shortcut that produces unreliable data and skips the structured research workflow.

---

## 10. Parallel Agent Strategy

| Stage | Parallel calls | Saved |
|---|---|---|
| SERP research | 4â€“5 searches at once | ~30s |
| Competitor scraping | 3â€“4 scrapes at once | ~20s |
| Video transcript reading | 2â€“4 transcripts at once | ~20s |
| Infographic generation | 2â€“3 images at once | ~30s |
| File I/O | CSS + sitemap + blog index edits | ~10s |

**Cannot parallelize:** multiple edits to the same file; HTML marker injections (each depends on previous);  
### Maximum-Parallelism Sequence

```
Turn 1 â€” Primary research (all parallel):
  â”œ serper-search (topic)
  â”œ serper-search (cost data)
  â”œ serper-search (case study)
  â”œ serper-search (PAA/FAQ)
  â”œ serper-search (site:reddit.com [topic])
  â”œ serper-search (site:reddit.com [topic] business)
  â”œ serper-search ([topic] explained youtube)
  â”” list_dir (blog structure)

Turn 2 â€” Reading sources (all parallel):
  â”œ serper-scrape Ã— 4â€“6 competitor URLs
  â”œ serper-scrape Ã— 3â€“5 Reddit threads
  â”œ youtube-transcript Ã— 2â€“4 ranking videos
  â”” serper-scrape (data source / industry report)

Turn 3 â€” Lateral depth:
  â”œ serper-search (industry report)
  â”œ serper-search (expert analysis)
  â”œ serper-search (adjacent topic)
  â”” serper-search (deep-dive URLs)

  â”€â”€ CHECKPOINT: â‰¥6 data points, â‰¥4 Reddit threads, â‰¥2 video transcripts read, unique angle identified â”€â”€
  â”€â”€ Planning: outline, keywords, infographic plan (Phase 2) â”€â”€

Turn 4 â€” Image generation (all parallel):
  â”” image_generate Ã— 3â€“5 infographics (using RESEARCHED data only)

Turn 5 â€” Infographic QA:
  â”œ view_file each image
  â”” regenerate any with metadata

Turn 6 â€” CSS + image deploy (parallel):
  â”œ replace_file_content (blog.css)
  â”” run_command (copy images)

Turn 7 â€” Scaffold (NOW â€” after research informs params):
  â”” run_command: scaffold-blog.ps1 -Title "..." -Category "..." -Description "..."

Turns 8â€“11 â€” Content injection (SEQUENTIAL per marker):
   8. replace_file_content (TLDR_ITEM_1/2/3 + PART1_MARKER â†’ sections 1â€“3)
   9. replace_file_content (PART2_MARKER â†’ sections 4â€“6)
  10. replace_file_content (PART3_MARKER â†’ sections 7â€“9)
  11. replace_file_content (FAQ_MARKER + RELATED_POSTS_MARKER + CTA_MARKER + FAQSCHEMA_MARKER)

Turn 12 â€” Integration (parallel):
  â”œ replace_file_content (blog/index.html â€” new card)
  â”œ replace_file_content (sitemap.xml)
  â”” replace_file_content (link-registry.json)

```

**Total: ~13 turns vs ~25+ sequential.**

> **KEY ADVANTAGE:** Scaffold is deliberately delayed until Turn 7 so that research, planning, and asset generation must complete first. This prevents skipping research â€” if the HTML file does not exist, there is nothing to inject into. By Turn 8, the AI writes with real data, sourced stats, and a research-backed outline. The scaffold itself takes <1 second, so there is zero time penalty.

---

## 11. HTML Skeleton Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[CONTENT-FOCUSED TITLE â‰¤ 60 â€” NO brand]</title>
  <meta name="description" content="[CONTENT-DRIVEN â‰¤ 155 â€” NO brand]">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://{{DOMAIN}}/blog/[SLUG]">
  <meta property="og:title" content="[DESCRIPTIVE â€” NO brand]">
  <meta property="og:description" content="[â‰¤ 200]">
  <meta property="og:url" content="https://{{DOMAIN}}/blog/[SLUG]">
  <meta property="og:type" content="article">
  <meta property="og:site_name" content="{{SITE_NAME}}.agency">
  <meta property="og:locale" content="en_US">
  <meta property="og:image" content="https://{{DOMAIN}}/assets/images/blog/[IMAGE].webp">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@clientagen">
  <meta name="twitter:title" content="[matches og:title â€” NO brand]">
  <meta name="twitter:description" content="[matches og:description]">
  <meta name="twitter:image" content="https://{{DOMAIN}}/assets/images/blog/[IMAGE].webp">
  <link rel="stylesheet" href="../css/main.css">
  <link rel="stylesheet" href="../css/blog.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Article",
    "headline": "[TITLE]",
    "author": {"@type": "Organization", "name": "{{SITE_NAME}}.agency"},
    "publisher": {"@type": "Organization", "name": "{{SITE_NAME}}.agency"},
    "datePublished": "[YYYY-MM-DD]",
    "dateModified": "[YYYY-MM-DD]"
  }
  </script>
</head>
<body>
  [TOPBAR â€” copy from existing post]
  [HEADER â€” copy from existing post]
  [MOBILE NAV â€” copy from existing post]

  <main>
    <article>
      <header class="article-header">
        <div class="container">
          <div class="breadcrumbs" style="justify-content:center;margin-bottom:var(--space-4);">
            <a href="../">Home</a> <span>/</span> <a href="./">Blog</a> <span>/</span> [Category]
          </div>
          <div class="article-header__meta">[CATEGORY]</div>
          <h1 class="article-header__title">[FULL TITLE]</h1>
          <div class="article-header__author">
            <span>Published [Date]</span> &bull; <span>[X] min read</span>
          </div>
        </div>
      </header>

      <div class="article-layout">
        <div class="container">
          <div class="article-container article-content">

            <!-- TLDR -->
            <div class="tldr-box">
              <div class="tldr-box__label">The Bottom Line for Busy {{AUDIENCE}}</div>
              <ul>
                <li>[Takeaway 1]</li>
                <li>[Takeaway 2]</li>
                <li>[Takeaway 3]</li>
              </ul>
            </div>

            <!-- CONTENT SECTIONS â€” use PART_MARKER comments for fragmentation -->

          </div>
        </div>
      </div>
    </article>
  </main>

  [FOOTER â€” copy from existing post]
  [SCRIPTS â€” main.js, animations.js, footer-year]
</body>
</html>
```

---

## 12. Master Checklist

```
[ ] Phase 1: Research
    [ ] 5â€“8 primary SERP queries
    [ ] 5â€“8 competitor articles scraped
    [ ] 3â€“7 other serp results scraped
    [ ] Reddit/community research (â‰¥2â€“4 threads)
    [ ] YouTube transcripts read & mined (â‰¥2â€“4 when relevant videos rank)
    [ ] Lateral/depth research (industry reports, expert analysis)
    [ ] Data sources scraped (â‰¥7 credible data points)
    [ ] â‰¥6 unique insights competitors lack
    [ ] PAA questions collected (â†’ FAQ)
    [ ] Infographic opportunities identified (3â€“6)
    [ ] (Optional but try to have that) YouTube video/reddit post/twitter post found

[ ] Phase 2: Planning
    [ ] Unique outline built from research
    [ ] Primary + secondary keywords defined
    [ ] 3â€“5 infographics planned (types + data)
    [ ] Optional elements decided

[ ] Phase 3: Assets
    [ ] Infographics generated (3â€“5, parallel)
    [ ] Infographic QA passed (no metadata/garbled text)
    [ ] Failed images regenerated with explicit anti-metadata prompts
    [ ] Clean images copied to assets/images/blog/

[ ] Phase 4: Writing (fragmented)
    [ ] CSS components added/verified in blog.css
    [ ] Skeleton created (head + nav + first chunk + footer)
    [ ] Middle chunk inserted via PART_MARKER
    [ ] Final chunk + FAQ + CTA inserted via PART_MARKER
    [ ] Schema JSON-LD + scripts added before </body>

[ ] Phase 5: Integration
    [ ] Blog card added to blog/index.html
    [ ] sitemap.xml updated
    [ ] link-registry.json updated

[ ] Phase 6: QA
    [ ] All infographics load
    [ ] Interactive elements functional
    [ ] SEO meta tags verified
    [ ] All links work
    [ ] PNG â†’ WebP conversion done; originals archived
```
