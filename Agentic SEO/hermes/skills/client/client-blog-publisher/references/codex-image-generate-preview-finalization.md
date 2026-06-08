# Codex-backed `image_generate` and interrupted blog-preview finalization

Use this when scheduled/autopilot blog publishing needs AI infographic evidence and the run is interrupted after creating the preview branch/PR but before operational state is finalized.

## Durable lessons

- If the user says their active Codex/GPT image model can generate images, still route through the Hermes `image_generate` tool, but configure the tool provider to the Codex-backed image plugin rather than bypassing the tool or falling back to SVG/programmatic visuals.
- Positive proof matters: do not claim the requirement is satisfied just because SVG/programmatic generation is blocked. Verify an actual `image_generate` call succeeds and records provider/model evidence.
- Scheduled blog guardrails should require an AI image manifest for generated infographic assets. For autopilot/scheduled blog work, fail closed if that manifest cannot be produced.
- Background agent runs may finish with a shell startup warning while the real blog workflow succeeded. Treat shell completion warnings separately from workflow validation; inspect logs and state before declaring failure.

## Codex image provider setup pattern

```bash
hermes plugins enable image_gen/openai-codex
hermes config set image_gen.provider openai-codex
hermes config set image_gen.model gpt-image-2-medium
```

Then verify with a real image generation call and capture evidence like:

```text
success: true
provider: openai-codex
model: gpt-image-2-medium
image: /root/.hermes/cache/images/...
```

Do not substitute FAL or deterministic SVG/HTML/canvas/Sharp graphics unless the user explicitly requests that fallback in the current task.

## Resume pattern after tool/context limit interruption

If the blog agent created a preview but stopped before finalization:

1. Inspect the blog publisher log for the last summary and artifact paths.
2. Verify the site branch/commit and PR.
3. If Cloudflare API env is missing, query PR comments for the Cloudflare bot preview URLs, then `curl -L` the branch preview, article, `/blog/`, and every new AI image asset.
4. Record state through project tooling, not raw DB edits:

```bash
node tools/record_blog_preview_ready.js \
  --db /opt/client-sqlite/seo-agent.db \
  --task <TASK_ID> \
  --site-root /opt/client-site \
  --branch <BRANCH> \
  --commit <COMMIT_SHA> \
  --preview <CLOUDFLARE_ARTICLE_URL> \
  --cloudflare-preview <CLOUDFLARE_ROOT_URL> \
  --cloudflare-blog <CLOUDFLARE_ARTICLE_URL> \
  --pr-url <PR_URL> \
  --files '<comma-separated changed files>' \
  --validation-status passed \
  --validation-summary '<concise validation evidence>' \
  --json
```

5. Process outbox:

```bash
node tools/sync_obsidian_outbox.js \
  --db /opt/client-sqlite/seo-agent.db \
  --obsidian-root /opt/client-obsidian \
  --limit 25 \
  --json

node tools/send_email_outbox.js \
  --db /opt/client-sqlite/seo-agent.db \
  --limit 5 \
  --json
```

6. Verify the task is `preview_ready`, the deployment row has `validation_status='passed'`, and no outbox jobs remain pending.
7. Return `/opt/client-site` to `master` after the preview branch is committed/pushed.
8. Checkpoint SQLite WAL if needed, then commit/push durable SQLite and Obsidian mirror changes.
9. Verify all four repos are clean/synced before reporting.

## Report shape

Keep production and preview status separate:

- Production: not merged / not published unless explicitly approved.
- Preview: PR URL, branch URL, Cloudflare article URL, commit SHA.
- Evidence: AI manifest path, guard result, HTTP `200` checks for article/index/assets, structural/browser validation.
- State: task status, deployment ID, outbox processed, durable repo commits.
