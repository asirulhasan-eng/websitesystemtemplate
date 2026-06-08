# Competitor city gap re-angle audit

## Trigger
Use when reporting, prioritizing, or executing local/city blog opportunities created from competitor gap sources, especially city {{AUDIENCE}} roundup pages such as RankMeTop `best-companies/{{AUDIENCE}}-<city>/` URLs.

## Lesson
Do not describe a later editorial framing as if it were the originally discovered opportunity. In a prior city cluster, competitor roundup gaps were generated as generic â€œHow {City} {{NICHE}} Companies Can Win More Local SEO Leadsâ€ briefs, then a cleanup pass re-angled all 13 into â€œ{City} {{NICHE}} SEO Local Pack Teardown: What to Fix First in 2026.â€ That re-angle reduced one repetitive pattern but created another.

## Required audit before reporting
1. Query the authoritative DB `/opt/client-sqlite/seo-agent.db` for:
   - `tasks.source`
   - `tasks.title`
   - `tasks.target_keyword`
   - `tasks.target_url`
   - `json_extract(metadata_json,'$.evidence.competitor_source_url')`
   - `json_extract(metadata_json,'$.evidence.competitor_title')`
   - `json_extract(metadata_json,'$.evidence.relevance')`
   - `json_extract(metadata_json,'$.evidence.blog_brief.proposed_title_h1')`
2. Check `events` for `event_type='task_angle_changed'` and read `old_value`, `new_value`, and `metadata_json.reason`.
3. Separate three layers in the report:
   - Original source: e.g. competitor city {{AUDIENCE}} roundup.
   - Original brief: e.g. generic â€œwin more local SEO leads.â€
   - Later editorial re-angle: e.g. â€œlocal pack teardown.â€
4. If many city tasks share the same title formula, explicitly flag it as a pattern/quality risk instead of presenting each title as an independently validated opportunity.

## Reporting language
Prefer:
- â€œRankMeTop city-{{AUDIENCE}}-roundup competitor gap cluster, later re-angled into local-pack teardown posts.â€

Avoid:
- â€œCity teardown opportunities were identified,â€ unless the source itself or independent SERP/GSC evidence supports teardown intent for each city.

## Execution guidance
Do not scale city-local blog templates blindly. For existing city posts, classify into keep, rename/re-angle, consolidate/noindex/remove, or stop-more-generation depending on city-specific depth and uniqueness.