# Local Preview / Background Process Triage

Use this when the user asks what a background process is during {{SITE_NAME}} site/content work, especially after local preview servers were started for validation.

## Pattern

1. Treat the question as Safe/read-only unless the user asks to stop/kill the process.
2. Do not rely on a stale chat process list alone. Cross-check both:
   - Hermes process manager: `process(action='list')` or `process(action='poll', session_id=...)` for tracked sessions.
   - OS process/ports: `ps -fp <pid>` or `pgrep -af 'python3 -m http.server|wrangler|npm|astro|vite'`, plus `ss -ltnp` for relevant ports.
3. Identify whether the process is:
   - a local preview/static server, e.g. `python3 -m http.server <port> --bind 127.0.0.1` in `/opt/client-site`;
   - a bounded validation/build process;
   - a long-lived external deploy/dev server;
   - stale/orphaned.
4. Explain in plain language:
   - command;
   - working directory if visible;
   - port/URL if listening;
   - age;
   - whether it changes production (local preview servers do not);
   - whether it is safe to leave running or stop.
5. Do not kill it unless the user explicitly asks or it is clearly blocking the requested task.

## Example answer shape

- `proc_...` is just a local static preview server, not an SEO automation task.
- Command: `python3 -m http.server 8087 --bind 127.0.0.1`
- Scope: local-only on `127.0.0.1`; it does not publish or modify production.
- Likely purpose: preview/validate `/opt/client-site` pages or assets.
- Next action: I can stop it if you want, otherwise it is safe but unnecessary after verification.

## Pitfall

Hermes `process list` can differ from what the user pasted if the process registry was reset, compacted, or belongs to a previous runtime. If Hermes shows no tracked processes, still inspect the OS process table and listening ports before answering.
