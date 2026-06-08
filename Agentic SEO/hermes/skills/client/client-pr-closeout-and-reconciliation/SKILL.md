---
name: client-pr-closeout-and-reconciliation
description: Use when {{SITE_NAME}} PRs need one-by-one merge/closeout, conflict resolution, or SQLite task-state reconciliation after GitHub/chat/manual integration.
category: client
triggers:
  - User asks to merge {{SITE_NAME}} PRs one by one
  - User asks to resolve PR conflicts and close PRs
  - User says PRs were merged via chat/manual path and tasks must be marked completed
  - GitHub reports {{SITE_NAME}} PRs as CONFLICTING/DIRTY/not mergeable
  - Preview-ready or approval-required {{SITE_NAME}} tasks need DB closeout after PR evidence
summary: >
  Class-level workflow to merge conflicting or preview-ready {{SITE_NAME}} PRs
  one-by-one, resolve shared-file conflicts safely, and keep SQLite task/approval
  state reconciled with deterministic evidence.
owner: hermes-agent
updated: 2026-06-01
metadata:
  hermes:
    tags: [{{SITE_NAME}}, GitHub, PRs, conflicts, SQLite, task-reconciliation]
    related_skills: [client-system-rules, client-operations, client-blog-publisher, personal-assistant-operating-loop]
---

# {{SITE_NAME}} PR closeout + task reconciliation

Use this when you have one or more open `client-site` PRs that are
conflicting (`mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`) and/or need
manual conflict resolution before completion, then must reconcile `tasks` state
in `/opt/client-sqlite/seo-agent.db`.

## Scope

- Repository: `/opt/client-site`
- DB: `/opt/client-sqlite/seo-agent.db`
- Primary conflict hotspots from this workflow:
  - `blog/index.html`
  - `sitemap.xml`
  - `tools/link-registry.json`

## Trigger conditions

- Open PRs fail `gh pr merge` with conflict/no-mergeable errors.
- You need deterministic cleanup after manual conflict resolution.
- Approval-required task records should remain audit-complete after merge proof.

## Prerequisites

- Git/GitHub CLI authentication available.
- Local checkout on `master` in a clean state.
- PR list and metadata available via `gh`.
- Keep branch hygiene discipline: return to clean `master` between PR attempts.
- If the worktree is dirty before PR work, classify every path before touching it:
  - PR-related generated/merge artifact â†’ include only if it belongs to the PR.
  - unrelated generated file/log â†’ preserve or explicitly remove only when provenance is clear.
  - unknown user work â†’ stop or stash safely; do not overwrite/delete blindly.

## Step-by-step (class-level)

### 1) Confirm state and open PR inventory

1. `git status --short`
2. `git checkout master && git pull --ff-only origin master`
3. `gh pr list --state open --json number,title,state,mergeable,mergeStateStatus,baseRefName,headRefName,url`
4. For each PR, inspect target metadata:
   - `gh pr view <N> --json mergeable,mergeStateStatus,number,state,headRefName,baseRefName`

### 2) Attempt direct merge first (safe path)

- Try `gh pr merge <N> --squash --delete-branch`.
- If it works, push/refresh and continue to next PR.

### 3) Manual conflict resolution path

When GH merge is blocked:

1. `gh pr checkout <N>`
2. `git fetch origin master`
3. Rebase branch onto base:
   - `git rebase origin/master`
4. Resolve merge markers in:
   - `blog/index.html`
   - `sitemap.xml`
   - `tools/link-registry.json`

Conflict resolution rules:

- Do **not** drop distinct entries from either side.
- In `blog/index.html`, keep unique card blocks for both PRs.
- In `tools/link-registry.json`, preserve all `"slug"` entries; remove conflict markers only.
- In `sitemap.xml`, dedupe `<loc>` entries and preserve both article URLs.

5. Stage files and continue:
   - `git add <resolved files>`
   - `git rebase --continue`
6. Return to master and finalize:
   - `git checkout master`
   - `git merge --ff-only <pr-branch>`
   - `git push origin master`
7. Verify PR state:
   - `gh pr view <N> --json state,mergedAt,closedAt`

Manual integration caveat:

- After a conflict-resolved branch is fast-forwarded into `master` and pushed,
  GitHub may show the original PR as `CLOSED` with `mergedAt: null` rather than
  `MERGED`. Treat that as **manually integrated/closed**, not a GitHub merge,
  only if all target artifacts are present on `origin/master`.
- Do not keep retrying `gh pr merge` once the branch content is already on
  `master` and the PR is no longer open; it can report `Pull Request is not
  mergeable` even though the work was integrated manually.
- If the PR remains open after manual integration, close it only after proof:
  `gh pr close <N> --delete-branch` is acceptable when `git branch --contains`
  or target-file evidence shows the PR content is already on `master`.
- Save PR metadata before closing/branch deletion when possible. `gh pr view
  <N> --json files` may return an empty file list after a manual close or head
  branch cleanup; use earlier PR snapshots and `events.metadata_json` as the
  audit trail.

### 4) Ensure clean handoff before next PR

- `git status --short` must be clean.
- If non-empty, abort and reopen recovery steps before touching next PR.
- Keep local working copy synced with origin:
  - `git fetch --all --prune`
  - `git pull --ff-only origin master`

### 5) Reconcile task database (only with evidence)

After PR closure/merge evidence exists:

1. Gather authoritative PR/file evidence before writing:
   - PR state: `gh pr view <N> --json number,state,mergedAt,closedAt,url,headRefName,baseRefName`
   - open inventory: `gh pr list --state open --json number,title,state`
   - target artifact checks in `blog/`, `blog/index.html`, `sitemap.xml`, and
     `tools/link-registry.json`
   - prior preview metadata from `tasks.metadata_json` and `events.metadata_json`
2. Map task rows by deterministic identifiers, not by broad status alone:
   - task id from branch name (`agent/<task_id>-...`)
   - `pr_url` or `/pull/<N>` inside `events.metadata_json`
   - exact `target_file` / `target_url` match
   - exact slug in sitemap and link registry
3. Update `tasks` only when evidence is deterministic.
4. Add an audit event for every state transition in `events`.

Useful SQLite probes:

```sql
SELECT task_id,status,target_file,target_url,approval_required,updated_at,completed_at
FROM tasks
WHERE task_id = '<TASK_ID>';

SELECT event_id,event_type,old_value,new_value,source,agent_name,created_at,metadata_json
FROM events
WHERE task_id = '<TASK_ID>'
ORDER BY created_at DESC;

SELECT task_id,status,target_file,target_url
FROM tasks
WHERE metadata_json LIKE '%/pull/<N>%'
   OR task_id IN (SELECT task_id FROM events WHERE metadata_json LIKE '%/pull/<N>%');
```

Minimum acceptable check before/after updates:

- `SELECT status, COUNT(*) FROM tasks WHERE approval_required=1 GROUP BY status;`
- Verify each transitioned task has a corresponding latest event:
  - `task_status_changed` with source/agent metadata and old/new status.

Preferred terminal transitions used in this project:

- `preview_ready -> deployed` for non-approval blog publisher tasks when PR/manual
  integration proof exists and target artifacts are on `master`.
- `candidate|monitored -> executed` for approval-required tasks only when the user
  explicitly confirms chat-based completion and repository/PR/file evidence supports it.
- Preserve existing historical events and append new ones.
- When a `preview_ready` blog task is closed out as `deployed`, also reconcile the
  matching latest `deployments` row when it is still `preview_ready`: set it to
  `deployed`, add the production URL, insert a `deployment_deployed` audit event,
  and enqueue both `update_obsidian_task_note` and `update_obsidian_deployment_note`.
  Otherwise Obsidian deployment notes can remain stale even though the task row is fixed.

Event-writing convention:

- Use an atomic SQLite transaction.
- Set `tasks.updated_at` and `tasks.completed_at` to the same UTC timestamp for terminal closeout.
- Insert `events.event_type='task_status_changed'`, `source='chat_merge_check'`,
  `agent_name='Hermes Assistant'`, `old_value=<prior status>`, `new_value=<target status>`.
- Include compact metadata keys: `source`, `status_updated_from`,
  `status_updated_to`, `github_state`, `matched_prs`, `proof`, `updated_by`,
  `updated_at`, and a short `note`.
- Do not bulk-update all `preview_ready` rows; update only the PR/task IDs proven by the current closeout.

## Risk gates

- **Safe**: direct `gh pr merge` without conflict.
- **Medium**: manual conflict resolution in shared files.
- **High**: any unresolved ambiguity in target-file mapping or evidence.

Before high-risk transitions in DB, request confirmation unless explicit instruction
already authorizes chat-based closeout.

## Pitfalls and anti-patterns

- Donâ€™t rely on GH auto-merge (`--auto`) in this repo class; policy has
  `enablePullRequestAutoMerge` disabled.
- Donâ€™t use speculative transitions for tasks when PR is merely local/branch-closed
  without origin proof.
- Donâ€™t leave conflict markers or unresolved staged state.
- Donâ€™t edit `blog/index.html`/`sitemap.xml`/`tools/link-registry.json` in
  ways that drop unique entries from either side of a conflict.
- Donâ€™t blindly concatenate sitemap conflict sides. `sitemap.xml` conflicts often start inside an already-open `<url>` node; a naive resolver can create nested/incomplete `<url>` elements that pass line-marker checks but fail XML parsing. Rebuild each affected `<url>` as a complete node (`<url><loc>...`) and run XML parsing before commit.
- Donâ€™t use a broad `grep '<<<<<<<\|=======\|>>>>>>>'` scan on HTML files as the only conflict check; decorative section comments often contain `=======` and create false failures. Anchor conflict marker scans to line start.
- Donâ€™t treat an immediate post-merge live 404 as final proof of failed deployment without a short cache-busted retry loop. Verify origin/master/file evidence first, then poll production before escalating to deploy credentials/manual deployment.
- Donâ€™t hardcode session-ephemeral artifacts as permanent rules.

## Verification checklist (required before reporting completion)

- `gh pr list --state open` should reflect expected closure.
- Shared files validate:
  - no real Git conflict markers remain; use an anchored check such as `^(<<<<<<<|=======|>>>>>>>)` because normal HTML separator comments can contain long `====` runs.
  - `tools/link-registry.json` parses as JSON
  - `sitemap.xml` parses as XML (for example `python3 - <<'PY' ... ET.parse('sitemap.xml') ... PY`)
  - both target slugs exist exactly once where expected
- Target article/file artifacts exist on `master` and are referenced by:
  - `blog/index.html`
  - `sitemap.xml`
  - `tools/link-registry.json`
- For review-comment fixes about a bad link, verify both sides explicitly:
  - the bad reviewed href is absent from the article on `origin/master` and live production
  - the replacement href points at a real backing file/route (for example `/services/{{NICHE}}-seo` backed by `services/{{NICHE}}-seo.html`)
- `npm test` (or the repo's focused validation command) passes when available.
- Live production verifies after deploy propagation. If the first cache-busted `curl -L` still returns stale 404/content immediately after merge, wait briefly and retry before declaring deployment failure.
- `git status --short` is clean, or any remaining dirty paths are explicitly unrelated and reported.
- `HEAD` and `origin/master` match after push/pull verification.
- DB approval-required status counts match evidence-backed totals.
- Every task transitioned during closeout has a latest deployment/task event with old/new values, source, timestamp, and proof metadata.


## Consolidated PR merge/live-verification lanes

Use this umbrella for all {{SITE_NAME}} PR closeout workflows instead of separate batch/live-verification siblings:

### Batch PR merge + conflict verification lane
- For conflict-heavy blog PR sets, do not bulk merge. Snapshot open PR state once, then process exactly one PR at a time from clean `master`.
- If the user asks to wait/await before merging, make the delay explicit with a timestamped sleep, then re-inventory open PRs after the delay. Do not rely on a stale pre-wait PR list; new PRs may have appeared and old ones may have changed state.
- For â€œmerge all open PRsâ€ requests, the terminal condition is an open PR count of `0` (or a clearly reported blocker for each remaining PR), not merely â€œthe known PR list was processed.â€
- Expected blockers include `mergeable=CONFLICTING`, `mergeStateStatus=DIRTY`, direct merge â€œmerge commit cannot be cleanly created,â€ repository auto-merge disabled, and permission-limited check APIs. These are signals to use the local one-by-one path, not proof the content is impossible to land.
- Shared conflict surfaces are `blog/index.html`, `sitemap.xml`, and `tools/link-registry.json`; preserve every unique card, URL, registry slug, and article entry unless explicitly superseded.
- After each PR attempt, abort/finish any active merge or rebase, return to clean `master`, pull `--ff-only`, and log PR number + status + blocker/evidence before touching the next PR.

### Live-site verification lane
- A merge is not complete until production or preview visibility has deterministic evidence. Verify target article URL, `/blog/`, `/sitemap.xml`, registry entries, cache-busted HTTP responses when needed, and branch/commit/PR state.
- Treat â€œonly a few blogs visibleâ€ reports as potentially cache/deploy/index visibility issues: compare local history, GitHub PR state, live `/blog/`, sitemap, and Cloudflare/deploy signals before concluding merges failed.
- If `gh pr checks --json` or rich status fields fail in this environment, fall back to stable `gh pr view` fields (`number`, `state`, `mergedAt`, `mergeCommit`, `baseRefName`, `headRefName`, `url`) plus live HTTP checks.
- Immediately after a force-push/rebase, GitHub mergeability JSON can be stale (`headRefOid`, `DIRTY`, or `CONFLICTING` may still reflect the old branch). If local validation is clean, retry or attempt the actual merge rather than treating the stale fields as final.
- For static/Cloudflare deploys, live 404/stale sitemap immediately after merge can be deploy propagation. Use cache-busted `curl -L`, wait briefly, and retry before declaring production verification failed.

### Approval/task closeout lane handoff
- When PR closeout implies task-state updates, hand off to the `client-operations` approval/task reconciliation lane: update SQLite only from high-confidence evidence, write audit events, and report DB state separately from Git merge state.
- For blog preview deployments that are now live, prefer the project recorder over raw SQLite: `node tools/record_deployment.js finish --db /opt/client-sqlite/seo-agent.db --id <DEP> --status deployed --production <live-url> --validation-status passed`, then run `tools/sync_obsidian_outbox.js`, and commit/push the durable SQLite repo plus only the PR-related Obsidian notes. Leave unrelated dirty mirror files untouched and report them.

## References

- `references/pr-closeout-and-reconciliation-notes-2026-06-01.md` â€” session-level repro, exact command order, and observed merge-control behavior.
- `references/absorbed-pr-merge-verification-skills-20260602.md` â€” inventory of batch PR merge and live verification sibling packages consolidated into this umbrella.
- `references/pr71-review-fix-conflict-live-closeout-2026-06-02.md` â€” concrete review-fix closeout pattern: temp worktree for dirty shared checkout, anchored conflict-marker checks, stale mergeability after force-push, live deploy retry, and recorder/outbox DB closeout.
- `references/pr67-optout-merge-live-validation-20260602.md` â€” concrete example of clean PR merge with unrelated dirty-worktree preservation, anchored conflict-marker scanning, live URL polling after initial 404, and SQLite/Obsidian deployed closeout.
- `references/batch-conflict-pr-closeout-eight-blogs-20260602.md` â€” concrete example of honoring an explicit wait, re-inventorying all open PRs, resolving a conflict-heavy blog PR queue one-by-one, verifying open PR count zero, and reconciling SQLite/Obsidian deployed state.

## Output format to return users

When requested, reply with:
- risk classification
- commands run
- merged/closed PR list
- DB status summary
- evidence file/metadata used
