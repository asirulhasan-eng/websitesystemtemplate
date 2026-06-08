# 10-minute task-executor trigger audit (12 slots)

Use this runbook when the user asks: "what happened in last 2 hours" for the 10-minute executor cron.

## Scope
- Window should be the exact last 2h of wall-time in {{TIMEZONE}}.
- Expect **12 boundaries**: `:00, :10, :20, :30, :40, :50` repeated twice.
- Use only real `*/10` cron artifacts as ground truth, then explicitly mark manual/extra reports separately.

## Evidence sources (preferred order)
1. `/var/spool/cron/crontabs/root` (or `crontab -l` equivalent)
2. `/opt/client-agent/logs/task-executor.log`
3. `/opt/client-agent/tools/out/executor/task-executor-*.json`

## Classification definition
- `processed`: report exists with `total > 0` (some task executed)
- `no-work`: report exists with `total == 0`
- `suppressed`: no report for expected wall-time boundary and a clear dirty/blocking refusal was logged
- `runtime-error`: report exists but has failed row/state in `.results[*].status`, or log shows immediate runtime/fatal errors

## Fast audit command
```bash
cd /opt/client-agent
python3 - <<'PY'
import json, re
from datetime import datetime, timedelta
from zoneinfo import ZoneInfo
from pathlib import Path

log = Path('logs/task-executor.log').read_text(errors='ignore').splitlines()
log_lines = [l for l in log if l.strip()]
now = datetime.now(ZoneInfo('{{TIMEZONE}}'))
start = now - timedelta(hours=2)

# gather expected filenames from cron artifacts within window
artifacts = sorted(Path('tools/out/executor').glob('task-executor-202*.json'))
rows = []

def utc_to_dhaka(name):
    # filename: task-executor-20260601T192003Z.json (UTC)
    m = re.search(r'task-executor-(\d{8}T\d{6})Z\.json', name)
    if not m:
        return None
    return datetime.strptime(m.group(1), '%Y%m%dT%H%M%S').replace(tzinfo=ZoneInfo('UTC')).astimezone(ZoneInfo('{{TIMEZONE}}'))

for p in artifacts:
    dt = utc_to_dhaka(p.name)
    if not dt or not (start <= dt <= now):
        continue
    # keep only minute ending 00/10/20/30/40/50
    if dt.minute % 10 != 0:
        continue
    data = json.loads(p.read_text())
    selected = data.get('selected',{})
    total = int(data.get('total', 0) or 0)
    status = 'processed' if total > 0 else 'no-work'
    # explicit runtime error if any status is non-ok
    if any(isinstance(r, dict) and r.get('status') and r.get('status') != 'ok' for r in data.get('results', [])):
        status = 'runtime-error'
    rows.append((dt, p.name, selected.get('safe',0), selected.get('semi_safe',0), selected.get('high_risk',0), total, status))

# expected 12 slots in window
print('WINDOW', start.isoformat(), 'to', now.isoformat())
for r in rows[-12:]:
    print(f"{r[0].strftime('%Y-%m-%d %H:%M:%S%z')} | {r[1]} | safe={r[2]} semi={r[3]} high={r[4]} total={r[5]} | {r[6]}")

# suppression check
suppressed = sum(1 for l in log_lines if 'Website repo is dirty; refusing to start task executor.' in l)
if suppressed:
    print('suppressed_lines=', suppressed)

print('counted_rows=', len(rows))
PY
```

## Handling boundary cases
- If a report exists at `:18` or `:38` (or any non-boundary minute), classify it as **manual/retry**, not part of the `*/10` 12-slot set.
- If logs show a suppressed message but no clean boundary reports after that time, classify missing boundaries as `suppressed` (not `no-work`).
- Keep the matrix explicitly short: wall-time, matched artifact, lane counts, status.

## Manual cross-check
Use when the class script disagrees with intuition:
```bash
grep -E "(Task executor processed|Website repo is dirty; proceeding with guarded fallback flow|Website repo is dirty; refusing to start task executor)" logs/task-executor.log | tail -n 80
```

- After classification, include both the table and the evidence source in user-facing output.