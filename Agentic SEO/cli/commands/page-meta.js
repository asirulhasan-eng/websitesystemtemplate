#!/usr/bin/env node
/**
 * page-meta.js â€” Extract structured metadata from one or more pages
 *
 * Lighter-weight than page-read: focuses only on SEO-relevant metadata.
 * Supports batch processing via --batch glob.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, exitWithError, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    const seoOnly = Boolean(args['seo-only']);
    let results;

    if (args.batch) {
      results = processBatch(args.batch, siteRoot, seoOnly);
    } else {
      const filePath = resolveFile(args, siteRoot);
      results = [extractPageMeta(filePath, siteRoot, seoOnly)];
    }

    const data = {
      page_count: results.length,
      pages: results,
    };

    printOutput(envelope(data, { tool: 'page-meta' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'page-meta' }), 'json');
    process.exitCode = 1;
  }
}

function resolveFile(args, siteRoot) {
  if (args.file) {
    return path.isAbsolute(args.file) ? args.file : path.resolve(siteRoot, args.file);
  }
  if (args.url) {
    return urlToFilePath(args.url, siteRoot);
  }
  throw new Error('Provide --url, --file, or --batch');
}

function urlToFilePath(url, siteRoot) {
  let pathname;
  try { pathname = new URL(url).pathname; } catch { pathname = url.startsWith('/') ? url : `/${url}`; }
  pathname = pathname.replace(/\/$/, '') || '/';
  const clean = pathname.replace(/^\//, '');
  const htmlPath = path.join(siteRoot, clean.endsWith('.html') ? clean : `${clean}.html`);
  if (fs.existsSync(htmlPath)) return htmlPath;
  const indexPath = path.join(siteRoot, clean, 'index.html');
  if (fs.existsSync(indexPath)) return indexPath;
  return htmlPath;
}

function processBatch(glob, siteRoot, seoOnly) {
  // Simple glob: support "services/*.html" or "blog/*.html"
  const parts = glob.replace(/\\/g, '/').split('/');
  const pattern = parts.pop();
  const dir = path.resolve(siteRoot, parts.join('/'));

  if (!fs.existsSync(dir)) return [];

  const regex = new RegExp('^' + pattern.replace(/\./g, '\\.').replace(/\*/g, '.*') + '$');
  const files = fs.readdirSync(dir).filter(f => regex.test(f));

  return files.map(f => extractPageMeta(path.join(dir, f), siteRoot, seoOnly));
}

function extractPageMeta(filePath, siteRoot, seoOnly = false) {
  const relativePath = path.relative(siteRoot, filePath).replace(/\\/g, '/');
  const exists = fs.existsSync(filePath);

  if (!exists) {
    return { file: relativePath, exists: false };
  }

  const html = fs.readFileSync(filePath, 'utf8');
  const text = stripHtml(html);

  const meta = {
    file: relativePath,
    exists: true,
    url: fileToUrl(relativePath),
    title: extractTag(html, 'title'),
    meta_description: extractMetaContent(html, 'description'),
    canonical: extractLinkHref(html, 'canonical'),
    robots: extractMetaContent(html, 'robots'),
    h1: extractAllTags(html, 'h1'),
    h2s: extractAllTags(html, 'h2'),
    word_count: text.split(/\s+/).filter(Boolean).length,
  };

  if (!seoOnly) {
    meta.h3s = extractAllTags(html, 'h3');
    meta.internal_link_count = (html.match(/<a\b[^>]*href=["'][^"']*["'][^>]*>/gi) || [])
      .filter(a => !/^https?:\/\//i.test(a.match(/href=["']([^"']*)["']/i)?.[1] || '') || /client\.agency/i.test(a)).length;
    meta.external_link_count = (html.match(/<a\b[^>]*href=["']https?:\/\/[^"']*["'][^>]*>/gi) || [])
      .filter(a => !/client\.agency/i.test(a)).length;
    meta.images_total = (html.match(/<img\b/gi) || []).length;
    meta.images_without_alt = (html.match(/<img\b(?![^>]*\salt\s*=)[^>]*>/gi) || []).length;
    meta.schema_types = extractSchemaTypes(html);
    meta.og_title = extractMetaProperty(html, 'og:title');
    meta.og_description = extractMetaProperty(html, 'og:description');
    meta.file_size_bytes = Buffer.byteLength(html);

    // Try to get last modified from git
    try {
      const { execFileSync } = require('node:child_process');
      const lastModified = execFileSync('git', ['log', '-1', '--format=%aI', '--', relativePath], {
        cwd: siteRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      if (lastModified) meta.last_modified = lastModified;
    } catch { /* git not available or not a repo */ }
  }

  return meta;
}

function fileToUrl(relativePath) {
  const clean = relativePath.replace(/\.html$/i, '').replace(/\/index$/i, '');
  return `https://{{DOMAIN}}/${clean || ''}`;
}

function extractTag(html, tag) {
  const m = html.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return m ? stripHtml(m[1]) : null;
}

function extractAllTags(html, tag) {
  const results = [];
  const regex = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = regex.exec(html)) !== null) results.push(stripHtml(m[1]));
  return results;
}

function extractMetaContent(html, name) {
  const patterns = [
    new RegExp(`<meta\\b[^>]*name=["']${name}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*name=["']${name}["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractMetaProperty(html, property) {
  const patterns = [
    new RegExp(`<meta\\b[^>]*property=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*content=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<meta\\b[^>]*content=["']([^"']*)["'][^>]*property=["']${property.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}["'][^>]*>`, 'i'),
  ];
  for (const p of patterns) {
    const m = html.match(p);
    if (m) return m[1];
  }
  return null;
}

function extractLinkHref(html, rel) {
  const m = html.match(new RegExp(`<link\\b[^>]*rel=["']${rel}["'][^>]*href=["']([^"']*)["'][^>]*>`, 'i'));
  return m ? m[1] : null;
}

function extractSchemaTypes(html) {
  const types = [];
  const blocks = [];
  const regex = /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = regex.exec(html)) !== null) blocks.push(m[1]);
  for (const block of blocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed['@type']) types.push(parsed['@type']);
      if (Array.isArray(parsed['@graph'])) {
        for (const item of parsed['@graph']) {
          if (item['@type']) types.push(item['@type']);
        }
      }
    } catch { /* ignore */ }
  }
  return types;
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/&[a-z]+;/gi, ' ').replace(/\s+/g, ' ').trim();
}

function printHelp() {
  console.log(`
page-meta â€” Extract structured metadata from site pages

Usage:
  v2 page-meta --url <url> [options]
  v2 page-meta --file <path> [options]
  v2 page-meta --batch <glob> [options]

Source:
  --url <url>              Page URL (resolves to local file)
  --file <path>            Local file path
  --batch <glob>           Process multiple files (e.g., "services/*.html")
  --site-root <path>       Website repo root

Options:
  --seo-only               Only SEO-relevant fields (title, meta, h1, h2s, word count)
  --full                   All metadata including links, images, schema (default)

Output:
  --json                   JSON output (default)
  --table                  Table output
  --csv                    CSV output

Output Fields:
  file, url, exists, title, meta_description, canonical, robots,
  h1 (array), h2s (array), h3s (array), word_count,
  internal_link_count, external_link_count,
  images_total, images_without_alt,
  schema_types (array), og_title, og_description,
  file_size_bytes, last_modified (from git)

Examples:
  v2 page-meta --url https://{{DOMAIN}}/services/{{NICHE}}-seo --json
  v2 page-meta --batch "services/*.html" --seo-only --table
  v2 page-meta --file blog/seo-for-{{AUDIENCE}}.html --json
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
