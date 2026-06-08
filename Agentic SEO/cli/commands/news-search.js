#!/usr/bin/env node
/**
 * news-search.js â€” Fresh news search via Serper's /news endpoint.
 *
 * The Industry Radar (cron/run-industry-radar.sh / processes/industry-radar.md)
 * uses this to gather dated headlines per beat (SEO / GBP / PPC / Google core
 * updates / local SEO / {{NICHE}} industry) instead of relying on the AI's
 * built-in web search, which proved unreliable. Deterministic, source-cited,
 * date-filtered results the radar can act on.
 *
 * Usage:
 *   node news-search.js --q "google core update" --days 7 --json
 */

const { parseArgs, numberArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { loadToolEnv } = require('../lib/env');
const { serperNews, compactNews, daysToRecency } = require('../lib/serper');

const TOOL = 'news-search';

const HELP = `
news-search â€” Fresh, dated news headlines via Serper (/news).

USAGE
  node news-search.js --q "<query>" [options]
  node news-search.js --q "google business profile update" --days 7 --json
  node news-search.js --sample

REQUIRED
  --q <query>            Search query (required unless --sample)

OPTIONS
  --days <N>             Freshness window in days â†’ Serper tbs recency bucket
                         (<=1 day, <=7 week, <=31 month, else year). Default: 7.
  --tbs <qdr:*>          Pass a Serper recency token directly (overrides --days).
  --num <N>              Max results to return (default: 10).
  --gl <country>         Google country code (default: us).
  --hl <lang>            Google UI language (default: en).
  --json | --table       Output format (default: json).
  --sample               Built-in sample output (no API key needed).
  --help                 Show this help.

OUTPUT
  query, freshness (tbs), count, results[] = { title, link, snippet, date, source, position }

Requires SERPER_API_KEY in the environment or an env file.
`.trim();

function sampleData() {
  return {
    query: 'google core update {{AUDIENCE}}',
    freshness: 'qdr:w',
    count: 2,
    results: [
      {
        position: 1,
        title: 'Google March 2026 Core Update Rolling Out',
        link: 'https://www.searchengin.example/google-march-2026-core-update',
        snippet: 'Google has begun rolling out the March 2026 core update, which is expected to take up to three weeks to complete...',
        date: '2 days ago',
        source: 'Search Engine Example',
      },
      {
        position: 2,
        title: 'How Local Businesses Should Respond to the Latest Core Update',
        link: 'https://www.localseo.example/core-update-local-business',
        snippet: 'Local service businesses, including {{AUDIENCE}} and HVAC, should audit content quality and E-E-A-T signals...',
        date: '1 day ago',
        source: 'Local SEO Example',
      },
    ],
  };
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  if (args.sample) {
    printOutput(envelope(sampleData(), { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const query = args.q || args.query;
    if (!query) {
      throw new Error('Missing required argument: --q "<query>" (or use --sample)');
    }

    const days = numberArg(args, 'days', 7);
    const tbs = args.tbs || daysToRecency(days);
    const num = numberArg(args, 'num', 10);

    const config = loadToolEnv({ cwd: args.cwd });
    const json = await serperNews(config, {
      q: query,
      tbs,
      num,
      gl: args.gl || 'us',
      hl: args.hl || 'en',
    });

    const compact = compactNews(json);
    const result = {
      query,
      freshness: tbs || null,
      count: compact.news.length,
      results: compact.news,
    };

    printOutput(envelope(result, { tool: TOOL }), getOutputFormat(args));
  } catch (error) {
    printOutput(errorEnvelope(error, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
