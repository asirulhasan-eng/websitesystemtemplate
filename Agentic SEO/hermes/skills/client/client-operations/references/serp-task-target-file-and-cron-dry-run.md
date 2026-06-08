# SERP Task `target_file` and Cron Dry-Run Diagnosis

## Trigger
Use this reference when {{SITE_NAME}} task execution says safe SERP tasks were selected but no edits happened, especially messages like:

```text
Task executor processed N tasks ...
Task execution no_action ...
Target file not found: unknown
```

## Key Findings

### 1. System cron can exist even when Hermes cron list is empty
Check both:

```bash
# Hermes scheduler jobs
# use cronjob(action='list') from Hermes

# System cron
crontab -l
```

On the {{SITE_NAME}} server, automation may be in the system crontab, not Hermes cron. The daily loop can be scheduled like:

```cron
17 2 * * * cd /opt/client-agent && ./tools/cron/run-daily.sh >> logs/daily.log 2>&1
```

### 2. `run-daily.sh` may execute tasks in dry-run mode
Inspect:

```bash
read_file /opt/client-agent/tools/cron/run-daily.sh
```

If the task executor command lacks `--apply`, reports will show:

```json
"dry_run": true
```

This means cron selects tasks and records execution reports, but does not apply production changes.

### 3. SERP movement candidates may lack `target_file`
Trace SERP task creation in:

```text
/opt/client-agent/tools/analyze_serp_movement.js
```

The SERP generator can call `createTaskCandidate()` with `targetUrl` and `targetKeyword` but no `targetFile`, for both:

- `ranking_recovery`
- `protect_ranking_gain`

Evidence pattern in exported task JSON or SQLite:

```json
{
  "source": "serp_movement",
  "task_type": "protect_ranking_gain",
  "target_url": "https://{{DOMAIN}}/",
  "target_file": null
}
```

Compare with GSC generation in:

```text
/opt/client-agent/tools/analyze_gsc_opportunities.js
```

GSC already imports and uses:

```js
const { createTaskCandidate, urlToLikelyFile } = require("./lib/tasks");
...
targetFile: urlToLikelyFile(row.page),
```

### 4. Existing URL-to-file helper is useful but incomplete for extensionless HTML pages
Helper location:

```text
/opt/client-agent/tools/lib/tasks.js
```

`urlToLikelyFile("https://{{DOMAIN}}/")` returns:

```text
index.html
```

That maps correctly to:

```text
/opt/client-site/index.html
```

But for extensionless URLs like:

```text
https://{{DOMAIN}}/pages/{{NICHE}}-seo-premium-growth
```

it may infer:

```text
pages/{{NICHE}}-seo-premium-growth/index.html
```

while the real site file may be:

```text
pages/{{NICHE}}-seo-premium-growth.html
```

A robust fix should check both patterns:

- `/path/` or existing directory route â†’ `path/index.html`
- `/path` where `path.html` exists â†’ `path.html`

### 5. Missing `target_file` is not the only blocker
Even after resolving `target_file`, safe executor support must be checked. `execute_safe_task.js` currently performs deterministic safe edits for task types such as:

- `missing_title`
- `missing_meta_description`
- `missing_canonical`
- `missing_image_alt`

A SERP task type like `protect_ranking_gain` may then become:

```text
Task type protect_ranking_gain is not a deterministic safe edit.
```

So diagnose separately:

1. Candidate generation / URL-to-file resolution.
2. Whether the task type has a deterministic safe executor action.

## Read-only Diagnostic Commands

```bash
cd /opt/client-agent

# Cron and recent execution evidence
crontab -l
tail -120 logs/daily.log

# Today's/latest executor report
sqlite3 -header -column tools/out/state/seo-agent.db \
  "SELECT task_id,status,risk_level,source,target_url,target_file,target_keyword,priority_score,created_at FROM tasks WHERE source='serp_movement' ORDER BY priority_score DESC LIMIT 20;"

# Summarize null target files by SERP task type stored in metadata
sqlite3 -header -column tools/out/state/seo-agent.db \
  "SELECT json_extract(metadata_json,'$.task_type') AS task_type,risk_level,COUNT(*) AS cnt,SUM(CASE WHEN target_file IS NULL OR target_file='' THEN 1 ELSE 0 END) AS null_target_file FROM tasks WHERE source='serp_movement' GROUP BY json_extract(metadata_json,'$.task_type'),risk_level ORDER BY cnt DESC;"
```

## Recommended Fix Shape

- Import `urlToLikelyFile` or a site-aware resolver in `analyze_serp_movement.js`.
- Set `targetFile` when creating SERP candidates.
- Improve URL-to-file resolution to handle real static-site routes (`index.html` and `.html`).
- Add a regression test or fixture for homepage and extensionless `.html` page URLs.
- Separately define what `protect_ranking_gain` should do if it remains a `safe` auto-executable task; otherwise classify it as planning/semi-safe instead of deterministic safe execution.
