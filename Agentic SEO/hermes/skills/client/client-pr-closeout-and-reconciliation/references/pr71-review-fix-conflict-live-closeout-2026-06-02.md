# PR review-fix conflict + live closeout pattern (2026-06-02)

Use this as a concrete reference for a single {{SITE_NAME}} PR where the review comment asked for a small content/link fix, but the shared site checkout was dirty and the PR later needed conflict resolution.

## Situation

- PR branch had already been corrected to point an article overview link at `/services/{{NICHE}}-seo` instead of the nonexistent `/seo-for-{{AUDIENCE}}/`.
- Shared checkout `/opt/client-site` was dirty on a different preview branch, so direct edits there would have risked overwriting unrelated work.
- `gh pr merge --squash --delete-branch` initially failed with: `the merge commit cannot be cleanly created`.

## Durable workflow lesson

1. Use a temporary worktree from the PR head branch when the shared checkout is dirty:
   - `git worktree add -B <tmp-branch> /tmp/<repo-prN> origin/<pr-head>`
2. Validate the review fix on the branch before merging:
   - Exact bad-link scan for the reviewed URL.
   - Confirm target backing file exists (`services/{{NICHE}}-seo.html` for `/services/{{NICHE}}-seo`).
   - Parse `tools/link-registry.json` and `sitemap.xml`.
   - Check only real Git conflict markers with `^(<<<<<<<|=======|>>>>>>>)`; HTML comment separator lines containing many `=` are not conflict markers.
3. If direct merge fails, rebase the PR branch onto `origin/master` and resolve conflicts one-by-one.
   - For `blog/index.html`, preserve both unique cards from base and PR.
   - For `sitemap.xml`, rebuild complete `<url>` blocks for both URLs rather than sharing one node.
4. After force-pushing the rebased PR branch, GitHub mergeability fields can be briefly stale (`headRefOid`, `DIRTY`, or `CONFLICTING` still showing old data). A subsequent `gh pr merge` may still succeed once GitHub refreshes, so do not overreact to the immediate stale JSON if the push succeeded and local validation is clean.
5. After merge, verify both repository state and live state:
   - `gh pr view <N> --json state,mergedAt,mergeCommit,url`
   - `git show origin/master:<article>` contains the fixed link and not the reviewed-bad link.
   - `curl -L` the live article and sitemap with a cache-busting query. Cloudflare/static deploy may lag; retry after a short wait before declaring production missing.
6. For blog preview tasks, close the operational loop:
   - `node tools/record_deployment.js finish --db /opt/client-sqlite/seo-agent.db --id <DEP> --status deployed --production <live-url> --validation-status passed`
   - Run `tools/sync_obsidian_outbox.js` for generated task/deployment notes.
   - Commit/push the durable SQLite repo and only the PR-related Obsidian note changes; leave unrelated dirty mirror files untouched and report them separately.

## Verification commands used

```bash
python3 - <<'PY'
from pathlib import Path
import json, xml.etree.ElementTree as ET, re
paths=['blog/<article>.html','blog/index.html','sitemap.xml','tools/link-registry.json']
for p in map(Path, paths):
    s=p.read_text(encoding='utf-8')
    assert not re.search(r'^(<<<<<<<|=======|>>>>>>>)', s, re.M), f'conflict marker in {p}'
json.load(open('tools/link-registry.json', encoding='utf-8'))
ET.parse('sitemap.xml')
article=Path('blog/<article>.html').read_text(encoding='utf-8')
assert 'href="/bad-url/"' not in article
assert 'href="/services/{{NICHE}}-seo"' in article
assert Path('services/{{NICHE}}-seo.html').exists()
PY
npm test
```
