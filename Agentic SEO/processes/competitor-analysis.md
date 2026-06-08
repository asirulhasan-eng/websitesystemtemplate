---
id: competitor-analysis
name: "Competitor Analysis"
version: 1
description: "Analyze competitor movements and identify strategic opportunities based on SERP landscape changes."
trigger:
  schedule: "manual"
  can_run_manually: true
  conditions:
    - "Triggered by daily scan detecting new competitors, or on monthly cadence, or on request"
guardrails:
  max_tasks_created: 10
  max_risk_level: semi_safe
  max_duration_minutes: 30
email_on_complete:
  enabled: false
---

# Competitor Analysis Process

> Understand who we're competing against, what they're doing, and where the gaps are.
> This drives strategic content and optimization decisions.

## When to Use

- Monthly strategic review (part of monthly-roadmap process)
- When a new competitor appears in top 10 for money keywords
- When we lose position to a specific competitor
- When planning new content or service pages
- When evaluating whether to expand into new keyword territories

---

## Step 1: Identify Competitors

```bash
# Check who's ranking for our money keywords
v2 serp-check --keywords "{{NICHE}} seo,seo for {{AUDIENCE}},{{AUDIENCE}} seo services,local seo for {{AUDIENCE}},{{NICHE}} seo agency,{{AUDIENCE}} marketing" --top 20 --include-features --json

# Get historical SERP data to see who's been consistently ranking
v2 serp-history --keyword "{{NICHE}} seo" --days 90 --competitors --json
v2 serp-history --keyword "seo for {{AUDIENCE}}" --days 90 --competitors --json
```

### AI Analysis â€” Competitor Identification

From the SERP data, categorize competitors:

#### Direct Competitors (SEO agencies targeting {{AUDIENCE}})
- Agencies specifically offering {{NICHE}} SEO services
- Look for: domain names, service page titles, landing page focus

#### Indirect Competitors (General SEO with {{AUDIENCE}} content)
- Large SEO agencies with a {{AUDIENCE}}-specific landing page
- Marketing platforms with {{AUDIENCE}}-focused content (ServiceTitan, Housecall Pro)
- Industry publications covering {{NICHE}} business marketing

#### Content Competitors (Ranking for informational queries)
- Blog sites, forums, directories ranking for "how to" queries
- These aren't business competitors but compete for SERP real estate

**Focus analysis on Direct and Indirect competitors. Content competitors are only relevant if they're taking featured snippet positions.**

---

## Step 2: Analyze Top Competitors

For each direct competitor (top 3-5):

```bash
# What keywords are THEY ranking for that we might be missing?
v2 serp-check --keywords "<competitor-keywords-we-dont-target>" --domain {{DOMAIN}} --json

# How does our ranking compare for shared keywords?
v2 gsc-history --days 28 --json  # Our performance
```

### AI Analysis â€” Competitive Gap Assessment

For each competitor, assess:

1. **Content breadth**: Do they cover topics we don't?
   - Do they have a page for "{{AUDIENCE}} Google Business Profile optimization" when we don't?
   - Do they have case studies, pricing pages, process pages we lack?

2. **Content depth**: Is their content more comprehensive?
   - Compare word counts, topic coverage, supporting content
   - Do they have better FAQ sections? More detailed guides?

3. **Technical advantages**: Better technical SEO?
   - Schema markup we're missing?
   - Better internal linking structure?
   - Faster page load? Better mobile experience?

4. **Content freshness**: Is their content more recently updated?
   - Outdated content loses rankings over time

5. **Unique value**: What do they offer that we don't?
   - Free tools? Templates? Calculators?
   - Case studies with real results?
   - Industry-specific content (specific {{NICHE}} services)?

---

## Step 3: Identify Opportunities

### AI Analysis â€” Strategic Opportunities

Based on the competitive gap, identify:

#### Content Gaps (Topics they cover, we don't)
- List specific topics/keywords with estimated search volume
- Prioritize by business value (would this attract paying {{NICHE}} company clients?)

#### Competitive Weaknesses (Where we can outperform)
- Topics where competitors have thin content
- Keywords where competitor content is outdated
- SERPs with no featured snippet that we could capture

#### Defensive Priorities (Where we're losing ground)
- Keywords where competitors are improving and we're declining
- New competitor content that's threatening our positions

---

## Step 4: Create Strategic Tasks

#### For content gaps:
```bash
v2 task create --title "Content gap: Create page for '<topic>' (competitor has one, we don't)" \
  --type new_content --priority 750 --risk-level semi_safe \
  --target-keyword "<keyword>" \
  --description "Competitive analysis: [Competitor X] ranks position [N] for '<keyword>' with a [page type]. We have no dedicated content. Estimated monthly search volume: [est]. Business value: [high/medium/low]." \
  --evidence '{"competitor": "competitor.com", "competitor_position": N, "our_position": null}' \
  --json
```

#### For competitive weaknesses:
```bash
v2 task create --title "Outperform competitor: Improve '<keyword>' page vs [competitor]" \
  --type content_optimization --priority 800 --risk-level semi_safe \
  --target-url "https://{{DOMAIN}}/services/<page>" \
  --target-keyword "<keyword>" \
  --description "Competitor [X] has thin/outdated content at position [N]. Our page at position [M] can surpass them with: [specific improvements]." \
  --json
```

#### For defensive priorities:
```bash
v2 task create --title "DEFEND: '<keyword>' â€” competitor [X] closing gap" \
  --type content_optimization --priority 900 --risk-level semi_safe \
  --target-keyword "<keyword>" \
  --description "Competitor [X] has moved from position [old] to [new] for '<keyword>' over the last [N] days. Our position: [current]. Defensive actions needed: [specific actions]." \
  --json
```

---

## Step 5: Document Findings

```bash
v2 report format --template custom --data '{
  "report_type": "competitor_analysis",
  "date": "YYYY-MM-DD",
  "competitors_analyzed": N,
  "content_gaps_found": N,
  "opportunities_identified": N,
  "tasks_created": N,
  "key_findings": [
    "Finding 1",
    "Finding 2"
  ],
  "strategic_recommendations": [
    "Recommendation 1",
    "Recommendation 2"
  ]
}' --json
```

---

## Key Principles for {{SITE_NAME}} Competitive Analysis

1. **We're niche, that's our advantage.** General SEO agencies targeting {{AUDIENCE}} are spread thin. We can go deeper.
2. **Quality over breadth.** Better to have 5 comprehensive service pages than 20 thin ones.
3. **Real {{NICHE}} SEO expertise signals.** Case studies, specific examples, {{NICHE}}-industry terminology demonstrate authenticity.
4. **Local SEO content is high-value.** {{NICHE}} is local. Content about local SEO for {{AUDIENCE}} is directly relevant and commercially valuable.
5. **Don't chase informational content competitors.** A blog post ranking #3 for "how to fix a leaky faucet" is irrelevant â€” we want {{NICHE}} BUSINESS OWNERS, not homeowners.
