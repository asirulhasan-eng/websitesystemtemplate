---
name: client-delegation-rules
description: Rules for delegating coding tasks safely
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Delegation, Safety]
    requires_tools: [delegate_task]
---
# {{SITE_NAME}} Delegation Rules

## When to Delegate
- Bug fixes in tool scripts
- New CLI command creation
- Test writing
- Documentation updates
- Database migration scripts

## When NOT to Delegate
- Production deployment decisions
- Risk classification decisions
- Approval processing
- Direct SQLite state changes
- Obsidian structure changes

## Good Delegation Template
Always use this format when delegating:
```
In /opt/client-agent, [specific task description].
Constraints:
- Do not change deployment code
- Do not touch /opt/client-site directly
- Do not modify .env files
- Add tests if applicable
- Run tests after changes
- Report: changed files, test results
```

## Bad Delegation (NEVER do this)
- "Improve the SEO system" (too broad)
- "Fix everything" (no constraints)
- "Deploy to production" (wrong delegation target)
- "Update the database" (needs CLI, not direct edits)
