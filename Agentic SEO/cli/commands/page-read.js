#!/usr/bin/env node
/**
 * page-read.js â€” Read page content from the local website repo
 *
 * Returns the raw or processed content of a page, useful for AI to
 * analyze page quality, keyword presence, and content structure.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, requireArg, boolArg, exitWithError, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');

function main() {
  const args = parseArgs();
  if (args.help) { printHelp(); return; }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    let filePath;

    if (args.file) {
      filePath = path.isAbsolute(args.file) ? args.file : path.resolve(siteRoot, args.file);
    } else if (args.url) {
      filePath = urlToFilePath(args.url, siteRoot);
    } else {
      throw new Error('Provide --url or --file');
    }

    if (!fs.existsSync(filePath)) {
      printOutput(envelope({
        file: filePath,
        exists: false,
        error: `File not found: ${filePath}`,
      }, { tool: 'page-read' }), getOutputFormat(args));
      return;
    }

    const html = fs.readFileSync(filePath, 'utf8');
    const mode = args.raw ? 'raw'
      : args.text ? 'text'
      : args.sections ? 'sections'
      : 'full';

    let result;

    if (mode === 'raw') {
      result = { file: filePath, exists: true, content: html, size_bytes: Buffer.byteLength(html) };
    } else if (mode === 'text') {
      const text = stripHtml(html);
      result = { file: filePath, exists: true, text, word_count: countWords(text) };
    } else if (mode === 'sections') {
      result = { file: filePath, exists: true, sections: extractSections(html) };
    } else {
      // full mode
      const text = stripHtml(html);
      result = {
        file: filePath,
        exists: true,
        size_bytes: Buffer.byteLength(html),
        word_count: countWords(text),
        ...extractMeta(html),
        sections: extractSections(html),
        internal_links: extractLinks(html, 'internal'),
        external_links: extractLinks(html, 'external'),
        images: extractImages(html),
      };

      if (args['keyword-density'] || args.find) {
        const targetKw = args['keyword-density'] || args.find;
        const lowerText = text.toLowerCase();
        const lowerKw = targetKw.toLowerCase();
        let count = 0;
        let idx = lowerText.indexOf(lowerKw);
        while (idx !== -1) {
          count++;
          idx = lowerText.indexOf(lowerKw, idx + 1);
        }
        result.keyword_analysis = {
          keyword: targetKw,
          occurrences: count,
          density_percent: Number(((count / Math.max(1, result.word_count)) * 100).toFixed(2)),
          in_title: (result.title || '').toLowerCase().includes(lowerKw),
          in_h1: (result.h1 || []).some(h => h.toLowerCase().includes(lowerKw)),
          in_meta_description: (result.meta_description || '').toLowerCase().includes(lowerKw),
        };
      }
    }

    printOutput(envelope(result, { tool: 'page-read' }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: 'page-read' }), 'json');
    process.exitCode = 1;
  }
}

function urlToFilePath(url, siteRoot) {
  let pathname;
  try {
    pathname = new URL(url).pathname;
  } catch {
    pathname = url.startsWith('/') ? url : `/${url}`;
  }
  pathname = pathname.replace(/\/$/, '') || '/';
  const clean = pathname.replace(/^\//, '');

  // Try direct .html file
  const htmlPath = path.join(siteRoot, clean.endsWith('.html') ? clean : `${clean}.html`);
  if (fs.existsSync(htmlPath)) return htmlPath;

  // Try index.html
  const indexPath = path.join(siteRoot, clean, 'index.html');
  if (fs.existsSync(indexPath)) return indexPath;

  // Return best guess
  return htmlPath;
}

function extractMeta(html) {
  const title = match(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
  const metaDesc = match(html, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i)
    || match(html, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i);
  const canonical = match(html, /<link\b[^>]*rel=["']canonical["'][^>]*href=["']([^"']*)["'][^>]*>/i);
  const robots = match(html, /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i);
  const h1 = matchAll(html, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripHtml);
  const h2s = matchAll(html, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(stripHtml);
  const h3s = matchAll(html, /<h3[^>]*>([\s\S]*?)<\/h3>/gi).map(stripHtml);

  // Schema types
  const schemaTypes = [];
  const ldJsonBlocks = matchAll(html, /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi);
  for (const block of ldJsonBlocks) {
    try {
      const parsed = JSON.parse(block);
      if (parsed['@type']) schemaTypes.push(parsed['@type']);
    } catch { /* ignore parse errors */ }
  }

  return {
    title: stripHtml(title || ''),
    meta_description: metaDesc || '',
    canonical: canonical || '',
    robots: robots || '',
    h1,
    h2s,
    h3s,
    schema_types: schemaTypes,
  };
}

function extractSections(html) {
  const sections = [];
  // Split by h2 headings
  const parts = html.split(/<h2[^>]*>/i);
  for (let i = 1; i < parts.length; i++) {
    const [heading, ...rest] = parts[i].split(/<\/h2>/i);
    const content = rest.join('');
    const text = stripHtml(content).trim();
    sections.push({
      heading: stripHtml(heading).trim(),
      word_count: countWords(text),
      text_preview: text.slice(0, 200),
    });
  }
  return sections;
}

function extractLinks(html, type) {
  const regex = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  const results = [];
  const seen = new Set();
  let m;

  while ((m = regex.exec(html)) !== null) {
    const href = m[1];
    const text = stripHtml(m[2] || '');
    const isExternal = /^https?:\/\//i.test(href) && !/client\.agency/i.test(href);

    if (type === 'internal' && isExternal) continue;
    if (type === 'external' && !isExternal) continue;
    if (seen.has(href)) continue;
    seen.add(href);

    results.push({ href, text: text.trim(), type: isExternal ? 'external' : 'internal' });
  }
  return results;
}

function extractImages(html) {
  const images = [];
  const imgTags = html.match(/<img\b[^>]*>/gi) || [];
  for (const tag of imgTags) {
    const src = match(tag, /src=["']([^"']*)["']/i);
    const alt = match(tag, /alt=["']([^"']*)["']/i);
    images.push({
      src: src || '',
      alt: alt === null ? null : alt, // null = missing alt attribute
      has_alt: alt !== null,
    });
  }
  return images;
}

function stripHtml(text) {
  return String(text || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function countWords(text) {
  return text.split(/\s+/).filter(Boolean).length;
}

function match(text, regex) {
  const m = text.match(regex);
  return m ? m[1] : null;
}

function matchAll(text, regex) {
  const results = [];
  let m;
  while ((m = regex.exec(text)) !== null) {
    results.push(m[1]);
  }
  return results;
}

function printHelp() {
  console.log(`
page-read â€” Read and analyze page content from the local website repo

Usage:
  v2 page-read --url <url> [options]
  v2 page-read --file <path> [options]

Source:
  --url <url>              Page URL (resolves to local file)
  --file <path>            Local file path directly
  --site-root <path>       Website repo root (default: /opt/client-site)

Content Mode:
  --raw                    Output raw HTML
  --text                   Output extracted text only (no tags)
  --sections               Output structured sections (h2 â†’ content)
  --full                   Output everything: meta + sections + links + images (default)

Analysis:
  --keyword-density <kw>   Calculate keyword density for given keyword
  --find <str>             Count occurrences of string in content

Output:
  --json                   JSON output (default)
  --table                  Table output
  --csv                    CSV output

Examples:
  v2 page-read --url https://{{DOMAIN}}/services/{{NICHE}}-seo --json
  v2 page-read --file services/{{NICHE}}-seo.html --keyword-density "{{NICHE}} seo" --json
  v2 page-read --url /blog/seo-for-{{AUDIENCE}} --text --json
  v2 page-read --file index.html --sections --table
`);
}


if (require.main === module) {
  main();
}

module.exports = main;
