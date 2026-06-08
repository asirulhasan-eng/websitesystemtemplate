# {{SITE_NAME}} Task Queue Priority Export

Use this when the user asks for the {{SITE_NAME}} task list, priorities, or "what should we work on next".

## Risk lane
Read-only task discovery is **Safe**:
- no SQLite writes
- no Obsidian edits
- no site/production changes

## Commands
```bash
cd /opt/client-agent
seo-agent export-tasks
```

The command prints top queue rows and writes a JSON export like:

```text
tools/out/exports/task-queue-candidate-YYYYMMDDTHHMMSSZ.json
```

## Summarization pattern
Parse the newest exported JSON and present:
- total candidate count
- priority counts
- risk counts
- top tasks with `priority_score`, priority band, `risk_level`, `task_type`, `task_id`, and title
- optional CSV artifact for the full queue

Suggested priority bands:
- High: `priority_score >= 900`
- Medium: `700 <= priority_score < 900`
- Low: `< 700`

## {{SITE_NAME}}-specific filter
Treat any task/evidence containing `switch.monster` as fake impressions, per the {{SITE_NAME}} operations rules. Do not present those as real opportunities; either list them separately as excluded or report the count excluded.

## Example parsing snippet
```python
import json, csv
from pathlib import Path

src = max(Path('/opt/client-agent/tools/out/exports').glob('task-queue-*.json'), key=lambda p: p.stat().st_mtime)
data = json.loads(src.read_text())
rows = []
for t in data['tasks']:
    text = json.dumps(t).lower()
    if 'switch.monster' in text:
        continue
    score = t.get('priority_score') or 0
    band = 'High' if score >= 900 else 'Medium' if score >= 700 else 'Low'
    rows.append((score, band, t.get('risk_level'), t.get('task_type') or '', t.get('task_id'), t.get('title')))
for row in rows:
    print(' | '.join(map(str, row)))
```
