#!/usr/bin/env node
/**
 * keyword-track.js â€” Manage tracked keywords in the {{SITE_NAME}} SQLite state DB.
 *
 * Add, remove, update, and bulk-import keywords for SERP tracking.
 *
 * Usage:
 *   node keyword-track.js --add "{{AUDIENCE}} near me" [options]
 */

const fs = require('node:fs');
const { parseArgs, requireArg, listArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb, makeId } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');

const HELP = `
keyword-track â€” Manage tracked keywords in the SQLite state database.

USAGE
  node keyword-track.js --add "{{AUDIENCE}} near me" [options]
  node keyword-track.js --add-file ./keywords.txt [options]
  node keyword-track.js --remove "old keyword"
  node keyword-track.js --update "existing keyword" --priority high --cluster "core services"

ACTIONS (pick one)
  --add <keyword>           Add a single keyword to tracking
  --add-file <path>         Bulk add keywords from a file (one per line)
  --remove <keyword>        Remove a keyword from tracking
  --update <keyword>        Update an existing keyword's metadata

KEYWORD OPTIONS (for --add, --add-file, --update)
  --cluster <name>          Assign keyword to a cluster group
  --target-url <url>        Associate a target URL with the keyword
  --priority <level>        Priority: high | medium | low (default: medium)
  --intent-tier <tier>      Intent: money | authority | info | noise (default: money)
  --page-type <type>        Target page type: service | blog | home
  --source <src>            Source: gsc | serper | manual (default: manual)
  --status <status>         Status: active | aspirational | ranking | paused (default: active)

OPTIONS
  --db <path>               SQLite database path
  --json                    Output as JSON (default)
  --table                   Output as table
  --sample                  Show sample output without a database

EXAMPLES
  node keyword-track.js --add "{{AUDIENCE}} near me" --cluster "core services" --priority high
  node keyword-track.js --add "emergency {{AUDIENCE}}" --target-url "https://client.com/emergency-{{AUDIENCE}}"
  node keyword-track.js --add-file ./keywords.txt --cluster "drain services"
  node keyword-track.js --update "{{AUDIENCE}} near me" --priority high --cluster "money keywords"
  node keyword-track.js --remove "outdated keyword"

FILE FORMAT (for --add-file)
  One keyword per line. Lines starting with # are ignored.
  Tab-separated fields (columns 5-8 optional):
    keyword<TAB>cluster<TAB>priority<TAB>target_url<TAB>intent_tier<TAB>page_type<TAB>source<TAB>status

  Example:
    {{AUDIENCE}} near me
    emergency {{AUDIENCE}}\\tcore services\\thigh
    drain cleaning service\\tdrain services\\tmedium\\thttps://example.com/drain\\tmoney\\tservice\\tmanual\\tactive
`.trim();

const VALID_PRIORITIES = new Set(['high', 'medium', 'low']);
const VALID_INTENT_TIERS = new Set(['money', 'authority', 'info', 'noise']);
const VALID_PAGE_TYPES = new Set(['service', 'blog', 'home']);
const VALID_SOURCES = new Set(['gsc', 'serper', 'manual']);
const VALID_STATUSES = new Set(['active', 'aspirational', 'ranking', 'paused']);

async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // â”€â”€ Sample mode â”€â”€
  if (args.sample) {
    const sample = {
      action: 'add',
      keywords: [
        {
          keyword_id: 'KW-2026-06-03-A1B2C3D4',
          keyword: '{{AUDIENCE}} near me',
          cluster: 'core services',
          priority: 'high',
          target_url: 'https://client.com/{{AUDIENCE}}',
          current_position: null,
          best_position: null,
          created_at: nowIso(),
        },
      ],
      added: 1,
      skipped: 0,
    };
    printOutput(envelope(sample, { tool: 'keyword-track' }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);
    const now = nowIso();

    const cluster = args.cluster || null;
    const targetUrl = args['target-url'] || null;
    const priority = args.priority || 'medium';
    const intentTier = args['intent-tier'] || 'money';
    const pageType = args['page-type'] || null;
    const source = args.source || 'manual';
    const status = args.status || 'active';

    if (args.priority && !VALID_PRIORITIES.has(args.priority)) {
      throw new Error(`--priority must be one of: ${[...VALID_PRIORITIES].join(', ')}`);
    }
    if (args['intent-tier'] && !VALID_INTENT_TIERS.has(args['intent-tier'])) {
      throw new Error(`--intent-tier must be one of: ${[...VALID_INTENT_TIERS].join(', ')}`);
    }
    if (args['page-type'] && !VALID_PAGE_TYPES.has(args['page-type'])) {
      throw new Error(`--page-type must be one of: ${[...VALID_PAGE_TYPES].join(', ')}`);
    }
    if (args.source && !VALID_SOURCES.has(args.source)) {
      throw new Error(`--source must be one of: ${[...VALID_SOURCES].join(', ')}`);
    }
    if (args.status && !VALID_STATUSES.has(args.status)) {
      throw new Error(`--status must be one of: ${[...VALID_STATUSES].join(', ')}`);
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ACTION: ADD single keyword
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (args.add) {
      const keyword = args.add;
      const result = addKeyword(db, keyword, { cluster, targetUrl, priority, intentTier, pageType, source, status, now });
      db.close();
      printOutput(envelope(result, { tool: 'keyword-track' }), getOutputFormat(args));
      return;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ACTION: ADD from file
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (args['add-file']) {
      const filePath = args['add-file'];
      if (!fs.existsSync(filePath)) {
        throw new Error(`File not found: ${filePath}`);
      }

      const lines = fs.readFileSync(filePath, 'utf8')
        .split(/\r?\n/)
        .map(l => l.trim())
        .filter(l => l && !l.startsWith('#'));

      const keywords = [];
      let added = 0;
      let skipped = 0;

      db.exec('BEGIN IMMEDIATE TRANSACTION');
      try {
        for (const line of lines) {
          const parts = line.split('\t');
          const kw = parts[0].trim();
          const kwCluster = parts[1]?.trim() || cluster;
          const kwPriority = parts[2]?.trim() || priority;
          const kwTargetUrl = parts[3]?.trim() || targetUrl;
          const kwIntentTier = parts[4]?.trim() || intentTier;
          const kwPageType = parts[5]?.trim() || pageType;
          const kwSource = parts[6]?.trim() || source;
          const kwStatus = parts[7]?.trim() || status;

          if (!kw) continue;

          // Check for duplicates
          const existing = db.prepare('SELECT keyword_id FROM keywords WHERE keyword = ?').get(kw);
          if (existing) {
            skipped++;
            continue;
          }

          const kwId = makeId('KW');
          db.prepare(`
            INSERT INTO keywords (keyword_id, keyword, cluster, priority, target_url, intent_tier, target_page_type, source, status, created_at, metadata_json)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
          `).run(kwId, kw, kwCluster, kwPriority, kwTargetUrl, kwIntentTier, kwPageType || null, kwSource, kwStatus, now, JSON.stringify({ source: 'keyword-track-cli', imported_from: filePath }));

          keywords.push({
            keyword_id: kwId,
            keyword: kw,
            cluster: kwCluster,
            priority: kwPriority,
            target_url: kwTargetUrl,
            intent_tier: kwIntentTier,
            target_page_type: kwPageType || null,
            source: kwSource,
            status: kwStatus,
          });
          added++;
        }
        db.exec('COMMIT');
      } catch (txError) {
        db.exec('ROLLBACK');
        throw txError;
      }

      db.close();

      const result = {
        action: 'add-file',
        source_file: filePath,
        keywords,
        added,
        skipped,
        total_lines: lines.length,
      };
      printOutput(envelope(result, { tool: 'keyword-track' }), getOutputFormat(args));
      return;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ACTION: REMOVE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (args.remove) {
      const keyword = args.remove;
      const existing = db.prepare('SELECT * FROM keywords WHERE keyword = ?').get(keyword);
      if (!existing) {
        db.close();
        throw new Error(`Keyword not found: "${keyword}"`);
      }

      db.prepare('DELETE FROM keywords WHERE keyword = ?').run(keyword);
      db.close();

      const result = {
        action: 'remove',
        removed: existing,
      };
      printOutput(envelope(result, { tool: 'keyword-track' }), getOutputFormat(args));
      return;
    }

    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    // ACTION: UPDATE
    // â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•â•
    if (args.update) {
      const keyword = args.update;
      const existing = db.prepare('SELECT * FROM keywords WHERE keyword = ?').get(keyword);
      if (!existing) {
        db.close();
        throw new Error(`Keyword not found: "${keyword}"`);
      }

      const setClauses = [];
      const setParams = [];

      if (cluster !== null) {
        setClauses.push('cluster = ?');
        setParams.push(cluster);
      }
      if (targetUrl !== null) {
        setClauses.push('target_url = ?');
        setParams.push(targetUrl);
      }
      if (args.priority) {
        setClauses.push('priority = ?');
        setParams.push(priority);
      }
      if (args['intent-tier']) {
        setClauses.push('intent_tier = ?');
        setParams.push(intentTier);
      }
      if (args['page-type']) {
        setClauses.push('target_page_type = ?');
        setParams.push(pageType);
      }
      if (args.source) {
        setClauses.push('source = ?');
        setParams.push(source);
      }
      if (args.status) {
        setClauses.push('status = ?');
        setParams.push(status);
      }

      if (setClauses.length === 0) {
        db.close();
        throw new Error('No updates specified. Use --cluster, --target-url, --priority, --intent-tier, --page-type, --source, or --status');
      }

      // Update metadata to track the change
      let metadata = {};
      try { metadata = JSON.parse(existing.metadata_json || '{}'); } catch { metadata = {}; }
      metadata.last_updated_by = 'keyword-track-cli';
      metadata.last_updated_at = now;
      setClauses.push('metadata_json = ?');
      setParams.push(JSON.stringify(metadata));

      setParams.push(keyword);
      db.prepare(`UPDATE keywords SET ${setClauses.join(', ')} WHERE keyword = ?`).run(...setParams);

      const updated = db.prepare('SELECT * FROM keywords WHERE keyword = ?').get(keyword);
      db.close();

      const result = {
        action: 'update',
        keyword: updated,
      };
      printOutput(envelope(result, { tool: 'keyword-track' }), getOutputFormat(args));
      return;
    }

    // â”€â”€ No action specified â”€â”€
    db.close();
    throw new Error('Specify an action: --add, --add-file, --remove, or --update. Use --help for details.');

  } catch (error) {
    printOutput(errorEnvelope(error, { tool: 'keyword-track' }), 'json');
    process.exitCode = 1;
  }
}

function addKeyword(db, keyword, opts) {
  const existing = db.prepare('SELECT keyword_id FROM keywords WHERE keyword = ?').get(keyword);
  if (existing) {
    const kw = db.prepare('SELECT * FROM keywords WHERE keyword = ?').get(keyword);
    return {
      action: 'add',
      keywords: [kw],
      added: 0,
      skipped: 1,
      message: `Keyword "${keyword}" already exists (${existing.keyword_id})`,
    };
  }

  const kwId = makeId('KW');
  db.prepare(`
    INSERT INTO keywords (keyword_id, keyword, cluster, priority, target_url, intent_tier, target_page_type, source, status, created_at, metadata_json)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    kwId, keyword, opts.cluster, opts.priority, opts.targetUrl,
    opts.intentTier || 'money', opts.pageType || null, opts.source || 'manual', opts.status || 'active',
    opts.now, JSON.stringify({ source: 'keyword-track-cli' })
  );

  const created = db.prepare('SELECT * FROM keywords WHERE keyword_id = ?').get(kwId);
  return {
    action: 'add',
    keywords: [created],
    added: 1,
    skipped: 0,
  };
}

if (require.main === module) {
  main();
}

module.exports = main;
