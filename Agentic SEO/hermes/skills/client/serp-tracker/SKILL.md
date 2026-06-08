---
name: client-serp-tracker
description: Track keyword rankings using Serper and DataForSEO
version: 1.0.0
author: {{OWNER_NAME}}
platforms: [linux]
metadata:
  hermes:
    tags: [SEO, {{SITE_NAME}}, SERP, Rankings]
    related_skills: [client-system-rules, client-gsc-opportunity]
    requires_tools: [terminal]
---
# {{SITE_NAME}} SERP Tracker

## When to Use
When user asks: "Check rankings", "How are we ranking?", "Track keywords", or during daily/weekly SERP checks.

## Procedure
```bash
cd /opt/client-agent
seo-agent serp
```

## What It Tracks
- High-priority keywords (daily)
- Medium-priority keywords (weekly)
- Low-priority keywords (bi-weekly)
- Competitor movements
- Wrong URL ranking
- Position changes over time

## Data Storage
- Raw SERP data: /opt/client-sqlite/serp-history/
- Processed results: SQLite serp_checks table
- Human-readable: Obsidian 06-SERP-Research/

## Reporting
Show the user:
- Keywords that moved up (celebrate)
- Keywords that moved down (investigate)
- New keywords ranking
- Keywords at position 4-10 (opportunity zone)
- Competitor movements on money keywords
