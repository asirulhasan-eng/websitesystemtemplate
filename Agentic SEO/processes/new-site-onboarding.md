# New Site Onboarding — Master Playbook

> **Purpose.** This playbook is the ONE process Hermes follows when a new site is
> deployed for the first time. The owner has already:
> 1. Exported their WordPress site via Simply Static into `Website/`
> 2. Created a minimal bootstrap config (`site-bootstrap.json`) with domain, owner name, email, timezone
>    (copy and edit `provision/examples/bootstrap-acme.json` as a starting point)
> 3. Pushed everything to GitHub
> 4. Set up the VPS with API keys in `.env`
> 5. Started Hermes with this skill
>
> **Your job:** Read the website, understand the business, generate the full configuration,
> build keyword strategy, rewrite all niche-specific prose, seed the brain, validate
> everything, and hand off to daily operations.
>
> **Duration:** This is a ONE-TIME process. It should take 1-3 hours depending on site size.
> After completion, the daily workplan cron takes over.
>
> **Guardrails:** This process does NOT go through the normal task queue. You are
> executing setup steps directly. No Telegram approval needed for onboarding — the
> owner already approved by starting you.

---

## Pre-flight Checks

Before starting, verify the environment is ready:

```bash
# 1. Verify CLI is installed and working
v2 heartbeat start --type onboarding

# 2. Verify the website directory has real content (not just the placeholder)
ls Website/index.html   # should exist and be > 1KB

# 3. Verify bootstrap config exists
cat site-bootstrap.json  # or site.config.json with partial values

# 4. Verify .env has API keys
v2 heartbeat start       # will fail if DB path is wrong
```

If the website directory only contains the template placeholder (`<h1>{{SITE_NAME}}</h1>`),
STOP and notify the owner: "The website hasn't been imported yet. Please export your
WordPress site via Simply Static, place the files in Website/, and push to GitHub."

---

## PHASE 1: Understand the Business

> **Goal:** Read the entire website and build a complete mental model of the business.
> You are a senior SEO strategist meeting a new client for the first time. Study their
> website like you'd study a competitor.

### Step 1.1 — Run the website analyzer

```bash
pwsh ./setup/analyze-website.ps1
```

This generates `website-profile.json` with deterministic data: domain, site name,
blog inventory, service pages, analytics IDs, CSS colors, HTML patterns, favicon paths.

Read the output carefully — it gives you raw facts.

### Step 1.2 — Read every page of the website

Read the website systematically. For each page, note:

- **Homepage (`index.html`)**: What's the headline? What services are featured? What's
  the call to action? What cities/areas are mentioned? What's the overall tone?
- **About page**: Company history, team, mission, certifications, years in business
- **Service pages**: What specific services do they offer? How are they described?
  What keywords are used naturally? What's the pricing model (free estimates, hourly, flat-rate)?
- **Blog posts**: What topics do they write about? What's the writing style? How technical?
  How long are posts? Do they use images, infographics, data? What's the voice?
- **Contact page**: Phone, address, service areas, hours
- **Location/area pages**: Which cities/regions do they serve?
- **Footer**: Services listed, areas served, certifications, social links

```bash
# Use page-read to analyze key pages
v2 page-read --url / --fields "title,h1,meta_description,word_count"
v2 page-read --url /about --fields "title,h1,content"
v2 site-pages --format table
```

### Step 1.3 — Analyze the writing style

From the blog posts and page content, determine:

1. **Tone**: Formal or casual? Technical or plain-language? Authoritative or friendly?
2. **Voice**: First person ("we") or third person ("the company")? Direct address ("you")?
3. **Vocabulary level**: Industry jargon or layman terms? Short sentences or complex?
4. **Content patterns**: Do they use lists, FAQs, how-to formats, case studies?
5. **Call-to-action style**: Aggressive ("Call NOW!") or soft ("Get in touch")?

Synthesize this into a `brand_voice` description. Example:
> "Friendly, reliable, and no-nonsense. Speak like a trusted neighbor who happens to be
> a master plumber. Use plain language, avoid jargon, emphasize fast response times,
> transparent pricing, and quality workmanship. End every piece with a clear call to action."

### Step 1.4 — Identify the business

From your analysis, determine the **required** business fields (these are what the
engine fills via `{{NICHE}}`/`{{AUDIENCE}}`/`{{BRAND_VOICE}}` and uses for strategy):

| Field (required) | How to determine |
|-------|-----------------|
| `business.type` | What kind of business? (e.g., "Plumbing Company", "Electrical Contractor", "HVAC Service") |
| `business.niche` | One word — the industry (e.g., "plumbing", "electrical", "hvac", "roofing") |
| `business.audience` | Who does the content speak to? (e.g., "homeowners and property managers in Austin TX") |
| `business.brand_voice` | The tone description from Step 1.3 |

The following are **OPTIONAL**. This template does NOT generate a website (the owner
imports their own), so contact/location/service fields are only worth capturing into
the brain/strategy notes if they're present on the site and useful. Do **not** add
them to `site.config.json` unless you have real values — never leave `__HERMES_FILL__`:

| Field (optional) | How to determine |
|-------|-----------------|
| `business.services` | Array of services from service pages/footer/homepage |
| `business.service_areas` | Array of cities/regions from location pages/footer |
| `business.phone` | From contact page or header |
| `business.address` | From contact page or footer |
| `business.city` | Primary city |
| `business.state` | State/region |

### Step 1.5 — Record your analysis

Save your findings to Brain memory before proceeding:

```bash
v2 brain note add --title "Onboarding: Business Analysis" --content "
## Business Profile
- Type: {type}
- Niche: {niche}
- Audience: {audience}
- Brand Voice: {voice}
- Services: {services}
- Areas: {areas}
- Key Differentiators: {what makes them stand out}
- Competitor Clues: {any competitors mentioned or implied}
"
```

---

## PHASE 2: Generate Full Configuration

> **Goal:** Merge the bootstrap config + your AI analysis into a complete site.config.json,
> then run all deterministic setup scripts.

### Step 2.1 — Generate site.config.json

Run the bootstrap-to-config merger with your AI-determined values:

```bash
pwsh ./provision/bootstrap-to-config.ps1 \
  -BootstrapFile ./site-bootstrap.json \
  -ProfileFile ./website-profile.json \
  -Apply
```

This generates a site.config.json with:
- Bootstrap values (domain, owner, email, timezone) used directly
- Website profile values (site_name, site_description) extracted automatically
- Paths auto-generated from slug (`/opt/{slug}-agent`, etc.)
- Git defaults filled in
- `business.*` fields left as `__HERMES_FILL__` placeholders

### Step 2.2 — Fill the AI-judged fields

Open `site.config.json` and replace every `__HERMES_FILL__` value with your analysis
from Phase 1:

- `business.type` → your determined business type
- `business.niche` → the niche keyword
- `business.audience` → the target audience
- `business.brand_voice` → your synthesized tone description
- `site_description` → if the website profile extracted one, verify it. If not, write one.

You may optionally add real `business.services`/`service_areas`/`phone`/`address`/
`city`/`state` if the site has them and they'll help strategy — but only with real
values. Leave them out entirely otherwise.

Write the updated file, then confirm nothing is left unfilled:

```bash
pwsh ./provision/validate-config.ps1 -ConfigFile ./site.config.json
```

This fails CRITICAL on any remaining `__HERMES_FILL__`. The next step
(`customize.ps1`) also refuses to run until every placeholder is filled — so a
half-filled config can never be baked into the engine.

### Step 2.3 — Run deterministic token replacement

```bash
pwsh ./setup/customize.ps1 -Apply
```

This replaces all `{{TOKENS}}` across ~109 files with the values from site.config.json.
Verify the output — the "Unfilled placeholders" list should be empty.

### Step 2.4 — Run skill injection

```bash
pwsh ./setup/inject-skills.ps1 -Apply
```

This fills skill files with structural values from website-profile.json (analytics IDs,
blog post patterns, CSS classes, source post for scaffolding).

### Step 2.5 — Generate scaffold config

```bash
pwsh ./setup/generate-scaffold-config.ps1
```

This creates `scaffold-config.json` so the blog scaffolder knows how to clone the
site's blog post HTML structure.

---

## PHASE 3: Build Strategy

> **Goal:** Use your SEO expertise to build the keyword strategy, internal linking map,
> and all niche-specific content guidelines. This is the most important phase — it's
> where AI judgment creates the most value.
>
> **Important:** Use the site-repo Serper tools for research, NOT your built-in web search:
> - `pwsh ./tools/serper-search.ps1 -Query "..." -Num 20`
> - `pwsh ./tools/serper-scrape.ps1 -Url "..."`
> - `pwsh ./tools/serper-batch.ps1 -QueriesFile queries.txt`

### Step 3.1 — Keyword research

Research the niche using Serper:

1. **Search for the business's core services** — what are people searching for?
2. **Check what the site currently ranks for** (if GSC data exists):
   ```bash
   v2 gsc-fetch --days 30
   v2 gsc-history --top 50
   ```
3. **Identify money keywords** — service-intent, pricing, local queries that drive revenue
4. **Identify informational keywords** — how-to, guide, tips queries for blog content
5. **Identify competitors** — who ranks for the money keywords?

### Step 3.2 — Build money_keyword_map.json

Rebuild `Agentic SEO/config/money_keyword_map.json` with:

- **Intent categories** mapped to the actual services (not generic/plumbing examples)
- **Regex patterns** that match the real niche's query patterns
- **Target pages** pointing to the real service page URLs from the website
- Keep `informational_negative_patterns` (they're niche-agnostic)

### Step 3.3 — Build keyword seed files

- **`config/money-keywords-seed.tsv`**: 20-50 money keywords with search volume estimates
- **`config/rank_tracking_keywords.txt`**: 30-100 keywords to track daily, covering:
  - Brand terms
  - Service + city combinations (e.g., "plumber austin tx")
  - Core service terms (e.g., "emergency plumber near me")
  - Informational terms you want to own

### Step 3.4 — Build link-registry.json

Rebuild `Agentic SEO/tools/link-registry.json` with:

- Every service page URL from the website as a linking target
- Every location/area page as a linking target
- The homepage as a target for head money terms
- Blog category pages as targets for informational clusters
- Anchor text suggestions for each target (varied, not exact-match spam)

Use the actual URLs from the site analysis — `v2 site-pages` to get the full URL list.

### Step 3.5 — Rewrite content production skills

These three files are the AI writing guides. They contain niche-specific examples,
tone guidelines, and framing that MUST match this business:

1. **`tools/blog-production-skill.md`** (~47KB)
   - Rewrite ALL niche examples (replace plumbing/roofing examples with this business)
   - Update brand voice section with your synthesized voice from Step 1.3
   - Update example headlines, CTAs, and content structures for this niche
   - Keep the production WORKFLOW intact — only change niche framing

2. **`tools/stats-blog-production-skill.md`** (~61KB)
   - Same treatment — rewrite examples for this niche
   - Update the data source suggestions for this industry
   - Keep the statistical methodology workflow intact

3. **`tools/SERVICE-PAGE-PRODUCTION-SKILL.md`** (~29KB)
   - Rewrite for this business's service types
   - Update example service descriptions, FAQs, process steps
   - Keep the production workflow intact

> **CRITICAL:** Do NOT rewrite these in a single pass. Start a FRESH session for each
> one — they are 800-1600+ lines each. Read the entire file first, then make targeted
> edits to replace niche-specific content while preserving the workflow structure.

### Step 3.6 — Rewrite llms.txt

Rebuild `Website/llms.txt` with:
- Real business name, description, and mission
- Actual service list with URLs
- Blog post inventory with URLs
- Target audience description
- Brand voice guidelines
- Key differentiators

### Step 3.7 — Audit and rewrite Hermes skills

Go through each skill in `hermes/skills/client/`:

| Skill | What to check/rewrite |
|-------|----------------------|
| `blog-publisher/` | Niche examples in guidance |
| `client-blog-publisher/` | Same |
| `client-operations/` | Operational examples |
| `client-pr-closeout-and-reconciliation/` | PR workflow examples |
| `content-refresh/` | Content refresh criteria for this niche |
| `daily-loop/` | Leave mostly as-is (generic) |
| `daily-workplan/` | Leave mostly as-is (generic) |
| `delegation-rules/` | Leave as-is |
| `gsc-opportunity/` | GSC analysis framing |
| `high-risk-approval/` | Leave as-is |
| `intelligence/` | Leave as-is (generic) |
| `preview-branch/` | Leave as-is |
| `safe-fix/` | Leave as-is |
| `serp-tracker/` | SERP tracking examples |
| `sync-repair/` | Leave as-is |
| `system-rules/` | Leave as-is |
| `task-list/` | Leave as-is |

Focus on skills that have niche-specific prose or examples. Skills that are purely
operational (safe-fix, sync-repair, system-rules) don't need niche changes.

### Step 3.8 — Audit and rewrite process playbooks

Go through `processes/` and rewrite niche-specific framing in:

| Process | What to change |
|---------|---------------|
| `daily-workplan.md` | Business value assessment examples |
| `new-blog-creation.md` | Blog topic examples |
| `content-gap-analysis.md` | Service page examples |
| `opportunity-scan.md` | Money keyword examples |
| `competitor-analysis.md` | Competitor framing |
| `keyword-campaign.md` | Keyword examples |
| `service-page-update.md` | Service descriptions |

Leave workflow logic intact — only change niche framing and examples.

---

## PHASE 4: Seed the Brain

> **Goal:** Populate the Obsidian Agent Brain with real, actionable knowledge about
> this business. This is what you'll recall every day when planning.

### Step 4.1 — Write SEO Strategy

Update `Obsidian Agent Brain/01-Agent-Brain/SEO Strategy.md`:

```markdown
# SEO Strategy — {Business Name}

## Audience
{Who the content speaks to — from your Step 1.4 analysis}
NOT {who the content does NOT speak to}. Treat {irrelevant audience} queries as noise.

## Money Pages
{List the actual service pages and what keywords they target}
These are the revenue engine — defend and sharpen first.

## Blog Strategy
{How the blog supports money pages — topical authority, funnel entry}
Must support, not cannibalize money pages.

## Keyword Priority
1. Money keywords: {top 10 service-intent keywords}
2. Authority keywords: {industry expertise terms}
3. Informational: {how-to, guide terms for blog}
4. Noise: {what to ignore}

## Competitive Landscape
{Key competitors and their strengths/weaknesses}

## Quick Wins (first 30 days)
{What to tackle immediately based on your analysis}
```

### Step 4.2 — Write Operating Rules

Update `01-Agent-Brain/Operating Rules.md` — adapt for this specific business.
Keep the SQLite/Brain authority split. Add any business-specific rules.

### Step 4.3 — Write Task Generation Rules

Update `01-Agent-Brain/Task Generation Rules.md` — set priorities based on this
business's keyword landscape and competitive position.

### Step 4.4 — Write User Preferences

Update `01-Agent-Brain/User Preferences.md` — note the owner's name, communication
preferences (from bootstrap), and standard defaults.

### Step 4.5 — Update Hermes memories

Rewrite `hermes/memories/MEMORY.md` with:
- Actual site paths and domain
- Real CLI reference (unchanged)
- Real cron schedule (unchanged)
- Business-specific context

Rewrite `hermes/memories/USER.md` with:
- Owner name and preferences
- Business facts discovered in Phase 1
- Communication style preferences

---

## PHASE 5: Validate and Go Live

> **Goal:** Verify everything is configured correctly, then hand off to daily operations.

### Step 5.1 — Run validation pipeline

```bash
pwsh ./validation/validate-site.ps1 -SitePath .
```

All checks should pass:
- ✅ **Token check**: 0 remaining `{{TOKENS}}`
- ✅ **Config check**: site.config.json valid, .env exists
- ✅ **SEO check**: meta tags, headings, schema present
- ✅ **Brain check**: all seed directories and notes present
- ✅ **Link check**: no broken internal links

If any CRITICAL check fails, fix it before proceeding.

### Step 5.2 — Verify deployment

```bash
# Push to trigger Cloudflare Pages deployment
v2 deploy-push --message "Onboarding complete: $(date)"

# Wait for deployment
v2 deploy-wait --timeout 300

# Verify the site is live
v2 deploy-status
```

### Step 5.3 — Run smoke tests

```bash
# Verify CLI works end-to-end
v2 heartbeat start --type onboarding-complete

# Verify brain is accessible
v2 brain health
v2 brain summary

# Verify GSC connection (may be empty if new)
v2 gsc-fetch --days 7

# Verify SERP checking works
v2 serp-check --keyword "{primary money keyword}" --location "{location}"
```

### Step 5.4 — Send onboarding-complete email

Send a comprehensive email to the owner:

```bash
v2 email-send --to "{admin_email}" --subject "✅ {site_name} — SEO Autopilot is Live" --body "
Hi {owner_name},

Your SEO autopilot for {domain} is now fully configured and running.

## What I Found
- Business Type: {type}
- Niche: {niche}
- Target Audience: {audience}
- Services: {services list}
- Service Areas: {areas list}

## What I Set Up
- Keyword tracking for {N} keywords
- {N} money keywords mapped to service pages
- Blog production guidelines matching your brand voice
- Internal linking strategy across {N} pages
- Daily intelligence + planning cycle (8 AM / 8 PM)

## What Happens Next
- I'll run my first daily workplan tomorrow morning at 8 AM {timezone}
- I'll email you the plan — review it and reply on Telegram if you want to change anything
- Technical SEO fixes will deploy automatically
- Blog posts will wait for your Telegram approval

## How to Control Me
- Telegram: 'stop {id}' to cancel a task
- Telegram: 'change {id} to {instruction}' to modify
- Telegram: 'approve {id}' to greenlight
- Telegram: 'pause' to stop all activity

## Please Verify
Does the business profile above look correct? If anything is wrong, reply to this
email and I'll adjust before my first workplan.

Best,
{site_name} SEO Agent
"
```

### Step 5.5 — Register in site registry

```bash
# Update the central registry
# (This is handled by provision-site.ps1 or manually)
```

### Step 5.6 — Complete onboarding heartbeat

```bash
v2 heartbeat start --type onboarding-complete
v2 brain note add --title "Onboarding Complete" --content "
Site onboarding completed at $(date).
- Config generated and validated
- {N} keyword targets configured
- All skills rewritten for {niche}
- Brain seeded with strategy
- Deployment verified
- Owner notified at {admin_email}
Next: Daily workplan cron takes over.
"
```

---

## Post-Onboarding: Handoff to Daily Operations

After this process completes, the standard cron schedule takes over:

- **7:30 AM/PM**: Intelligence pipeline
- **8:00 AM/PM**: Daily workplan (your normal planning cycle)
- **Every 7 min**: Ops pipeline
- **Every 19 min**: Blog pipeline
- **Every 10 min**: Outbox worker
- **Every 15 min**: Health monitor

You do NOT run this onboarding process again. If the owner wants to change business
facts, update `01-Agent-Brain/` notes and they'll be picked up in the next planning cycle.

---

## Failure Recovery

If onboarding fails partway through:

1. **Phase 1 failed** (couldn't read website): Notify owner — likely the website wasn't
   imported correctly. Ask them to re-export via Simply Static.
2. **Phase 2 failed** (config generation): Check bootstrap config is valid JSON with
   required fields. Run `pwsh ./provision/validate-config.ps1` for diagnostics.
3. **Phase 3 failed** (strategy build): Can be retried. Run this process again —
   Phases 1-2 will detect existing config and skip ahead.
4. **Phase 4 failed** (brain seed): Can be retried. Brain notes are idempotent.
5. **Phase 5 failed** (validation): Fix the specific check that failed, then re-run
   validation only.

Record the failure in Brain memory:
```bash
v2 brain note add --title "Onboarding Issue" --content "Onboarding failed at Phase {N}, Step {M}: {error}. {What I tried to fix it.}"
```
