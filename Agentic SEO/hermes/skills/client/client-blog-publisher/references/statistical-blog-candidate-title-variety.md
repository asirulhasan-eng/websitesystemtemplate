# Statistical blog candidate title variety

## Trigger

Use this note when creating or repairing user-requested statistics/roundup blog candidates for {{SITE_NAME}}, especially batches of `new_blog_post` tasks inserted into the authoritative SQLite queue.

## Session lesson

The user objected when 10 statistical blog candidates all used the same obvious `75+ Data Points` title pattern. The correction was not to lower queue priority; it was to make the title set less templated while preserving the high-priority semi-safe blog queue intent.

## Durable pattern

- Keep statistics blog candidates semi-safe unless the user explicitly requests immediate production publication.
- If the user asks for high-priority/statistical blog ideas, a high-800s `priority_score` can be appropriate, but titles must not look mass-generated.
- Vary the count promise across the batch, starting around 70+ and moving upward: examples include `70+`, `72+`, `73+`, `76+`, `77+`, `79+`, `81+`, `82+`, `84+`, `88+`.
- Replace generic repeated `Data Points You Need to Know` with topic-specific nouns:
  - `Local Search Benchmarks`
  - `Benchmarks for Contractors`
  - `Trust and Conversion Benchmarks`
  - `Homeowner Demand Benchmarks`
  - `Cost, Call, and Booking Benchmarks`
  - `Wage, Revenue, and Market Benchmarks`
- Preserve the required stats-production workflow in task metadata/description when applicable.

## Verification after insert or correction

1. Query/export the authoritative SQLite queue, not Obsidian, and verify all intended tasks are present.
2. Confirm the corrected titles are visible through the normal task export path.
3. If modifying existing queue rows, record an event per task and enqueue Obsidian outbox updates so the mirror catches up.
4. Report concise proof: count updated/inserted, source, event count, outbox count, and a few corrected titles.

## Pitfall

Do not defend the repeated wording as a statistics-blog convention. If the user flags it as obvious/random-looking, update the queue immediately and verify from SQLite.
