# Template Runtime Conventions

This repository is a reusable website-operations agent template. Keep these conventions consistent when creating a new site from the template.

## Canonical runtime paths

Use these defaults unless a site-specific deployment intentionally overrides them:

- Agent repo: `/opt/website-agent`
- Website repo: `/opt/website-site`
- State/SQLite directory: `/opt/website-state`
- SQLite DB: `/opt/website-state/website-agent.db`
- Obsidian vault: `/opt/website-obsidian`

## Canonical environment variables

Runtime code and cron wrappers use `WEBSITE_AGENT_*`:

- `WEBSITE_AGENT_ROOT`
- `WEBSITE_AGENT_SITE_ROOT`
- `WEBSITE_AGENT_DB_PATH`
- `WEBSITE_AGENT_OBSIDIAN_ROOT`
- `WEBSITE_AGENT_BRAIN_VAULT`
- `WEBSITE_AGENT_BASE_URL`
- `WEBSITE_AGENT_GUARDRAILS_PATH`

Google Search Console OAuth uses the standard neutral names:

- `GSC_CLIENT_ID`
- `GSC_CLIENT_SECRET`
- `GSC_REFRESH_TOKEN`
- `GSC_SITE_URL`

The older `CLIENT_*` wording may appear only in legacy explanatory notes or the generic Hermes skill namespace. Do not add new runtime code that depends only on `CLIENT_*`.

## Production skill placement

Content workers operate inside the website repo and expect these guides under `Website/tools/` in a fresh template clone, and under `/opt/website-site/tools/` after deployment:

- `blog-production-skill.md`
- `stats-blog-production-skill.md`
- `SERVICE-PAGE-PRODUCTION-SKILL.md`

The copies under `Agentic SEO/tools/` are the agent-side source/reference copies. Keep both copies in sync when changing the production workflow.

## Generic website scaffold guards

Keep these reusable helpers in every derived site unless the site has equivalent replacements:

- `Website/tools/register-blog-post.ps1`
- `Website/tools/sort-blog-index.js`
- `Website/tools/link-registry.json`
- `Website/test/blog-index-sort.test.js`
- `Website/test/sitemap-lastmod.test.js`
- `Website/test/structured-data-jsonld.test.js`

These guards prevent known production regressions: unsorted blog index cards, invalid sitemap `<lastmod>` values, broken JSON-LD, and missing registry/sitemap entries.

## Setup checklist for a new site

1. Edit `site.config.json` with the site identity, owner, paths, and Cloudflare/GSC settings.
2. Run `pwsh -NoProfile -File setup/customize.ps1` and review the dry-run.
3. Run `pwsh -NoProfile -File setup/customize.ps1 -Apply` only in a per-site copy, not the master template.
4. Copy `.env.example` to `.env` and fill secrets manually; never commit `.env`.
5. Import/replace the static website under `Website/`, but preserve `Website/tools/` and `Website/test/` unless equivalent guards are added.
6. Run:

```bash
cd Website && node --test test/*.test.js
cd "Agentic SEO/cli" && npm test
WEBSITE_AGENT_ROOT=/opt/example-agent WEBSITE_AGENT_CRON_DIR="$PWD/../cron" bash ../cron/install-crons.sh --dry-run
```
