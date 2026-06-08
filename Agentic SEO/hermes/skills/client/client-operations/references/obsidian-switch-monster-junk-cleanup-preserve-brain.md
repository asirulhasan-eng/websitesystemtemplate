# Obsidian switch.monster junk cleanup while preserving Brain no-go rule

## Trigger
Use when {{OWNER_NAME}} asks to remove/clear `switch.monster` or `switch-monster` junk from the Obsidian vault, but explicitly says not to remove that it is banned/no-go/task-blocked.

## Risk lane
Safe if limited to `/opt/client-obsidian` mirror/navigation cleanup and compiled Brain refresh. Do not touch production site or deploy.

## Key distinction
- Remove generated junk task/topic/target notes and stale relationship links outside the Brain.
- Preserve `01-Agent-Brain/No-Go Sources.md` and compiled Brain files that enforce the no-go/task-ban rule.
- Remaining `switch.monster` mentions should be only in `01-Agent-Brain/` policy/compiled files.

## Workflow
1. State risk classification first: Safe Obsidian cleanup; no production edit/deploy.
2. Verify source-of-truth task state before cleanup:
   ```bash
   cd /opt/client-agent
   for db in /opt/client-agent/tools/out/state/seo-agent.db /opt/client-sqlite/seo-agent.db; do
     sqlite3 "$db" "SELECT COUNT(*) FROM tasks WHERE status='candidate' AND lower(COALESCE(title,'') || ' ' || COALESCE(description,'') || ' ' || COALESCE(target_url,'') || ' ' || COALESCE(target_file,'') || ' ' || COALESCE(target_keyword,'') || ' ' || COALESCE(metadata_json,'')) LIKE '%switch.monster%';"
   done
   ```
3. In `/opt/client-obsidian`, enumerate files containing `switch.monster` or `switch-monster`, including path matches.
4. Remove tracked generated junk notes with `git rm`, typically under:
   - `02-Tasks/*switch*monster*.md`
   - `03-Topics/*switch*monster*.md`
   - `05-Targets/*switch*monster*.md`
5. Patch non-Brain relationship/index notes to remove links to removed switch-related notes. If a target index has no related tasks left, replace the section with `- None currently mirrored.`
6. Recompile and health-check the Brain so compiled files remain aligned:
   ```bash
   cd /opt/client-agent
   node tools/compile_obsidian_brain.js --vault /opt/client-obsidian --json
   node tools/check_obsidian_brain_health.js --vault /opt/client-obsidian --json
   ```
7. Validate:
   - zero non-Brain `switch.monster`/`switch-monster` mentions;
   - zero `02-Tasks`, `03-Topics`, or `05-Targets` files matching `*switch*monster*.md`;
   - no broken switch-related wikilinks;
   - Brain health `ok: true` and `no_go_drift` ok;
   - active candidate count for `switch.monster` remains 0 in both DBs.
8. Commit and push only the Obsidian repo changes.

## Reporting
Report:
- Safe risk lane.
- Removed file counts by directory.
- Confirmation that Brain/no-go rule was preserved.
- Commit hash and pushed branch.
- Verification evidence: non-Brain mentions 0, junk files 0, broken wikilinks 0, Brain health ok.

## Pitfalls
- Do not delete `01-Agent-Brain/No-Go Sources.md` just because it contains `switch.monster`; that is the policy record the user wants preserved.
- Do not remove compiled Brain no-go mentions; regenerate them after cleanup.
- Do not treat Obsidian as source of truth for task status. Check SQLite candidate counts before and after.
