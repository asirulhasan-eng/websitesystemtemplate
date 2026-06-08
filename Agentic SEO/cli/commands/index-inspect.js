#!/usr/bin/env node
/**
 * index-inspect.js - Inspect URL index status via Google Search Console.
 *
 * Uses the official URL Inspection API when credentials are configured. If
 * credentials are missing, it can fall back to a live technical indexability
 * check while clearly marking Google index status as unverified.
 */
const fs = require('node:fs');
const { parseArgs, boolArg, numberArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');
const { inspectUrl } = require('../lib/gsc');
const {
  DEFAULT_BASE_URL,
  readPageSource,
  extractPageSignals,
  normalizeUrl,
} = require('../lib/site_analysis');

const TOOL = 'index-inspect';

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  try {
    const url = args.url || args['inspection-url'];
    if (!url && !args['from-file'] && !boolArg(args, 'sample')) throw new Error('Provide --url');

    const config = loadToolEnv({ cwd: args.cwd, envPath: args.env });
    const siteUrl = args['site-url'] || config.get('GSC_SITE_URL') || deriveSiteUrl(url);
    const languageCode = args.lang || args['language-code'] || 'en-US';

    let source = 'gsc_api';
    let raw;
    let apiError = null;

    if (boolArg(args, 'sample')) {
      raw = sampleInspection(url || 'https://{{DOMAIN}}/');
      source = 'sample';
    } else if (args['from-file']) {
      raw = JSON.parse(fs.readFileSync(args['from-file'], 'utf8'));
      source = 'file';
    } else {
      try {
        raw = await inspectUrl(config, { inspectionUrl: url, siteUrl, languageCode });
      } catch (error) {
        apiError = error.message;
        if (boolArg(args, 'gsc-only')) throw error;
        const fallback = await liveFallback(url, args);
        printOutput(envelope({
          url,
          site_url: siteUrl,
          source: 'live_fallback',
          gsc_verified: false,
          api_error: apiError,
          decision: 'unknown_requires_gsc',
          verified_in_google_index: null,
          manual_followup_required: true,
          live_indexability: fallback,
          blocking_findings: fallback.blocking_findings,
          notes: [
            'Google index status was not verified because the URL Inspection API could not be reached.',
            'Use GSC URL Inspection or provide OAuth credentials for definitive indexed/deindexed status.',
          ],
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }
    }

    const normalized = normalizeInspection(raw, {
      requestedUrl: url || raw?.request?.inspectionUrl || raw?.inspectionUrl,
      siteUrl: siteUrl || raw?.siteUrl || raw?.request?.siteUrl,
      source,
    });

    printOutput(envelope(normalized, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}
module.exports = main;

function normalizeInspection(raw, context = {}) {
  const inspectionResult = raw.inspectionResult || raw.raw?.inspectionResult || raw;
  const index = inspectionResult.indexStatusResult || {};
  const mobile = inspectionResult.mobileUsabilityResult || null;
  const rich = inspectionResult.richResultsResult || null;
  const requestedUrl = context.requestedUrl || raw.request?.inspectionUrl || null;
  const siteUrl = context.siteUrl || raw.siteUrl || raw.request?.siteUrl || null;
  const verdict = index.verdict || null;

  const blockingFindings = [];
  if (index.robotsTxtState === 'DISALLOWED') blockingFindings.push('robots_txt_disallowed');
  if (/^BLOCKED_/i.test(index.indexingState || '')) blockingFindings.push(index.indexingState.toLowerCase());
  if (index.pageFetchState && index.pageFetchState !== 'SUCCESSFUL') blockingFindings.push(index.pageFetchState.toLowerCase());
  if (verdict === 'FAIL') blockingFindings.push('inspection_failed');
  if (verdict === 'NEUTRAL') blockingFindings.push('not_indexed_or_excluded');

  const googleCanonical = index.googleCanonical || null;
  const userCanonical = index.userCanonical || null;
  const canonicalMismatch =
    Boolean(googleCanonical && requestedUrl) &&
    normalizeUrl(googleCanonical) !== normalizeUrl(requestedUrl);
  if (canonicalMismatch) blockingFindings.push('google_selected_different_canonical');

  const verifiedIndexed = verdict === 'PASS';
  const decision = verifiedIndexed
    ? 'indexed'
    : (blockingFindings.length > 0 ? 'deindexed_or_blocked' : 'not_indexed_or_unknown');

  return {
    url: requestedUrl,
    site_url: siteUrl,
    source: context.source || 'gsc_api',
    gsc_verified: context.source !== 'live_fallback',
    verified_in_google_index: verifiedIndexed,
    decision,
    verdict,
    coverage_state: index.coverageState || null,
    robots_txt_state: index.robotsTxtState || null,
    indexing_state: index.indexingState || null,
    page_fetch_state: index.pageFetchState || null,
    crawled_as: index.crawledAs || null,
    last_crawl_time: index.lastCrawlTime || null,
    google_canonical: googleCanonical,
    user_canonical: userCanonical,
    canonical_mismatch: canonicalMismatch,
    sitemaps: index.sitemap || [],
    referring_urls: index.referringUrls || [],
    mobile_usability_verdict: mobile?.verdict || null,
    rich_results_verdict: rich?.verdict || null,
    inspection_result_link: inspectionResult.inspectionResultLink || null,
    blocking_findings: Array.from(new Set(blockingFindings)),
    raw: context.source === 'file' || context.source === 'sample' ? inspectionResult : undefined,
  };
}

async function liveFallback(url, args) {
  const baseUrl = args['base-url'] || process.env.CLIENT_BASE_URL || DEFAULT_BASE_URL;
  const page = await readPageSource({
    url,
    siteRoot: args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site',
    baseUrl,
    timeoutMs: numberArg(args, 'timeout-ms', 20000),
    preferLive: boolArg(args, 'prefer-live', true),
  });
  const signals = extractPageSignals(page.html);
  const xRobots = page.headers?.['x-robots-tag'] || '';
  const noindex = /\bnoindex\b/i.test(`${xRobots},${signals.robots || ''}`);
  const canonical = signals.canonical ? normalizeUrl(new URL(signals.canonical, page.url).toString(), baseUrl) : null;
  const normalizedUrl = normalizeUrl(url, baseUrl);
  const canonicalMismatch = Boolean(canonical && canonical !== normalizedUrl);
  const blockingFindings = [];
  if (page.status >= 400) blockingFindings.push(`http_${page.status}`);
  if (noindex) blockingFindings.push('noindex');
  if (canonicalMismatch) blockingFindings.push('canonical_mismatch');

  return {
    source: page.source,
    status: page.status,
    final_url: page.url,
    title: signals.title,
    canonical,
    robots: signals.robots || null,
    noindex,
    canonical_mismatch: canonicalMismatch,
    is_live_indexable: page.status >= 200 && page.status < 300 && !noindex && !canonicalMismatch,
    blocking_findings: blockingFindings,
  };
}

function deriveSiteUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.protocol}//${parsed.host}/`;
  } catch {
    return 'sc-domain:{{DOMAIN}}';
  }
}

function sampleInspection(url) {
  return {
    request: {
      inspectionUrl: url,
      siteUrl: 'sc-domain:{{DOMAIN}}',
      languageCode: 'en-US',
    },
    inspectionResult: {
      inspectionResultLink: 'https://search.google.com/search-console/inspect',
      indexStatusResult: {
        verdict: 'PASS',
        coverageState: 'Submitted and indexed',
        robotsTxtState: 'ALLOWED',
        indexingState: 'INDEXING_ALLOWED',
        pageFetchState: 'SUCCESSFUL',
        googleCanonical: url,
        userCanonical: url,
        sitemap: ['https://{{DOMAIN}}/sitemap.xml'],
        referringUrls: [],
        crawledAs: 'MOBILE',
      },
    },
  };
}

function printHelp() {
  console.log(`
index-inspect - Inspect a URL with Google Search Console URL Inspection API

Usage:
  v2 index-inspect --url https://{{DOMAIN}}/page/ --json

Inputs:
  --url <url>              URL to inspect.
  --site-url <property>    GSC property URL, e.g. sc-domain:{{DOMAIN}}.
  --env <path>             Env file with GSC OAuth credentials.
  --from-file <path>       Normalize a saved URL Inspection API JSON response.
  --sample                 Use a built-in indexed sample response.

Fallback:
  --gsc-only               Fail instead of using live technical fallback.
  --prefer-live            Fetch live URL for fallback even if local file exists.
  --site-root <path>       Local site root for fallback URL resolution.
  --base-url <url>         Site base URL for fallback canonical comparison.
  --timeout-ms <N>         Fetch timeout (default: 20000).

Output:
  --json                   JSON output (default).
  --table                  Table output.

Notes:
  The live fallback checks HTTP status, noindex, and canonical tags. It cannot
  verify whether Google has indexed the URL; use GSC credentials for that.
`);
}
