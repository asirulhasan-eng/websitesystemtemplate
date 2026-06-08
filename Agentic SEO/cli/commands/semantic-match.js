#!/usr/bin/env node
/**
 * semantic-match.js - Score topical overlap between two pages.
 *
 * This is a deterministic lexical relevance gate for internal-link candidates.
 * It weights titles/headings/meta text above body copy and returns a bounded
 * score plus shared terms so the AI can reject forced links by evidence.
 */
const { parseArgs, numberArg, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const {
  DEFAULT_BASE_URL,
  readPageSource,
  extractPageSignals,
  tokenize,
  termFrequency,
  cosineSimilarity,
  jaccardSimilarity,
  topSharedTerms,
} = require('../lib/site_analysis');

const TOOL = 'semantic-match';

async function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  try {
    const sourceInput = args['source-url'] || args.source || args['source-file'];
    const targetInput = args['target-url'] || args.target || args['target-file'];
    if (!sourceInput || !targetInput) {
      throw new Error('Provide --source-url/--source-file and --target-url/--target-file');
    }

    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    const baseUrl = args['base-url'] || process.env.CLIENT_BASE_URL || DEFAULT_BASE_URL;
    const timeoutMs = numberArg(args, 'timeout-ms', 20000);
    const threshold = numberArg(args, 'threshold', 0.22);
    const preferLive = boolArg(args, 'prefer-live');

    const source = await readPageSource({
      url: args['source-file'] ? null : sourceInput,
      file: args['source-file'] ? sourceInput : null,
      siteRoot,
      baseUrl,
      timeoutMs,
      preferLive,
    });
    const target = await readPageSource({
      url: args['target-file'] ? null : targetInput,
      file: args['target-file'] ? targetInput : null,
      siteRoot,
      baseUrl,
      timeoutMs,
      preferLive,
    });

    const sourceSignals = extractPageSignals(source.html);
    const targetSignals = extractPageSignals(target.html);
    const sourceTokens = weightedTokens(sourceSignals);
    const targetTokens = weightedTokens(targetSignals);
    const sourceTitleTokens = tokenize([sourceSignals.title, ...sourceSignals.h1s, ...sourceSignals.h2s].join(' '));
    const targetTitleTokens = tokenize([targetSignals.title, ...targetSignals.h1s, ...targetSignals.h2s].join(' '));

    const cosine = cosineSimilarity(termFrequency(sourceTokens), termFrequency(targetTokens));
    const jaccard = jaccardSimilarity(sourceTokens, targetTokens);
    const headingOverlap = jaccardSimilarity(sourceTitleTokens, targetTitleTokens);
    const score = round((cosine * 0.7) + (jaccard * 0.2) + (headingOverlap * 0.1), 3);
    const sharedTerms = topSharedTerms(sourceTokens, targetTokens, numberArg(args, 'terms', 20));
    const recommendation = classify(score, threshold, sharedTerms.length);

    printOutput(envelope({
      source: summarizeSource(source, sourceSignals),
      target: summarizeSource(target, targetSignals),
      algorithm: 'weighted_lexical_cosine_v1',
      score,
      threshold,
      pass: recommendation === 'accept',
      recommendation,
      components: {
        cosine: round(cosine, 3),
        jaccard: round(jaccard, 3),
        heading_overlap: round(headingOverlap, 3),
      },
      shared_terms: sharedTerms.map(({ term, source_count, target_count }) => ({ term, source_count, target_count })),
      notes: [
        'Use this as a topical relevance gate, not as permission to add a link by count alone.',
        'Accept only when the link is also a natural next step for a reader and the anchor can be contextual.',
      ],
    }, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

function weightedTokens(signals) {
  const chunks = [];
  repeat(chunks, signals.title, 4);
  repeat(chunks, signals.h1s.join(' '), 3);
  repeat(chunks, signals.h2s.join(' '), 2);
  repeat(chunks, signals.meta_description, 2);
  repeat(chunks, signals.text, 1);
  return tokenize(chunks.join(' '));
}

function repeat(chunks, value, count) {
  const text = String(value || '').trim();
  if (!text) return;
  for (let i = 0; i < count; i += 1) chunks.push(text);
}

function classify(score, threshold, sharedTermCount) {
  if (score >= threshold && sharedTermCount >= 3) return 'accept';
  if (score >= threshold * 0.7 && sharedTermCount >= 2) return 'review';
  return 'reject';
}

function summarizeSource(source, signals) {
  return {
    input: source.input,
    source: source.source,
    url: source.url,
    file: source.file,
    status: source.status,
    title: signals.title,
    h1: signals.h1s[0] || null,
    word_count: signals.word_count,
  };
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function printHelp() {
  console.log(`
semantic-match - Score topical relevance between two pages

Usage:
  v2 semantic-match --source-url <url> --target-url <url> [options]
  v2 semantic-match --source-file <file> --target-file <file> [options]

Inputs:
  --source-url <url>       Source page URL.
  --target-url <url>       Destination page URL.
  --source-file <path>     Source local HTML file.
  --target-file <path>     Target local HTML file.
  --site-root <path>       Local website root for URL-to-file resolution.
  --base-url <url>         Site base URL (default: https://{{DOMAIN}}).
  --prefer-live            Fetch URLs live even if a local file exists.

Scoring:
  --threshold <score>      Acceptance threshold, 0-1 (default: 0.22).
  --terms <N>              Shared terms to include (default: 20).
  --timeout-ms <N>         Live fetch timeout (default: 20000).

Output:
  --json                   JSON output (default).
  --table                  Table output.

Examples:
  v2 semantic-match --source-url /blog/{{NICHE}}-seo-pricing --target-url /services/pricing --json
  v2 semantic-match --source-file blog/a.html --target-file services/b.html --site-root ./site --json
`);
}

if (require.main === module) {
  main();
}

module.exports = main;
