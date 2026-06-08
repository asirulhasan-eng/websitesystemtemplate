# Hermes Cron Skill Alias Verification

## Trigger
Use this when creating, updating, or diagnosing a Hermes cron job that preloads {{SITE_NAME}} skills and reports warnings such as:

```text
Skill(s) not found and skipped: client-system-rules
```

## Durable lesson
Hermes skill discovery may list a skill by the `name:` in `SKILL.md`, while cron preloading / `skill_view` may resolve a different folder slug when duplicate or legacy skill directories exist. For example, a skill at:

```text
~/.hermes/skills/client/system-rules/SKILL.md
```

can declare:

```yaml
name: client-system-rules
```

but load successfully in runtime as:

```text
system-rules
```

while `client-system-rules` produces a skipped-skill warning.

## Procedure
1. Before scheduling or repairing a cron job with `skills=[...]`, verify each skill name with `skill_view(name=...)` in the same runtime context when available.
2. If a skill exists on disk but cron says it is skipped, test the folder slug as an alias, especially for category folders like `client/system-rules`.
3. Update the cron job to use the loadable alias, not only the declared `name:` shown by `hermes skills list`.
4. Re-run/list the cron job and confirm the `skills` array now contains loadable names.
5. Treat this as a config hygiene issue, not evidence that the job ignored all rules: other loaded umbrella skills may still carry overlapping rules. Still fix the warning so future runs are unambiguous.

## Example fix
For the {{SITE_NAME}} blog publisher autopick job, replace:

```text
client-system-rules
```

with:

```text
system-rules
```

while keeping:

```text
client-operations
client-blog-publisher
```
