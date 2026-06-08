# Active skill-update mandate (session-specific)

## Trigger observed
User explicitly requested a hard check-in: "Review the conversation above and update the skill library... a pass that does nothing is a missed learning opportunity, not a neutral outcome."

## Durable update extracted
From this exchange, the curation behavior should now enforce:

- If the user asks for library review/update, do **not** skip updates.
- Treat the ask as a mandatory curation action in that turn.
- Only use `Nothing to save.` when the requested updates are impossible (e.g., only protected skills are viable) or no reusable class-level learning exists.
- Preserve class-level scope; avoid one-session-only naming.

## Related policy reminders
- Keep `references/`, `templates/`, and `scripts/` for detailed/session-specific materials and deterministic probes instead of bloating SKILL.md.
- Avoid encoding transient environment/tool state failures as permanent rules; store fixes/patterns instead.