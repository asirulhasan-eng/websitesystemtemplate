# New Site Onboarding — Hermes Skill

> **When to use:** ONLY on first deployment of a new site. This is a ONE-TIME process
> triggered manually or by the onboarding cron. After completion, switch to the standard
> `daily-workplan` skill for ongoing operations.
>
> **What it does:** You read the imported website, understand the business using AI
> judgment, generate the full configuration, build keyword strategy, rewrite all
> niche-specific prose, seed the brain, and validate the deployment.
>
> **Duration:** 1-3 hours. This is a long process. Do NOT rush.

---

## How to Invoke

```bash
# Manual trigger (recommended for first site):
hermes --skills new-site-onboarding,system-rules -z "Onboard this new site. The website has been imported into Website/. Read it, understand the business, and complete the full setup."

# Or via cron (after VPS setup):
# The install-crons.sh can add a one-time onboarding trigger
```

---

## Process

1. **Read the onboarding playbook:**
   ```
   Agentic SEO/processes/new-site-onboarding.md
   ```
   This is your master checklist. Follow it step by step, phase by phase.

2. **Read the guardrails:**
   ```
   Agentic SEO/config/guardrails.json
   ```
   Understand the autonomy model. During onboarding, you have full authority —
   no Telegram approval needed.

3. **Follow all 5 phases in order:**
   - Phase 1: Understand the Business (read website, analyze, extract)
   - Phase 2: Generate Full Configuration (merge bootstrap + AI analysis)
   - Phase 3: Build Strategy (keywords, link registry, rewrite skills/prose)
   - Phase 4: Seed the Brain (write strategic notes to Obsidian)
   - Phase 5: Validate and Go Live (run checks, deploy, notify owner)

---

## Key CLI Commands

### Website Analysis
```bash
pwsh ./setup/analyze-website.ps1                    # Generate website-profile.json
v2 site-pages                                        # List all pages
v2 page-read --url / --fields "title,h1,meta_description,word_count"
v2 crawl                                             # Full site crawl
```

### Configuration
```bash
pwsh ./provision/bootstrap-to-config.ps1 -BootstrapFile ./site-bootstrap.json -ProfileFile ./website-profile.json -Apply
pwsh ./setup/customize.ps1 -Apply                    # Fill all {{TOKENS}}
pwsh ./setup/inject-skills.ps1 -Apply                # Inject structural values
pwsh ./setup/generate-scaffold-config.ps1            # Blog scaffold config
```

### Keyword Research
```bash
pwsh ./tools/serper-search.ps1 -Query "..." -Num 20  # SERP research
pwsh ./tools/serper-scrape.ps1 -Url "..."             # Scrape competitor page
pwsh ./tools/serper-batch.ps1 -QueriesFile queries.txt # Batch queries
v2 gsc-fetch --days 30                                # Existing GSC data (if any)
v2 keyword-track --keyword "..." --target "/"          # Start tracking
```

### Brain & Memory
```bash
v2 brain note add --title "..." --content "..."       # Add brain note
v2 brain recall --query "..."                          # Search brain
v2 brain summary                                       # Brain health summary
v2 brain health                                        # Verify brain structure
```

### Validation & Deployment
```bash
pwsh ./validation/validate-site.ps1 -SitePath .       # Run all validation checks
v2 deploy-push --message "Onboarding complete"         # Push to production
v2 deploy-wait --timeout 300                           # Wait for Cloudflare
v2 deploy-status                                       # Verify deployment
v2 heartbeat start --type onboarding-complete          # Record completion
```

### Notification
```bash
v2 email-send --to "{admin}" --subject "..." --body "..." # Notify owner
```

---

## Rules

1. **Do NOT skip Phase 1.** You must read the website thoroughly before generating config.
   Bad niche/audience/voice analysis = bad content for months.

2. **Do NOT rewrite production skills in the same session.** Start a FRESH session for
   each of the three big skill files (blog-production, stats-blog, service-page). They
   are 800-1600+ lines each. Read entirely first, then make targeted edits.

3. **Do NOT invent business facts.** If you can't determine something from the website
   (e.g., pricing, specific certifications, founding year), leave it out or ask the owner.

4. **DO use Serper tools for research**, not built-in web search. Keep API keys out of
   any saved content.

5. **DO record your analysis in Brain memory** at each phase. If onboarding fails partway
   through, the next attempt should be able to pick up where you left off.

6. **DO send the onboarding-complete email.** The owner needs to verify your business
   analysis is correct before the daily workplan starts generating tasks.

---

## Success Criteria

Onboarding is complete when ALL of the following are true:

- [ ] `website-profile.json` generated from the real website
- [ ] `site.config.json` complete with all fields (no `__HERMES_FILL__` remaining)
- [ ] `customize.ps1 -Apply` ran successfully (0 unfilled placeholders)
- [ ] `money_keyword_map.json` rebuilt for this niche
- [ ] `money-keywords-seed.tsv` has 20+ keywords
- [ ] `rank_tracking_keywords.txt` has 30+ keywords
- [ ] `link-registry.json` has the real site's URLs
- [ ] `llms.txt` rewritten with real site identity
- [ ] All three production skills rewritten for this niche
- [ ] Brain notes updated with real strategy
- [ ] `MEMORY.md` and `USER.md` updated
- [ ] `validate-site.ps1` passes (0 critical failures)
- [ ] Cloudflare deployment is live
- [ ] Owner notified via email
- [ ] Onboarding-complete heartbeat recorded
