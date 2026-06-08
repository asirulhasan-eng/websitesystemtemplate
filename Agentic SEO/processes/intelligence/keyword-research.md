---
id: keyword-research
name: Keyword Research & Discovery
version: 1
type: intelligence_module
cadence: weekly (Tuesday mornings)
trigger: scheduled
---

# Keyword Research & Discovery

## Purpose
Expand the money-keyword registry by mining Serper related searches, People Also Ask, and seed permutations. Surfaces money keywords with thin/zero current GSC presence BEFORE they show meaningful volume. This is the supply-side complement to GSC-based demand analysis.

## Data Gathering

### Step 1: Load Current Registry
```bash
v2 keyword list --json --db $DB
```
Note the current head terms and clusters. Identify gaps in coverage.

### Step 2: SERP Mining (for each registry head term, up to 15)
For each high-priority head term in the registry:
```bash
v2 serp-check --keywords "<head_term>" --include-paa --include-features --json --db $DB
```
Extract from each SERP response:
- `relatedSearches` â€” Google's related search suggestions
- `peopleAlsoAsk` â€” PAA questions and their implied keywords
- `organic` results â€” competitor page titles (for keyword extraction)

### Step 3: Seed Permutation Mining
Generate permutations from the Bucket-1 taxonomy:
- Pattern: "[{{NICHE}}|{{AUDIENCE}}|{{AUDIENCE}}] [seo|marketing|website|online] [service|services|audit|cost|pricing|agency|company|packages|near me]"
- Location variants: "[Dallas|Fort Worth|DFW] {{AUDIENCE}} seo"
- Problem-aware: "{{AUDIENCE}} [needs more customers|not getting calls|website not ranking|no leads]"

For the highest-potential permutations (up to 10), run:
```bash
v2 serp-check --keywords "<permutation>" --include-paa --json --db $DB
```

### Step 4: Cross-Reference with GSC
Check if discovered keywords already have GSC impressions:
```bash
v2 gsc-fetch --days 90 --query-contains "<candidate>" --json --db $DB
```

## AI Analysis

For each unique candidate keyword discovered:

### Scoring Criteria
1. **Commercial Intent (0-1):** Would the searcher become a paying client of an SEO agency serving {{AUDIENCE}}? Score 1.0 for "{{NICHE}} seo pricing", 0.3 for "what is seo for {{AUDIENCE}}".
2. **Service-Line Fit (0-1):** Does this align with {{DOMAIN}}'s actual services (SEO, website optimization, content, local SEO for {{AUDIENCE}})? Score 0.1 for "{{NICHE}} supplies wholesale".
3. **Novelty (0-1):** Is this keyword NOT already in the registry? Score 1.0 if absent, 0.0 if present.
4. **Composite Score** = commercial_intent Ã— 0.4 + service_fit Ã— 0.3 + novelty Ã— 0.3

### Auto-Promote Rules
- Score â‰¥ 0.8 â†’ `auto_promote: true` (planner should add to registry)
- Score 0.6â€“0.79 â†’ `auto_promote: false` (candidate for review)
- Score < 0.6 â†’ exclude from report

### Classification
For each candidate, determine:
- `suggested_cluster`: group with existing cluster or propose new
- `suggested_intent_tier`: money | authority | info
- `suggested_page_type`: service | blog

## Report Output

Save report via:
```bash
v2 intelligence report --module keyword-research --session $SESSION --headline "<summary>" --severity <level> --report-json '<json>' --db $DB
```

Report JSON structure:
```json
{
  "candidates": [
    {
      "keyword": "{{AUDIENCE}} google ads vs seo",
      "source": "serper_related",
      "seed_keyword": "seo for {{AUDIENCE}}",
      "composite_score": 0.82,
      "commercial_intent": 0.9,
      "service_fit": 0.8,
      "novelty": 1.0,
      "suggested_cluster": "comparison",
      "suggested_intent_tier": "money",
      "suggested_page_type": "blog",
      "auto_promote": true,
      "gsc_impressions_90d": 0,
      "evidence": "Found in relatedSearches for 'seo for {{AUDIENCE}}'"
    }
  ],
  "sources_mined": {
    "head_terms_checked": 12,
    "serp_responses": 22,
    "related_searches_found": 84,
    "paa_questions_found": 48,
    "permutations_checked": 10
  },
  "coverage": {
    "scanned_count": 142,
    "surfaced_top": 8,
    "floor_applied": "composite_score >= 0.6",
    "deprioritized_reason": "134 candidates below score threshold or already in registry"
  },
  "observations": [
    "Strong cluster of comparison keywords (X vs Y) not currently tracked",
    "Multiple PAA questions suggest content opportunity for FAQ-style service pages"
  ],
  "recommendations": [
    {
      "action": "Auto-add 3 high-confidence keywords to registry via keyword-track",
      "priority": "high",
      "evidence": "Composite scores 0.8+ with commercial intent"
    }
  ]
}
```

## Severity Rules
- **normal**: Routine discovery, few or no high-confidence candidates
- **warning**: 5+ auto-promote candidates found â€” significant registry expansion needed
- **critical**: Discovered a competitor ranking for a high-value keyword we don't track

## Key Rules
- This module is **REPORT-ONLY**. It does NOT add keywords to the registry directly.
- The daily planner reads this report and runs `v2 keyword track --add` for auto-promote candidates.
- Limit Serper API calls to 25 per run to control costs.
- Never report homeowner/DIY queries (Bucket 4 noise).
