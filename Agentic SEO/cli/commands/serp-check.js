#!/usr/bin/env node
/**
 * serp-check.js Ã¢â‚¬â€ Check live SERP positions for keywords
 *
 * Queries Serper (or DataForSEO) API for organic SERP results,
 * finds the target domain's position, and optionally persists
 * results to the serp_checks table.
 *
 * Usage:
 *   node serp-check.js --keywords "website seo,seo for small business owners" [options]
 *
 * See --help for full option list.
 */

const fs = require('node:fs');
const { parseArgs, numberArg, boolArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { loadToolEnv } = require('../lib/env');
const { serperSearch, compactSerp } = require('../lib/serper');
const { nowIso } = require('../lib/dates');
const { loadLines } = require('../lib/io');
const { reconcileSerpTrackedKeywords } = require('./keyword-track');

const TOOL = 'serp-check';

const HELP = `
serp-check Ã¢â‚¬â€ Check live SERP positions for keywords

USAGE
  node serp-check.js --keywords <list> [options]
  node serp-check.js --keywords-file <path> [options]
  node serp-check.js --from-tracked --db <path> [options]
  node serp-check.js --sample [options]

KEYWORD INPUT
  --keywords <list>          Comma-separated keywords to check
  --keywords-file <path>     File with one keyword per line
  --from-tracked             Use keywords from the 'keywords' table (requires --db)
  --reconcile-tracked        Before --from-tracked, seed/update keywords from serp_checks

SEARCH OPTIONS
  --domain <domain>          Target domain to find (default: example.com)
  --location <location>      Search location (for serper: gl parameter)
  --provider <name>          SERP provider: serper | dataforseo | sample (default: serper)
  --top <N>                  Number of SERP results to check (default: 10)
  --include-paa              Include People Also Ask data
  --include-features         Include SERP feature data

PERSISTENCE
  --db <path>                SQLite database path (enables persistence)
  --no-persist               Check SERPs but skip saving to database
  --only-tracked             Only show results for tracked keywords (requires --db)
  --only-unranked            Only show keywords where domain is not found

OUTPUT
  --sort <field>             Sort by field (default: position)
  --json                     JSON output (default)
  --table                    Table output
  --csv                      CSV output

SAMPLE MODE
  --sample                   Use built-in sample data (no API key needed)

EXAMPLES
  node serp-check.js --sample --table
  node serp-check.js --keywords "website seo,seo for small business owners" --domain example.com
  node serp-check.js --keywords-file ./keywords.txt --db ./seo.db --top 20
  node serp-check.js --from-tracked --db ./seo.db --only-unranked
  node serp-check.js --keywords "small business owners marketing" --provider dataforseo --include-paa
`.trim();

function getSampleData(domain) {
  return [
    {
      keyword: 'website seo',
      position: 4,
      url: `https://${domain}/`,
      title: 'Website Operations - #1 SEO Agency for small business owners',
      domain: domain,
      top_results: [
        { position: 1, title: 'SEO for small business owners - ServiceTitan', link: 'https://servicetitan.com/small business owners-seo', domain: 'servicetitan.com' },
        { position: 2, title: 'small business owners SEO Services - WebFX', link: 'https://webfx.com/small business owners-seo', domain: 'webfx.com' },
        { position: 3, title: 'SEO for website Companies | HookAgency', link: 'https://hookagency.com/small business owners-seo', domain: 'hookagency.com' },
        { position: 4, title: 'Website Operations - #1 SEO Agency for small business owners', link: `https://${domain}/`, domain: domain },
      ],
      paa: [
        { question: 'How much does SEO cost for small business owners?', snippet: 'SEO for small business owners typically costs $500-$2000/mo...' },
        { question: 'Is SEO worth it for website owners?', snippet: 'Yes, SEO provides long-term ROI for small business owners...' },
      ],
    },
    {
      keyword: 'seo for small business owners',
      position: 5,
      url: `https://${domain}/seo-for-small business owners`,
      title: 'SEO for small business owners - Complete Guide | Website Operations',
      domain: domain,
      top_results: [
        { position: 1, title: 'small business owners SEO - The Complete Guide', link: 'https://searchenginejournal.com/small business owners-seo', domain: 'searchenginejournal.com' },
        { position: 5, title: 'SEO for small business owners - Complete Guide | Website Operations', link: `https://${domain}/seo-for-small business owners`, domain: domain },
      ],
      paa: [],
    },
    {
      keyword: 'small business owners website design',
      position: 7,
      url: `https://${domain}/web-design`,
      title: 'small business owners Website Design | Website Operations',
      domain: domain,
      top_results: [],
      paa: [],
    },
    {
      keyword: 'small business owners lead generation',
      position: null,
      url: null,
      title: null,
      domain: domain,
      top_results: [
        { position: 1, title: 'Lead Generation for small business owners - HomeAdvisor', link: 'https://homeadvisor.com/small business owners-leads', domain: 'homeadvisor.com' },
      ],
      paa: [],
    },
  ];
}

function checkSerpSample(keyword, domain) {
  const row = getSampleData(domain).find((item) => item.keyword === keyword);
  if (!row) return { organic: [] };
  const organic = (row.top_results || []).map((item) => ({
    position: item.position,
    title: item.title,
    link: item.link,
  }));
  return {
    organic,
    peopleAlsoAsk: row.paa || [],
  };
}

async function checkSerpSerper(config, keyword, options) {
  const result = await serperSearch(config, {
    q: keyword,
    gl: options.location || 'us',
    num: options.top || 10,
  });
  return compactSerp(result);
}

async function checkSerpDataforseo(config, keyword, options) {
  const { dataForSeoOrganicSearch, compactDataForSeoSerp } = require('../lib/dataforseo');
  const result = await dataForSeoOrganicSearch(config, {
    q: keyword,
    depth: options.top || 10,
    locationCode: options.location || 2840,
  });
  // Budget exhaustion returns no SERP payload. Surface it as an error rather
  // than letting compactDataForSeoSerp return [] Ã¢â‚¬â€ an empty result would be
  // mistaken for "domain ranks nowhere" and could trigger false alerts.
  if (result && result.budget_exhausted) {
    throw new Error(`DataForSEO budget exhausted while checking "${keyword}": ${result.error || 'daily credit limit reached'}`);
  }
  return compactDataForSeoSerp(result);
}

function findDomainInResults(serpData, domain) {
  const normalizedDomain = domain.replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/$/, '').toLowerCase();
  for (const result of (serpData.organic || [])) {
    const resultDomain = (result.link || '').replace(/^(https?:\/\/)?(www\.)?/, '').replace(/\/.*$/, '').toLowerCase();
    if (resultDomain === normalizedDomain || resultDomain.endsWith('.' + normalizedDomain)) {
      return {
        position: result.position,
        url: result.link,
        title: result.title,
      };
    }
  }
  return { position: null, url: null, title: null };
}

function persistToDb(dbPath, results, provider) {
  const db = openStateDb(dbPath);
  const now = nowIso();
  const insert = db.prepare(`
    INSERT INTO serp_checks (
      serp_check_id, keyword, provider, position, url, domain,
      snapshot_json, checked_at, created_at, metadata_json
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `);

  let inserted = 0;
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const row of results) {
      const snapshotJson = JSON.stringify({
        top_results: row.top_results || [],
        paa: row.paa || [],
        features: row.features || [],
      });

      insert.run(
        makeId('SERP'),
        row.keyword,
        provider,
        row.position,
        row.url,
        row.domain,
        snapshotJson,
        now,
        now,
        JSON.stringify({ competitors: (row.top_results || []).map(r => r.domain).filter(Boolean) })
      );
      inserted++;
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  // Update keywords table with latest position if it exists
  try {
    const updateKeyword = db.prepare(`
      UPDATE keywords SET
        current_position = ?,
        best_position = CASE
          WHEN best_position IS NULL THEN ?
          WHEN ? IS NOT NULL AND ? < best_position THEN ?
          ELSE best_position
        END,
        last_checked_at = ?
      WHERE keyword = ?
    `);

    for (const row of results) {
      updateKeyword.run(
        row.position,
        row.position,
        row.position, row.position, row.position,
        now,
        row.keyword
      );
    }
  } catch { /* keywords table might not have matching entries */ }

  db.close();
  return inserted;
}

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  try {
    const domain = args.domain || 'example.com';
    const provider = args.provider || 'serper';
    const top = numberArg(args, 'top', 10);
    const includePaa = boolArg(args, 'include-paa');
    const includeFeatures = boolArg(args, 'include-features');

    // Ã¢â€â‚¬Ã¢â€â‚¬ Collect keywords Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let keywords = [];
    let reconciliation = null;

    if (boolArg(args, 'sample')) {
      // Sample mode Ã¢â‚¬â€ use built-in data
      const sampleResults = getSampleData(domain);

      const output = envelope({
        domain,
        provider: 'sample',
        keywords_checked: sampleResults.length,
        found: sampleResults.filter(r => r.position != null).length,
        not_found: sampleResults.filter(r => r.position == null).length,
        errors: [],
        keywords_errored: 0,
        partial: false,
        rows: sampleResults.map(r => {
          const row = {
            keyword: r.keyword,
            position: r.position,
            url: r.url,
            domain: r.domain,
          };
          if (includePaa && r.paa && r.paa.length) row.paa = r.paa;
          if (!includePaa) delete r.paa;
          row.top_results = r.top_results;
          return row;
        }),
      }, { tool: TOOL });

      printOutput(output, getOutputFormat(args));
      return;
    }

    if (args.keywords) {
      keywords = listArg(args, 'keywords');
    } else if (args['keywords-file']) {
      keywords = loadLines(args['keywords-file']);
      if (keywords.length === 0) throw new Error(`No keywords found in file: ${args['keywords-file']}`);
    } else if (boolArg(args, 'from-tracked')) {
      if (!args.db && !process.env.WEBSITE_AGENT_DB_PATH && !process.env.SEO_AGENT_DB) {
        throw new Error('--db <path> is required when using --from-tracked');
      }
      const db = openStateDb(resolveDbPath(args));
      if (boolArg(args, 'reconcile-tracked')) {
        reconciliation = reconcileSerpTrackedKeywords(db, {
          cluster: 'serp-tracked',
          priority: 'medium',
          intentTier: 'money',
          sourceArg: provider === 'serper' || provider === 'sample' ? 'serper' : null,
          status: 'active',
          now: nowIso(),
        });
      }
      const tracked = db.prepare('SELECT keyword FROM keywords ORDER BY priority DESC, keyword ASC').all();
      db.close();
      keywords = tracked.map(r => r.keyword);
      if (keywords.length === 0) throw new Error('No tracked keywords found in the keywords table');
    } else {
      throw new Error('Provide keywords via --keywords, --keywords-file, --from-tracked, or --sample');
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Check SERPs Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const config = loadToolEnv({ cwd: args.cwd });
    const results = [];
    const errors = [];

    for (const keyword of keywords) {
      try {
        let serpData;

        if (provider === 'dataforseo') {
          serpData = await checkSerpDataforseo(config, keyword, { top, location: args.location });
        } else if (provider === 'sample') {
          serpData = checkSerpSample(keyword, domain);
        } else {
          serpData = await checkSerpSerper(config, keyword, { top, location: args.location });
        }

        const found = findDomainInResults(serpData, domain);
        const topResults = (serpData.organic || []).slice(0, top).map(r => ({
          position: r.position,
          title: r.title,
          link: r.link,
          domain: (r.link || '').replace(/^https?:\/\/(www\.)?/, '').replace(/\/.*$/, ''),
        }));

        const row = {
          keyword,
          position: found.position,
          url: found.url,
          title: found.title,
          domain,
          top_results: topResults,
        };

        if (includePaa && serpData.peopleAlsoAsk) {
          row.paa = serpData.peopleAlsoAsk;
        }
        if (includeFeatures) {
          row.features = {
            knowledge_graph: !!serpData.knowledgeGraph,
            paa_count: (serpData.peopleAlsoAsk || []).length,
            related_searches: (serpData.relatedSearches || []).length,
          };
        }

        results.push(row);
      } catch (keywordError) {
        const message = keywordError && keywordError.message ? keywordError.message : String(keywordError);
        console.error(`[serp-check] Failed to check "${keyword}": ${message}`);
        errors.push({ keyword, error: message });
        // Log individual keyword failure but continue checking the remaining keywords
      }
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Filter Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let filtered = results;

    if (boolArg(args, 'only-unranked')) {
      filtered = filtered.filter(r => r.position == null);
    }
    if (boolArg(args, 'only-tracked') && args.db) {
      const db = openStateDb(resolveDbPath(args));
      const tracked = new Set(db.prepare('SELECT keyword FROM keywords').all().map(r => r.keyword));
      db.close();
      filtered = filtered.filter(r => tracked.has(r.keyword));
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Sort Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const sortField = args.sort || 'position';
    filtered.sort((a, b) => {
      const va = a[sortField];
      const vb = b[sortField];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'number') return va - vb;
      return String(va).localeCompare(String(vb));
    });

    // Ã¢â€â‚¬Ã¢â€â‚¬ Persist Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    let persisted = 0;
    const shouldPersist = args.db && !boolArg(args, 'no-persist');
    if (shouldPersist) {
      persisted = persistToDb(resolveDbPath(args), filtered, provider);
    }

    // Ã¢â€â‚¬Ã¢â€â‚¬ Output Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
    const payload = {
      domain,
      provider,
      keywords_checked: filtered.length,
      found: filtered.filter(r => r.position != null).length,
      not_found: filtered.filter(r => r.position == null).length,
      errors,
      keywords_errored: errors.length,
      partial: errors.length > 0,
      persisted,
      rows: filtered,
    };
    if (reconciliation) payload.reconciliation = reconciliation;
    const output = envelope(payload, { tool: TOOL });

    printOutput(output, getOutputFormat(args));

  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
