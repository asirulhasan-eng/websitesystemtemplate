# GitHub PR CLI mergeability guardrails (June 2026)

Observed in PR merge flow for a semi-safe blog task:

- `gh pr checks <PR>` with unsupported `--json` flag returned:
  - `unknown flag: --json`
- `gh pr checks <PR>` without `--json` sometimes returned GraphQL permission errors such as:
  - `Resource not accessible by personal access token ...`
- `gh pr view <PR> --json state,mergeable,mergeStateStatus,url,title` may show:
  - `state: OPEN|MERGED`,
  - `mergeStateStatus: UNKNOWN`,
  - `mergeable: UNKNOWN`.

Practical resolution:
1. Treat `mergeStateStatus`/`mergeable` as metadata-limited under restricted token scope when they are `UNKNOWN`.
2. Use `gh pr view <PR> --json state,url,mergedAt,mergeCommit,baseRefName` to confirm merge outcome and commit.
3. Use `gh pr merge <PR> --squash --delete-branch` once approvals/merge intent is clear.
4. Sync workflow state from `sqlite`/Obsidian after merge (deployment status, production URL, outbox jobs), not from PR-check telemetry alone.

Reminder for this workflow:
- In this class of PR, successful `gh pr merge` + confirmed merged commit + clean `master` fast-forward was a stronger completion signal than `gh pr checks` output under the repo/token combination used.