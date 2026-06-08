#!/usr/bin/env node
/**
 * site-pages.js â€” Full site page inventory from local website repo
 *
 * Scans the website directory for HTML files and extracts metadata
 * for each page. Useful for AI to understand the full site structure.
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
    if (!fs.existsSync(siteRoot)) {
      throw new Error(`Site root not found: ${siteRoot}`);
    }

    // Collect all HTML files
    const htmlFiles = walkDir(siteRoot)
      .filter(f => f.endsWith('.html'))
      .filter(f => !f.includes('node_modules') && !f.includes('.git') && !f.includes('_archive'));

    let pages = htmlFiles.map(f => extractPageInfo(f, siteRoot));

    // Apply filters
    if (args.type && args.type !== 'all') {
      pages = pages.filter(p => p.page_type === args.type);
    }
    if (boolArg(args, 'has-schema')) {
      pages = pages.filter(p => p.schema_types.length > 0);
    }
    if (boolArg(args, 'missing-meta')) {
      pages = pages.filter(p => !p.title || !p.meta_description);
    }
    if (boolArg(args, 'missing-canonical')) {
      pages = pages.filter(p => !p.canonical);
    }
    if (boolArg(args, 'missing-h1')) {
      pages = pages.filter(p => p.h1_count === 0);
    }
    if (boolArg(args, 'multiple-h1')) {
      pages = pages.filter(p => p.h1_count > 1);
    }
    if (args['min-words']) {
      const min = numberArg(args, 'min-words', 0);
      pages = pages.filter(p => p.word_count >= min);
    }
    if (args['max-words']) {
      const max = numberArg(args, 'max-words', Infinity);
      pages = pages.filter(p => p.word_count <= max);
    }

    // Sort
    const sortField = args.sort || 'url';
    pages.sort((a, b) => {
      const va = a[sortField], vb = b[sortField];
      if (typeof va === 'number' && typeof vb === 'number') return vb - va;
      return String(va || '').localeCompare(String(vb || ''));
    });
    if (boolArg(args, 'asc')) pages.reverse();

    // Limit
    const limit = numberArg(args, 'limit', 0);
    if (limit > 0) pages = pages.slice(0, limit);

    // Summary stats
    const summary = {
      total_pages: pages.length,
      by_type: {},
      total_word_count: 0,
      pages_missing_title: 0,
      pages_missing_meta_desc: 0,
      pages_missing_canonical: 0,
      pages_with_schema: 0,
    };

    for (const p of pages) {
      summary.by_type[p.page_type] = (summary.by_type[p.page_type] || 0) + 1;
      summary.total_word_count += p.word_count;
      if (!p.title) summary.pages_missing_title++;
      if (!p.meta_description) summary.pages_missing_meta_desc++;
      if (!p.canonical) summary.pages_missing_canonical++;
      if (p.schema_types.length > 0) summary.pages_with_schema++;
    }
    summary.avg_word_count = Math.round(summary.total_word_count / Math.max(1, pages.length));

    const data = {
      site_root: siteRoot,
      summary,
      pages,
    };

    printOutput(envelope(data, { tool: 'site-pages' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'site-pages' }), 'json');
    process.exitCode = 1;
  }
}

function extractPageInfo(filePath, siteRoot) {
  const relativePath = path.relative(siteRoot, filePath).replace(/\\/g, '/');
  const html = fs.readFileSync(filePath, 'utf8');
  const text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ').trim();

  const titleMatch = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/<[^>]+>/g, '').trim() : null;

  const descMatch = html.match(/<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || html.match(/<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const meta_description = descMatch ? descMatch[1] : null;

  const canonicalMatch = html.match(/<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  const canonical = canonicalMatch ? canonicalMatch[1] : null;

  const h1s = [];
  const h1Regex = /<h1[^>]*>([\s\S]*?)<\/h1>/gi;
  let m;
  while ((m = h1Regex.exec(html)) !== null) h1s.push(m[1].replace(/<[^>]+>/g, '').trim());

  const schemaTypes = [];
  const ldRegex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  while ((m = ldRegex.exec(html)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (parsed['@type']) schemaTypes.push(parsed['@type']);
      if (Array.isArray(parsed['@graph'])) {
        for (const item of parsed['@graph']) {
          if (item['@type']) schemaTypes.push(item['@type']);
        }
      }
    } catch { /* ignore */ }
  }

  const url = fileToUrl(relativePath);

  return {
    file: relativePath,
    url,
    page_type: classifyPageType(relativePath),
    title,
    meta_description,
    canonical,
    h1: h1s[0] || null,
    h1_count: h1s.length,
    word_count: text.split(/\s+/).filter(Boolean).length,
    schema_types: schemaTypes,
    file_size_bytes: Buffer.byteLength(html),
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

function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.')) continue;
      results.push(...walkDir(full));
    } else if (entry.isFile()) {
      results.push(full);
    }
  }
  return results;
}

function printHelp() {
  console.log(`
site-pages â€” Full site page inventory with metadata

Usage:
  v2 site-pages [options]

Options:
  --site-root <path>       Website repo root (default: /opt/client-site)
  --type <type>            Filter by: service|blog|utility|home|other|all (default: all)
  --has-schema             Only pages with structured data
  --missing-meta           Only pages missing title or meta description
  --missing-canonical      Only pages missing canonical tag
  --missing-h1             Only pages with no H1 tag
  --multiple-h1            Only pages with more than one H1
  --min-words <N>          Minimum word count
  --max-words <N>          Maximum word count
  --sort <field>           Sort by: url|word_count|page_type|title (default: url)
  --asc                    Sort ascending
  --limit <N>              Max results

Output:
  --json                   JSON output (default)
  --table                  Table output
  --csv                    CSV output

Summary includes:
  - Total pages, pages by type
  - Total/avg word count
  - Pages missing title/meta/canonical
  - Pages with schema markup

Examples:
  v2 site-pages --json
  v2 site-pages --type service --table
  v2 site-pages --missing-meta --json
  v2 site-pages --sort word_count --limit 10 --table
  v2 site-pages --has-schema --json
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
