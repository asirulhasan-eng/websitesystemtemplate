# SKILL-SETUP-GUIDE.md -- Customizing the Production Skill Files for a New Client

> **Purpose.** After you import a client's website into `Website/` and fill
> `site.config.json`, this guide walks you through the three CLI scripts that
> read the site, extract everything the skill files need, and inject those values
> automatically. The result: `blog-production-skill.md`,
> `stats-blog-production-skill.md`, `SERVICE-PAGE-PRODUCTION-SKILL.md`, and
> `scaffold-blog.ps1` are fully retargeted to the new client -- ready for Hermes.

> [!IMPORTANT]
> **For AI agents:** This guide covers the CLI scripts (mechanical token replacement).
> For the FULL AI-driven process -- reading the website, understanding the business,
> filling site.config.json, AND doing the deep customization (voice guides, brand palette,
> industry research, angle formulas) -- use the AI skill file instead:
>
> ```
> "Read the website analysis skill at
>  Agentic SEO/tools/website-analysis-skill.md
>  and use it to analyze the website in Website/ and customize
>  all skill files for this client."
> ```
>
> The AI skill file calls these CLI scripts internally at the right step.
> It also handles the judgment-heavy work the scripts cannot do.

## Overview

There are **three scripts**, run in order:

```
setup/
├── analyze-website.ps1         ← Step 1: reads the imported website
├── inject-skills.ps1           ← Step 2: fills the skill files
└── generate-scaffold-config.ps1 ← Step 3: generates scaffold reference config
```

**Data flow:**

```
Website/          ──→  analyze-website.ps1  ──→  website-profile.json
                                                        │
site.config.json  ──→  inject-skills.ps1    ←───────────┘
                            │
                            ▼
                  blog-production-skill.md      (customized)
                  stats-blog-production-skill.md (customized)
                  SERVICE-PAGE-PRODUCTION-SKILL.md (customized)
                  scaffold-blog.ps1              (customized)
                            │
                            ▼
                  generate-scaffold-config.ps1  ──→  scaffold-config.json
```

---

## Prerequisites

- [x] Node.js ≥ 22.5 and PowerShell 5.1+
- [x] `site.config.json` filled with the client's identity (domain, niche, audience, etc.)
- [x] The client's static website imported into `Website/` (or another path)

---

## Step 1 — Analyze the Website

```powershell
pwsh ./setup/analyze-website.ps1
```

**What it does:** Scans every HTML, CSS, and JS file in `Website/` and extracts:

| Extracted Data | How It's Used |
|---|---|
| **Domain** (from canonical/og:url) | Fills `{{DOMAIN}}` if not in config |
| **Site name** (from og:site_name or `<title>`) | Fills `{{SITE_NAME}}` |
| **Analytics IDs** (GA4 `G-XXXX`, GTM `GTM-XXXX`, Clarity) | Replaces hardcoded IDs in scaffold-blog.ps1 |
| **Social handles** (Twitter, Facebook, YouTube, etc.) | Replaces placeholder handles in schema `sameAs` |
| **Blog post inventory** (slugs, titles, file sizes) | Seeds link-registry; identifies best source post |
| **Service page inventory** | Same for service pages |
| **HTML patterns** (topbar, mobile-nav, TLDR, FAQ, CTA classes) | Documents the site's component structure |
| **CSS variables and top colors** | Detects the brand palette |
| **Favicon paths** | Ensures scaffold uses correct paths |
| **JS files** | Documents the scripts to include |

**Output:** `website-profile.json` in the repo root.

**Options:**
```powershell
pwsh ./setup/analyze-website.ps1 -WebsitePath "D:\client-export"
pwsh ./setup/analyze-website.ps1 -OutputPath "D:\custom-profile.json"
```

> **Review the profile** before proceeding. Open `website-profile.json` and verify:
> - `identity.domain` is correct
> - `scaffold.best_source_post` points to a full, well-formed blog post
> - `analytics.ga4_id` matches the client's GA property

---

## Step 2 — Inject Variables into Skill Files

```powershell
# Preview (writes nothing)
pwsh ./setup/inject-skills.ps1

# Apply
pwsh ./setup/inject-skills.ps1 -Apply
```

**What it does:** Two-layer replacement on the four target files:

### Layer 1 — Token Replacement (from `site.config.json`)

These are the standard `{{TOKEN}}` placeholders that `customize.ps1` also handles,
but `inject-skills.ps1` targets only the skill files (not the entire engine):

| Token | Source Field | Example Value |
|---|---|---|
| `{{DOMAIN}}` | `domain` | `acmeroofing.com` |
| `{{SITE_NAME}}` | `site_name` | `Acme Roofing SEO` |
| `{{NICHE}}` | `business.niche` | `roofing` |
| `{{AUDIENCE}}` | `business.audience` | `roofers` |
| `{{OWNER_NAME}}` | `owner_name` | `John Smith` |
| `{{ADMIN_EMAIL}}` | `email.admin` | `john@acmeroofing.com` |
| `{{TIMEZONE}}` | `timezone` | `America/New_York` |
| `{{TIMEZONE_ABBR}}` | `timezone_abbr` | `ET` |
| `{{BRAND_VOICE}}` | `business.brand_voice` | *(multi-line text)* |
| `{{SITE_DESCRIPTION}}` | `site_description` | `Professional roofing SEO...` |

### Layer 2 — Structural Injection (from `website-profile.json`)

These replace **hardcoded values** that are not `{{TOKENS}}` but still need to
change per client:

| What's Replaced | What It Becomes |
|---|---|
| `c:\Users\Administrator\Documents\{{NICHE}} website 2\tools` | Actual website tools path |
| `d:\Projects\{{NICHE}} SEO Agency\tools` | Same |
| `google-maps-seo-for-{{AUDIENCE}}.html` | Best detected source post |
| `drain-cleaning.html` | Best detected service page |
| `G-H9RD5BVGR8` (GA4 ID) | Client's GA4 ID |
| `ww29j18bkr` (Clarity ID) | Client's Clarity ID |
| `@clientagen` (Twitter handle) | Client's Twitter handle |
| Hardcoded API key | Replaced with env var reference |

**Options:**
```powershell
# Use a different config path
pwsh ./setup/inject-skills.ps1 -ConfigPath "D:\my-config.json"

# Use a different profile
pwsh ./setup/inject-skills.ps1 -ProfilePath "D:\my-profile.json"

# Target different skill directory
pwsh ./setup/inject-skills.ps1 -SkillsDir "D:\engine\tools"
```

> [!IMPORTANT]
> After applying, check for any remaining `{{TOKEN}}` placeholders:
> ```powershell
> Select-String -Path "Agentic SEO\tools\*-skill.md","Agentic SEO\tools\SERVICE-PAGE*.md" -Pattern "\{\{" | Format-Table Path, LineNumber, Line -AutoSize
> ```

---

## Step 3 — Generate Scaffold Config (Optional)

```powershell
pwsh ./setup/generate-scaffold-config.ps1
```

**What it does:** Creates `Agentic SEO/tools/scaffold-config.json` — a
consolidated reference file that `scaffold-blog.ps1` and the AI agent can read
when creating new posts. It contains:

- The best source post for cloning header/footer
- Analytics IDs
- Social media handles (for schema `sameAs`)
- Favicon paths
- Brand color palette
- Inventory of existing blog posts (for Related Posts and link-registry)
- Inventory of existing service pages

This file is **informational** — `scaffold-blog.ps1` doesn't read it
automatically (it uses command-line parameters), but the AI agent can read it to
know which parameters to pass.

---

## What's Left After the Scripts Run

The scripts handle all **deterministic** customization. What's left requires
**judgment** — the AI (Hermes) or a human must review:

### Voice Guide (in each skill file)

The voice guide sections describe the writing tone and style. After token
replacement, they'll reference the correct niche and audience, but the **specific
language examples** ("phone doesn't quit ringing," "keep the trucks moving") are
from the original plumbing niche. Hermes should rewrite these examples to match
the new client's industry.

> **Prompt for Hermes:**
> "Read the Voice Guide section in `blog-production-skill.md`. The niche is now
> `[NICHE]` and the audience is `[AUDIENCE]`. Rewrite the 'use language like'
> and 'avoid language like' lists, the humor examples, and the opinion phrases
> to match this industry. Keep the structural rules (short paragraphs, no em
> dashes, etc.) unchanged."

### Infographic Brand Palette

The skill files specify a brand palette (`#0F2A44`, `#176B9A`, etc.) for
infographic generation. If the client's actual brand colors differ significantly,
update the palette section in each skill file. The `website-profile.json` includes
detected CSS variables and top colors to guide this.

### Reddit Subreddit Suggestions

The skill files suggest subreddits to search (e.g., `r/{{NICHE}}`,
`r/HomeImprovement`). These should be updated for the new niche's relevant
communities.

### Blog Angle Formula

The "Blog Angle Formula" section in `blog-production-skill.md` (Step 2.1b) uses
niche-specific framing ("quiet phones, wrong-area calls, competitors above you").
Hermes should adapt these to the new client's pain points.

---

## Full Workflow Example

```powershell
# 0. Import the client's website into Website/
#    (replace placeholder files with the real site)

# 1. Fill the client profile
notepad site.config.json

# 2. Analyze the imported website
pwsh ./setup/analyze-website.ps1

# 3. Review the profile
notepad website-profile.json

# 4. Preview what inject-skills will do
pwsh ./setup/inject-skills.ps1

# 5. Apply the injection
pwsh ./setup/inject-skills.ps1 -Apply

# 6. Generate scaffold config (optional but recommended)
pwsh ./setup/generate-scaffold-config.ps1

# 7. Verify no placeholders remain
Select-String -Path "Agentic SEO\tools\*-skill.md","Agentic SEO\tools\SERVICE-PAGE*.md","Agentic SEO\tools\scaffold-blog.ps1" -Pattern "\{\{" | Format-Table Path, LineNumber -AutoSize

# 8. (AI) Polish the voice guides and examples
#    Hand to Hermes with: "Read the skill files in Agentic SEO/tools/.
#    The niche is [X], audience is [Y]. Rewrite the voice examples,
#    subreddit suggestions, and angle formulas for this industry."
```

---

## Script Reference

| Script | Input | Output | Safe? |
|---|---|---|---|
| `analyze-website.ps1` | `Website/` directory | `website-profile.json` | Read-only (never writes to Website/) |
| `inject-skills.ps1` | `site.config.json` + `website-profile.json` | Modifies skill files in-place | **Dry-run by default** |
| `generate-scaffold-config.ps1` | `website-profile.json` + `site.config.json` | `scaffold-config.json` | Creates new file only |

All three scripts support `-Verbose` for detailed output.

---

## Relationship to `customize.ps1`

`customize.ps1` handles the **entire engine** — all 109 files with `{{TOKENS}}`.
`inject-skills.ps1` handles only the **4 skill/scaffold files** but goes deeper:
it also replaces structural values (analytics IDs, source posts, paths) that
`customize.ps1` doesn't touch.

**You can run both.** In fact, the recommended order is:

1. `customize.ps1 -Apply` → fills tokens across the whole engine
2. `analyze-website.ps1` → reads the imported site
3. `inject-skills.ps1 -Apply` → fills the deeper structural values in skills
4. `generate-scaffold-config.ps1` → creates the scaffold reference

If you've already run `customize.ps1`, `inject-skills.ps1` will simply find
zero `{{TOKEN}}` matches (they're already replaced) and only apply Layer 2
(structural injection).
