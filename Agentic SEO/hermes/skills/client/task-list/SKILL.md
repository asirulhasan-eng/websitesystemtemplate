---
name: client-task-list
description: Retrieve and format the real {{SITE_NAME}} candidate task list from the SQLite database. Use when the user asks for "task list", "todo", "todo list", "what is next", "priority tasks", or any query about tasks.
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, Tasks, Priority]
    related_skills: [client-system-rules]
    requires_tools: [terminal]
---
# {{SITE_NAME}} Task List Retriever

## When to Use
Use this skill when the user asks for "task list", "todo", "todo list", "what's next", "priority tasks", or asks about the candidates/tasks queued for execution.

## Procedure
1. Execute the following command in the terminal to retrieve the candidate task list in JSON format:
   ```bash
   seo-agent export-tasks --status candidate --json
   ```
   *Note: If `seo-agent` is not in the path, run `node tools/export_task_queue.js --status candidate --json` from `/opt/client-agent`.*

2. Parse the JSON output:
   - Sort all tasks by `priority_score` descending (highest score first).
   - Filter out any tasks that do not have `status: "candidate"`.

3. Group tasks into the following priority categories based on their `priority_score`:
   - **High priority**: score >= 800
   - **Medium priority**: score 700 to 799
   - **Low priority**: score < 700

4. Output the categorized lists. Number the tasks sequentially (1, 2, 3...) across all priority bands in the response. Format each task exactly like this (use double spaces at the end of lines or newlines to ensure proper markdown line breaks):
   ```
   [Number]. [priority_score] â€” [Formatted Risk Level]  
   [task_id]  
   [title]
   ```
   *Format the Risk Level as follows:*
   - `safe` -> `Safe`
   - `semi_safe` -> `Semi-safe`
   - `high_risk` -> `High-risk`

5. Under the lists, add a **Recommended next action** section:
   - Identify the top `safe` tasks (highest priority first). Mention them by ID and suggest starting with them (e.g. "Start with the 2 safe high-priority tasks:\n\n1. CAND-X\n2. CAND-Y").
   - Explicitly add the following text to guide the user:
     "These are safe ranking-protection tasks and do not require approval.

     The semi-safe ranking recovery tasks should use preview branch + Cloudflare preview + email review before production."

