# Competitor Blog Gap Tasks: Executor Routing Pitfall

## When this applies
Use this when turning competitor blog sitemap/blog coverage gaps into {{SITE_NAME}} task candidates and then validating that the automation will create blog previews.

## Durable lesson
Competitor-gap tasks can legitimately have both:

```json
{
  "task_type": "new_blog_post",
  "evidence": { "type": "competitor_blog_gap" }
}
```

Executor routing must prefer the canonical task intent (`task_type`) over the evidence/source classification (`evidence.type`). `evidence.type` describes why the task exists; it should not override what the task is supposed to do.

## Failure mode
If routing reads `evidence.type` first, a `new_blog_post` competitor-gap task may not enter the blog-preview draft path. The queue will look populated, but semi-safe preview creation will fail or become a no-op because the executor treats the item as an unsupported `competitor_blog_gap` action.

## Correct verification pattern
After inserting competitor blog gap tasks:

1. Pick one high-priority candidate from the authoritative DB (`/opt/client-sqlite/seo-agent.db`).
2. Run the executor in dry-run/plan mode against that task.
3. Verify the planned first action is a deterministic blog file write, e.g.:

```text
status=planned
dry_run=true
action_count=1
first_action.type=write_file
file_path=/opt/client-site/blog/<slug>.html
```

4. Run the relevant semi-safe preview branch policy tests and the full Node test suite before reporting the queue as automation-ready.

## Implementation guidance
- Keep `task_type: "new_blog_post"` as the routing key for preview blog drafting.
- Keep `evidence.type: "competitor_blog_gap"` only as provenance/justification metadata.
- Add/maintain a regression test where a `new_blog_post` task with competitor-gap evidence still routes to preview draft creation.
- Do not publish production content from this flow; generated blog pages are semi-safe preview work unless separately approved.
