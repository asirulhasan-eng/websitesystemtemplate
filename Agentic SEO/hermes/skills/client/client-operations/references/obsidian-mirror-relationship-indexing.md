# Obsidian Mirror Relationship Indexing

Use when the user asks to make the {{SITE_NAME}} Obsidian vault more interconnected, easier to navigate, or linked by related SEO tasks/topics/targets.

## Risk lane
Safe, if limited to `/opt/client-obsidian` markdown/navigation updates. Do not edit production site content and do not change SQLite task/page state. SQLite remains source of truth; Obsidian is a human-readable mirror.

## Relationship model
Create explicit Obsidian wikilinks around durable relationships already present in generated mirror notes:

- Dashboard: every generated note should be able to navigate back to `[[00-Dashboard/{{SITE_NAME}} Home|{{SITE_NAME}} Home]]`.
- Topic/keyword index: group task notes by `target_keyword` into `03-Topics/<keyword-slug>.md`.
- Target/file index: group task notes by `target_file` or `target_url` into `05-Targets/<target-slug>.md`.
- Related tasks: each task note should link to sibling tasks with the same keyword and/or same target file/URL.
- Reports: link back to dashboard/task board and a compact high-priority task context list.
- Alerts/system logs: link back to dashboard/system logs and, when possible, sibling alerts with the same alert type.

## Safe implementation notes
- Add relationship blocks under a clear managed marker so reruns update instead of duplicating content:
  - `<!-- client-related:start -->`
  - `<!-- client-related:end -->`
- Use Obsidian wikilinks for vault-internal links, not markdown links.
- Use external markdown links only for public URLs.
- Do not manually edit or reinterpret `sqlite_status`, risk, priority, or source-of-truth fields.
- Treat generated relationship notes as navigation/index notes with frontmatter such as `source_of_truth: SQLite-derived relationship index` and `tags: [client, relationship-index, sqlite-mirror]`.

## Verification checklist
After generating/patching links:

1. Count markdown files, notes containing the managed relationship marker, total wikilinks, topic index files, and target index files.
2. Validate path-style wikilinks resolve to existing files/folders where the link contains `/`.
3. Check there are no duplicate managed markers in any file.
4. Inspect at least one task note, one topic note, and one target note manually.
5. Commit and push only the Obsidian mirror repo after verification.

## Example output to report
Include counts like:

- existing notes scanned
- task notes updated
- alert/report notes updated
- topic indexes written
- target indexes written
- files with relationship blocks
- total wikilinks
- missing explicit path links
- commit hash pushed to `client-obsidian`
