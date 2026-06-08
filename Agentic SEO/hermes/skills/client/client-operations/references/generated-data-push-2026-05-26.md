# Generated Data Push Example â€” 2026-05-26

## Trigger
User clarified that â€œsync Obsidianâ€ meant pushing whatever generated SEO data exists to GitHub.

## Working Pattern
From `/opt/client-agent`, generated data was under `tools/out/`:
- Current operational DB: `/opt/client-agent/tools/out/state/seo-agent.db`
- Generated Obsidian mirror: `/opt/client-agent/tools/out/obsidian/`
- Reports, GSC, SERP, task candidates, health, monitor, email/outbox output: other `tools/out/*` directories

The durable GitHub repos were:
- SQLite/raw data repo: `/opt/client-sqlite`
- Obsidian mirror repo: `/opt/client-obsidian`

Commands that worked:

```bash
# Safely copy current generated SQLite DB into the SQLite data repo.
sqlite3 /opt/client-agent/tools/out/state/seo-agent.db ".backup '/opt/client-sqlite/seo-agent.db'"

# Copy generated non-Obsidian outputs into the SQLite/raw-data repo.
mkdir -p /opt/client-sqlite/tools-out
rsync -a --delete --exclude 'obsidian/' /opt/client-agent/tools/out/ /opt/client-sqlite/tools-out/

# Copy the generated Obsidian mirror into the Obsidian repo.
# IMPORTANT: use --delete only after confirming tools/out/obsidian is a complete mirror.
# If it may be partial (for example, outbox just wrote a task/deployment note), copy only the
# specific generated files or rsync without --delete. A partial source + --delete will remove
# valid vault notes, and if .git is not excluded it can even remove repo metadata.
rsync -a --exclude '.git/' /opt/client-agent/tools/out/obsidian/ /opt/client-obsidian/

# Commit and push.
git -C /opt/client-sqlite add -A
git -C /opt/client-sqlite commit -m "Backup generated SEO data"
git -C /opt/client-sqlite push -u origin main

git -C /opt/client-obsidian add -A
git -C /opt/client-obsidian commit -m "Sync generated Obsidian mirror"
git -C /opt/client-obsidian push -u origin main
```

## Verification
Run:

```bash
for repo in /opt/client-site /opt/client-sqlite /opt/client-obsidian /opt/client-agent; do
  git -C "$repo" status --porcelain=v1
  git -C "$repo" status -sb | head -1
done
```

Expected result: clean repos and local branches tracking their remotes.

## Pitfall
`/opt/client-sqlite/seo-agent.db` can be stale compared with `/opt/client-agent/tools/out/state/seo-agent.db`; use SQLite `.backup`, not raw file editing, before committing generated DB state.

## Opportunity Noise Learned
Keywords containing `switch.monster` are fake impressions for {{SITE_NAME}}. If such tasks appear in generated GSC/task reports, treat them as noise, not real opportunities.
