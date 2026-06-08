#!/usr/bin/env node
/**
 * sitemap-audit.js - Validate XML sitemap cleanliness.
 *
 * Parses sitemap XML or sitemap indexes, then optionally checks listed URLs for
 * status, redirects, noindex directives, and canonical mismatches.
 */
const fs = require('node:fs');
const { parseArgs, numberArg, boolArg, listArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const {
  DEFAULT_BASE_URL,
  decodeHtml,
  extractPageSignals,
  normalizeBaseUrl,
  normalizeUrl,
} = require('../lib/site_analysis');

const TOOL = 'sitemap-audit';

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  try {
    const baseUrl = args['base-url'] || process.env.CLIENT_BASE_URL || DEFAULT_BASE_URL;
    const sitemapUrl = args.url || `${normalizeBaseUrl(baseUrl)}/sitemap.xml`;
    const timeoutMs = numberArg(args, 'timeout-ms', 20000);
    const limit = numberArg(args, 'limit', 250);
    const maxSitemaps = numberArg(args, 'max-sitemaps', 20);
    const noFetch = boolArg(args, 'no-fetch');
    const contains = listArg(args, 'contains', []);
    const requiredUrls = listArg(args, 'required-url', []);

    const sitemapState = await collectSitemaps({
      sitemapUrl,
      fromFile: args['from-file'],
      timeoutMs,
      noFetch,
      maxSitemaps,
    });

    const allUrlEntries = dedupeUrlEntries(sitemapState.urlEntries);
    const checkedEntries = noFetch ? [] : allUrlEntries.slice(0, limit);
    const pageChecks = [];
    for (const entry of checkedEntries) {
      pageChecks.push(await auditUrl(entry.loc, { timeoutMs, baseUrl }));
    }

    const issues = [
      ...sitemapState.issues,
      ...pageChecks.flatMap((check) => check.issues),
      ...containsIssues(contains, allUrlEntries),
      ...requiredUrlIssues(requiredUrls, allUrlEntries, baseUrl),
    ];

    const byType = {};
    const bySeverity = { critical: 0, important: 0, minor: 0, info: 0 };
    for (const issue of issues) {
      byType[issue.type] = (byType[issue.type] || 0) + 1;
      bySeverity[issue.severity] = (bySeverity[issue.severity] || 0) + 1;
    }

    printOutput(envelope({
      sitemap_url: sitemapUrl,
      source: args['from-file'] ? 'file' : 'live',
      fetched: !noFetch,
      sitemap_count: sitemapState.sitemaps.length,
      url_count: allUrlEntries.length,
      checked_url_count: pageChecks.length,
      check_limit: noFetch ? 0 : limit,
      ok_to_submit: issues.filter((issue) => ['critical', 'important'].includes(issue.severity)).length === 0,
      by_type: byType,
      by_severity: bySeverity,
      contains_checks: contains.map((needle) => ({
        contains: needle,
        present: allUrlEntries.some((entry) => entry.loc.includes(needle)),
      })),
      required_url_checks: requiredUrls.map((url) => ({
        url: normalizeUrl(url, baseUrl),
        present: allUrlEntries.some((entry) => normalizeUrl(entry.loc, baseUrl) === normalizeUrl(url, baseUrl)),
      })),
      sitemaps: sitemapState.sitemaps,
      urls: boolArg(args, 'summary-only') ? undefined : allUrlEntries,
      page_checks: boolArg(args, 'summary-only') ? undefined : pageChecks,
      issues,
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

async function collectSitemaps(options) {
  const seen = new Set();
  const sitemaps = [];
  const urlEntries = [];
  const issues = [];

  async function visit(sitemapUrl, depth, fromFile = null) {
    if (seen.has(sitemapUrl) || seen.size >= options.maxSitemaps) return;
    seen.add(sitemapUrl);

    let xml;
    let status = 200;
    let source = 'live';
    let finalUrl = sitemapUrl;
    try {
      if (fromFile) {
        xml = fs.readFileSync(fromFile, 'utf8');
        source = 'file';
      } else if (options.noFetch && depth > 0) {
        sitemaps.push({ url: sitemapUrl, source: 'skipped', status: null, url_count: 0, child_sitemap_count: 0 });
        return;
      } else {
        const fetched = await fetchRaw(sitemapUrl, { timeoutMs: options.timeoutMs, redirect: 'follow' });
        status = fetched.status;
        finalUrl = fetched.finalUrl || sitemapUrl;
        xml = fetched.body;
        if (!fetched.ok) {
          issues.push({
            type: 'sitemap_unreachable',
            severity: 'critical',
            sitemap: sitemapUrl,
            status,
            detail: `Sitemap returned HTTP ${status}`,
          });
        }
      }
    } catch (error) {
      issues.push({
        type: 'sitemap_fetch_error',
        severity: 'critical',
        sitemap: sitemapUrl,
        detail: error.message,
      });
      sitemaps.push({ url: sitemapUrl, source, status: null, error: error.message, url_count: 0, child_sitemap_count: 0 });
      return;
    }

    const parsed = parseSitemapXml(xml, finalUrl);
    sitemaps.push({
      url: sitemapUrl,
      final_url: finalUrl,
      source,
      status,
      type: parsed.type,
      url_count: parsed.urls.length,
      child_sitemap_count: parsed.sitemaps.length,
    });
    urlEntries.push(...parsed.urls);

    if (parsed.type === 'unknown') {
      issues.push({
        type: 'invalid_sitemap_xml',
        severity: 'critical',
        sitemap: sitemapUrl,
        detail: 'No <url><loc> or <sitemap><loc> entries found.',
      });
    }

    if (depth < 2) {
      for (const child of parsed.sitemaps) await visit(child.loc, depth + 1);
    }
  }

  await visit(options.sitemapUrl, 0, options.fromFile || null);
  return { sitemaps, urlEntries, issues };
}

function parseSitemapXml(xml, sitemapUrl) {
  const text = String(xml || '');
  const childSitemaps = [];
  const urls = [];

  for (const block of matchBlocks(text, 'sitemap')) {
    const loc = extractXmlTag(block, 'loc');
    if (!loc) continue;
    childSitemaps.push({
      loc: absolutizeUrl(loc, sitemapUrl),
      lastmod: extractXmlTag(block, 'lastmod') || null,
    });
  }

  for (const block of matchBlocks(text, 'url')) {
    const loc = extractXmlTag(block, 'loc');
    if (!loc) continue;
    urls.push({
      loc: absolutizeUrl(loc, sitemapUrl),
      lastmod: extractXmlTag(block, 'lastmod') || null,
      changefreq: extractXmlTag(block, 'changefreq') || null,
      priority: extractXmlTag(block, 'priority') || null,
    });
  }

  return {
    type: childSitemaps.length > 0 ? 'sitemapindex' : (urls.length > 0 ? 'urlset' : 'unknown'),
    sitemaps: childSitemaps,
    urls,
  };
}

async function auditUrl(url, options) {
  const issues = [];
  const normalized = normalizeUrl(url, options.baseUrl);
  const check = {
    url,
    normalized_url: normalized,
    status: null,
    redirected: false,
    redirect_location: null,
    canonical: null,
    noindex: false,
    ok: false,
    issues,
  };

  try {
    const fetched = await fetchRaw(url, { timeoutMs: options.timeoutMs, redirect: 'manual' });
    check.status = fetched.status;
    check.content_type = fetched.headers['content-type'] || null;
    check.ok = fetched.status >= 200 && fetched.status < 300;

    if (fetched.status >= 300 && fetched.status < 400) {
      check.redirected = true;
      check.redirect_location = fetched.headers.location || null;
      issues.push({
        type: 'sitemap_url_redirects',
        severity: 'important',
        url,
        status: fetched.status,
        location: check.redirect_location,
        detail: 'Sitemap URL redirects; list the final canonical URL instead.',
      });
      return check;
    }

    if (fetched.status >= 400 || fetched.status === 0) {
      issues.push({
        type: 'sitemap_url_http_error',
        severity: fetched.status >= 500 || fetched.status === 0 ? 'critical' : 'important',
        url,
        status: fetched.status,
        detail: `Sitemap URL returned HTTP ${fetched.status}`,
      });
      return check;
    }

    const xRobots = fetched.headers['x-robots-tag'] || '';
    const signals = extractPageSignals(fetched.body || '');
    check.canonical = signals.canonical || null;
    check.robots = signals.robots || null;
    check.noindex = /\bnoindex\b/i.test(`${xRobots},${signals.robots || ''}`);

    if (check.noindex) {
      issues.push({
        type: 'sitemap_url_noindex',
        severity: 'important',
        url,
        detail: 'Sitemap URL is marked noindex.',
      });
    }

    if (signals.canonical) {
      let canonicalUrl = signals.canonical;
      try { canonicalUrl = new URL(signals.canonical, fetched.finalUrl || url).toString(); } catch { /* keep as-is */ }
      const normalizedCanonical = normalizeUrl(canonicalUrl, options.baseUrl);
      check.canonical = normalizedCanonical;
      if (normalizedCanonical !== normalized) {
        issues.push({
          type: 'sitemap_url_noncanonical',
          severity: 'important',
          url,
          canonical: normalizedCanonical,
          detail: 'Sitemap URL declares a different canonical URL.',
        });
      }
    }
  } catch (error) {
    issues.push({
      type: 'sitemap_url_fetch_error',
      severity: 'critical',
      url,
      detail: error.message,
    });
  }

  return check;
}

async function fetchRaw(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeoutMs || 20000);
  try {
    const response = await fetch(url, {
      method: 'GET',
      redirect: options.redirect || 'follow',
      headers: { 'user-agent': '{{SITE_NAME}}Agent/2.0 (+https://{{DOMAIN}})' },
      signal: controller.signal,
    });
    const body = await response.text();
    return {
      ok: response.ok,
      status: response.status,
      finalUrl: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function matchBlocks(text, tag) {
  const blocks = [];
  const regex = new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'gi');
  let found;
  while ((found = regex.exec(text)) !== null) blocks.push(found[1]);
  return blocks;
}

function extractXmlTag(block, tag) {
  const found = String(block || '').match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i'));
  return found ? decodeHtml(found[1].trim()) : null;
}

function absolutizeUrl(value, baseUrl) {
  try {
    return new URL(value, baseUrl).toString();
  } catch {
    return value;
  }
}

function dedupeUrlEntries(entries) {
  const seen = new Set();
  const deduped = [];
  for (const entry of entries) {
    const key = normalizeUrl(entry.loc);
    if (seen.has(key)) continue;
    seen.add(key);
    deduped.push(entry);
  }
  return deduped;
}

function containsIssues(contains, entries) {
  return contains
    .filter((needle) => !entries.some((entry) => entry.loc.includes(needle)))
    .map((needle) => ({
      type: 'sitemap_missing_contains',
      severity: 'important',
      contains: needle,
      detail: `No sitemap URL contains "${needle}".`,
    }));
}

function requiredUrlIssues(requiredUrls, entries, baseUrl) {
  const sitemapUrls = new Set(entries.map((entry) => normalizeUrl(entry.loc, baseUrl)));
  return requiredUrls
    .map((url) => normalizeUrl(url, baseUrl))
    .filter((url) => !sitemapUrls.has(url))
    .map((url) => ({
      type: 'sitemap_missing_required_url',
      severity: 'important',
      url,
      detail: 'Required URL is missing from the sitemap.',
    }));
}

function printHelp() {
  console.log(`
sitemap-audit - Validate sitemap XML and listed URLs

Usage:
  v2 sitemap-audit --url https://{{DOMAIN}}/sitemap.xml --json
  v2 sitemap-audit --from-file ./sitemap.xml --no-fetch --json

Inputs:
  --url <url>              Sitemap URL (default: <base-url>/sitemap.xml).
  --from-file <path>       Read sitemap XML from a local file.
  --base-url <url>         Site base URL (default: https://{{DOMAIN}}).

Checks:
  --contains <text[,text]> Require at least one sitemap URL containing each value.
  --required-url <url[,url]> Require exact normalized URLs in the sitemap.
  --limit <N>              Max listed URLs to fetch-check (default: 250).
  --max-sitemaps <N>       Max sitemap index children to fetch (default: 20).
  --no-fetch               Parse XML only; skip live status/canonical/noindex checks.
  --summary-only           Omit URL and page-check arrays.
  --timeout-ms <N>         Fetch timeout (default: 20000).

Output:
  --json                   JSON output (default).
  --table                  Table output.

Flags raised:
  - Sitemap unreachable or invalid
  - Listed URLs that redirect, 4xx/5xx, noindex, or canonicalize elsewhere
  - Required/contains URL checks missing from the sitemap
`);
}

if (require.main === module) {
  main();
}

module.exports = main;
