# Serper SEO Research Tools
**API Key:** `2812f605aa71e6ef397a8f553a2427918f7d5703`

---

## Quick Start

Open PowerShell in this folder (`tools/`) and run any script directly.

```powershell
cd "c:\Users\Administrator\Documents\{{NICHE}} website 2\tools"
```

---

## Script 1 â€” SERP Search (`serper-search.ps1`)

Run a Google search and see ranked results, knowledge graph, People Also Ask, and related searches.

**Endpoint:** `POST https://google.serper.dev/search`

### Examples

```powershell
# Basic organic results
.\serper-search.ps1 -Query "{{AUDIENCE}} seo"

# More results, geo-targeted
.\serper-search.ps1 -Query "{{AUDIENCE}} near me" -Country "us" -Num 20

# Show People Also Ask (keyword/content ideas)
.\serper-search.ps1 -Query "{{NICHE}} services" -Mode paa

# Show Related Searches (keyword ideas)
.\serper-search.ps1 -Query "{{NICHE}} services" -Mode related

# Show everything (organic + KG + PAA + related)
.\serper-search.ps1 -Query "{{NICHE}} services" -Mode all

# Export organic results to CSV (saved in exports/)
.\serper-search.ps1 -Query "{{AUDIENCE}} seo" -Export

# Knowledge graph only
.\serper-search.ps1 -Query "roto-rooter" -Mode kg
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-Query` | *(required)* | Search keyword |
| `-Country` | `us` | Country code (gl) |
| `-Language` | `en` | Language code (hl) |
| `-Num` | `10` | Number of results (max 100) |
| `-Page` | `1` | Page number |
| `-Mode` | `organic` | `organic` \| `paa` \| `related` \| `kg` \| `all` |
| `-Export` | *(flag)* | Save organic results to `exports/` as CSV |

---

## Script 2 â€” Webpage Scraper (`serper-scrape.ps1`)

Scrape any webpage and get clean plain text or markdown.

**Endpoint:** `POST https://scrape.serper.dev`

### Examples

```powershell
# Scrape a competitor's page (text + markdown)
.\serper-scrape.ps1 -Url "https://www.roto-rooter.com/services/"

# Get only markdown version
.\serper-scrape.ps1 -Url "https://example.com" -Mode markdown

# Get only plain text
.\serper-scrape.ps1 -Url "https://example.com" -Mode text

# Just metadata (page title etc.)
.\serper-scrape.ps1 -Url "https://example.com" -Mode meta

# Save output to file in exports/scraped/
.\serper-scrape.ps1 -Url "https://example.com" -Mode markdown -Save
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-Url` | *(required)* | Full URL to scrape |
| `-Mode` | `both` | `text` \| `markdown` \| `both` \| `meta` |
| `-Save` | *(flag)* | Save output to `exports/scraped/` |

> **Cost:** Each scrape costs **2 credits**.

---

## Script 3 â€” Batch SERP (`serper-batch.ps1`)

Research multiple keywords at once. Exports 3 CSVs: organic results, PAA, and related searches.

### Examples

```powershell
# Inline keyword list
.\serper-batch.ps1 -Keywords "{{AUDIENCE}} seo","{{NICHE}} marketing","local {{AUDIENCE}}"

# From a text file (one keyword per line)
.\serper-batch.ps1 -KeywordFile .\keywords.txt

# With options
.\serper-batch.ps1 -KeywordFile .\keywords.txt -Country "us" -Num 20 -DelayMs 800
```

### Keyword File Format (`keywords.txt`)
```
{{AUDIENCE}} seo
{{NICHE}} marketing
emergency {{AUDIENCE}} near me
{{AUDIENCE}} google ads
```

### Parameters

| Parameter | Default | Description |
|-----------|---------|-------------|
| `-Keywords` | â€” | Array of keywords inline |
| `-KeywordFile` | â€” | Path to `.txt` file, one keyword per line |
| `-Country` | `us` | Country code |
| `-Num` | `10` | Results per keyword |
| `-DelayMs` | `600` | Delay between requests (ms) |

### Output Files (in `exports/`)
| File | Contents |
|------|----------|
| `batch_organic_TIMESTAMP.csv` | All organic results across keywords |
| `batch_paa_TIMESTAMP.csv` | All People Also Ask questions |
| `batch_related_TIMESTAMP.csv` | All related searches |

---

## API Reference

| Field | Value |
|-------|-------|
| API Key | `2812f605aa71e6ef397a8f553a2427918f7d5703` |
| SERP Endpoint | `https://google.serper.dev/search` |
| Scrape Endpoint | `https://scrape.serper.dev` |
| Auth Header | `X-API-KEY: <key>` |
| Content-Type | `application/json` |
| Docs | https://serper.dev/api-reference |

### Raw cURL (if needed)

```bash
# SERP Search
curl --location 'https://google.serper.dev/search' \
--header 'X-API-KEY: 2812f605aa71e6ef397a8f553a2427918f7d5703' \
--header 'Content-Type: application/json' \
--data '{"q":"{{AUDIENCE}} seo","gl":"us","num":10}'

# Scrape
curl --location 'https://scrape.serper.dev' \
--header 'X-API-KEY: 2812f605aa71e6ef397a8f553a2427918f7d5703' \
--header 'Content-Type: application/json' \
--data '{"url":"https://example.com","includeMarkdown":true}'
```

---

## Folder Structure

```
tools/
â”œâ”€â”€ README.md              â† This file
â”œâ”€â”€ serper-search.ps1      â† Single keyword SERP lookup
â”œâ”€â”€ serper-scrape.ps1      â† Webpage scraper
â”œâ”€â”€ serper-batch.ps1       â† Multi-keyword batch research
â”œâ”€â”€ keywords.txt           â† (create this) one keyword per line
â””â”€â”€ exports/               â† Auto-created on first export
    â”œâ”€â”€ serp_*.csv
    â””â”€â”€ scraped/
        â”œâ”€â”€ *.md
        â””â”€â”€ *.txt
```
