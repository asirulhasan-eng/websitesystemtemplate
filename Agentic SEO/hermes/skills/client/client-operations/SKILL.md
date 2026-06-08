---
name: client-operations
description: Class-level operational workflow guidance for {{SITE_NAME}} repo hygiene, pre-flight remediation, and daily SEO loop reporting.
version: 1.0.1
author: Hermes Agent
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, operations, daily-loop, git]
    related_skills: [client-system-rules, client-daily-loop, client-pr-closeout-and-reconciliation, client-blog-publisher, personal-assistant-operating-loop]
    references:
      - references/scheduler-cadence-collision.md
      - references/blog-publisher-partial-preview-dirty-repo.md
      - references/task-executor-dirty-repo-auto-stash-runbook.md
      - references/task-executor-dirty-repo-operator-recovery.md
      - references/task-executor-12-slot-trigger-audit.md
    requires_tools: [terminal]
---

# {{SITE_NAME}} Operations

## Session-Learned Updates
- `/opt/client-site` is the core {{SITE_NAME}} site repo. Include it in repo hygiene/status checks and PR merge workflows unless the user explicitly narrows scope away from the site.
- When the user gives short operational follow-through commands such as "merge open PRs", "resolve conflict and close PRs", or "complete task related to these", do not treat them as isolated chat requests. Load `personal-assistant-operating-loop` plus the relevant {{SITE_NAME}} closeout/reconciliation skill, then complete the full chain: repo/PR state, conflict resolution or closure, target artifact proof, SQLite task/event reconciliation, and concise evidence-backed report.
- If `/opt/client-site` is dirty when a 10-minute or workflow-triggered task executor run is needed, treat it as a normal operator event: do guarded fallback first, then preserve a recovery note/stash and only clean it up in a separate step.
- When responding to {{SITE_NAME}} watchdog alerts, start with a safe diagnostic lane: inspect heartbeat/cron rows, logs, scheduler config, running processes, disk, repo health, and whether commands are reading the authoritative DB (`/opt/client-sqlite/seo-agent.db`) before remediation. Classify production/content risk before every action.
- For task-autopilot scheduling requests, verify OS crontab first (not just project `cronjob` tool). In this project, `cronjob.list` can return zero while Linux `crontab -l` still owns execution cadence.
- When changing pickup/blog publish frequency, treat it as Safe if limited to cron edits. For the current split-lane system, keep the staggered managed block shape unless the user explicitly requests a cadence change:
  - general task executor: `*/5 * * * * ...run-task-executor.sh`
  - blog publisher/new drafts: prefer an offset cadence such as `2-59/20 * * * * ...CLIENT_BLOG_PUBLISHER_PREVIEW_BACKLOG_LIMIT=200 ...run-blog-publisher.sh` (or explicit `2,22,42 * * * *`) so it does **not** collide every run with the `*/5` task executor.
  - blog editor/existing edits: `43 */4 * * * ...run-blog-editor.sh`
  - blog review/preview reconciliation: `27 */2 * * * ...run-blog-review-worker.sh`
  - Brain-aware daily observer: `17 */2 * * * ...run-daily.sh`
  - keep offsets to reduce lockstep contention and avoid exact collisions. If blog logs show repeated `Site worktree is busy` while task-executor logs show work at the same minute, treat the cadence collision as the likely cause before blaming missing blog candidates.
- After any crontab edit, verify with `crontab -l | grep -E 'run-task-executor.sh|run-blog-publisher.sh|run-blog-editor.sh|run-blog-review-worker.sh|run-monitor.sh'` and run a near-term forecast check in the next loop before reporting.
- When repairing/installing the Linux scheduler, do a dry run first (`node tools/install_linux_scheduler.js --json`), inspect the generated crontab for duplicate legacy unmarked {{SITE_NAME}} cron lines and missing production wrappers, back up live crontab before `--apply`, then verify a follow-up dry run reports `changed: false`. If outbox remains pending after a sync pass, remember `sync_obsidian_outbox.js` is batch-limited; rerun `npm run outbox` until `pending_outbox`/`outbox_jobs status='pending'` is zero before declaring monitor health clean.
- When diagnosing `outbox_stuck` email floods, check for monitor feedback loops: stale outbox rows create `send_monitor_alert` jobs, and those alert jobs can themselves become stale. Prefer grouped alerts by `(job_type, status)` with count/oldest/sample metadata over one alert per outbox row; verify with a regression test and a real-DB dry run. See `references/outbox-stuck-alert-aggregation.md`.
- When missed-cron and stuck monitor-alert outbox alerts recur, repair the underlying cron wrapper/monitor resolution logic rather than repeatedly cancelling alerts: run daily/backup against the authoritative DB, ensure daily observer receives the real Brain vault path, make `cron_missed`/`cron_never_run`/`outbox_stuck` alerts auto-resolve when their condition clears, dedupe by alert identity metadata, and only then cancel obsolete alert-delivery outbox jobs with audit events. See `references/watchdog-cron-outbox-repair.md`.
- For top-to-bottom agent health checks, include the scheduler/vault/outbox/email/report-rendering ladder: compare stale task-list exports against live SQLite, verify `CLIENT_OBSIDIAN_ROOT=/opt/client-obsidian` in live crontab and scheduler defaults, process/cancel outbox rows only through audited project tooling, keep real Gmail auth failures visible, ensure dead-man monitor uses latest activity for missed-cron checks, render daily report mirrors from `daily_reports.report_markdown`, and checkpoint SQLite/re-check clean repos after any scheduled worker race. See `references/outbox-vault-email-daily-report-health-audit.md`.
- Dead-man heartbeat alerts can be false positives if completed daily jobs are treated like continuously-running jobs. For daily/periodic jobs, stale-heartbeat detection should apply only to `status='running'`; missed scheduled executions belong in missed-cron checks. Also verify mid-run heartbeat beats use the same configured job name as the start/finish heartbeat. See `references/heartbeat-stale-false-positive-2026-05-26.md`.
- When the user asks to push generated SEO data to GitHub, sync the current operational DB and generated artifacts into their durable repos before committing: SQLite/raw data goes to `/opt/client-sqlite` and the generated Obsidian mirror goes to `/opt/client-obsidian`.
- Use SQLite `.backup` from `/opt/client-agent/tools/out/state/seo-agent.db` to `/opt/client-sqlite/seo-agent.db`; do not copy/edit DB state manually.
- Rsync non-Obsidian `tools/out/` into `/opt/client-sqlite/tools-out/`. For Obsidian, first decide whether `/opt/client-agent/tools/out/obsidian/` is a complete mirror: use `--delete` only for a confirmed complete mirror; for task/deployment outbox updates, copy only the specific generated notes or rsync without `--delete` so valid vault notes are not removed.
- Treat keywords containing `switch.monster` as fake impressions for {{SITE_NAME}}; do not present them as real opportunities. If they appear in the active task queue, cancel the matching candidate tasks atomically (do not delete rows) and process the Obsidian outbox; see `references/switch-monster-queue-cleanup.md`.
- See `references/generated-data-push-2026-05-26.md` for exact commands and verification.
- For user-requested content brief/gap-planning work, first classify as Safe if it is planning-only, inspect existing `/opt/client-site/blog/*.html` titles/H1s before drafting, then save the finished briefs as a durable project/Obsidian artifact rather than memory. See `references/content-brief-gap-planning.md`.
- When the user asks to cover all blogs from a competitor site, inventory competitor posts from `/blog/`, pagination, and `post-sitemap.xml` because WordPress posts may live under category paths instead of `/blog/`; compare every competitor H1/title against existing {{SITE_NAME}} blog H1s, create durable gap briefs, insert only uncovered topics via `node tools/generate_task_candidates.js --input ... --db /opt/client-sqlite/seo-agent.db`, run Obsidian outbox sync, and verify the new candidate tasks. After insertion, dry-run at least one high-priority `new_blog_post` competitor-gap task through the executor and confirm it plans a blog preview file write; executor routing must prefer `task_type` over `evidence.type`. See `references/competitor-blog-gap-task-generation.md` and `references/competitor-blog-gap-task-type-routing.md`.
- When reporting competitor-gap blog opportunities, distinguish **original source**, **original generated brief**, and **later editorial re-angle**. Do not present a cleanup re-angle/template as if it were independently discovered intent. If a city cluster was bulk-renamed into a repeated formula such as â€œLocal Pack Teardown,â€ audit `events.event_type='task_angle_changed'` plus original `metadata_json.evidence.blog_brief` before describing the opportunity, and flag repeated city-title formulas as a content-quality risk. See `references/competitor-city-gap-reangle-audit.md`.
- When a preview draft is valid but the user asks for â€œmore depth,â€ more SERPs/scraping, more infographics, or table CSS fixes, treat it as a blog-quality repair on the existing semi-safe preview branch. Re-run adjacent-intent SERPs/scrapes, add decision-support depth, use existing table components, generate AI-model infographics with `image_generate`, save optimized WebP assets in the site repo, and visually verify image/table rendering before pushing. Do not hand-code SVG/HTML infographics unless the user explicitly requests SVG/vector output or the AI image service is unavailable and the fallback is disclosed. See `references/blog-enrichment-infographic-preview-pr.md`.
- If safe post-daily cleanup changes task queue state after the daily report has already been generated, process the outbox to completion, regenerate the daily summary, sync the regenerated report, and then verify/report from the final state. See `references/daily-loop-post-cleanup-summary-regeneration.md`.
- When processing Obsidian outbox for the authoritative DB, do not rely on `npm run outbox -- --db /opt/client-sqlite/seo-agent.db` to pass the DB path to every chained command; verify the generated sync report `db_path`. To avoid syncing the repo-local DB accidentally, call `node tools/sync_obsidian_outbox.js --db /opt/client-sqlite/seo-agent.db --obsidian-root /opt/client-obsidian --limit 25` directly, loop until `processed: 0`, then handle email outbox separately if needed.
- For semi-safe Cloudflare Workers preview branches, if Wrangler is not authenticated or GitHub deployments/check APIs are restricted, query PR issue comments for Cloudflare bot posts; they often contain both Commit Preview URL and Branch Preview URL. Verify the preview URL with `curl -I` on the target page and changed redirect behavior before reporting. See `references/cloudflare-workers-preview-url-from-pr-comments.md`.

- When the user explicitly approves merging a semi-safe PR, perform PR mergeability/check preflight, squash-merge with branch deletion, sync local `master`, and verify production behavior plus sitemap after Cloudflare deploys. See `references/merge-semi-safe-pr-production-verification.md`.
- When task automation appears not to execute, distinguish Hermes cron from Linux crontab, inspect `tools/cron/run-daily.sh`, executor artifacts, and `dry_run` before assuming cron is absent. If SERP tasks show `Target file not found: unknown`, trace `target_file` from `analyze_serp_movement.js` through `createTaskCandidate`; SERP generation must set `targetFile` with `urlToLikelyFile`, and URL resolution may need to prefer an existing `path.html` for extensionless URLs. See `references/serp-target-file-and-dry-run-executor-2026-05-30.md`.
- When safe SERP tasks are selected but not applied, inspect both automation mode and candidate shape: system cron may run `run-daily.sh` while Hermes cron is empty, `run_task_executor.js` is dry-run unless `--apply` is present, and SERP movement candidates may lack `target_file` because `analyze_serp_movement.js` does not use the URL-to-file helper. Also verify whether the SERP task type has a deterministic executor action before enabling auto-apply. See `references/serp-task-target-file-and-cron-dry-run.md`.
- The intended {{SITE_NAME}} task automation model is autopilot by risk lane: safe tasks should complete automatically after validation, semi-safe tasks should create preview branches/Cloudflare previews and provide review details, and only high-risk tasks should require explicit confirmation. If tasks stay as candidates, diagnose dry-run mode, missing `target_file`, and missing deterministic executor actions before reporting the queue as merely pending. See `references/autopilot-task-execution-expectation.md`.
- For safe SERP autopilot fixes, do not enable cron apply mode alone. First make target-file resolution/backfill work (`candidate.target_file || urlToLikelyFile(candidate.target_url)`), add a deterministic `protect_ranking_gain` executor action, add tests for both, validate on a copied DB, then enable `--apply --validate-live --rollback-on-failure` for the daily executor. See `references/safe-serp-autopilot-target-file-executor-fix.md`.
- For the user's expected â€œautopilot one by one, ask only high-riskâ€ model, wire all risk lanes deliberately: safe tasks auto-execute, semi-safe candidate tasks auto-create/push preview branches and send review details, and high-risk tasks remain approved-only. Use `--limit 1 --apply --all-lanes --push --validate-live --rollback-on-failure` in daily cron, ensure semi-safe child executors do not double-acquire orchestrator locks, and backfill pre-existing tasks that still lack `target_file`. See `references/autopilot-lanes-and-semi-safe-preview-wiring.md`.
- For semi-safe automation, branch only when the plan contains deterministic content/page edits. Monitoring or investigation-only tasks should record a no-preview/monitored result with audit visibility, not create empty preview branches. When cleaning old preview branches, delete only after verifying `ahead=0`, `behind=0`, and no diff versus the default branch. See `references/semi-safe-preview-branch-policy-and-cleanup.md`.
- When diagnosing â€œwhy is the agent not taking tasks one by one and completing,â€ check not only executor flags but also cadence: a correct executor inside `run-daily.sh` still runs only once daily unless a separate executor cron exists. Explain that semi-safe success means `preview_ready` + branch/review details, not production `executed`; fix missing `target_file` before increasing cadence. See `references/autopilot-cadence-and-preview-ready-diagnosis.md`.
- When the user wants blog tasks picked and completed one-by-one by priority every 15 minutes, verify the frequent Linux cron wrapper, not just daily automation. `run_task_executor.js` excludes `new_blog_post` candidates unless the wrapper passes `--include-new-blog-posts`; use `--limit 1 --apply --all-lanes --include-new-blog-posts --push --validate-live --rollback-on-failure`, reset `/opt/client-site` to the production branch before each task so preview branches do not chain from one another, and report semi-safe blog results as `preview_ready` branches until approved. See `references/blog-autopilot-priority-cadence.md`.
- When autopilot appears active but the task list/backlog looks wrong, verify DB routing before judging task progress: compare repo-local `tools/out/state/seo-agent.db` with authoritative `/opt/client-sqlite/seo-agent.db`, patch cron wrappers and Node defaults to prefer explicit `--db`, `CLIENT_DB_PATH`/`SEO_AGENT_DB`, then the authoritative DB, and recover only legitimate missing rows from the mistaken DB with audit events/outbox updates. See `references/autopilot-authoritative-db-routing-and-recovery.md`.
- When the user asks for the {{SITE_NAME}} task list or priorities:
  1. classify as Safe/read-only and use an authoritative-DB query (preferred):
     - `sqlite3 /opt/client-sqlite/seo-agent.db "SELECT status, COUNT(*) FROM tasks GROUP BY status;"`
     - `sqlite3 /opt/client-sqlite/seo-agent.db "SELECT task_id,title,status,risk_level,priority_score,approval_required,target_url,target_file FROM tasks WHERE status IN ('monitored','preview_ready','candidate') ORDER BY priority_score DESC, created_at ASC;"`
  2. summarize by priority band (`980`, `880`, `720`, etc.), risk level, and approval requirements.
  3. apply the no-go filter: if `switch.monster` appears in title/target, mark as fake-no-op and do not escalate as actionable ranking opportunity.
  4. If `task` CLI output is available in this environment, run `seo-agent export-tasks` as a convenience, then reconcile with DB output before reporting.
  5. Provide a compact handoff-safe list with IDs, URLs, status, and lane state.
  6. For deeper queue diagnostics (targets, counts, outbox linkage), follow `references/task-queue-priority-export.md` and the quick-priority template in `references/task-list-query-and-priority-interpretation.md`.
  7. Keep this lane read-only unless the user explicitly asks for backlog mutation.
  
- For rewrite/refresh backlog runs, keep a conservative default before execution:
  - Filter candidates by `priority_score >= 800` unless the user explicitly changes scope.
  - Keep user-requested rewrite tasks with `status='candidate'`, `approval_required=true`, and `risk_level='semi_safe'` until explicit approval to execute content edits.
- When Serper-assisted research is requested for {{NICHE}} topics, avoid mixing tooling paths:
  - Use `/opt/client-agent/tools/analyze_serp_movement.js` (or repo-local equivalent) for ranking movement snapshots and candidate generation.
  - Use `/opt/client-site/tools/serper-search.ps1` + `/opt/client-site/tools/serper-scrape.ps1` for command-line competitive phrase/page research.
  - This resolves the folder-ambiguity confusion where older notes claim "clientagencysite/tools"; treat `/opt/client-site/tools` as the primary Serper helper location for this workflow.
  - See `references/serper-tasking-tooling-paths-and-priority-rules.md` for command sequence and defaults.
- When executing or resuming a {{SITE_NAME}} task, keep the session todo list self-contained for handoff/context compression: include exact task IDs, risk lane, target URL/keyword/file, repo paths, commands run, artifact/log paths, current status, blocker reason, verification evidence, and the next safe action. Avoid vague todos like â€œverify resultâ€ once concrete facts are known.
- When cleaning `switch.monster` queue/mirror noise, after cancelling tasks and processing Obsidian outbox, verify and remove generated mirror files containing `switch-monster`/`switch.monster`; outbox processing can create additional fake mirror notes before cleanup. If the user asks to clear Obsidian junk but preserve that it is banned/no-go, remove task/topic/target junk and stale non-Brain links, but preserve `01-Agent-Brain/No-Go Sources.md` and compiled Brain no-go mentions; recompile/health-check the Brain and verify zero non-Brain mentions. See `references/switch-monster-queue-cleanup.md` and `references/obsidian-switch-monster-junk-cleanup-preserve-brain.md`.
- When the user asks to make Obsidian notes interconnected or related, treat it as safe mirror/navigation work if limited to `/opt/client-obsidian`: add managed `## Related Notes` wikilink blocks, create `03-Topics/` keyword indexes and `05-Targets/` target/file indexes, validate explicit path wikilinks, then commit/push only the Obsidian mirror repo. See `references/obsidian-mirror-relationship-indexing.md`.
- When the user wants Obsidian to act as the agentâ€™s durable â€œbrain,â€ do not treat it as just a passive mirror. Design a dedicated `01-Agent-Brain` layer with machine-readable critical rules, compiled `BRAIN.json`/`BRAIN.md`, stale detection, last-good fallback, lane-specific fail-closed behavior, SQLite reconciliation, and chat-agent Brain-summary loading. Critical no-go rules such as `switch.monster` must be enforced at generation, recommendation, direct execution, preview, and deployment boundaries, not merely documented. If {{OWNER_NAME}} says credentials belong in the Brain, support an intentional credentials note and avoid printing credential values in summaries/health checks; do not moralize or re-litigate the choice. See `references/obsidian-brain-boundary-conditions.md`.
- When asked to strengthen the Obsidian Brain after a guardrail failure, actively identify workflow pitfalls, limiting conditions, breakpoints, and boundary conditions across generation/export/reconciliation/execution/preview/approval/summary/outbox/GitHub/credential workflows. Store the remedies as an interconnected Brain note, compile/health-check the Brain, validate wikilinks, commit/push the Obsidian repo, and verify clean/synced status. See `references/obsidian-brain-workflow-pitfalls-remedies.md`.
- When the user says to implement the Obsidian Brain remedy backlog, turn recommendations into enforced workflow boundaries with tests first: compiler duplicate/conflict rule validation, no-go drift and compact-size health checks, outbox `01-Agent-Brain` write protection, risk-lane reclassification before execution, and daily observer ordering/reconciliation before summary. Watch for `--no-*` CLI flags that are legitimate valued options and for operational scripts that need `if (require.main === module)` before helper import tests. See `references/obsidian-brain-enforcement-implementation.md`.
- When the user asks to do all safe recommendations after a cleanup, finish the hygiene loop: sync operational SQLite to the durable SQLite repo via `.backup`, commit/push durable DB changes, validate and commit/push agent code/test fixes, inspect remaining Obsidian mirror stubs before deciding whether to remove or commit them, then verify all repos are clean/synced. See `references/safe-recommendation-follow-through-after-cleanup.md`.
- When cleaning the {{SITE_NAME}} candidate backlog, treat it as safe operational state work if limited to SQLite task rows, audit events, outbox, and Obsidian mirror notes. Re-read the authoritative DB immediately before apply because autopilot can change counts mid-session; normalize wrong non-empty `target_file` values when URL resolution points to an existing static file, group candidates by normalized keyword+URL, keep the highest-priority candidate, mark duplicates `cancelled` with `superseded_by` metadata rather than deleting, process Obsidian outbox, checkpoint/vacuum SQLite, commit/push SQLite + Obsidian, and verify zero duplicate groups, zero missing candidate target files, zero pending outbox, clean repos, and active `run-task-executor.sh` cron. See `references/safe-backlog-cleanup-dedupe-target-files.md`.
- When the user explicitly asks to remove/purge cancelled jobs â€œfrom database/SQL/Obsidian/everywhere,â€ treat it as Safe destructive cleanup only after a SQLite backup. Use the project tool `node tools/purge_cancelled_jobs.js --db /opt/client-sqlite/seo-agent.db --obsidian-root /opt/client-obsidian --apply --json`, rerun once if cron creates new cancelled rows during the window, process Obsidian outbox, regenerate stale daily reports/dashboard if they still mention cancelled rows, run `PRAGMA integrity_check`, verify zero `status LIKE '%cancel%'` rows across task/outbox/deployment/etc. tables and zero `cancelled|canceled` Obsidian markdown mentions, then commit/push `/opt/client-agent`, `/opt/client-sqlite`, and `/opt/client-obsidian`. Keep the pre-purge backup outside the SQLite repo so the durable repo itself has no cancelled-job backup artifact.
- When fixing {{SITE_NAME}} rank tracking, verify `analyze_serp_movement.js` writes the live `serp_checks` schema (`serp_check_id`, `keyword`, `provider`, `position`, `url`, `domain`, `snapshot_json`, `checked_at`, `created_at`, `metadata_json`), backfill from both `tools/out/serp-movement` and `tools/out/serp-history` idempotently, keep expanded rank keywords in `config/rank_tracking_keywords.txt`, ensure keyword-file comments are ignored, generate `/opt/client-obsidian/04-Dashboards/Rank Tracking Dashboard.md`, and test with `node --test test/serp-db-persistence.test.js test/rank-dashboard.test.js` plus the full Node test suite. See `references/rank-tracking-persistence-and-dashboard.md`.
- When the user asks what will happen in the next hour or two, classify as Safe/read-only and forecast from cron cadence plus the authoritative queue, not intuition: check `crontab -l`, relevant cron wrappers, recent `cron_runs`, candidate lane counts, top executor picks, and task-executor logs. Distinguish true completions/deploys from semi-safe `monitored/no_preview_required` outcomes. See `references/task-executor-near-term-forecast.md`.
- When the user asks what happened in the last SERP/opportunity trigger, classify as Safe/read-only and audit from concrete artifacts: opportunity logs, latest `opportunity-scan-*.json`, `serp-movement/scan-*.json`, task candidate rows, task events, and executor artifacts. Separate scan/generation from later executor action, report which DB each fact came from if repo-local and authoritative DBs differ, confirm whether `protect_ranking_gain` changed files or only recorded a snapshot, and flag `switch.monster` leakage or prune schema errors such as `no such column: task_type`. See `references/serp-opportunity-trigger-audit.md`.
- When the user asks for a 2-hour, 12-trigger `*/10` audit, classify each expected boundary with evidence (`*/10` trigger time, matched task-executor artifact, outcome):
  - `processed` (total > 0)
  - `no-work` (artifact exists with total == 0)
  - `suppressed` (expected boundary missing and dirty/blocking refusal observed)
  - `runtime-error` (artifact or log shows execution failure)
  - Use `references/task-executor-12-slot-trigger-audit.md` for the exact extraction script and logging caveats (ignore non-boundary manual runs).
- When the user suspects trigger is not firing or tasks are "competing", prove with logs + cron evidence before changing schedules:
  1. verify wrapper scheduling (`crontab -l` and any Hermes `cronjob` layer if present)
  2. inspect `/opt/client-agent/tools/cron/run-task-executor.sh` and `/opt/client-agent/tools/cron/run-blog-publisher.sh` for early exits (notably repo cleanliness gates)
  3. inspect `logs/task-executor.log` and `logs/blog-publisher.log` for `Task executor processed ...` / `Starting Hermes blog publisher ...` vs `Website repo is dirty; refusing to start ...`
  4. verify corresponding DB rows in `cron_runs` when available, but do not rely on `cron_runs` alone because these wrappers may log to files even when the table lacks rows
  5. if you see regular `dirty` exits plus repeated 0-task reports, classify as a dirty-worktree gating issue first, then apply the wrapper fallback checks below
  6. for dirty blog previews, prefer completion only if safe, because wrapper now supports a guarded continuation path:
     - `CLIENT_TASK_EXECUTOR_ALLOW_DIRTY=1` (default): allows execution with local dirt, with no freeze
     - `CLIENT_TASK_EXECUTOR_STASH_DIRTY=1` (default): auto-stash/restore around execution
     - if stash fails, execution continues with explicit `--allow-dirty` and logs restore steps
     - use this to avoid repeated scheduler skips while you clean/deduplicate generated worktree state
  7. for a proof run, keep a temporary stash backup (for example `git stash push -u -m 'temp-clean-for-task-executor-<date>'`), switch to clean `master`, and run the exact cron wrapper (`./tools/cron/run-task-executor.sh`) rather than only `run_task_executor.js` to test preflight + apply-path behavior end-to-end
  8. rerun one wrapper cycle and confirm a fresh report appears with a non-`dirty` path and non-zero `processed` when candidates exist
  - Use `references/task-executor-dirty-repo-blocks-10m-run.md` for the exact failure signature, including blog-publisher max-turn/tool-limit partial-preview cases.
  - Use `references/blog-publisher-partial-preview-dirty-repo.md` for the preserve-vs-discard decision tree when a partial new-blog preview dirties the shared site worktree.
  - Use `references/task-executor-dirty-repo-auto-stash-runbook.md` for the committed fallback pattern now in `run-task-executor.sh`.
- When the user asks to change the Brain-aware run cadence, treat it as a Safe operational scheduler change if limited to cron and scheduler defaults: back up the live crontab, update the live `run-daily.sh` line, update both Linux and Windows scheduler installer defaults so reinstall does not revert it, verify syntax/tests/generated crontab, calculate next Dhaka/UTC runs, then commit/push `/opt/client-agent`. See `references/brain-aware-cron-cadence.md`.
  - For the task/blog executor cadence split used in this project (`run-task-executor.sh` + `run-blog-publisher.sh`), see `references/task-executor-cadence-15-to-10-2026-06.md` for an exact Linux-only one-pass edit pattern.
- When a Hermes cron job reports `Skill(s) not found and skipped` for a {{SITE_NAME}} skill that appears installed, verify the exact loadable runtime alias before assuming the workflow failed. `hermes skills list` can show the declared `name:` while cron/`skill_view` may resolve a folder slug such as `system-rules`; update the cron job's `skills` array to the loadable alias and re-list the job. See `references/hermes-cron-skill-alias-verification.md`.
- When the user asks what a background process/task is during {{SITE_NAME}} site work, classify as Safe/read-only, cross-check both Hermes tracked processes and OS listeners/processes, and explain whether it is only a local preview server versus an automation/deploy task. Do not kill local preview servers unless asked. See `references/local-preview-background-process-triage.md`.
- When applying PR review comments to a {{SITE_NAME}} preview/agent branch, prefer a temporary detached `git worktree` from `origin/<branch>` so the shared `/opt/client-site` checkout stays clean on `master` for autopilot/cron. Patch, run focused content assertions plus `npm test`/`git diff --check`, commit, push `HEAD:<branch>`, verify the remote tip, remove the worktree, and report the PR URL/commit/validation. See `references/preview-branch-review-fix-worktree.md`.
- When GSC reports rich-result **Duplicate field `FAQPage`**, classify as Safe if the work only removes duplicate schema markup while preserving visible FAQ content. Add a high-priority task through project tooling, keep canonical JSON-LD FAQPage, remove duplicate FAQ microdata attributes, validate live that each affected URL has exactly one FAQPage JSON-LD source and zero FAQPage microdata sources, then record deployment/task state and sync Obsidian outbox. See `references/duplicate-faqpage-rich-result-fix.md`.

## Consolidated task and state operations lanes

Use this umbrella for {{SITE_NAME}} operational queue/state workflows instead of maintaining one micro-skill per queue artifact:

### Task queue audit / task-list lane
- When the user asks for a task list, priorities, todo, next work, or queue health, classify as Safe/read-only and query the authoritative DB `/opt/client-sqlite/seo-agent.db` before reporting.
- Report status counts, risk distribution, candidate/preview/monitored groups, priority ordering (`priority_score` descending then `created_at` ascending), and lane buckets separately for general operational work vs blog writing/editing/review.
- Treat missing/blank `task_type` in exported Markdown as valid monitor-family rows unless DB fields prove otherwise; prefer `./seo-agent export-tasks` as a readable artifact but reconcile with SQLite counts.
- Keep this lane read-only unless the user explicitly asks for backlog mutation.

### Task executor / cron safety lane
- Separate generic executor, blog publisher, blog editor, and preview-review lanes; generic safe execution must not process `new_blog_post` tasks unless an explicit operator flag is set.
- Verify Linux `crontab -l` as source-of-truth before assuming Hermes cron owns cadence; keep staggered schedules and shared worktree locks so lanes do not mutate `/opt/client-site` simultaneously.
- Wrapper behavior must preselect eligible work before git/stash operations, refuse or explicitly allow/stash dirty repos with logged reasons, and restore safely. Never silently run dirty.
- For â€œwas a blog triggered?â€ or similar status questions, use an evidence ladder: cron lines, wrapper logs, cron/task artifacts, DB task events, skip reasons, and lane-specific logs.

### Approval/task reconciliation lane
- Approval-required task closeout is a state-sync workflow, not a code deployment workflow. Pull fresh GitHub PR metadata and a task snapshot in the same pass.
- Only high-confidence taskâ†”PR evidence should auto-transition task state; medium/low confidence mappings must be reported for manual review.
- Inspect schema before writes, update status with audit event metadata, recompute counts, and sample-check changed rows. Do not infer taskâ†”PR linkage from task rows alone unless explicit fields exist.

## When to Use
Use this for {{SITE_NAME}} operational tasks that combine repo hygiene, pre-flight checks, queue/cron/task-state inspection or mutation, CLI pipeline runs, and final reporting. This is an umbrella complement to the narrower {{SITE_NAME}} daily-loop/system-rules skills.

## Core Rules
- Consolidated queue/executor/approval sibling package inventory: `references/absorbed-operations-task-state-skills-20260602.md`.
- Load and obey `client-system-rules` before any SEO action.
- SQLite is the source of truth; do not delete or hand-edit the database to make Git clean.
- Do not bypass dirty-repo pre-flight checks. For scheduler-runner safety, use the guarded fallback in the wrapper first (`CLIENT_TASK_EXECUTOR_ALLOW_DIRTY=1` default, optional `CLIENT_TASK_EXECUTOR_STASH_DIRTY=1`): stash/restore generated worktree state around execution, or run with explicit `--allow-dirty` when no stash is possible, then classify/fix remaining dirt in a separate follow-up step.
- When dirty-worktree recovery is used, preserve the created stash entry as part of operator context, rerun safely, and only then reconcile/clean those recovered local changes (do not auto-delete generated drafts unless explicitly approved).
  - See `references/task-executor-dirty-repo-operator-recovery.md` for the exact proof-command sequence and decision log format.
- Use the provided CLI/pipelines (`seo-agent ...` or `node tools/...`) rather than editing site, SQLite, or Obsidian files directly.

## Daily Loop Repo-Hygiene Pattern
If `seo-agent daily` is blocked by dirty repos, inspect the exact `git status --porcelain` entries and remediate only expected generated/runtime files.

Known project-aligned fixes:
1. `/opt/client-sqlite` with `?? seo-agent.db`
   - This repo exists to store SQLite state.
   - Commit the database rather than deleting it:
     ```bash
     cd /opt/client-sqlite
     git add seo-agent.db
     git commit -m "Track SEO agent database state"
     git push -u origin main
     ```
2. `/opt/client-agent` with `?? logs/`
   - Runtime logs should be ignored, not committed:
     ```bash
     cd /opt/client-agent
     printf "\nlogs/\n" >> .gitignore
     git add .gitignore
     git commit -m "Ignore runtime logs"
     git push -u origin main
     ```
   - If `.gitignore` already has nearby runtime-output rules, patch it instead of appending duplicate blocks.

After remediation, rerun the full pre-flight:
```bash
for repo in /opt/client-site /opt/client-sqlite /opt/client-obsidian /opt/client-agent; do
  git -C "$repo" status --porcelain
done
df -h /opt
sqlite3 /opt/client-sqlite/seo-agent.db "SELECT 1;"
```
Only proceed when all repos are clean and SQLite responds.

If the daily run or a safe post-run cleanup changes task queue state after the first daily summary is generated, regenerate the summary before reporting so the user-facing Tomorrow's Queue is not stale. Process Obsidian outbox in batches until `processed` is `0`, then run `generate_daily_summary.js`, sync the regenerated report, and re-check outbox status. See `references/daily-loop-post-cleanup-summary-regeneration.md`.

## Running the Daily Loop
```bash
cd /opt/client-agent
seo-agent daily
```
If `seo-agent` is not on PATH but npm scripts are configured, use the project-provided equivalent such as `npm run daily`.

## Heartbeat / Dead-Man Alert Triage
Use this sequence for `heartbeat_stale`, `heartbeat_failed`, and related monitor alerts:
1. Classify risk first. Initial inspection is Safe; code fixes to monitor scripts are Safe if they do not touch site content; production/site edits remain separately classified.
2. Inspect current state without raw DB writes:
   ```bash
   cd /opt/client-agent
   date -u
   ps -eo pid,ppid,stat,etime,cmd | grep -E 'seo-agent|daily-seo|node tools|npm run daily|cron' | grep -v grep || true
   crontab -l
   tail -160 logs/monitor.log logs/daily.log 2>/dev/null || true
   sqlite3 -header -column tools/out/state/seo-agent.db "SELECT job_name,status,heartbeat_at,last_successful_run_at,last_failed_run_at,error_summary FROM heartbeats ORDER BY job_name;"
   sqlite3 -header -column tools/out/state/seo-agent.db "SELECT cron_run_id,job_name,status,started_at,finished_at,error_summary FROM cron_runs ORDER BY started_at DESC LIMIT 12;"
   sqlite3 -header -column tools/out/state/seo-agent.db "SELECT alert_id,alert_type,severity,status,message,triggered_at,resolved_at FROM monitor_alerts WHERE status='open' ORDER BY triggered_at DESC LIMIT 20;"
   ```
3. If a daily/periodic job is `completed`, do not treat age > 30 minutes as failure. Check whether the scheduled cron has missed its expected interval instead.
4. If an orphan heartbeat is stuck `running`, look for job-name mismatch between `record_heartbeat start`, mid-run `beat`, and `finish`. Clear state only through project CLIs such as `node tools/record_heartbeat.js ...`; never raw-update SQLite.
5. Reproduce and verify fixes on a copied DB first:
   ```bash
   TMPDB="/tmp/seo-agent-monitor-regression-$$.db"
   cp tools/out/state/seo-agent.db "$TMPDB"
   node tools/run_deadman_monitor.js --db "$TMPDB" --json --out /tmp/deadman-regression.json
   ```
6. After remediation, run the monitor once against the real DB to resolve stale false-positive alerts, then verify no open `heartbeat_stale` alerts remain.

## Reporting Checklist
After completion, report:
- Repo fixes applied and pushed, including short commit hashes if available.
- Pre-flight status: clean/dirty per repo, disk usage, SQLite lock/query check.
- Daily loop status: started/completed timestamps and final status.
- What was checked: repo health, disk, SQLite integrity, stale lock cleanup, GSC, SERP, task candidates, dead-man monitor, outbox, summary generation.
- Counts: GSC opportunities, SERP keywords, task candidates, executor processed safe/semi-safe/high-risk counts, outbox jobs, email outbox jobs.
- Safe fixes applied, semi-safe previews created, high-risk approval requests sent, deployments, failed validations, lock issues, stuck/dead-letter jobs.
- Non-blocking failures that occurred inside the pipeline.

## Useful Output Artifacts
See `references/daily-loop-repo-hygiene.md` for the concrete repo-hygiene remediation pattern and verification commands from an actual daily-loop unblock.

The daily command prints the exact paths; common artifacts are:
- `tools/out/runs/daily-observer-<timestamp>.json` â€” step-level status and partial failures.
- `tools/out/executor/task-executor-<timestamp>.json` â€” safe/semi-safe/high-risk execution counts.
- `tools/out/obsidian-sync/obsidian-sync-<timestamp>.json` â€” outbox processing details.
- `tools/out/reports/daily-YYYY-MM-DD.md` â€” user-facing daily summary.

## Pitfalls
- `email_approvals` IMAP authentication failures are reportable but can be non-blocking if the daily observer continues and records heartbeat finish successfully.
- Experimental SQLite warnings from Node are informational unless the command exits non-zero.
- A clean `client-obsidian` repo may have no HEAD/unborn branch; report that accurately instead of treating it as dirty.
- Do not record one day's task IDs, report IDs, or commit hashes as persistent rules; include them only in the session summary.
