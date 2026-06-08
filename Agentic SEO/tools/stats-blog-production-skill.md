# Statistics Blog Production Skill â€” {{SITE_NAME}}.agency
# ============================================
# A repeatable, step-by-step process for producing
# comprehensive, data-aggregation blog posts with real
# statistics, HTML/CSS data visualizations, and infographics.
#
# Format: "[Topic] Statistics: [N]+ Data Points You Need to Know in [Year]"
# Example: "{{NICHE}} Industry Statistics: 75+ Data Points for 2026"
# Last updated: 2026-05-16
# ============================================

# -----------------------------------------------------------
# HOW TO USE THIS SKILL
# -----------------------------------------------------------
# Paste the following prompt to Antigravity:
#
#   "Read the stats blog production skill at
#    d:\Projects\{{NICHE}} SEO Agency\tools\stats-blog-production-skill.md
#    and use it to produce a statistics blog post on: [YOUR TOPIC]"
#
# The agent will follow every step automatically.
# -----------------------------------------------------------

## Table of Contents

1. [Overview](#overview)
2. [Phase 1: Deep Data Research](#phase-1-research)
3. [Phase 2: Data Architecture & Outline](#phase-2-planning)
4. [Phase 3: Asset Generation (Infographics + HTML Visualizations)](#phase-3-assets)
5. [Phase 4: Writing the HTML](#phase-4-writing)
6. [Phase 5: Site Integration](#phase-5-integration)
7. [Phase 6: QA & Verification](#phase-6-qa)
8. [Critical Constraints](#constraints)
9. [Parallel Agent Strategies](#parallel-agents)
10. [Component Reference: HTML/CSS Data Visualizations](#component-reference)
11. [File Templates](#templates)

---

<a id="overview"></a>
## 1. Overview

This skill produces **statistics roundup blog posts** -- the definitive data resource on a given topic. These posts are structured differently from standard editorial blog posts:

**What makes a statistics post different:**
- **Data-first** -- Every section is built around verified statistics from multiple authoritative sources
- **Massive research phase** -- Up to 50 searches and 50 webpage scrapes to aggregate real data
- **HTML/CSS data visualizations** -- Interactive bar charts, progress bars, stat grids, and comparison tables built in pure HTML/CSS (not just images)
- **5+ infographic images** -- Generated visual assets that complement the HTML visualizations
- **Source-cited throughout** -- Every single statistic links back to its original source
- **Table of Contents navigation** -- Numbered sections with anchor links
- **Key Takeaways box** -- Top 10-15 headline statistics at the top
- **Hero stat counters** -- 3-4 massive headline numbers displayed prominently
- **Methodology section** -- Transparent sourcing at the bottom
- **Summary table** -- Master reference table of all statistics

### SEO Meta & Branding Rules

> **CONTENT-FIRST PRINCIPLE:** Titles, meta descriptions, OG titles, and Twitter titles must be 100% content-driven and descriptive. Do NOT append brand names, domain names, taglines, or brand signatures to any of these fields. The brand is communicated through `og:site_name`, schema markup, and the domain in the URL itself.

| Element | Max Length | Brand Suffix? | Priority |
|---|---|---|---|
| `<title>` | **<= 60 characters** | **NO** -- no `| {{SITE_NAME}}.agency`, no `| {{NICHE}} SEO Agency for {{AUDIENCE}}` | Primary keyword + year + compelling descriptor |
| `<meta name="description">` | **<= 155 characters** | **NO** -- no brand name, no tagline | Data-focused summary that earns the click |
| `<h1>` | No hard limit (aim <= 80 chars) | **NO** -- content-focused only | Matches search intent, contains primary keyword + stat count |
| `og:title` | **<= 95 characters** | **NO** -- descriptive only | Optimized for social sharing engagement |
| `og:description` | **<= 200 characters** | **NO** | Compelling social preview with headline stat |
| `og:site_name` | N/A | **YES** -- this is where brand goes | Set to `{{SITE_NAME}}.agency` |
| `twitter:title` | **<= 70 characters** | **NO** -- matches og:title | Same as og:title |
| `twitter:description` | **<= 200 characters** | **NO** | Same as og:description |
| Schema `headline` | Matches `<title>` | **NO** | Same as title tag |
| Schema `author`/`publisher` name | N/A | **YES** -- `{{SITE_NAME}}.agency` | Brand in structured data only |

**Why no brand in titles/descriptions?**
- Google often appends the site name automatically in SERPs
- Every character spent on brand is a character NOT spent on keyword relevance or stat count
- Social platforms show the domain/site_name separately
- Content-focused titles have higher CTR than branded ones for informational queries
- For statistics posts especially, the stat count ("75+ Data Points") is FAR more click-worthy than a brand name
- The brand is already visible in the URL, favicon, and schema markup

**Examples for statistics posts:**
```
GOOD title:  "{{NICHE}} SEO Statistics (2026) | 75+ Data Points"
BAD title:   "{{NICHE}} SEO Statistics (2026) | {{NICHE}} SEO Agency for {{AUDIENCE}}"

GOOD meta:   "75+ verified {{NICHE}} SEO statistics for 2026 covering Google Maps, reviews, mobile search, and local ranking factors."
BAD meta:    "{{SITE_NAME}}.agency presents 75+ verified {{NICHE}} SEO statistics."

GOOD og:title: "{{NICHE}} SEO Statistics (2026): 75+ Data Points You Need to Know"
BAD og:title:  "{{NICHE}} SEO Statistics (2026) | {{NICHE}} SEO Agency for {{AUDIENCE}}"
```

**Example output structure (based on "Blogging Statistics" reference):**

```
HERO SECTION:
  3-4 giant stat counters (e.g., "600M+ Active blogs worldwide")

KEY TAKEAWAYS:
  12-20 bullet-point headline stats with source citations

TABLE OF CONTENTS:
  Numbered, clickable sections

SECTIONS (10-18 per post):
  Each section contains:
    - H2 heading with section number
    - Intro paragraph with context
    - Data table (HTML) with Metric | Value | Source columns
    - 1-2 HTML/CSS data visualizations (bar charts, progress bars, etc.)
    - 1 stat callout box (big number with context)
    - Interpretive text (what the data means)
    - Infographic image (in 3-5 of the sections)

METHODOLOGY SECTION:
  List of all sources used

SUMMARY TABLE:
  Master table with all key statistics
```

### Project Structure Reference

```
{{NICHE}} SEO Agency/
  blog/
    index.html              <- Blog listing page (add new card here)
    [new-post-slug].html    <- New post goes here
  css/
    main.css                <- Design system (DO NOT modify)
    blog.css                <- Blog-specific styles (extend here)
  assets/images/blog/       <- Infographic images
  tools/
    serper-search.ps1       <- SERP research tool
    serper-scrape.ps1       <- Webpage scraper tool
    serper-batch.ps1        <- Multi-keyword batch research
    link-registry.json      <- Internal link lookup
  js/
    main.js                 <- Navigation, topbar, FAQ accordion
    animations.js           <- Scroll reveal animations
  sitemap.xml               <- Add new URLs here
```

### API Credentials (Serper.dev)

```
API Key:    (set SERPER_API_KEY in .env — see SETUP.md)
SERP:       POST https://google.serper.dev/search
Scrape:     POST https://scrape.serper.dev
Auth:       X-API-KEY header
```

---

<a id="phase-1-research"></a>
## 2. Phase 1: Deep Data Research (Up to 50 Searches + 50 Scrapes)

**This is the most critical phase.** A statistics post lives or dies by the quality and breadth of its data. You must gather REAL statistics from REAL sources. Never fabricate, estimate, or invent any data point.

**Research budget:** Up to 50 serper-search calls and 50 serper-scrape calls. Use them aggressively.

### Step 1.1 -- Primary Topic SERP Analysis (8-12 searches)

Run broad searches to find existing statistics roundups and data sources:

```powershell
cd "d:\Projects\{{NICHE}} SEO Agency\tools"

# Core statistics searches
.\serper-search.ps1 -Query "[TOPIC] statistics 2025 2026" -Mode all -Num 10
.\serper-search.ps1 -Query "[TOPIC] data statistics report" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] industry report" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] market size revenue" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] industry outlook" -Mode organic -Num 10

.\serper-search.ps1 -Query "[TOPIC] trends report" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] research report" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] annual report" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] state of the industry" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] facts and figures" -Mode organic -Num 10

.\serper-search.ps1 -Query "[TOPIC] survey results" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] consumer survey" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] customer behavior data" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] buyer behavior statistics" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] trust statistics" -Mode organic -Num 10

.\serper-search.ps1 -Query "[TOPIC] benchmarks data" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] performance benchmarks" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] cost benchmarks" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] ROI statistics" -Mode organic -Num 10
.\serper-search.ps1 -Query "[TOPIC] filetype:pdf report" -Mode organic -Num 10
```

**What to extract:**
- URLs of existing statistics roundup posts (your competitors)
- Primary data sources they cite (surveys, reports, studies)
- Knowledge Graph data (market size, key figures)
- People Also Ask questions (for FAQ section)
- Related searches (secondary angles to cover)

### Step 1.2 -- Competitor Statistics Posts Scraping (12-20 scrapes)

Scrape the top 8-12 existing statistics roundup posts on your topic:

```powershell
.\serper-scrape.ps1 -Url "https://competitor-stats-post-1.com" -Mode text
.\serper-scrape.ps1 -Url "https://competitor-stats-post-2.com" -Mode text
# ... scrape 8-12 total
```

**What to catalog from each competitor:**
- Total number of statistics cited
- Which sources they reference (build a master source list)
- How they organize sections (what categories do they use?)
- Data gaps -- what statistics are missing?
- How old is their data? (You need NEWER data to outrank them)
- Specific numbers: extract every stat into a working spreadsheet/list

> **BUILD A DATA INVENTORY:** Create a running list of every statistic you find. Format: `[Statistic] | [Value] | [Source Name] | [Source URL] | [Year]`. This becomes your master reference for writing.

### Step 1.3 -- Primary Source Mining (15-25 searches + 10-20 scrapes)

**Go directly to the original sources.** Do NOT just copy stats from other roundup posts. Find the actual studies, surveys, and reports:

```powershell
# Find the actual studies/reports cited by competitors
.\serper-search.ps1 -Query "[Source Name] [report title] 2025 2026" -Mode organic -Num 5
.\serper-search.ps1 -Query "[Organization] annual survey [topic]" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] census bureau data" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] bureau of labor statistics" -Mode organic -Num 5

# Industry-specific data sources
.\serper-search.ps1 -Query "[topic] market research report statista" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] ibisworld industry report" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] association annual report" -Mode organic -Num 5

# Government and institutional data
.\serper-search.ps1 -Query "site:bls.gov [topic]" -Mode organic -Num 5
.\serper-search.ps1 -Query "site:census.gov [topic]" -Mode organic -Num 5
.\serper-search.ps1 -Query "site:statista.com [topic]" -Mode organic -Num 5
```

Then scrape the actual source pages:
```powershell
.\serper-scrape.ps1 -Url "https://actual-study-or-report.com" -Mode text
# Scrape 10-20 primary sources
```

**Priority sources (in order of authority):**
1. Government agencies (BLS, Census, SBA, EPA)
2. Industry associations and trade groups
3. Major research firms (Statista, IBISWorld, Grand View Research)
4. Annual surveys from respected organizations
5. Academic studies and university research
6. Major consulting firms (McKinsey, Deloitte, PwC)
7. Established industry publications
8. Company-published data (with verification)

### Step 1.4 -- Lateral and Depth Research (10-15 searches + 5-10 scrapes)

Search for angles and data that competitors missed:

```powershell
# Economic and financial data
.\serper-search.ps1 -Query "[topic] revenue growth rate CAGR" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] average salary compensation" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] failure rate success rate" -Mode organic -Num 5

# Technology and trends
.\serper-search.ps1 -Query "[topic] technology adoption rate" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] AI impact statistics" -Mode organic -Num 5

# Demographics and geography
.\serper-search.ps1 -Query "[topic] demographics age gender" -Mode organic -Num 5
.\serper-search.ps1 -Query "[topic] by state by country" -Mode organic -Num 5

# Reddit and community insights
.\serper-search.ps1 -Query "site:reddit.com [topic] statistics data" -Mode organic -Num 5
.\serper-search.ps1 -Query "site:reddit.com [topic] industry numbers" -Mode organic -Num 5
```

### Step 1.5 -- Data Validation and Inventory

**Before moving to Phase 2, you MUST have:**

```
MINIMUM DATA REQUIREMENTS:
[ ] 70+ verified statistics with sources (target 75-100+)
[ ] 15+ unique primary sources cited
[ ] Data from at least 4 different years (for trend analysis)
[ ] At least 7 statistics that NO competitor roundup includes
[ ] Enough data for 10-18 distinct thematic sections
[ ] At least 5-8 data sets suitable for HTML/CSS visualization
[ ] At least 5 data sets suitable for infographic generation
[ ] Every statistic has: value, source name, source URL, year
```

> **CRITICAL RULE:** If a statistic cannot be traced to a named, linkable source, DO NOT include it. "Various sources" is acceptable only as a last resort when 2 or more sources agree on the same number.

> **PARALLEL AGENT TIP:** Fire ALL Step 1.1 searches simultaneously (8-12 parallel calls). Then fire ALL Step 1.2 scrapes simultaneously. Then fire ALL Step 1.3 searches simultaneously. This reduces 50+ sequential calls to ~5 parallel batches.

---

<a id="phase-2-planning"></a>
## 3. Phase 2: Data Architecture & Outline

### Step 2.1 -- Organize Statistics Into Thematic Sections

Group your data inventory into 12-18 logical sections. Study how competitor roundups organize theirs, then improve on it:

**Common section patterns for statistics posts:**
- Market size and growth
- Demographics (who)
- Usage and adoption rates
- Revenue and income
- Technology and tools
- Performance benchmarks
- Regional/geographic breakdown
- Trends over time
- Challenges and failure rates
- Future projections
- Platform/channel comparisons
- Best practices correlation data

**Each section needs:**
- At least 8-15 statistics
- At least 1 data table (HTML)
- At least 1 HTML/CSS visualization (bar chart, progress bar, etc.)
- 1 stat callout box (big number highlight)
- Contextual prose connecting the data points

### Step 2.2 -- Plan the Hero Section

Choose 3-4 of the most striking, headline-worthy statistics for the hero stat counters:

```
Hero Stat 1: [BIG NUMBER] + [short label]  (e.g., "600M+" / "Active blogs worldwide")
Hero Stat 2: [BIG NUMBER] + [short label]
Hero Stat 3: [BIG NUMBER] + [short label]
Hero Stat 4: [BIG NUMBER] + [short label]  (optional)
```

These should be the most impressive, attention-grabbing numbers that make the reader want to keep scrolling.

### Step 2.3 -- Plan Key Takeaways

Select 10-15 of the most important statistics for the Key Takeaways box. Format:

```
- [Statistic in plain English] ([Source Name])
- [Statistic in plain English] ([Source Name])
... (10-15 total)
```

### Step 2.4 -- Define Keywords

```
Primary keyword:    [topic] statistics
Secondary keywords: [topic] stats, [topic] data, [topic] facts
Long-tail keywords: [topic] statistics [year], how many [topic], [topic] industry size
```

### Step 2.5 -- Plan Infographics (MANDATORY -- 5+ per post)

Statistics posts require MORE infographics than standard posts because they are data-heavy. Plan at least 5:

```
Infographic 1: [Type] -- [Data it shows] -- [Section placement]
Infographic 2: [Type] -- [Data it shows] -- [Section placement]
Infographic 3: [Type] -- [Data it shows] -- [Section placement]
Infographic 4: [Type] -- [Data it shows] -- [Section placement]
Infographic 5: [Type] -- [Data it shows] -- [Section placement]
Infographic 6: [Type] -- [Data it shows] -- [Section placement]  (optional)
Infographic 7: [Type] -- [Data it shows] -- [Section placement]  (optional)
```

**Best infographic types for statistics posts:**
- Timeline/trend charts (showing change over multiple years)
- Pie/donut chart breakdowns (market share, demographics)
- Horizontal bar charts (rankings, comparisons)
- Comparison infographics (side-by-side data)
- Process/funnel diagrams (conversion data)
- Geographic/regional data maps
- Stacked bar charts (composition data)

### Step 2.6 -- Plan HTML/CSS Data Visualizations

For EVERY section, plan at least one HTML/CSS data visualization. These are coded directly in the HTML (not images) and include:

```
Section 1: [Visualization type] -- [What data it shows]
Section 2: [Visualization type] -- [What data it shows]
... (one per section minimum)
```

**Available HTML/CSS visualization types (see Component Reference):**
- Horizontal bar chart (CSS width percentages)
- Vertical bar chart (CSS height percentages)
- Progress bar / gauge
- Stat callout box (big number with context)
- Donut chart (CSS conic-gradient)
- Timeline progression (year-over-year data)
- Comparison cards (side-by-side metrics)

---

<a id="phase-3-assets"></a>
## 4. Phase 3: Asset Generation (AI Infographics)

### Step 3.1 -- Generate Infographics (5+ per post)

Use the `image_generate` AI image tool for all planned infographics. This means the AI image model/tool, not a hand-written SVG, HTML chart, canvas chart, screenshot, or Sharp-created graphic. Prompts must be information-dense and include exact researched statistics, labels, hierarchy, brand palette, and source citation. Save/download the generated image and optimize the delivered asset as WebP. Do **not** satisfy infographic requirements with programmatic SVG/HTML/canvas/Sharp layouts. For scheduled/autopilot publishing, if `image_generate` is unavailable or fails, stop as blocked instead of using a fallback generator. Only use a non-AI fallback when the user explicitly requests it in the current task, and disclose it clearly.

Follow this prompt pattern:

```
"Professional infographic titled '[TITLE]' for a statistics blog post.
Dark navy background (#0F2A44).
[describe the data, layout, and structure in DETAIL -- be very specific
about every number, label, bar, segment, and comparison].
Clean sans-serif typography, subtle grid lines,
professional data visualization style.
Bottom text: 'Source: [source] | {{SITE_NAME}}.agency'.
No stock photos, pure data visualization.
Do NOT include any watermarks, AI attribution text, metadata labels, or
generation tool references anywhere in the image."
```

**CRITICAL prompt additions to ALWAYS include (anti-metadata):**
```
Always append these instructions to EVERY infographic prompt:
- "No watermarks."
- "No AI-generated labels or attribution text."
- "No metadata or generation tool references."
- "No 'created with' or 'made by' text."
- "No small print disclaimers unless it is the source citation."
```

**Brand color palette:**
- Navy background: `#0F2A44`
- Primary accent: `#176B9A` (teal/blue)
- Alert/negative: `#E94743` (red)
- Success/positive: `#74C9A7` (green)
- Highlight/callout: `#F4D77A` (yellow)
- Text on dark: `#FAFAF7` (off-white)

**Best infographic prompts for statistics posts:**

| Type | Prompt Structure |
|------|------------------|
| Trend Timeline | "Horizontal timeline from [year] to [year] showing [metric] values: [year1]=[val1], [year2]=[val2], etc. Connected line chart style with data points labeled." |
| Pie/Donut Chart | "Donut chart showing [topic] breakdown: [segment1] [%], [segment2] [%], etc. Each segment labeled with percentage and name." |
| Horizontal Bar Chart | "Horizontal bar chart ranking [items] by [metric]: [item1]=[val1], [item2]=[val2], etc. Bars sorted longest to shortest." |
| Statistical Highlight | "Large central number [N] with supporting context, surrounded by 3-4 smaller stats in cards" |
| Comparison | "Side-by-side columns comparing [A] vs [B] across [N] metrics with specific values" |
| Funnel | "Vertical funnel diagram showing [process] with [N] stages, each narrower, with conversion rates" |

### Step 3.2 -- Infographic QA (MANDATORY)

After generating each infographic, visually inspect it using `view_file`:

**Reject and regenerate if:**
- AI-generated/watermark text visible
- Gibberish or garbled text
- Numbers are wrong or unreadable
- Layout is messy or unprofessional
- Colors do not match brand palette

### Step 3.3 -- Deploy Images

```powershell
# Create directory if needed
New-Item -ItemType Directory -Path "d:\Projects\{{NICHE}} SEO Agency\assets\images\blog" -Force

# Copy ALL generated images to project
Copy-Item "[source-path-1]" "d:\Projects\{{NICHE}} SEO Agency\assets\images\blog\[descriptive-name-1].png"
# ... etc for all infographics
```

> **PARALLEL AGENT TIP:** Fire ALL 5-7 infographic generations simultaneously. This is the single biggest time save.

---

<a id="phase-4-writing"></a>
## 5. Phase 4: Writing the HTML

### CRITICAL: Token Limit Fragmentation Strategy

> **OUTPUT TOKEN LIMIT IS 64,000 TOKENS.** Statistics posts are LONG (800-1200+ lines of HTML). You MUST fragment into 4-6 `replace_file_content` calls using marker comments.

### The Proven Fragmentation Pattern:

**Step 4.1 -- Write skeleton with hero + key takeaways + first 3 sections:**
Use `write_to_file` to create the file with:
- Complete `<head>` (meta tags, schema, stylesheets, inline CSS for data visualizations)
- Complete header/nav
- Article header (title, breadcrumbs, date)
- Hero stat counters (3-4 big numbers)
- Key Takeaways box (10-15 bullet stats)
- Table of Contents
- Sections 1-3 with data tables and HTML visualizations
- A `<!-- CONTENT_PART2 -->` placeholder comment
- Complete footer + scripts

**Step 4.2 -- Replace CONTENT_PART2 with sections 4-6:**
Use `replace_file_content` targeting `<!-- CONTENT_PART2 -->` to insert:
- Sections 4-6 with data tables and HTML visualizations
- Infographic images in relevant sections
- A `<!-- CONTENT_PART3 -->` placeholder

**Step 4.3 -- Replace CONTENT_PART3 with sections 7-9:**
Use `replace_file_content` targeting `<!-- CONTENT_PART3 -->` to insert:
- Sections 7-9 with data tables and HTML visualizations
- More infographic images
- A `<!-- CONTENT_PART4 -->` placeholder

**Step 4.4 -- Replace CONTENT_PART4 with sections 10-12+ and closing:**
Use `replace_file_content` targeting `<!-- CONTENT_PART4 -->` to insert:
- Remaining sections (10-15)
- Summary statistics table
- Methodology and sources section
- FAQ section with schema
- Related Posts component
- Bottom CTA
- A `<!-- SCRIPTS_MARKER -->` placeholder

**Step 4.5 -- Replace SCRIPTS_MARKER with scripts:**
Use `replace_file_content` to add:
- FAQ schema JSON-LD
- FAQ accordion JavaScript
- Any animated counter scripts
- Scroll-triggered animation scripts

### Statistics Post -- Unique HTML Components

**These components are SPECIFIC to statistics posts and supplement the standard blog.css components:**

#### 1. Hero Stat Counters (top of article)

```html
<div class="stats-hero-grid">
  <div class="stats-hero-card">
    <div class="stats-hero-card__number">600M+</div>
    <div class="stats-hero-card__label">Active blogs worldwide</div>
  </div>
  <div class="stats-hero-card">
    <div class="stats-hero-card__number">7.5M</div>
    <div class="stats-hero-card__label">Blog posts published daily</div>
  </div>
  <div class="stats-hero-card">
    <div class="stats-hero-card__number">95%</div>
    <div class="stats-hero-card__label">Bloggers using AI (2025)</div>
  </div>
</div>
```

#### 2. Key Takeaways Box

```html
<div class="key-takeaways">
  <div class="key-takeaways__label">Key Takeaways</div>
  <ul class="key-takeaways__list">
    <li>There are over 600 million blogs worldwide -- 31.6% of all websites
      (<a href="[URL]" target="_blank" rel="noopener">Tech Business News</a>)</li>
    <li>[Next stat with source link]</li>
    <!-- 10-15 total -->
  </ul>
</div>
```

#### 3. Section Data Table (most common component)

```html
<div class="data-table-wrapper">
  <table class="data-table">
    <thead>
      <tr>
        <th>Metric</th>
        <th>Value</th>
        <th>Source</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td>Total blogs worldwide</td>
        <td><strong>600 million+</strong></td>
        <td><a href="[URL]" target="_blank" rel="noopener">Tech Business News</a></td>
      </tr>
      <!-- more rows -->
    </tbody>
  </table>
</div>
```

#### 4. Stat Callout Box (big number highlight within a section)

```html
<div class="stat-callout">
  <div class="stat-callout__number">2.7B</div>
  <div class="stat-callout__text">Blog posts are published per year worldwide.
    To put that in perspective, that is roughly 85 new blog posts per second.</div>
  <div class="stat-callout__source">Tech Business News, 2025</div>
</div>
```

#### 5. CSS Horizontal Bar Chart

```html
<div class="css-bar-chart">
  <div class="css-bar-chart__title">Blog Publishing Frequency (% of Bloggers)</div>
  <div class="css-bar-chart__item">
    <span class="css-bar-chart__label">Multiple/week</span>
    <div class="css-bar-chart__bar-bg">
      <div class="css-bar-chart__bar" style="width:13%">
        <span class="css-bar-chart__value">13%</span>
      </div>
    </div>
  </div>
  <div class="css-bar-chart__item">
    <span class="css-bar-chart__label">Weekly</span>
    <div class="css-bar-chart__bar-bg">
      <div class="css-bar-chart__bar" style="width:22%">
        <span class="css-bar-chart__value">22%</span>
      </div>
    </div>
  </div>
  <!-- more bars -->
</div>
```

#### 6. CSS Timeline Progression

```html
<div class="css-timeline">
  <div class="css-timeline__title">Average Blog Post Word Count Over Time</div>
  <div class="css-timeline__track">
    <div class="css-timeline__point">
      <div class="css-timeline__year">2014</div>
      <div class="css-timeline__value">808</div>
    </div>
    <div class="css-timeline__point">
      <div class="css-timeline__year">2016</div>
      <div class="css-timeline__value">1,054</div>
    </div>
    <!-- more points -->
  </div>
</div>
```

#### 7. CSS Donut Chart

```html
<div class="css-donut-chart">
  <div class="css-donut-chart__title">High-Traffic Blog Niches (50K+ Monthly Sessions)</div>
  <div class="css-donut-chart__visual"
    style="background: conic-gradient(
      #176B9A 0% 42.8%,
      #74C9A7 42.8% 56.1%,
      #F4D77A 56.1% 66.1%,
      #E94743 66.1% 100%
    );">
    <div class="css-donut-chart__center">
      <span class="css-donut-chart__center-value">42.8%</span>
      <span class="css-donut-chart__center-label">Food</span>
    </div>
  </div>
  <div class="css-donut-chart__legend">
    <div class="css-donut-chart__legend-item">
      <span class="css-donut-chart__swatch" style="background:#176B9A"></span>
      Food (42.8%)
    </div>
    <div class="css-donut-chart__legend-item">
      <span class="css-donut-chart__swatch" style="background:#74C9A7"></span>
      Lifestyle (13.3%)
    </div>
    <!-- more items -->
  </div>
</div>
```

#### 8. Year-over-Year Comparison Cards

```html
<div class="yoy-compare">
  <div class="yoy-compare__card yoy-compare__card--before">
    <div class="yoy-compare__year">2014</div>
    <div class="yoy-compare__value">2h 24m</div>
    <div class="yoy-compare__label">Average writing time</div>
  </div>
  <div class="yoy-compare__arrow">&#8594;</div>
  <div class="yoy-compare__card yoy-compare__card--after">
    <div class="yoy-compare__year">2025</div>
    <div class="yoy-compare__value">3h 48m</div>
    <div class="yoy-compare__label">Average writing time (+58%)</div>
  </div>
</div>
```

### Step 4.6 -- CSS Additions for Statistics Post Components

Add these NEW component styles to `css/blog.css` using `replace_file_content`. Append at the end of the file:

**New CSS classes needed (add to blog.css):**
```
.stats-hero-grid           -- 3-4 column grid for hero stat counters
.stats-hero-card           -- Individual hero stat card
.stats-hero-card__number   -- Big number display
.stats-hero-card__label    -- Label below number
.key-takeaways             -- Takeaways box container
.key-takeaways__label      -- "Key Takeaways" header
.key-takeaways__list       -- Styled bullet list
.stat-callout              -- Big number callout box
.stat-callout__number      -- Central big number
.stat-callout__text        -- Supporting context text
.stat-callout__source      -- Source citation
.css-bar-chart             -- Bar chart container
.css-bar-chart__title      -- Chart title
.css-bar-chart__item       -- Individual bar row
.css-bar-chart__label      -- Bar label
.css-bar-chart__bar-bg     -- Bar background track
.css-bar-chart__bar        -- Filled bar (width set inline)
.css-bar-chart__value      -- Value displayed on bar
.css-timeline              -- Timeline container
.css-timeline__title       -- Timeline title
.css-timeline__track       -- Horizontal track
.css-timeline__point       -- Individual data point
.css-timeline__year        -- Year label
.css-timeline__value       -- Value at point
.css-donut-chart           -- Donut chart container
.css-donut-chart__visual   -- The donut (conic-gradient)
.css-donut-chart__center   -- Center circle overlay
.css-donut-chart__legend   -- Legend container
.css-donut-chart__swatch   -- Color swatch in legend
.yoy-compare               -- Year comparison container
.yoy-compare__card         -- Before/after card
.yoy-compare__arrow        -- Arrow between cards
.stats-toc                 -- Table of contents
.stats-toc__item           -- TOC item with number
.methodology               -- Methodology section
.summary-table             -- Summary master table
```

> **IMPORTANT:** The full CSS implementation for each component is in the Component Reference section at the end of this skill.

### Phase 4b: Internal & External Linking (MANDATORY)

Same rules as the standard blog production skill:

#### Step 4b.1 -- Internal Linking
- Open `tools/link-registry.json`
- Scan each section for natural linking opportunities
- Insert contextual links to sibling blog posts and service pages
- No fixed count, natural fit only, max 1 link per target page

#### Step 4b.2 -- External Authority Linking
- EVERY statistic that cites a source should link to that source
- Always `rel="noopener"` and `target="_blank"` for external links
- Link to the PRIMARY source (the study/report), not a secondary blog
- This is even MORE important in statistics posts since credibility depends on verifiable sources

#### Step 4b.3 -- Related Posts Component (MANDATORY)
Add "Keep Reading" section with 3 related sibling posts, same as standard skill.

---

<a id="phase-5-integration"></a>
## 6. Phase 5: Site Integration

### Step 5.1 -- Add Blog Card to Index
Edit `blog/index.html` -- insert a new `blog-card` div BEFORE existing cards (newest first):

```html
<div class="blog-card reveal">
  <div class="blog-card__image" style="background:linear-gradient(135deg, rgba(23,107,154,0.15), rgba(116,201,167,0.1));">
    <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
      <path d="M3 3h18v18H3z"/><path d="M7 17V10"/><path d="M12 17V7"/><path d="M17 17V13"/>
    </svg>
  </div>
  <div class="blog-card__content">
    <div class="blog-card__meta">
      <span>[Category]</span> &bull; [Date]
    </div>
    <h2 class="blog-card__title">
      <a href="/blog/[slug]">[Title]: [N]+ Data Points for [Year]</a>
    </h2>
    <p class="blog-card__excerpt">[1-2 sentence excerpt highlighting the most striking statistic]</p>
    <a href="/blog/[slug]" class="blog-card__read-more">Read Article ...</a>
  </div>
</div>
```

### Step 5.2 -- Update Sitemap
Add to `sitemap.xml`:

```xml
<url>
  <loc>https://{{DOMAIN}}/blog/[slug]</loc>
  <lastmod>[YYYY-MM-DD]</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.6</priority>
</url>
```

### Step 5.3 -- Update Link Registry
Add the new post to `tools/link-registry.json`:

```json
{
  "slug": "/blog/[new-post-slug]",
  "title": "[Full Title of Statistics Post]",
  "topics": ["keyword1", "keyword2", "keyword3", "statistics", "data"],
  "anchors": ["suggested anchor text 1", "suggested anchor text 2"]
}
```

Append this entry to the `internal.blog` array in the registry.

---

<a id="phase-6-qa"></a>
## 7. Phase 6: QA & Verification

### Step 6.1 -- Browser Visual Test
Use `browser_subagent` to:
1. Open the blog post
2. Verify hero stat counters display correctly
3. Verify Key Takeaways box renders
4. Check Table of Contents links work
5. Scroll through ALL sections
6. Verify all data tables render properly
7. Verify all HTML/CSS visualizations display (bar charts, donut charts, timelines)
8. Check all infographic images load
9. Verify stat callout boxes render
10. Test FAQ accordion functionality
11. Check responsive layout at mobile widths
12. Verify methodology section and summary table

### Step 6.2 -- SEO Checklist
Verify in the HTML:
- [ ] `<title>` tag contains primary keyword + year (content-focused, NO brand suffix)
- [ ] `<title>` is <= 60 characters
- [ ] `<meta name="description">` is compelling, data-focused, and <= 155 characters
- [ ] `<meta name="description">` does NOT contain brand name or tagline
- [ ] `<h1>` matches the article's content focus with stat count (NOT the brand)
- [ ] `<link rel="canonical">` is set correctly
- [ ] Open Graph tags present (title, description, image, url, type, site_name)
- [ ] `og:title` is descriptive and content-focused (NO brand suffix)
- [ ] `og:description` is <= 200 characters
- [ ] `og:site_name` is set to `{{SITE_NAME}}.agency`
- [ ] Twitter Card tags present (card, site, title, description, image)
- [ ] `twitter:title` matches `og:title` (content-focused, NO brand suffix)
- [ ] Article schema JSON-LD is valid
- [ ] FAQPage schema JSON-LD has all questions
- [ ] Single `<h1>` on the page
- [ ] H2/H3 hierarchy is logical with section numbers
- [ ] Images have descriptive alt text
- [ ] ALL statistics link to their source
- [ ] Internal links added where natural
- [ ] External links have `target="_blank" rel="noopener"`
- [ ] Related Posts section with 3 sibling articles
- [ ] New post added to `tools/link-registry.json`

### Step 6.3 -- Data Accuracy Spot Check
- [ ] Randomly verify 5-10 statistics against their cited sources
- [ ] Ensure no statistic is attributed to the wrong source
- [ ] Verify all source URLs are still live (not 404)
- [ ] Check that year/date context is accurate

### Step 6.4 -- Image Optimization
- [ ] Convert PNG infographics to WebP format
- [ ] Back up originals to archive folder
- [ ] Verify WebP images load correctly in the post

---

<a id="constraints"></a>
## 8. Critical Constraints

### âš ï¸ GOLDEN RULE: Save as .html, NEVER link as .html

**Files are saved on disk as `[slug].html`** â€” that is correct and must stay that way.

**All `href` links, canonical tags, og:url, sitemap `<loc>`, and any URL reference in HTML or JSON must use the clean URL WITHOUT `.html`.**

| Context | Correct | Wrong |
|---------|---------|-------|
| `href` in `<a>` tag | `href="/blog/my-post"` | `href="/blog/my-post.html"` |
| `<link rel="canonical">` | `href="https://{{DOMAIN}}/blog/my-post"` | `href="https://{{DOMAIN}}/blog/my-post.html"` |
| `og:url` meta tag | `https://{{DOMAIN}}/blog/my-post` | `https://{{DOMAIN}}/blog/my-post.html` |
| Sitemap `<loc>` | `https://{{DOMAIN}}/blog/my-post` | `https://{{DOMAIN}}/blog/my-post.html` |
| Link registry `slug` | `/blog/my-post` | `/blog/my-post.html` |
| Nav / footer links | `/pages/pricing` | `/pages/pricing.html` |

This rule exists because the site is served via Cloudflare Workers which strips `.html` from URLs. The live URL is `{{DOMAIN}}/blog/my-post` â€” linking to the `.html` version creates a redirect chain that hurts SEO.

---

### Token Limit (64K output)
**Problem:** Statistics posts are 800-1200+ lines of HTML, far exceeding limits.
**Solution:** Fragment into 5-6 `replace_file_content` calls with marker comments.
**Rule:** Never write more than ~120 lines of HTML per tool call.

### PowerShell Emoji Encoding
**Problem:** Emoji characters corrupt in PowerShell scripts.
**Solution:** Use ASCII alternatives: `[SEARCH]`, `[ERROR]`, `[OK]`.

### Never use Em dash
Use `--` instead of the em dash character in all blog writing.

### Data Integrity
**Problem:** Statistics posts lose credibility if any data is wrong.
**Solution:** Every stat must have: value, source name, source URL, year.
**Rule:** NEVER fabricate or estimate a statistic. If you cannot verify it, do not include it.

### File Size
**Problem:** Statistics posts can reach 1200+ lines of HTML.
**Solution:** Fragment writing. Use CSS classes in blog.css (not inline styles for components). Keep the HTML clean and semantic.

### Source Linking
**Problem:** Statistics posts have 30-50+ external links.
**Solution:** Every source link must use `target="_blank" rel="noopener"`. Link to primary sources, not secondary roundups.

---

<a id="parallel-agents"></a>
## 9. Parallel Agent Strategies

### Maximum Parallelism Plan

```
Turn 1: Fire ALL primary SERP searches at once (8-12 parallel):
  serper-search x8-12 (statistics, data, reports, surveys, etc.)

Turn 2: Fire ALL competitor scrapes at once (5-8 parallel):
  serper-scrape x5-8 (top statistics roundup posts)

Turn 3: Fire ALL primary source searches (10-15 parallel):
  serper-search x10-15 (actual studies, reports, gov data)

Turn 4: Fire ALL primary source scrapes (10-15 parallel):
  serper-scrape x10-15 (actual data pages)

Turn 5: Fire lateral/depth searches (5-10 parallel):
  serper-search x5-10 (demographics, revenue, trends)

Turn 6: Fire remaining scrapes (5-10 parallel):
  serper-scrape x5-10 (remaining data sources)

Turn 7: Fire ALL infographic generations (5-7 parallel):
  image_generate x5-7

Turn 8: Infographic QA -- view_file each image:
  view_file x5-7 (regenerate any with issues)

Turn 9: CSS additions + image deployment (parallel):
  replace_file_content (blog.css)
  run_command (copy images to assets)

Turn 10-15: Write HTML fragments (sequential):
  10. write_to_file (skeleton + hero + sections 1-3)
  11. replace_file_content (sections 4-6)
  12. replace_file_content (sections 7-9)
  13. replace_file_content (sections 10-12+)
  14. replace_file_content (summary + methodology + FAQ + CTA)
  15. replace_file_content (scripts + schema)

Turn 16: Integration (parallel):
  replace_file_content (blog/index.html -- new card)
  replace_file_content (sitemap.xml -- new URL)
  replace_file_content (link-registry.json -- new entry)

Turn 17: QA
  browser_subagent (visual test)

Turn 18: Image optimization
  run_command (convert PNG to WebP, backup originals)
```

**Total: ~18 turns instead of ~40+ sequential turns.**

### What CAN run in parallel:
| Stage | Parallel Calls | Time Saved |
|-------|---------------|------------|
| SERP Research (3 batches) | 8-15 searches per batch | ~60 seconds |
| Source Scraping (3 batches) | 5-15 scrapes per batch | ~45 seconds |
| Infographic Generation | 5-7 images simultaneously | ~45 seconds |
| Site Integration | CSS + sitemap + index + registry | ~15 seconds |

### What CANNOT run in parallel:
- Multiple edits to the SAME file
- HTML fragment steps (each depends on the previous marker)
- Browser testing (must happen after all writing)

---

<a id="component-reference"></a>
## 10. Component Reference: Full CSS for Statistics Post Visualizations

**Append ALL of the following CSS to `css/blog.css` when creating a statistics post.** Only add what you have not already added in a previous post.

```css
/* ============================================
   Statistics Post Components
   ============================================ */

/* Hero Stat Grid */
.stats-hero-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: var(--space-5);
  margin: var(--space-8) 0;
}
.stats-hero-card {
  text-align: center;
  padding: var(--space-6) var(--space-4);
  background: linear-gradient(135deg, var(--trust-navy), var(--workwear-blue));
  border-radius: var(--radius-lg);
  color: var(--off-white);
  box-shadow: var(--shadow-md);
}
.stats-hero-card__number {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: clamp(2rem, 5vw, 3.5rem);
  line-height: 1;
  margin-bottom: var(--space-2);
  color: var(--road-yellow);
}
.stats-hero-card__label {
  font-size: var(--text-sm);
  color: rgba(250,250,247,0.8);
  font-weight: 500;
}

/* Key Takeaways Box */
.key-takeaways {
  background: rgba(23,107,154,0.05);
  border: 2px solid rgba(23,107,154,0.15);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  margin: var(--space-8) 0;
}
.key-takeaways__label {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-xl);
  color: var(--trust-navy);
  margin-bottom: var(--space-5);
  padding-bottom: var(--space-3);
  border-bottom: 2px solid rgba(23,107,154,0.15);
}
.key-takeaways__list {
  list-style: none;
  padding: 0;
  margin: 0;
  counter-reset: takeaway;
}
.key-takeaways__list li {
  padding: var(--space-3) 0 var(--space-3) var(--space-8);
  position: relative;
  font-size: var(--text-base);
  color: #334155;
  line-height: 1.6;
  border-bottom: 1px solid rgba(0,0,0,0.06);
}
.key-takeaways__list li:last-child { border-bottom: none; }
.key-takeaways__list li::before {
  counter-increment: takeaway;
  content: counter(takeaway);
  position: absolute;
  left: 0;
  top: var(--space-3);
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--trust-navy);
  color: var(--off-white);
  font-family: var(--font-heading);
  font-size: 11px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
}

/* Stat Callout Box */
.stat-callout {
  background: linear-gradient(135deg, var(--trust-navy), var(--workwear-blue));
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  margin: var(--space-10) 0;
  text-align: center;
  color: var(--off-white);
  position: relative;
  overflow: hidden;
}
.stat-callout::before {
  content: '';
  position: absolute;
  top: -40%;
  right: -15%;
  width: 250px;
  height: 250px;
  border-radius: 50%;
  background: rgba(244,215,122,0.08);
}
.stat-callout__number {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: clamp(2.5rem, 6vw, 4.5rem);
  color: var(--road-yellow);
  line-height: 1;
  margin-bottom: var(--space-3);
}
.stat-callout__text {
  font-size: var(--text-lg);
  color: rgba(250,250,247,0.9);
  max-width: 600px;
  margin: 0 auto var(--space-3);
  line-height: 1.6;
}
.stat-callout__source {
  font-size: var(--text-sm);
  color: rgba(250,250,247,0.5);
  font-style: italic;
}

/* CSS Horizontal Bar Chart */
.css-bar-chart {
  background: var(--white);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  margin: var(--space-8) 0;
  box-shadow: var(--shadow-sm);
}
.css-bar-chart__title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--trust-navy);
  margin-bottom: var(--space-5);
  text-align: center;
}
.css-bar-chart__item {
  display: grid;
  grid-template-columns: 140px 1fr;
  gap: var(--space-3);
  align-items: center;
  margin-bottom: var(--space-3);
}
.css-bar-chart__label {
  font-family: var(--font-heading);
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--trust-navy);
  text-align: right;
}
.css-bar-chart__bar-bg {
  background: rgba(23,107,154,0.08);
  border-radius: var(--radius-sm);
  height: 32px;
  position: relative;
  overflow: hidden;
}
.css-bar-chart__bar {
  height: 100%;
  background: linear-gradient(90deg, var(--{{NICHE}}-blue), var(--workwear-blue));
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: flex-end;
  padding-right: var(--space-3);
  min-width: 40px;
  transition: width 0.8s ease;
}
.css-bar-chart__value {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-sm);
  color: var(--off-white);
}

/* CSS Timeline Progression */
.css-timeline {
  background: var(--white);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  margin: var(--space-8) 0;
  box-shadow: var(--shadow-sm);
}
.css-timeline__title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--trust-navy);
  margin-bottom: var(--space-6);
  text-align: center;
}
.css-timeline__track {
  display: flex;
  justify-content: space-between;
  align-items: flex-end;
  padding: var(--space-6) 0 var(--space-2);
  border-bottom: 3px solid var(--{{NICHE}}-blue);
  position: relative;
  overflow-x: auto;
  gap: var(--space-2);
}
.css-timeline__point {
  display: flex;
  flex-direction: column;
  align-items: center;
  flex: 1;
  min-width: 60px;
}
.css-timeline__value {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-lg);
  color: var(--{{NICHE}}-blue);
  margin-bottom: var(--space-2);
}
.css-timeline__year {
  font-size: var(--text-xs);
  color: var(--steel-gray);
  font-weight: 600;
  margin-top: var(--space-2);
  padding-top: var(--space-2);
}
.css-timeline__point::after {
  content: '';
  width: 12px;
  height: 12px;
  border-radius: 50%;
  background: var(--{{NICHE}}-blue);
  border: 3px solid var(--white);
  box-shadow: 0 0 0 2px var(--{{NICHE}}-blue);
  order: 2;
}

/* CSS Donut Chart */
.css-donut-chart {
  background: var(--white);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  margin: var(--space-8) 0;
  box-shadow: var(--shadow-sm);
  text-align: center;
}
.css-donut-chart__title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--trust-navy);
  margin-bottom: var(--space-5);
}
.css-donut-chart__visual {
  width: 200px;
  height: 200px;
  border-radius: 50%;
  margin: 0 auto var(--space-5);
  display: flex;
  align-items: center;
  justify-content: center;
  position: relative;
}
.css-donut-chart__center {
  width: 120px;
  height: 120px;
  border-radius: 50%;
  background: var(--white);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
}
.css-donut-chart__center-value {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-2xl);
  color: var(--trust-navy);
  line-height: 1;
}
.css-donut-chart__center-label {
  font-size: var(--text-xs);
  color: var(--steel-gray);
  font-weight: 600;
  margin-top: 2px;
}
.css-donut-chart__legend {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: var(--space-3) var(--space-5);
}
.css-donut-chart__legend-item {
  display: flex;
  align-items: center;
  gap: var(--space-2);
  font-size: var(--text-sm);
  color: #334155;
}
.css-donut-chart__swatch {
  width: 14px;
  height: 14px;
  border-radius: 3px;
  flex-shrink: 0;
}

/* Year-over-Year Comparison */
.yoy-compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  margin: var(--space-8) 0;
  flex-wrap: wrap;
}
.yoy-compare__card {
  text-align: center;
  padding: var(--space-6);
  border-radius: var(--radius-lg);
  border: 2px solid;
  min-width: 180px;
  flex: 1;
  max-width: 260px;
}
.yoy-compare__card--before {
  background: rgba(233,71,67,0.04);
  border-color: rgba(233,71,67,0.2);
}
.yoy-compare__card--after {
  background: rgba(116,201,167,0.08);
  border-color: rgba(116,201,167,0.3);
}
.yoy-compare__year {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.08em;
  margin-bottom: var(--space-2);
}
.yoy-compare__card--before .yoy-compare__year { color: var(--pin-red); }
.yoy-compare__card--after .yoy-compare__year { color: #2d8a68; }
.yoy-compare__value {
  font-family: var(--font-heading);
  font-weight: 800;
  font-size: var(--text-3xl);
  color: var(--trust-navy);
  line-height: 1;
  margin-bottom: var(--space-2);
}
.yoy-compare__label {
  font-size: var(--text-sm);
  color: var(--steel-gray);
}
.yoy-compare__arrow {
  font-size: var(--text-3xl);
  color: var(--steel-gray);
  font-weight: 300;
}

/* Table of Contents for Stats Posts */
.stats-toc {
  background: rgba(23,107,154,0.04);
  border: 1px solid rgba(23,107,154,0.12);
  border-radius: var(--radius-lg);
  padding: var(--space-6);
  margin: var(--space-8) 0;
}
.stats-toc__title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-lg);
  color: var(--trust-navy);
  margin-bottom: var(--space-4);
}
.stats-toc__list {
  list-style: none;
  padding: 0;
  margin: 0;
  columns: 2;
  column-gap: var(--space-6);
}
.stats-toc__item {
  padding: var(--space-2) 0;
  break-inside: avoid;
}
.stats-toc__item a {
  font-size: var(--text-sm);
  color: var(--{{NICHE}}-blue);
  text-decoration: none;
  font-weight: 500;
  display: flex;
  align-items: baseline;
  gap: var(--space-2);
}
.stats-toc__item a:hover { color: var(--pin-red); }
.stats-toc__number {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-xs);
  color: var(--off-white);
  background: var(--trust-navy);
  width: 20px;
  height: 20px;
  border-radius: 50%;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  flex-shrink: 0;
}

/* Methodology Section */
.methodology {
  background: rgba(0,0,0,0.02);
  border: 1px solid var(--light-gray);
  border-radius: var(--radius-lg);
  padding: var(--space-8);
  margin: var(--space-10) 0;
}
.methodology__title {
  font-family: var(--font-heading);
  font-weight: 700;
  font-size: var(--text-xl);
  color: var(--trust-navy);
  margin-bottom: var(--space-4);
}
.methodology__text {
  font-size: var(--text-sm);
  color: var(--steel-gray);
  margin-bottom: var(--space-4);
  line-height: 1.6;
}
.methodology__sources {
  list-style: none;
  padding: 0;
  margin: 0;
  columns: 2;
  column-gap: var(--space-6);
}
.methodology__sources li {
  font-size: var(--text-sm);
  color: #334155;
  padding: var(--space-1) 0;
  break-inside: avoid;
}

/* Responsive Overrides */
@media (max-width: 768px) {
  .stats-hero-grid { grid-template-columns: 1fr; }
  .css-bar-chart__item { grid-template-columns: 100px 1fr; }
  .css-timeline__track { gap: var(--space-1); }
  .css-timeline__value { font-size: var(--text-base); }
  .stats-toc__list { columns: 1; }
  .methodology__sources { columns: 1; }
  .yoy-compare { flex-direction: column; }
  .yoy-compare__arrow { transform: rotate(90deg); }
}
@media (max-width: 480px) {
  .stats-hero-grid { gap: var(--space-3); }
  .stats-hero-card { padding: var(--space-4) var(--space-3); }
  .css-bar-chart__item { grid-template-columns: 80px 1fr; }
}
```

---

<a id="templates"></a>
## 11. Quick Reference: HTML Skeleton Template

```html
<!DOCTYPE html>
<html lang="en">
<head>
  <!-- Google tag (gtag.js) -->
  <script async src="https://www.googletagmanager.com/gtag/js?id=G-H9RD5BVGR8"></script>
  <script>
    window.dataLayer = window.dataLayer || [];
    function gtag(){dataLayer.push(arguments);}
    gtag('js', new Date());
    gtag('config', 'G-H9RD5BVGR8');
  </script>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[TOPIC] Statistics: [N]+ Data Points for [YEAR] -- {{SITE_NAME}}.agency</title>
  <meta name="description" content="[META DESCRIPTION < 160 chars with key stat]">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://{{DOMAIN}}/blog/[SLUG].html">
  <meta property="og:title" content="[TITLE]">
  <meta property="og:description" content="[DESCRIPTION]">
  <meta property="og:url" content="https://{{DOMAIN}}/blog/[SLUG].html">
  <meta property="og:type" content="article">
  <meta property="og:image" content="https://{{DOMAIN}}/assets/images/blog/[IMAGE].webp">
  <meta name="twitter:card" content="summary_large_image">
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
  <link rel="icon" type="image/x-icon" href="/assets/favicon.ico">
  <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png">
  <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png">
  <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png">
  <meta name="theme-color" content="#0F2A44">
</head>
<body>
  [TOPBAR -- copy from existing post]
  [HEADER -- copy from existing post]
  [MOBILE NAV -- copy from existing post]

  <main>
    <article>
      <header class="article-header">
        <div class="container">
          <div class="breadcrumbs" style="justify-content:center;margin-bottom:var(--space-4);">
            <a href="../">Home</a> <span>/</span> <a href="./">Blog</a> <span>/</span> [Category]
          </div>
          <div class="article-header__meta">[CATEGORY] &bull; Industry Data</div>
          <h1 class="article-header__title">[TOPIC] Statistics: [N]+ Data Points for [YEAR]</h1>
          <div class="article-header__author">
            <span>Published [Date]</span> &bull; <span>[X] min read</span>
          </div>
        </div>
      </header>

      <div class="article-layout">
        <div class="container">
          <div class="article-container article-content">

            <!-- INTRO PARAGRAPH -->
            <p>[Opening paragraph with the most striking headline stat. Set the
              scene for why this data matters. Cite the key sources.]</p>

            <!-- HERO STAT COUNTERS -->
            <div class="stats-hero-grid">
              <div class="stats-hero-card">
                <div class="stats-hero-card__number">[N]</div>
                <div class="stats-hero-card__label">[Label]</div>
              </div>
              <!-- 2-3 more cards -->
            </div>

            <!-- KEY TAKEAWAYS -->
            <div class="key-takeaways">
              <div class="key-takeaways__label">Key Takeaways</div>
              <ul class="key-takeaways__list">
                <li>[Stat 1] (<a href="[URL]" target="_blank" rel="noopener">[Source]</a>)</li>
                <!-- 10-15 total -->
              </ul>
            </div>

            <!-- TABLE OF CONTENTS -->
            <div class="stats-toc">
              <div class="stats-toc__title">Table of Contents</div>
              <ul class="stats-toc__list">
                <li class="stats-toc__item">
                  <a href="#section-1">
                    <span class="stats-toc__number">1</span> [Section Title]
                  </a>
                </li>
                <!-- more items -->
              </ul>
            </div>

            <!-- CONTENT SECTIONS -->
            <section id="section-1">
              <h2><span style="color:var(--{{NICHE}}-blue)">1</span> [Section Title]</h2>
              <p>[Context paragraph]</p>
              <!-- Data table -->
              <!-- HTML/CSS visualization -->
              <!-- Stat callout -->
              <!-- Infographic (if planned for this section) -->
              <p>[Interpretation paragraph]</p>
            </section>

            <!-- CONTENT_PART2 marker for fragmentation -->

          </div>
        </div>
      </div>
    </article>
  </main>

  [FOOTER -- copy from existing post]
  [SCRIPTS -- main.js, animations.js, footer-year]
</body>
</html>
```

---

## Checklist: Complete Statistics Blog Production

```
[ ] Phase 1: Deep Data Research
    [ ] 12-18 primary SERP searches run
    [ ] 8-12 competitor statistics posts scraped and analyzed
    [ ] 15-25 primary source searches run
    [ ] 10-20 primary source pages scraped
    [ ] 10-15 lateral/depth searches run
    [ ] 8-15 additional source pages scraped
    [ ] 50+ verified statistics with sources collected
    [ ] 15+ unique primary sources identified
    [ ] Every stat has: value, source name, source URL, year
    [ ] At least 7 stats that competitors do not include
    [ ] Data sets identified for 5+ infographics
    [ ] Data sets identified for 8+ HTML/CSS visualizations

[ ] Phase 2: Data Architecture
    [ ] Statistics organized into 8-15 thematic sections
    [ ] 3-4 hero stat counters selected
    [ ] 13-19 key takeaways selected
    [ ] Primary + secondary keywords defined
    [ ] 5+ infographics planned with types and data
    [ ] HTML/CSS visualization planned for each section
    [ ] Section outline built from research

[ ] Phase 3: Assets
    [ ] 5+ infographics generated (all in parallel)
    [ ] Infographic QA passed (no AI metadata, watermarks, garbled text)
    [ ] Failed infographics regenerated
    [ ] Clean images copied to assets/images/blog/

[ ] Phase 4: Writing (fragmented to avoid 64K token limit)
    [ ] CSS components added to blog.css (stats-hero, key-takeaways,
        stat-callout, css-bar-chart, css-timeline, css-donut-chart,
        yoy-compare, stats-toc, methodology)
    [ ] HTML skeleton created (head + nav + hero + takeaways + TOC + sections 1-3)
    [ ] Middle sections inserted via CONTENT_PART2 marker
    [ ] Later sections inserted via CONTENT_PART3 marker
    [ ] Final sections + summary table + methodology + FAQ inserted
    [ ] Scripts + schema JSON-LD added before </body>
    [ ] Internal links added where natural (via link-registry.json)
    [ ] EVERY statistic links to its source (external links)
    [ ] Related Posts section with 3 sibling articles
    [ ] Bottom CTA box

[ ] Phase 5: Integration
    [ ] Blog card added to blog/index.html (newest first)
    [ ] sitemap.xml updated with new URL
    [ ] link-registry.json updated with new entry

[ ] Phase 6: QA
    [ ] Browser visual test passed
    [ ] Hero stat counters display correctly
    [ ] Key takeaways box renders
    [ ] Table of contents links work
    [ ] All data tables render properly
    [ ] All HTML/CSS visualizations display (bar charts, donut, timeline)
    [ ] All infographic images load
    [ ] Stat callout boxes render
    [ ] FAQ accordion works
    [ ] Methodology section and summary table present
    [ ] SEO meta tags verified
    [ ] Data accuracy spot-checked (5-10 random stats verified)
    [ ] All source URLs are live (not 404)
    [ ] Convert PNG to WebP, backup originals to archive folder
```

