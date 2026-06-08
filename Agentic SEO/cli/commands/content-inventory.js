#!/usr/bin/env node
/**
 * content-inventory.js â€” WS5 Content Inventory
 *
 * Produces a comprehensive per-page inventory by scanning the local website
 * repo and optionally enriching with keyword registry and GSC performance data
 * from the SQLite state DB.
 *
 * Usage:
 *   v2 content-inventory --db <path> [options]
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');

const HELP = `
content-inventory â€” WS5 content inventory with optional keyword & GSC enrichment

USAGE
  v2 content-inventory --db <path> [options]

OPTIONS
  --site-root <path>     Site root directory (default: env CLIENT_SITE_ROOT or /opt/client-site)
  --join-keywords        Join with keyword registry to show target keywords per page
  --join-gsc             Join with latest GSC data to show impressions/clicks per page
  --type <type>          Filter by page type: service|blog|home|utility|other|all (default: all)

OUTPUT
  --json                 JSON output (default)
  --table                Table output
  --csv                  CSV output
  --sample               Sample output without filesystem or DB access
  --help                 Show this help

EXAMPLES
  v2 content-inventory --json
  v2 content-inventory --join-keywords --join-gsc --db ./seo-agent.db --json
  v2 content-inventory --type service --join-keywords --table
  v2 content-inventory --sample --json
`.trim();

function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = buildSampleOutput();
    printOutput(envelope(sample, { tool: 'content-inventory' }), getOutputFormat(args));
    return;
  }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    if (!fs.existsSync(siteRoot)) {
      throw new Error(`Site root not found: ${siteRoot}`);
    }

    const joinKeywords = boolArg(args, 'join-keywords');
    const joinGsc = boolArg(args, 'join-gsc');
    const typeFilter = args.type || 'all';

    // â”€â”€ Step 1: Walk site root and extract page info â”€â”€
    const htmlFiles = walkDir(siteRoot)
      .filter(f => f.endsWith('.html'))
      .filter(f => !f.includes('node_modules') && !f.includes('.git') && !f.includes('_archive'));

    let pages = htmlFiles.map(f => extractPageInfo(f, siteRoot));

    // â”€â”€ Step 2: Build link map (reuse site-links.js pattern) â”€â”€
    const linkMap = buildLinkMap(siteRoot, htmlFiles);

    // Attach link counts to each page
    for (const page of pages) {
      page.internal_links_in = (linkMap.incoming[page.url] || []).length;
      page.internal_links_out = (linkMap.outgoing[page.url] || []).length;
    }

    // â”€â”€ Step 3: Optional keyword join â”€â”€
    let keywordsByUrl = {};
    let db = null;
    const needsDb = joinKeywords || joinGsc;

    if (needsDb) {
      const dbPath = resolveDbPath(args);
      db = openStateDb(dbPath);
    }

    try {
      if (joinKeywords && db) {
        keywordsByUrl = loadKeywordsByUrl(db);
      }

      // â”€â”€ Step 4: Optional GSC join â”€â”€
      let gscByPage = {};
      if (joinGsc && db) {
        gscByPage = loadGscByPage(db);
      }

      // â”€â”€ Step 5: Enrich pages â”€â”€
      for (const page of pages) {
        // Keywords
        const kwMatches = keywordsByUrl[page.url] || [];
        page.target_keywords = kwMatches.map(k => k.keyword);
        page.target_clusters = [...new Set(kwMatches.map(k => k.cluster).filter(Boolean))];

        // GSC
        if (joinGsc) {
          const gsc = gscByPage[page.url];
          page.gsc_impressions_28d = gsc ? gsc.impressions : 0;
          page.gsc_clicks_28d = gsc ? gsc.clicks : 0;
          page.avg_position = gsc ? gsc.avg_position : null;
        }

        // Coverage status
        page.coverage_status = page.target_keywords.length > 0 ? 'has_keywords' : 'no_keywords';
      }
    } finally {
      if (db) db.close();
    }

    // â”€â”€ Step 6: Apply type filter â”€â”€
    if (typeFilter && typeFilter !== 'all') {
      pages = pages.filter(p => p.type === typeFilter);
    }

    // â”€â”€ Step 7: Sort by URL â”€â”€
    pages.sort((a, b) => a.url.localeCompare(b.url));

    // â”€â”€ Step 8: Build summary â”€â”€
    const summary = buildSummary(pages);

    const data = {
      site_root: siteRoot,
      summary,
      pages,
    };

    printOutput(envelope(data, { tool: 'content-inventory' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'content-inventory' }), 'json');
    process.exitCode = 1;
  }
}

// â”€â”€ Page extraction â”€â”€

function extractPageInfo(filePath, siteRoot) {
  const relativePath = path.relative(siteRoot, filePath).replace(/\\/g, '/');
  const html = fs.readFileSync(filePath, 'utf8');

  // Strip scripts/styles, then tags to get visible text
  const text = html
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;

  const url = fileToUrl(relativePath);

  return {
    url,
    type: classifyPageType(relativePath),
    title,
    file_path: relativePath,
    word_count: text.split(/\s+/).filter(Boolean).length,
    internal_links_in: 0,
    internal_links_out: 0,
    target_keywords: [],
    target_clusters: [],
    gsc_impressions_28d: 0,
    gsc_clicks_28d: 0,
    avg_position: null,
    coverage_status: 'no_keywords',
  };
}

function classifyPageType(relativePath) {
  const lower = relativePath.toLowerCase();
  if (lower === 'index.html' || lower === '/' || lower === '') return 'home';
  if (lower.startsWith('services/')) return 'service';
  if (lower.startsWith('blog/')) return 'blog';
  if (/^(about|contact|privacy|terms|thank-you|404)/i.test(lower)) return 'utility';
  return 'other';
}

function fileToUrl(relativePath) {
  const clean = relativePath.replace(/\.html$/i, '').replace(/\/index$/i, '');
  return `https://{{DOMAIN}}/${clean || ''}`;
}

// â”€â”€ Link map (mirrors site-links.js buildLinkMap) â”€â”€

function buildLinkMap(siteRoot, htmlFiles) {
  const outgoing = {};
  const incoming = {};
  const allPages = new Set();

  for (const filePath of htmlFiles) {
    const relativePath = path.relative(siteRoot, filePath).replace(/\\/g, '/');
    const pageUrl = fileToUrl(relativePath);
    allPages.add(pageUrl);
    outgoing[pageUrl] = [];

    const html = fs.readFileSync(filePath, 'utf8');
    const linkRegex = /<a\b[^>]*href=["']([^"'#]*?)["'][^>]*>/gi;
    let m;
    const seen = new Set();

    while ((m = linkRegex.exec(html)) !== null) {
      let href = m[1].trim();
      if (!href || href.startsWith('mailto:') || href.startsWith('tel:') || href.startsWith('javascript:')) continue;

      // Normalize to absolute URL
      const resolved = resolveHref(href, pageUrl);
      if (!resolved) continue;

      // Only track internal links
      if (!resolved.includes('{{DOMAIN}}') && !resolved.startsWith('/')) continue;

      const normalizedUrl = normalizeUrl(resolved);
      if (normalizedUrl === pageUrl) continue; // skip self-links
      if (seen.has(normalizedUrl)) continue;
      seen.add(normalizedUrl);

      outgoing[pageUrl].push(normalizedUrl);
      if (!incoming[normalizedUrl]) incoming[normalizedUrl] = [];
      incoming[normalizedUrl].push(pageUrl);
    }
  }

  return { outgoing, incoming, allPages };
}

function resolveHref(href, baseUrl) {
  if (href.startsWith('http://') || href.startsWith('https://')) return href;
  if (href.startsWith('/')) return `https://{{DOMAIN}}${href}`;
  // Relative link â€” resolve from base
  const basePath = baseUrl.replace(/\/[^/]*$/, '/');
  return basePath + href;
}

function normalizeUrl(url) {
  try {
    const u = new URL(url.includes('://') ? url : `https://{{DOMAIN}}${url}`);
    let pathname = u.pathname.replace(/\/+$/, '') || '/';
    pathname = pathname.replace(/\.html$/i, '').replace(/\/index$/i, '');
    return `https://{{DOMAIN}}${pathname}`;
  } catch {
    return url;
  }
}

// â”€â”€ Filesystem walker (mirrors site-pages.js walkDir) â”€â”€

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

// â”€â”€ DB helpers â”€â”€

function loadKeywordsByUrl(db) {
  const rows = db.prepare(`
    SELECT keyword, cluster, target_url
    FROM keywords
    WHERE target_url IS NOT NULL AND target_url != ''
  `).all();

  const byUrl = {};
  for (const row of rows) {
    const normalized = normalizeUrl(row.target_url);
    if (!byUrl[normalized]) byUrl[normalized] = [];
    byUrl[normalized].push({ keyword: row.keyword, cluster: row.cluster });
  }
  return byUrl;
}

function loadGscByPage(db) {
  const rows = db.prepare(`
    SELECT page,
           SUM(impressions) AS impressions,
           SUM(clicks) AS clicks,
           AVG(position) AS avg_position
    FROM gsc_snapshots
    WHERE captured_at >= date('now', '-28 days')
    GROUP BY page
  `).all();

  const byPage = {};
  for (const row of rows) {
    const normalized = normalizeUrl(row.page);
    byPage[normalized] = {
      impressions: row.impressions || 0,
      clicks: row.clicks || 0,
      avg_position: row.avg_position != null ? Number(row.avg_position.toFixed(1)) : null,
    };
  }
  return byPage;
}

// â”€â”€ Summary builder â”€â”€

function buildSummary(pages) {
  const byType = {};
  let totalWordCount = 0;
  let totalLinksIn = 0;
  let withKeywords = 0;
  let withoutKeywords = 0;

  for (const p of pages) {
    byType[p.type] = (byType[p.type] || 0) + 1;
    totalWordCount += p.word_count;
    totalLinksIn += p.internal_links_in;
    if (p.coverage_status === 'has_keywords') {
      withKeywords++;
    } else {
      withoutKeywords++;
    }
  }

  const count = Math.max(1, pages.length);

  return {
    total_pages: pages.length,
    by_type: byType,
    with_keywords: withKeywords,
    without_keywords: withoutKeywords,
    avg_word_count: Math.round(totalWordCount / count),
    avg_internal_links_in: Number((totalLinksIn / count).toFixed(1)),
  };
}

// â”€â”€ Sample output â”€â”€

function buildSampleOutput() {
  const pages = [
    {
      url: 'https://{{DOMAIN}}/',
      type: 'home',
      title: '{{SITE_NAME}} â€” SEO for {{NICHE}} Companies',
      file_path: 'index.html',
      word_count: 1850,
      internal_links_in: 8,
      internal_links_out: 12,
      target_keywords: ['{{NICHE}} seo', 'seo for {{AUDIENCE}}'],
      target_clusters: ['brand'],
      gsc_impressions_28d: 320,
      gsc_clicks_28d: 45,
      avg_position: 12.3,
      coverage_status: 'has_keywords',
    },
    {
      url: 'https://{{DOMAIN}}/services/seo-audit',
      type: 'service',
      title: 'SEO Audit for {{AUDIENCE}}',
      file_path: 'services/seo-audit/index.html',
      word_count: 1250,
      internal_links_in: 3,
      internal_links_out: 7,
      target_keywords: ['{{NICHE}} seo audit'],
      target_clusters: ['seo-audit'],
      gsc_impressions_28d: 95,
      gsc_clicks_28d: 0,
      avg_position: 37.2,
      coverage_status: 'has_keywords',
    },
    {
      url: 'https://{{DOMAIN}}/services/local-seo',
      type: 'service',
      title: 'Local SEO for {{AUDIENCE}}',
      file_path: 'services/local-seo/index.html',
      word_count: 1100,
      internal_links_in: 4,
      internal_links_out: 5,
      target_keywords: ['local seo for {{AUDIENCE}}'],
      target_clusters: ['local-seo'],
      gsc_impressions_28d: 210,
      gsc_clicks_28d: 18,
      avg_position: 15.6,
      coverage_status: 'has_keywords',
    },
    {
      url: 'https://{{DOMAIN}}/blog/{{NICHE}}-seo-tips',
      type: 'blog',
      title: '10 {{NICHE}} SEO Tips for 2026',
      file_path: 'blog/{{NICHE}}-seo-tips/index.html',
      word_count: 2100,
      internal_links_in: 2,
      internal_links_out: 9,
      target_keywords: [],
      target_clusters: [],
      gsc_impressions_28d: 55,
      gsc_clicks_28d: 3,
      avg_position: 28.4,
      coverage_status: 'no_keywords',
    },
    {
      url: 'https://{{DOMAIN}}/contact',
      type: 'utility',
      title: 'Contact Us',
      file_path: 'contact/index.html',
      word_count: 280,
      internal_links_in: 6,
      internal_links_out: 2,
      target_keywords: [],
      target_clusters: [],
      gsc_impressions_28d: 12,
      gsc_clicks_28d: 1,
      avg_position: 42.0,
      coverage_status: 'no_keywords',
    },
  ];

  const summary = buildSummary(pages);

  return {
    site_root: '/opt/client-site',
    summary,
    pages,
  };
}


if (require.main === module) {
  main();
}

module.exports = main;
