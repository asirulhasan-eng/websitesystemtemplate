#!/usr/bin/env node
/**
 * link-check.js - Find internal links to a target URL or broken local links.
 */
const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const {
  DEFAULT_BASE_URL,
  extractLinks,
  fileToUrl,
  normalizeBaseUrl,
  normalizeUrl,
  urlToFilePath,
  walkDir,
} = require('../lib/site_analysis');

const TOOL = 'link-check';

function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  try {
    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    if (!fs.existsSync(siteRoot)) throw new Error(`Site root not found: ${siteRoot}`);

    const baseUrl = args['base-url'] || process.env.CLIENT_BASE_URL || DEFAULT_BASE_URL;
    const targetUrl = args['target-url'] || args.url || null;
    const contains = args.contains || null;
    const checkBroken = boolArg(args, 'broken') || (!targetUrl && !contains);
    const targetNormalized = targetUrl ? normalizeUrl(targetUrl, baseUrl) : null;

    const pages = walkDir(siteRoot)
      .filter((file) => file.endsWith('.html'))
      .filter((file) => !file.includes('node_modules') && !file.includes('.git') && !file.includes('_archive'));

    const matches = [];
    const broken = [];
    let internalLinkCount = 0;

    for (const file of pages) {
      const relativePath = path.relative(siteRoot, file).replace(/\\/g, '/');
      const sourceUrl = fileToUrl(relativePath, baseUrl);
      const html = fs.readFileSync(file, 'utf8');
      const links = extractLinks(html, sourceUrl, baseUrl).filter((link) => link.internal);
      internalLinkCount += links.length;

      for (const link of links) {
        if (targetNormalized && normalizeUrl(link.url, baseUrl) === targetNormalized) {
          matches.push(toLinkRecord(link, sourceUrl, relativePath));
        } else if (contains && (link.href.includes(contains) || link.url.includes(contains))) {
          matches.push(toLinkRecord(link, sourceUrl, relativePath));
        }

        if (checkBroken && isBrokenInternalLink(link, siteRoot, baseUrl)) {
          broken.push(toLinkRecord(link, sourceUrl, relativePath));
        }
      }
    }

    printOutput(envelope({
      site_root: siteRoot,
      base_url: normalizeBaseUrl(baseUrl),
      mode: targetUrl ? 'target-url' : (contains ? 'contains' : 'broken'),
      target_url: targetNormalized,
      contains,
      pages_scanned: pages.length,
      internal_links_scanned: internalLinkCount,
      match_count: matches.length,
      broken_count: broken.length,
      matches,
      broken_links: checkBroken ? broken : undefined,
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

function toLinkRecord(link, sourceUrl, sourceFile) {
  return {
    source_url: sourceUrl,
    source_file: sourceFile,
    href: link.href,
    target_url: link.url,
    anchor_text: link.text,
  };
}

function isBrokenInternalLink(link, siteRoot, baseUrl) {
  try {
    const url = new URL(link.url);
    if (url.origin !== normalizeBaseUrl(baseUrl)) return false;
  } catch {
    return false;
  }
  const filePath = urlToFilePath(link.url, siteRoot, baseUrl);
  return !filePath || !fs.existsSync(filePath);
}

function printHelp() {
  console.log(`
link-check - Find internal links to a target URL or broken local links

Usage:
  v2 link-check --target-url /old-url --site-root ./site --json
  v2 link-check --contains /old-folder/ --json
  v2 link-check --broken --json

Inputs:
  --site-root <path>       Website repo root (default: /opt/client-site).
  --base-url <url>         Site base URL (default: https://{{DOMAIN}}).

Modes:
  --target-url <url>       Find internal links pointing to this normalized URL.
  --contains <text>        Find internal links whose href/URL contains text.
  --broken                 Find internal links that do not resolve to a local HTML file.

Output:
  --json                   JSON output (default).
  --table                  Table output.
`);
}

if (require.main === module) {
  main();
}
module.exports = main;
