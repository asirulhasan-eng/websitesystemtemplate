# Salvaging templated city SEO posts into a durable city cluster

Use this when a batch of city pages/posts was generated from adjacent competitor-gap sources (for example, `10 Best {{AUDIENCE}} in {City}` roundup pages) and later over-reangled into the same editorial frame such as `{City} {{NICHE}} SEO Local Pack Teardown`.

## Core lesson
Do not present these as independently discovered local-pack opportunities unless GSC/SERP/rank evidence proves it. Treat them as an adjacent competitor-gap city cluster that needs editorial differentiation and tracking.

## Evidence ladder
1. Query authoritative SQLite first (`/opt/client-sqlite/seo-agent.db`): `tasks.source`, `target_keyword`, `target_url`, `metadata_json`, status.
2. Inspect `events` for `task_angle_changed` or cleanup events that explain title/angle mutations.
3. Use Obsidian task notes only as a readable mirror/clue layer; confirm all facts back in SQLite.
4. Check live/site state before recommending deletion: HTTP status, word count, H2 count, image count, canonical/sitemap/index presence.
5. Check whether rank tracking/GSC has data for the city keywords before judging success.

## Salvage strategy
- Preserve URLs/slugs unless there is a strong canonical/redirect reason. Changing slug is high-risk compared with title/H1/meta/body refresh.
- Rename/reframe repeated titles so every city does not share the same `Local Pack Teardown` formula.
- Convert the set into a deliberate city {{NICHE}} SEO strategy cluster.
- Add one genuinely city-specific module per page: market structure, neighborhoods/suburbs, seasonality, property-management demand, service-area overlap, review dynamics, or bilingual/local trust factors.
- Build/strengthen a hub such as `{{NICHE}} SEO by City` and link hub â†” spokes.
- Link related city pairs naturally (e.g. Riverside â†” Corona, Miami â†” Hialeah) and link all city pages to core service/supporting guides.
- Add rank tracking for `{city} {{NICHE}} seo`, `{{AUDIENCE}} seo {city}`, `seo for {{AUDIENCE}} {city}`, and `{city} {{NICHE}} marketing` before deciding whether a page failed.
- For preview-ready pages, revise before merge. For deployed pages, use a semi-safe content refresh branch.

## What not to do
- Do not delete/noindex first just because the batch title pattern looks bad.
- Do not keep generating more pages with the same title formula.
- Do not claim GSC/local-pack opportunity origin when the source is competitor-gap metadata.
- Do not treat Obsidian as authority for task facts.

## Reporting language
Prefer: â€œRankMeTop city-{{AUDIENCE}}-roundup competitor-gap tasks re-angled into a repeated local-pack framing.â€
Avoid: â€œcity teardown opportunities,â€ unless backed by real local-pack teardown data.
