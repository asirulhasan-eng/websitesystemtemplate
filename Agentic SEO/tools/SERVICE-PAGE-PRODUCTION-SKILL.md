# Service Page Production Skill
Repeatable process for conversion-focused service pages. Proven on: *[Your first service page]* Last updated: 2026-06-04.
## Contents
1. Overview & Conversion Rules
2. Phase 1 â€” Research
3. Phase 2 â€” Planning
4. Phase 3 â€” Assets
5. **Voice Guide** â† applies during writing only
6. Phase 4 â€” Writing
7. Phase 4b â€” Linking
8. Phase 5 â€” Integration
9. Phase 6 â€” QA
10. Constraints
11. Parallel Agent Strategy
12. Templates & Checklist
---
## 1. Overview
Service pages must be:
- **Conversion-focused** â€” every element moves the visitor from awareness to call/quote/contact
- **Benefit-heavy** â€” speak to owner pain; explain what you solve, not what you do
- **Trust-building** â€” testimonials, case studies, credentials, guarantees where applicable
- **Scannable** â€” H2/H3 hierarchy, short paragraphs, benefit cards, visual breaks
- **Action-oriented** â€” multiple CTAs (top, middle, bottom), clear next steps
- **Competitive** â€” show why you vs. generic service providers or DIY
- **Schema-rich** â€” Service schema, LocalBusiness, FAQPage, BreadcrumbList
### Project Structure
```
{{NICHE}} website 2/
â”œâ”€â”€ pages/
â”‚   â”œâ”€â”€ index.html                           â† Add new card here
â”‚   â”œâ”€â”€ drain-cleaning.html                  â† Reference service page
â”‚   â””â”€â”€ [new-service].html                   â† New service page
â”œâ”€â”€ css/
â”‚   â”œâ”€â”€ main.css        â† DO NOT modify
â”‚   â”œâ”€â”€ pages.css       â† Extend here
â”‚   â””â”€â”€ blog.css
â”œâ”€â”€ assets/images/services/                  â† Hero images, benefit icons, testimonial photos
â”œâ”€â”€ tools/
â”‚   â”œâ”€â”€ scaffold-service.ps1                 â† â˜… STEP 1: Run this FIRST
â”‚   â”œâ”€â”€ serper-search.ps1
â”‚   â”œâ”€â”€ serper-scrape.ps1
â”‚   â”œâ”€â”€ keywords.txt
â”‚   â””â”€â”€ link-registry.json
â”œâ”€â”€ js/{main.js, animations.js}
â””â”€â”€ sitemap.xml
```
## 2. Phase 1 â€” Research (NO code yet)
> **HARD RULE: DO NOT scaffold, create files, or write content until Phases 1â€“3 (Research, Planning, Assets) are fully complete.** The scaffold script runs at the START of Phase 4, not before. If the HTML file does not exist yet, you cannot skip research.
> **RESEARCH TOOLS: Use ONLY the serper PowerShell scripts.** `serper-search.ps1` for searches, `serper-scrape.ps1` for scraping. Do NOT use built-in AI tools (`search_web`, `read_url_content`, `browser_subagent`) for research.
### 1.1 Competitive Service Analysis (5â€“8 searches)
```powershell
cd "c:\Users\Administrator\Documents\{{NICHE}} website 2\tools"
.\serper-search.ps1 -Query "[service] {{AUDIENCE}} near me" -Mode all -Num 10
.\serper-search.ps1 -Query "[service] cost {{NICHE}}" -Mode all -Num 10
.\serper-search.ps1 -Query "[service] how much does [service] cost" -Mode paa -Num 10
.\serper-search.ps1 -Query "[city] [service] {{AUDIENCE}}" -Mode all -Num 10
.\serper-search.ps1 -Query "[service] emergency {{AUDIENCE}}" -Mode all -Num 10
```
Extract: top 5 local competitors (Google Maps + organic), PAA questions (â†’ FAQ), pricing signals, service descriptions, unique selling angles.
### 1.2 Competitor Scraping (top 4â€“6 local + national)
```powershell
.\serper-scrape.ps1 -Url "https://competitor-website.com/services/[service]" -Mode text
```
Analyze: 
- Service description (what problem does it solve?)
- Pricing transparency (do they show prices? ranges?)
- Process/timeline (how long? steps?)
- Guarantees/warranties (what's promised?)
- CTAs (where/how to contact?)
- Testimonials/trust signals
- Comparison to other services
- Pain points addressed
### 1.3 Reddit + Community Research (MANDATORY)
Goal: real owner fears, DIY failures, why professionals matter, common mistakes.
```powershell
.\serper-search.ps1 -Query "site:reddit.com [SERVICE] {{AUDIENCE}} cost" -Mode organic -Num 10
.\serper-search.ps1 -Query "site:reddit.com [SERVICE] failed DIY" -Mode organic -Num 10
.\serper-search.ps1 -Query "site:reddit.com [SERVICE] help" -Mode organic -Num 10
.\serper-search.ps1 -Query "site:reddit.com [SERVICE] expensive" -Mode organic -Num 10
```
Scrape best 3â€“5 threads:
```powershell
.\serper-scrape.ps1 -Url "https://www.reddit.com/r/HomeImprovement/comments/..." -Mode text
```
**Extract:** 
- What homeowners worry about (cost, quality, scams)
- DIY horror stories (why professional service matters)
- Questions about timing, urgency, preventive value
- Budget concerns and willingness to pay
- Red flags homeowners mention
### 1.4 Lateral Research (Optional but Valuable)
```powershell
.\serper-search.ps1 -Query "[SERVICE] industry standards 2026" -Mode organic -Num 10
.\serper-search.ps1 -Query "[SERVICE] best practices homeowner" -Mode organic -Num 10
.\serper-search.ps1 -Query "[SERVICE] warranty guarantees standards" -Mode organic -Num 10
```
**Extract:** best practices, warranty/guarantee standards, what "professional" means, cost benchmarks.
### 1.5 Identify Visual & Social Proof Opportunities
- Case study/before-after photos (if applicable)
- Customer testimonials/review sources
- Pricing table competitors use
- Service comparison frameworks
- Step-by-step process visuals
- Guarantee/warranty offerings
> **CHECKPOINT before Phase 2:**
> - 4â€“5 local competitors analyzed
> - 3â€“5 threads showing owner pain + DIY failures
> - 5+ unique owner fears/questions identified
> - 3â€“4 pricing signals (ranges, guarantees, promises)
> - Unique value angle vs. local competitors
---
## 3. Phase 2 â€” Planning
### 2.1 Build Unique Service Page Outline
**NOT a template fill.** Derive from research:
1. **Study competitor pages** â€” what sections do all share? What do they avoid?
2. **Map buyer's journey** â€” awareness (what's the problem?) â†’ consideration (why you?) â†’ decision (proof, cost, timing) â†’ action (how to contact)
3. **Find your angle** â€” what do you offer that locals don't? (warranty, speed, pricing transparency, expertise, guarantee)
**Fixed elements:**
```
ALWAYS:
  - Hero section (headline, problem statement, CTA)
  - What problem does this solve? (owner-focused, not task-focused)
  - How it works (3â€“5 clear steps)
  - Why us? (2â€“3 competitive advantages)
  - Pricing or cost expectations (transparency builds trust)
  - FAQ section (from research, schema-ready)
  - Customer reviews/testimonials (if you have them)
  - Bottom CTA (clear, urgent)
  - Trust signals (years in business, certifications, guarantees)
WHEN RELEVANT:
  - Before/after visuals (if service is visible)
  - Comparison table (this service vs. alternative)
  - Timeline/urgency messaging (emergency? seasonal?)
  - Financing/payment options (if relevant)
  - Service area map (if geographic limits matter)
  - Video walkthrough (if helpful)
  - Checklist (when to call us)
```
### 2.1b Service Angle Formula
1. **Start with the owner's fear** â€” "What happens if I ignore this?" (costs, damage, safety, property loss)
2. **Explain why DIY fails** â€” complexity, mistakes, equipment, time, liability
3. **Show what a professional does** â€” what makes you different from DIY or competitors
4. **Connect to outcomes** â€” fixed problem, peace of mind, safe/working system, time saved, money saved
5. **Make the ask clear** â€” "Call now," "Book a free quote," "Schedule service," with no friction
> **ANGLE CHECK:** Does this page help an owner understand when to call, why to call us, and remove friction to calling?
### 2.2 Keywords
```
Primary:    [service] {{NICHE}} / [service] near me
Secondary:  [service] cost, [service] how much, emergency [service]
Long-tail:  [city] [service], best [service] [city], [service] {{AUDIENCE}}
```
### 2.3 Plan Visual Assets (3â€“5)
```
Asset 1:    [Type] â€” [Content] â€” [Placement]
Asset 2:    [Type] â€” [Content] â€” [Placement]
Asset 3:    [Type] â€” [Content] â€” [Placement]
```
Types: hero image, before/after, process steps, pricing table visual, benefit icons, service area map, testimonial photo.
### 2.4 Testimonials & Social Proof
- Source: (existing reviews? case studies? customer interviews?)
- Format: short quotes (50â€“100 words), attributed, if possible with photo
- Placement: after "How it works" or in a dedicated section before CTA
---
## 4. Phase 3 â€” Asset Generation
### 4.1 Generate Key Visuals (2â€“4)
Use `image_generate` for:
- **Process step visual** â€” (e.g., "Step 1: Inspection â†’ Step 2: Diagnosis â†’ Step 3: Fix â†’ Step 4: Testing")
- **Benefit icons/grid** â€” (e.g., "Fast," "Guaranteed," "Certified," "Available 24/7")
- **Comparison visual** â€” (if comparing this service to DIY or alternative)
- **Before/after mockup** â€” (if service produces visual results)
**Prompt pattern (same as blog):**
```
"Professional service infographic for {{NICHE}} companies.
Dark navy background (#0F2A44).
[Describe structure, data, labels, hierarchy].
Clean sans-serif, subtle grid, professional style.
Bottom: '{{SITE_NAME}}.agency'.
No watermarks, no AI text, no metadata."
```
### 4.2 Deploy Images
```powershell
New-Item -ItemType Directory -Path "assets\images\services" -Force
Copy-Item "[source-path]" "assets\images\services\[descriptive-name].webp"
```
### 4.3 Gather Testimonials
If no existing testimonials: placeholder text only. Never invent customer quotes.
---
## 5. Service Page Voice Guide
> **APPLY DURING PHASE 4 ONLY.**
Write as a tradesman-turned-owner speaking to another homeowner who needs this service. You understand the fear (cost, quality, timing), the frustration (having to call a stranger), and the trust issue (will they overcharge? do good work? show up?).
**Voice pillars:**
1. **Reassuring.** Homeowners are nervous. Answer their unspoken questions: "Will this fix it?" "How much?" "Will it hold?" "Can you do it soon?"
2. **Transparent.** Explain pricing, timeline, process plainly. Don't hide costs. Say "this typically costs X" even if you quote per-job.
3. **Service-focused.** Lead with the outcome (problem solved, peace of mind, safety) not the task (we'll inspect your pipes).
4. **Owner-aware.** Most homeowners know nothing about the trade. Explain without condescension. Assume they're smart but uninformed.
Use language like:
peace of mind, solid work, we stand behind it, we'll take care of you, properly done, no surprises, inspect everything, guarantee it, available when you need us, fast turnaround, certified team, trust matters.
Avoid language like:
premium solutions, cutting-edge technology, transformative experience, maximized efficiency, professional-grade infrastructure, revolutionary approach, expert ecosystem.
**Opening hook:**
Start with the problem OR the fear. "Your main line is backing up" or "You're worried about that wet spot in the basement." Make the homeowner feel seen.
**Price transparency:**
If you don't list prices, explain why: "Every job is unique â€” we'll assess and quote fairly." This is better than silence.
**Urgency without pressure:**
Use urgency when real: "If water damage spreads, costs triple" or "Mold grows fast." Don't fake urgency for routine service.
**Trust signals:**
"We've been serving this area for X years." "We're certified by [org]." "We guarantee our work for [period]." "We show up when we say."
**Before writing, check:**
1. Does the opening speak to the owner's fear/need, not our service?
2. Is pricing or cost expectation addressed?
3. Is there a clear "when to call" trigger?
4. Is the timeline/urgency honest?
5. Does it feel like a local expert talking to a neighbor, not a marketing agency?
### SEO Meta & Branding Rules
> **CONTENT-FIRST PRINCIPLE:** Titles, meta descriptions must be 100% content-driven. NO brand names in titles/descriptions.
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
| Schema `provider` | â€” | **YES** â†’ `{{SITE_NAME}}.agency` |
**Examples:**
```
âœ… "Drain Cleaning Services in [City] | Fast, Guaranteed"
âŒ "Drain Cleaning Services | {{SITE_NAME}}.agency"
âœ… "We unclog drains fast, guarantee the fix, and charge fair prices."
âŒ "{{SITE_NAME}}.agency offers professional drain cleaning."
```
---
## 6. Phase 4 â€” Writing the HTML
### STEP 1: Scaffold (MANDATORY â€” run AFTER research, planning, and assets)
```powershell
cd tools
.\scaffold-service.ps1 -Title "Service Title" -ServiceName "[Service Name]" -Description "Meta description."
```
This generates a complete, validated HTML file with:
- Full `<head>` (GA tag, meta, OG, Twitter, Service schema, LocalBusiness schema, BreadcrumbList)
- Topbar + Header + Mobile Nav (cloned from `drain-cleaning.html`)
- Hero section with headline, subheading, CTA button
- Service overview, how it works, why choose us sections with placeholders
- Pricing/expectations section
- FAQ accordion
- Testimonials placeholder
- Bottom CTA
- Footer + scripts
- 25-point validation check
**Script parameters:**
| Param | Required | Default |
|---|---|---|
| `-Title` | Yes | â€” |
| `-ServiceName` | Yes | â€” |
| `-Slug` | No | Auto from title |
| `-Category` | No | `"Service"` |
| `-Description` | No | Placeholder |
| `-SourcePost` | No | `drain-cleaning.html` |
| `-Date` | No | Today |
**Output:** `pages/[slug].html` (280 lines, all boilerplate done).
### STEP 2: Content Injection
Use `replace_file_content` to inject content at markers:
**4.1 Hero section** (hero copy, problem statement, CTA button text)
**4.2 Service overview** (`OVERVIEW_MARKER`):
- What is this service? (in 2â€“3 sentences)
- What problem does it solve?
**4.3 How it works** (`HOWITWORKS_MARKER`):
- 3â€“5 clear steps
- Brief explanation of each
**4.4 Why us?** (`WHYUS_MARKER`):
- 3â€“4 competitive advantages
- Proof or explanation for each
**4.5 Pricing/expectations** (`PRICING_MARKER`):
- Cost range or "why we quote custom"
- Timeline
- Guarantees/warranty
**4.6 Checklist** (`CHECKLIST_MARKER` â€” optional):
- "When to call a professional" checklist
**4.7 FAQ** (`FAQ_MARKER`):
- 5â€“8 FAQ items with accordion HTML
**4.8 Testimonials** (`TESTIMONIALS_MARKER`):
- 2â€“3 customer quotes (if available)
**4.9 Bottom CTA** (`CTA_MARKER`):
- Headline + button text
**4.10 Service Schema** (`SERVICESCHEMA_MARKER`):
- Service JSON-LD
**4.11 FAQ Schema** (`FAQSCHEMA_MARKER`):
- FAQPage JSON-LD
### 4.5 CSS Additions
Append new component styles to `css/pages.css` via `replace_file_content`. **Do not modify main.css.**
**Existing components:**
```
.hero-section             â€” Full-width hero with background
.service-overview         â€” Problem statement box
.how-it-works             â€” Step-by-step process (3â€“5 columns)
.why-us                   â€” Benefit cards (3â€“4 grid)
.pricing-section          â€” Cost/timeline box
.checklist                â€” "When to call" bullet list
.testimonial-grid         â€” Customer quote cards
.benefit-card             â€” Individual benefit icon + text
.step-card                â€” Individual process step
.faq-section / accordion  â€” Expandable FAQ items
.cta-box                  â€” Call-to-action box
```
---
## 7. Phase 4b â€” Internal & External Linking
### 4b.1 Internal Linking
Link naturally to sibling services and blog posts that add context.
**Rules:**
- Max 1â€“2 links per service page (less is more for service pages)
- Only link when genuinely relevant
- Examples: "Preventive maintenance" â†’ link to blog post on why maintenance matters; "Leaks" â†’ link to related emergency service
### 4b.2 External Authority Linking
Link where you cite sources, tools, or external info.
**Rule:** If you reference a certification, tool, or external standard, link to it.
### 4b.3 Sibling Service Links (Optional)
If service pages naturally cross-reference (e.g., drain cleaning â†’ water heater), add a "Related Services" section.
---
## 8. Phase 5 â€” Site Integration
### 5.1 Add Service Card to Services Index
Edit `pages/index.html` â€” insert new card in the services grid:
```html
<div class="service-card reveal">
  <div class="service-card__icon" style="background:linear-gradient(...);">
    <svg>...</svg>
  </div>
  <h2 class="service-card__title">
    <a href="/pages/[slug]">[Service Name]</a>
  </h2>
  <p class="service-card__description">[1â€“2 sentence benefit]</p>
  <a href="/pages/[slug]" class="service-card__link">Learn More ...</a>
</div>
```
### 5.2 Update Sitemap
```xml
<url>
  <loc>https://{{DOMAIN}}/pages/[slug]</loc>
  <lastmod>[YYYY-MM-DD]</lastmod>
  <changefreq>monthly</changefreq>
  <priority>0.7</priority>
</url>
```
### 5.3 Update Link Registry
Append to `internal.services` array in `tools/link-registry.json`:
```json
{
  "slug": "/pages/[new-service-slug]",
  "title": "[Service Name]",
  "topics": ["keyword1", "keyword2"],
  "anchors": ["suggested anchor"]
}
```
---
## 9. Phase 6 â€” QA & Verification
### 9.1 Service Page Checklist
- [ ] `<title>` primary keyword + benefit, content-focused, NO brand, â‰¤ 60 chars
- [ ] `<meta description>` compelling, benefit-focused, NO brand, â‰¤ 155 chars
- [ ] `<h1>` clear problem statement or service name (NOT brand)
- [ ] `<link rel="canonical">` set
- [ ] OG tags present (title, description, image, url, type)
- [ ] Twitter Card tags present
- [ ] Service schema JSON-LD valid
- [ ] FAQPage schema has all questions (if FAQ present)
- [ ] LocalBusiness schema includes address, phone, service area
- [ ] Single `<h1>`
- [ ] H2/H3 hierarchy logical
- [ ] Descriptive alt text on images
- [ ] Internal links work and are contextual
- [ ] External links cite sources (target="_blank" rel="noopener")
- [ ] Pricing or cost expectation addressed (or explained why custom)
- [ ] Warranty/guarantee mentioned (if applicable)
- [ ] CTA buttons functional and clear
- [ ] Hero section compelling and problem-focused
- [ ] Footer markup matches source post
- [ ] FAQ uses `.faq-question` buttons
- [ ] Page added to sitemap
- [ ] Page added to link-registry.json
- [ ] Service card added to pages/index.html
- [ ] Local render checked with HTTP 200
- [ ] Hero image optimized to WebP
---
## 10. Critical Constraints & Workarounds
### âš ï¸ GOLDEN RULE: Save as .html, NEVER link as .html
Files on disk: `[slug].html`. **All `href`, canonical, og:url, sitemap, and JSON use clean URLs WITHOUT `.html`.**
| Context | âœ… Correct | âŒ Wrong |
|---|---|---|
| `href` in `<a>` | `/pages/my-service` | `/pages/my-service.html` |
| `<link rel="canonical">` | `https://{{DOMAIN}}/pages/my-service` | `...my-service.html` |
| `og:url` | `https://{{DOMAIN}}/pages/my-service` | `...my-service.html` |
| Sitemap `<loc>` | `https://{{DOMAIN}}/pages/my-service` | `...my-service.html` |
### No Em Dashes in Copy
Never use em dash (â€”) in service page body text.
### Token Limit (50K output)
Service page HTML + metadata may exceed. **Solution:** fragment into 3â€“5 `replace_file_content` calls using marker comments.
### File Size
Keep CSS in pages.css, not inline.
### Research Tool Enforcement
**ALL research must use the serper PowerShell scripts.** Do NOT use built-in AI tools (`search_web`, `read_url_content`) for competitive research.
---
## 11. Parallel Agent Strategy
| Stage | Parallel calls | Saved |
|---|---|---|
| SERP research | 4â€“5 searches at once | ~20s |
| Competitor scraping | 3â€“4 scrapes at once | ~15s |
| Image generation | 2â€“3 images at once | ~20s |
| File I/O | CSS + sitemap + index edits | ~5s |
**Maximum-Parallelism Sequence:**
```
Turn 1 â€” Research (all parallel):
  â”œ serper-search (service + location)
  â”œ serper-search (cost/pricing)
  â”œ serper-search (FAQ/PAA)
  â”œ serper-search (site:reddit.com [service] help)
  â”” list_dir (services structure)
Turn 2 â€” Scraping (all parallel):
  â”œ serper-scrape Ã— 4â€“6 competitor service pages
  â”œ serper-scrape Ã— 3â€“5 Reddit threads
  â”” serper-scrape (industry guide/data)
  â”€â”€ CHECKPOINT: 4â€“5 competitors analyzed, 3+ pain points identified â”€â”€
  â”€â”€ Planning: outline, keywords, visual assets (Phase 2) â”€â”€
Turn 3 â€” Image generation (all parallel):
  â”” image_generate Ã— 2â€“4 visuals
Turn 4 â€” Image QA:
  â”œ view_file each image
  â”” regenerate any with metadata
Turn 5 â€” CSS + image deploy (parallel):
  â”œ replace_file_content (pages.css)
  â”” run_command (copy images)
Turn 6 â€” Scaffold (NOW â€” after research):
  â”” run_command: scaffold-service.ps1 -Title "..." -ServiceName "..." -Description "..."
Turns 7â€“10 â€” Content injection (SEQUENTIAL per marker):
   7. replace_file_content (overview + how it works)
   8. replace_file_content (why us + pricing)
   9. replace_file_content (FAQ + testimonials)
  10. replace_file_content (CTA + schemas)
Turn 11 â€” Integration (parallel):
  â”œ replace_file_content (pages/index.html â€” new card)
  â”œ replace_file_content (sitemap.xml)
  â”” replace_file_content (link-registry.json)
```
**Total: ~11 turns vs ~20+ sequential.**
---
## 12. Master Checklist
```
[ ] Phase 1: Research
    [ ] 4â€“5 primary SERP queries
    [ ] 4â€“6 competitor service pages scraped
    [ ] 3â€“5 Reddit threads analyzed (DIY fails, fears)
    [ ] Lateral research (industry standards, warranty norms)
    [ ] â‰¥3â€“5 pain points / objections identified
    [ ] Pricing signals collected
    [ ] PAA questions collected (â†’ FAQ)
    [ ] Visual assets planned (hero, process, benefit icons)
[ ] Phase 2: Planning
    [ ] Unique outline built from research
    [ ] Keywords defined (primary, secondary)
    [ ] 2â€“4 visual assets planned
    [ ] Competitive angle identified
    [ ] Service angle formula applied
[ ] Phase 3: Assets
    [ ] Key visuals generated (2â€“4, parallel)
    [ ] Infographic QA passed (no metadata)
    [ ] Images deployed to assets/images/services/
    [ ] Testimonials sourced (or placeholder marked)
[ ] Phase 4: Writing (fragmented)
    [ ] Scaffold generated with hero + sections
    [ ] Overview + "How It Works" injected
    [ ] "Why Us" + pricing injected
    [ ] FAQ + testimonials + CTA injected
    [ ] Service schema + FAQ schema added
    [ ] CSS components verified in pages.css
[ ] Phase 5: Integration
    [ ] Service card added to pages/index.html
    [ ] sitemap.xml updated
    [ ] link-registry.json updated
[ ] Phase 6: QA
    [ ] All images load
    [ ] CTAs functional
    [ ] SEO meta verified
    [ ] All links work
    [ ] Schema valid (Service + LocalBusiness + FAQ)
    [ ] Responsive on mobile
    [ ] Footer matches source
```

---
## 13. Service Page Template Skeleton
```html
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>[SERVICE â€” NO brand] | Cost, Guarantee</title>
  <meta name="description" content="[BENEFIT-FOCUSED â‰¤ 155 â€” NO brand]">
  <meta name="robots" content="index, follow">
  <link rel="canonical" href="https://{{DOMAIN}}/pages/[SLUG]">
  <meta property="og:title" content="[SERVICE â€” NO brand]">
  <meta property="og:description" content="[BENEFIT â‰¤ 200]">
  <meta property="og:url" content="https://{{DOMAIN}}/pages/[SLUG]">
  <meta property="og:type" content="LocalBusiness">
  <meta property="og:site_name" content="{{SITE_NAME}}.agency">
  <meta property="og:image" content="https://{{DOMAIN}}/assets/images/services/[HERO].webp">
  <meta name="twitter:card" content="summary_large_image">
  <meta name="twitter:site" content="@clientagen">
  <meta name="twitter:title" content="[SERVICE â€” NO brand]">
  <meta name="twitter:description" content="[BENEFIT]">
  <meta name="twitter:image" content="https://{{DOMAIN}}/assets/images/services/[HERO].webp">
  <link rel="stylesheet" href="../css/main.css">
  <link rel="stylesheet" href="../css/pages.css">
  <script type="application/ld+json">
  {
    "@context": "https://schema.org",
    "@type": "Service",
    "name": "[SERVICE]",
    "provider": {"@type": "LocalBusiness", "name": "{{SITE_NAME}}.agency"},
    "areaServed": "[CITY/REGION]",
    "availableChannel": {"@type": "ServiceChannel", "serviceUrl": "https://{{DOMAIN}}/pages/[SLUG]"}
  }
  </script>
</head>
<body>
  [TOPBAR â€” copy from drain-cleaning.html]
  [HEADER â€” copy from drain-cleaning.html]
  [MOBILE NAV â€” copy from drain-cleaning.html]
  <main>
    <article>
      <!-- HERO SECTION -->
      <section class="hero-section" style="background:linear-gradient(...);">
        <div class="container">
          <div class="breadcrumbs">
            <a href="../">Home</a> <span>/</span> <a href="./">Services</a> <span>/</span> [SERVICE]
          </div>
          <h1>[HEADLINE â€” Problem-Focused]</h1>
          <p class="hero-subheading">[Benefit statement]</p>
          <a href="#contact-cta" class="btn btn-primary">[CTA Button Text]</a>
        </div>
      </section>

      <!-- SERVICE OVERVIEW -->
      <section class="service-overview">
        <div class="container">
          <!-- OVERVIEW_MARKER -->
        </div>
      </section>

      <!-- HOW IT WORKS -->
      <section class="how-it-works">
        <div class="container">
          <h2>How It Works</h2>
          <!-- HOWITWORKS_MARKER -->
        </div>
      </section>

      <!-- WHY US -->
      <section class="why-us">
        <div class="container">
          <h2>Why Choose Us</h2>
          <!-- WHYUS_MARKER -->
        </div>
      </section>

      <!-- PRICING & EXPECTATIONS -->
      <section class="pricing-section">
        <div class="container">
          <h2>Pricing & Timeline</h2>
          <!-- PRICING_MARKER -->
        </div>
      </section>

      <!-- CHECKLIST (Optional) -->
      <section class="checklist-section">
        <div class="container">
          <!-- CHECKLIST_MARKER -->
        </div>
      </section>

      <!-- FAQ -->
      <section class="faq-section">
        <div class="container">
          <h2>FAQ</h2>
          <!-- FAQ_MARKER -->
        </div>
      </section>

      <!-- TESTIMONIALS (Optional) -->
      <section class="testimonial-section">
        <div class="container">
          <h2>What Our Customers Say</h2>
          <!-- TESTIMONIALS_MARKER -->
        </div>
      </section>

      <!-- BOTTOM CTA -->
      <section class="bottom-cta">
        <div class="container">
          <!-- CTA_MARKER -->
        </div>
      </section>
    </article>
  </main>
  [FOOTER â€” copy from drain-cleaning.html]
  <script type="application/ld+json">
  <!-- SERVICESCHEMA_MARKER -->
  </script>
  <script type="application/ld+json">
  <!-- FAQSCHEMA_MARKER -->
  </script>
  [SCRIPTS â€” main.js, animations.js, footer-year]
</body>
</html>
```
---

## Quick Reference: Service Page vs Blog Post
| Aspect | Blog Post | Service Page |
|---|---|---|
| **Length** | 1,500â€“2,500 words | 800â€“1,500 words |
| **Structure** | Narrative, educational | Hierarchical, scannable |
| **CTAs** | 1â€“2 (bottom) | 3+ (hero, middle, bottom) |
| **Research** | SERP + competitors + Reddit + industry | Competitors + Reddit + pricing |
| **Visual** | 3â€“5 infographics | 2â€“4 hero/step/comparison visuals |
| **Schema** | Article + FAQ | Service + LocalBusiness + FAQ |
| **Goal** | Education, trust, ranking | Conversion, qualification, calls |
| **Tone** | Owner-to-owner | Service provider to homeowner |
