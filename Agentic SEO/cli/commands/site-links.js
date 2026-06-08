#!/usr/bin/env node
/**
 * site-links.js â€” Analyze internal link structure of the website
 *
 * Helps AI understand link equity distribution, find orphan pages,
 * and identify internal linking opportunities.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, numberArg, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    if (!fs.existsSync(siteRoot)) throw new Error(`Site root not found: ${siteRoot}`);

    // Build full internal link map
    const linkMap = buildLinkMap(siteRoot);

    let result;

    if (args.url) {
      // Show links TO and FROM a specific page
      result = analyzePageLinks(args.url, linkMap);
    } else if (boolArg(args, 'orphans')) {
      result = findOrphans(linkMap);
    } else if (boolArg(args, 'most-linked')) {
      result = mostLinked(linkMap, numberArg(args, 'limit', 20));
    } else if (boolArg(args, 'least-linked')) {
      result = leastLinked(linkMap, numberArg(args, 'limit', 20));
    } else if (boolArg(args, 'link-map')) {
      result = fullLinkMap(linkMap);
    } else {
      // Default: summary
      result = linkSummary(linkMap);
    }

    printOutput(envelope(result, { tool: 'site-links' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'site-links' }), 'json');
    process.exitCode = 1;
  }
}

function buildLinkMap(siteRoot) {
  const htmlFiles = walkDir(siteRoot)
    .filter(f => f.endsWith('.html') && !f.includes('node_modules') && !f.includes('.git'));

  // outgoing[pageUrl] = [linked urls]
  // incoming[pageUrl] = [linking from urls]
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

function analyzePageLinks(url, linkMap) {
  const normalizedUrl = normalizeUrl(url);
  const incomingLinks = linkMap.incoming[normalizedUrl] || [];
  const outgoingLinks = linkMap.outgoing[normalizedUrl] || [];

  return {
    url: normalizedUrl,
    incoming_count: incomingLinks.length,
    outgoing_count: outgoingLinks.length,
    incoming_from: incomingLinks.sort(),
    outgoing_to: outgoingLinks.sort(),
    is_orphan: incomingLinks.length === 0 && linkMap.allPages.has(normalizedUrl),
  };
}

function findOrphans(linkMap) {
  const orphans = [];
  for (const page of linkMap.allPages) {
    const incoming = linkMap.incoming[page] || [];
    if (incoming.length === 0) {
      orphans.push({
        url: page,
        outgoing_count: (linkMap.outgoing[page] || []).length,
      });
    }
  }
  return {
    orphan_count: orphans.length,
    total_pages: linkMap.allPages.size,
    orphan_percentage: Number(((orphans.length / Math.max(1, linkMap.allPages.size)) * 100).toFixed(1)),
    orphans: orphans.sort((a, b) => a.url.localeCompare(b.url)),
  };
}

function mostLinked(linkMap, limit) {
  const pages = [];
  for (const page of linkMap.allPages) {
    pages.push({
      url: page,
      incoming_count: (linkMap.incoming[page] || []).length,
      outgoing_count: (linkMap.outgoing[page] || []).length,
    });
  }
  pages.sort((a, b) => b.incoming_count - a.incoming_count);
  return {
    pages: pages.slice(0, limit),
  };
}

function leastLinked(linkMap, limit) {
  const pages = [];
  for (const page of linkMap.allPages) {
    pages.push({
      url: page,
      incoming_count: (linkMap.incoming[page] || []).length,
      outgoing_count: (linkMap.outgoing[page] || []).length,
    });
  }
  pages.sort((a, b) => a.incoming_count - b.incoming_count);
  return {
    pages: pages.slice(0, limit),
  };
}

function fullLinkMap(linkMap) {
  const map = [];
  for (const page of [...linkMap.allPages].sort()) {
    map.push({
      url: page,
      incoming_count: (linkMap.incoming[page] || []).length,
      outgoing_count: (linkMap.outgoing[page] || []).length,
      outgoing_to: (linkMap.outgoing[page] || []).sort(),
    });
  }
  return { total_pages: linkMap.allPages.size, map };
}

function linkSummary(linkMap) {
  let totalIncoming = 0;
  let totalOutgoing = 0;
  let maxIncoming = 0;
  let orphanCount = 0;

  for (const page of linkMap.allPages) {
    const inc = (linkMap.incoming[page] || []).length;
    const out = (linkMap.outgoing[page] || []).length;
    totalIncoming += inc;
    totalOutgoing += out;
    if (inc > maxIncoming) maxIncoming = inc;
    if (inc === 0) orphanCount++;
  }

  return {
    total_pages: linkMap.allPages.size,
    total_internal_links: totalOutgoing,
    avg_incoming_links: Number((totalIncoming / Math.max(1, linkMap.allPages.size)).toFixed(1)),
    avg_outgoing_links: Number((totalOutgoing / Math.max(1, linkMap.allPages.size)).toFixed(1)),
    max_incoming_links: maxIncoming,
    orphan_pages: orphanCount,
    orphan_percentage: Number(((orphanCount / Math.max(1, linkMap.allPages.size)) * 100).toFixed(1)),
  };
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

function fileToUrl(relativePath) {
  const clean = relativePath.replace(/\.html$/i, '').replace(/\/index$/i, '');
  return `https://{{DOMAIN}}/${clean || ''}`;
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
site-links â€” Analyze internal link structure

Usage:
  v2 site-links [options]

Modes:
  (default)                Show link structure summary
  --url <url>              Show all links TO and FROM a specific page
  --orphans                Find pages with zero incoming internal links
  --most-linked            Show pages with most incoming links
  --least-linked           Show pages with fewest incoming links
  --link-map               Full internal link adjacency map

Options:
  --site-root <path>       Website repo root (default: /opt/client-site)
  --limit <N>              Max results for most/least-linked (default: 20)

Output:
  --json                   JSON output (default)
  --table                  Table output
  --csv                    CSV output

Examples:
  v2 site-links --json                          # Summary stats
  v2 site-links --url /services/{{NICHE}}-seo    # Links to/from page
  v2 site-links --orphans --json                # Find orphan pages
  v2 site-links --most-linked --limit 10 --table
  v2 site-links --least-linked --json
  v2 site-links --link-map --json               # Full adjacency map
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
