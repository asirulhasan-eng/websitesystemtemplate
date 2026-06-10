#!/usr/bin/env node
/**
 * crawl.js â€” Technical site audit using local HTML file scanning
 *
 * Scans the local website repo for common SEO issues:
 * - Missing/duplicate titles
 * - Missing meta descriptions
 * - Missing/multiple H1s
 * - Missing canonical tags
 * - Images without alt text
 * - Broken internal links (checks if target file exists)
 * - Missing schema markup on service pages
 *
 * Persists results to crawler_runs table in SQLite.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, numberArg, boolArg, getOutputFormat, resolveDbPath } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    if (!fs.existsSync(siteRoot)) throw new Error(`Site root not found: ${siteRoot}`);

    const htmlFiles = walkDir(siteRoot)
      .filter(f => f.endsWith('.html') && !f.includes('node_modules') && !f.includes('.git'));

    const issues = [];
    const pages = [];

    for (const filePath of htmlFiles) {
      const relativePath = path.relative(siteRoot, filePath).replace(/\\/g, '/');
      const html = fs.readFileSync(filePath, 'utf8');
      const pageIssues = auditPage(html, relativePath, siteRoot);
      
      pages.push({
        url: fileToUrl(relativePath),
        file: relativePath,
        title: extractTag(html, 'title'),
        meta_description: extractMetaContent(html, 'description'),
        h1s: extractAllTags(html, 'h1'),
        canonical: extractLinkHref(html, 'canonical'),
        robots: extractMetaContent(html, 'robots'),
        issue_count: pageIssues.length,
      });

      issues.push(...pageIssues);
    }

    // Categorize issues
    const byType = {};
    const bySeverity = { critical: 0, important: 0, minor: 0, info: 0 };
    for (const issue of issues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    const result = {
      site_root: siteRoot,
      pages_scanned: pages.length,
      issue_count: issues.length,
      by_severity: bySeverity,
      by_type: byType,
      issues: boolArg(args, 'summary-only') ? undefined : issues,
      pages: boolArg(args, 'issues-only') ? undefined : pages,
    };

    // Persist to SQLite if --db provided
    if (args.db && !boolArg(args, 'no-persist')) {
      try {
        const { openStateDb, recordCrawlAtomic } = require('../lib/state_db');
        const db = openStateDb(resolveDbPath(args));
        const crawlResult = recordCrawlAtomic(db, {
          site_root: siteRoot,
          base_url: 'https://{{DOMAIN}}',
          page_count: pages.length,
          issue_count: issues.length,
          issues,
          pages,
          generated_at: new Date().toISOString(),
        });
        result.persisted = true;
        result.crawler_run_id = crawlResult.runId;
        db.close();
      } catch (err) {
        result.persist_error = err.message;
      }
    }

    printOutput(envelope(result, { tool: 'crawl' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'crawl' }), 'json');
    process.exitCode = 1;
  }
}

function auditPage(html, relativePath, siteRoot) {
  const issues = [];
  const pageType = classifyPageType(relativePath);
  const url = fileToUrl(relativePath);

  // Title tag
  const title = extractTag(html, 'title');
  if (!title) {
    issues.push({ type: 'missing_title', severity: pageType === 'utility' ? 'minor' : 'critical', page: relativePath, url, detail: 'No <title> tag found' });
  } else if (title.length > 70) {
    issues.push({ type: 'long_title', severity: 'minor', page: relativePath, url, detail: `Title is ${title.length} chars (recommended: â‰¤60)`, value: title });
  } else if (title.length < 10) {
    issues.push({ type: 'short_title', severity: 'important', page: relativePath, url, detail: `Title is only ${title.length} chars`, value: title });
  }

  // Meta description
  const metaDesc = extractMetaContent(html, 'description');
  if (!metaDesc) {
    issues.push({ type: 'missing_meta_description', severity: pageType === 'utility' ? 'minor' : 'important', page: relativePath, url, detail: 'No meta description found' });
  } else if (metaDesc.length > 170) {
    issues.push({ type: 'long_meta_description', severity: 'minor', page: relativePath, url, detail: `Meta description is ${metaDesc.length} chars (recommended: â‰¤160)` });
  }

  // H1 tags
  const h1s = extractAllTags(html, 'h1');
  if (h1s.length === 0) {
    issues.push({ type: 'missing_h1', severity: pageType === 'utility' ? 'minor' : 'important', page: relativePath, url, detail: 'No H1 tag found' });
  } else if (h1s.length > 1) {
    issues.push({ type: 'multiple_h1', severity: 'important', page: relativePath, url, detail: `${h1s.length} H1 tags found`, value: h1s });
  }

  // Canonical tag
  const canonical = extractLinkHref(html, 'canonical');
  if (!canonical && pageType !== 'utility') {
    issues.push({ type: 'missing_canonical', severity: 'important', page: relativePath, url, detail: 'No canonical tag found' });
  }

  // Images without alt
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  const missingAlt = imgTags.filter(tag => !/\balt\s*=/i.test(tag));
  if (missingAlt.length > 0) {
    issues.push({ type: 'missing_image_alt', severity: 'important', page: relativePath, url, detail: `${missingAlt.length} of ${imgTags.length} images missing alt text`, count: missingAlt.length });
  }

  // Schema markup on service pages
  if (pageType === 'service') {
    const hasSchema = /<script[^>]*type=["']application\/ld\+json["']/i.test(html);
    if (!hasSchema) {
      issues.push({ type: 'missing_schema', severity: 'important', page: relativePath, url, detail: 'Service page has no structured data (JSON-LD)' });
    }
  }

  // Broken internal links (check if target file exists)
  const linkRegex = /<a\b[^>]*href=["']([^"']*?)["'][^>]*>/gi;
  let m;
  while ((m = linkRegex.exec(html)) !== null) {
    let href = m[1].trim();
    const qIdx = href.indexOf('?');
    if (qIdx >= 0) href = href.substring(0, qIdx);
    const hIdx = href.indexOf('#');
    if (hIdx >= 0) href = href.substring(0, hIdx);
    if (!href || href.startsWith('http') || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

    // Resolve relative link to file path
    const targetRelative = href.startsWith('/') ? href.slice(1) : path.join(path.dirname(relativePath), href);
    const targetPath = path.join(siteRoot, targetRelative.endsWith('.html') ? targetRelative : `${targetRelative}.html`);
    const targetIndex = path.join(siteRoot, targetRelative, 'index.html');

    if (!fs.existsSync(targetPath) && !fs.existsSync(targetIndex)) {
      issues.push({ type: 'broken_internal_link', severity: 'important', page: relativePath, url, detail: `Link to "${href}" â€” file not found`, value: href });
    }
  }

  return issues;
}

function classifyPageType(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower === 'index.html') return 'home';
  if (lower.startsWith('services/')) return 'service';
  if (lower.startsWith('blog/')) return 'blog';
  if (/^(about|contact|privacy|terms|thank-you|404)/i.test(lower)) return 'utility';
  return 'other';
}

function fileToUrl(relativePath) {
  const clean = relativePath.replace(/\.html$/i, '').replace(/\/index$/i, '');
  return `https://{{DOMAIN}}/${clean || ''}`;
}

function extractTag(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? m[1].replace(/<[^>]+>/g, '').trim() : null;
}

function extractAllTags(html, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = regex.exec(html)) !== null) results.push(m[1].replace(/<[^>]+>/g, '').trim());
  return results;
}

function extractMetaContent(html, name) {
  const m = html.match(new RegExp(`<meta\\b[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'))
    || html.match(new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`, 'i'));
  return m ? m[1] : null;
}

function extractLinkHref(html, rel) {
  const m = html.match(new RegExp(`<link\\b[^>]*rel=["']${rel}["'][^>]*href=["']([^"']*)["'][^>]*>`, 'i'));
  return m ? m[1] : null;
}

function walkDir(dir) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...walkDir(full));
      else if (entry.isFile()) results.push(full);
    }
  } catch { /* skip unreadable dirs */ }
  return results;
}

function printHelp() {
  console.log(`
crawl â€” Technical SEO site audit (local files)

Usage:
  v2 crawl [options]

Options:
  --site-root <path>       Website repo root (default: /opt/client-site)
  --summary-only           Only show issue counts, not individual issues
  --issues-only            Only show issues, not page list

Persistence:
  --db <path>              Save results to SQLite crawler_runs + pages tables
  --no-persist             Skip database persistence

Output:
  --json                   JSON output (default)
  --table                  Table output
  --csv                    CSV output

Checks performed:
  - Missing/short/long title tags
  - Missing meta descriptions
  - Missing/multiple H1 tags
  - Missing canonical tags
  - Images without alt text
  - Missing schema markup on service pages
  - Broken internal links (file existence check)

Issue severities:
  critical   Page-level issues on money pages (missing title on service page)
  important  Issues that impact SEO quality (missing meta, broken links)
  minor      Good practice but not urgent (decorative image alt, utility page meta)
  info       Informational only (no action needed)

Examples:
  v2 crawl --json
  v2 crawl --summary-only --table
  v2 crawl --db /path/to/seo-agent.db --json
  v2 crawl --issues-only --json
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
