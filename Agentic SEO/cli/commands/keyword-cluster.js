#!/usr/bin/env node
/**
 * keyword-cluster.js Ã¢â‚¬â€ Cluster search queries by lexical similarity.
 *
 * Groups queries from GSC snapshots or the tracked-keywords table into
 * topical clusters using pairwise Jaccard similarity over tokenized
 * n-grams and union-find connected-component clustering. Each cluster
 * gets an auto-generated ID, a head term (highest impressions), and
 * aggregated metrics.
 *
 * Usage:
 *   v2 keyword-cluster --db <path> [options]
 */

const { parseArgs, numberArg, boolArg, resolveDbPath, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const { openStateDb } = require('../lib/state_db');
const { nowIso } = require('../lib/dates');
const { tokenize, jaccardSimilarity } = require('../lib/site_analysis');

const TOOL = 'keyword-cluster';

const HELP = `
keyword-cluster Ã¢â‚¬â€ Cluster search queries by lexical similarity

USAGE
  v2 keyword-cluster --db <path> [options]

DATA SOURCES (pick one)
  --from-gsc             Cluster from gsc_snapshots table (default)
  --from-tracked         Cluster tracked keywords only

CLUSTERING OPTIONS
  --threshold <N>        Jaccard similarity threshold (default: 0.5)
  --min-impressions <N>  Minimum cluster total impressions to include (default: 5)
  --days <N>             GSC lookback days (default: 28)
  --intent-filter <t>    Filter: money|authority|info|all (default: all)

OUTPUT
  --json                 JSON output (default)
  --table                Table output
  --csv                  CSV output
  --save                 Save cluster names back to keywords.cluster column
  --sample               Sample output without DB
  --help                 Show this help

EXAMPLES
  v2 keyword-cluster --db ./seo.db --table
  v2 keyword-cluster --db ./seo.db --from-tracked --threshold 0.4 --json
  v2 keyword-cluster --db ./seo.db --days 14 --min-impressions 20 --save
  v2 keyword-cluster --sample --json
`.trim();

// Ã¢â€â‚¬Ã¢â€â‚¬ Intent classification tokens Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
const COMMERCIAL_TOKENS = new Set([
  'buy', 'service', 'cost', 'pricing', 'agency', 'company',
  'audit', 'package', 'hire', 'price', 'quote', 'rate',
  'affordable', 'cheap', 'best', 'top', 'professional',
  'contractor', 'firm', 'provider', 'expert',
]);

// Ã¢â€â‚¬Ã¢â€â‚¬ Union-Find Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function makeUnionFind(n) {
  const parent = Array.from({ length: n }, (_, i) => i);
  const rank = new Array(n).fill(0);

  function find(x) {
    while (parent[x] !== x) {
      parent[x] = parent[parent[x]]; // path compression
      x = parent[x];
    }
    return x;
  }

  function union(a, b) {
    const ra = find(a);
    const rb = find(b);
    if (ra === rb) return;
    if (rank[ra] < rank[rb]) { parent[ra] = rb; }
    else if (rank[ra] > rank[rb]) { parent[rb] = ra; }
    else { parent[rb] = ra; rank[ra] += 1; }
  }

  return { find, union };
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Slug helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function slugify(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Round helper Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function round(value, digits = 1) {
  return Number(Number(value || 0).toFixed(digits));
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Infer intent from query tokens Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function inferIntent(queryTokens) {
  for (const token of queryTokens) {
    if (COMMERCIAL_TOKENS.has(token)) return 'commercial';
  }
  return 'informational';
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Sample data Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function getSampleClusters() {
  return [
    {
      cluster_id: 'auto-{{NICHE}}-seo-audit-servic',
      head_term: '{{NICHE}} website seo audit service',
      variants: [
        '{{NICHE}} website seo audit services',
        '{{NICHE}} seo audit service',
        '{{AUDIENCE}} seo audit',
        'seo audit for {{AUDIENCE}}',
        '{{NICHE}} site seo audit',
        '{{NICHE}} seo audit process',
      ],
      total_impressions: 95,
      total_clicks: 4,
      weighted_position: 37.2,
      ranking_urls: ['https://{{DOMAIN}}/blog/{{NICHE}}-seo-audit-process'],
      dominant_intent: 'commercial',
      variant_count: 6,
    },
    {
      cluster_id: 'auto-{{NICHE}}-seo',
      head_term: '{{NICHE}} seo',
      variants: [
        '{{AUDIENCE}} seo',
        'seo for {{AUDIENCE}}',
        '{{NICHE}} search engine optimization',
      ],
      total_impressions: 890,
      total_clicks: 42,
      weighted_position: 5.1,
      ranking_urls: [
        'https://{{DOMAIN}}/',
        'https://{{DOMAIN}}/seo-for-{{AUDIENCE}}',
      ],
      dominant_intent: 'informational',
      variant_count: 3,
    },
    {
      cluster_id: 'auto-{{NICHE}}-web-design',
      head_term: '{{AUDIENCE}} website design',
      variants: [
        '{{NICHE}} website design cost',
        '{{AUDIENCE}} web design services',
      ],
      total_impressions: 540,
      total_clicks: 22,
      weighted_position: 8.4,
      ranking_urls: ['https://{{DOMAIN}}/web-design'],
      dominant_intent: 'commercial',
      variant_count: 2,
    },
  ];
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Load queries from GSC Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function loadFromGsc(db, days) {
  const rows = db.prepare(`
    SELECT
      query,
      SUM(impressions) AS impressions,
      SUM(clicks)      AS clicks,
      AVG(position)    AS avg_position
    FROM gsc_snapshots
    WHERE captured_at >= date('now', '-' || ? || ' days')
      AND query IS NOT NULL
      AND query != ''
    GROUP BY query
  `).all(days);

  // Also gather ranking URLs per query
  const urlRows = db.prepare(`
    SELECT query, page
    FROM gsc_snapshots
    WHERE captured_at >= date('now', '-' || ? || ' days')
      AND query IS NOT NULL
      AND query != ''
      AND page IS NOT NULL
      AND page != ''
    GROUP BY query, page
  `).all(days);

  const urlMap = new Map();
  for (const row of urlRows) {
    if (!urlMap.has(row.query)) urlMap.set(row.query, new Set());
    urlMap.get(row.query).add(row.page);
  }

  return rows.map(r => ({
    query: r.query,
    impressions: r.impressions || 0,
    clicks: r.clicks || 0,
    avg_position: r.avg_position || 0,
    urls: urlMap.has(r.query) ? [...urlMap.get(r.query)] : [],
  }));
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Load from tracked keywords Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function loadFromTracked(db) {
  const rows = db.prepare(`
    SELECT keyword, cluster, current_position
    FROM keywords
  `).all();

  return rows.map(r => ({
    query: r.keyword,
    impressions: 1, // no impression data for tracked-only
    clicks: 0,
    avg_position: r.current_position || 0,
    urls: [],
    existing_cluster: r.cluster || null,
  }));
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Core clustering logic Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function clusterQueries(entries, threshold) {
  const n = entries.length;
  if (n === 0) return [];

  // 1. Tokenize each query
  const tokenSets = entries.map(e => tokenize(e.query));

  // 2. Build inverted index: token Ã¢â€ â€™ [entry indices]
  const invertedIndex = new Map();
  for (let i = 0; i < n; i++) {
    const seen = new Set();
    for (const token of tokenSets[i]) {
      if (seen.has(token)) continue;
      seen.add(token);
      if (!invertedIndex.has(token)) invertedIndex.set(token, []);
      invertedIndex.get(token).push(i);
    }
  }

  // 3. Build pairwise similarity Ã¢â‚¬â€ only compare pairs sharing Ã¢â€°Â¥1 token
  const uf = makeUnionFind(n);
  const checked = new Set();

  for (const indices of invertedIndex.values()) {
    for (let a = 0; a < indices.length; a++) {
      for (let b = a + 1; b < indices.length; b++) {
        const i = indices[a];
        const j = indices[b];
        // Already in the same component? Skip.
        if (uf.find(i) === uf.find(j)) continue;
        const pairKey = i < j ? `${i}:${j}` : `${j}:${i}`;
        if (checked.has(pairKey)) continue;
        checked.add(pairKey);

        const sim = jaccardSimilarity(tokenSets[i], tokenSets[j]);
        if (sim >= threshold) {
          uf.union(i, j);
        }
      }
    }
  }

  // 4. Collect connected components
  const components = new Map();
  for (let i = 0; i < n; i++) {
    const root = uf.find(i);
    if (!components.has(root)) components.set(root, []);
    components.get(root).push(i);
  }

  // 5. Build cluster objects
  const clusters = [];
  for (const memberIndices of components.values()) {
    const members = memberIndices.map(i => entries[i]);

    // Head term = highest impressions
    members.sort((a, b) => b.impressions - a.impressions);
    const headTerm = members[0].query;

    const totalImpressions = members.reduce((s, m) => s + m.impressions, 0);
    const totalClicks = members.reduce((s, m) => s + m.clicks, 0);

    // Impression-weighted average position
    let weightedPosition = 0;
    if (totalImpressions > 0) {
      const weightedSum = members.reduce((s, m) => s + (m.avg_position * m.impressions), 0);
      weightedPosition = round(weightedSum / totalImpressions, 1);
    } else {
      // Fallback: simple average
      const posSum = members.reduce((s, m) => s + m.avg_position, 0);
      weightedPosition = round(posSum / members.length, 1);
    }

    // Collect all ranking URLs across cluster members
    const urlSet = new Set();
    for (const m of members) {
      for (const url of (m.urls || [])) urlSet.add(url);
    }

    // Infer dominant intent from all member tokens
    const allTokens = members.flatMap(m => tokenize(m.query));
    const dominantIntent = inferIntent(allTokens);

    const variants = members
      .filter(m => m.query !== headTerm)
      .map(m => m.query);

    clusters.push({
      cluster_id: `auto-${slugify(headTerm)}`,
      head_term: headTerm,
      variants,
      total_impressions: totalImpressions,
      total_clicks: totalClicks,
      weighted_position: weightedPosition,
      ranking_urls: [...urlSet],
      dominant_intent: dominantIntent,
      variant_count: variants.length,
    });
  }

  // Sort by total_impressions DESC
  clusters.sort((a, b) => b.total_impressions - a.total_impressions);
  return clusters;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Save clusters back to keywords table Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function saveClusters(db, clusters) {
  const update = db.prepare(`
    UPDATE keywords SET cluster = ?, metadata_json =
      json_set(COALESCE(metadata_json, '{}'), '$.cluster_updated_at', ?)
    WHERE keyword = ?
  `);
  const now = nowIso();
  let updated = 0;

  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const cluster of clusters) {
      const allQueries = [cluster.head_term, ...cluster.variants];
      for (const query of allQueries) {
        const result = update.run(cluster.head_term, now, query);
        updated += result.changes;
      }
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }

  return updated;
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Filter by intent Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
function filterByIntent(clusters, intentFilter) {
  if (!intentFilter || intentFilter === 'all') return clusters;
  const filterMap = {
    money: 'commercial',
    commercial: 'commercial',
    authority: 'informational',
    info: 'informational',
    informational: 'informational',
  };
  const target = filterMap[intentFilter.toLowerCase()];
  if (!target) return clusters;
  return clusters.filter(c => c.dominant_intent === target);
}

// Ã¢â€â‚¬Ã¢â€â‚¬ Main Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
async function main() {
  const args = parseArgs();

  if (args.help || args.h) {
    console.log(HELP);
    return;
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ Sample mode Ã¢â€â‚¬Ã¢â€â‚¬
  if (args.sample) {
    const clusters = getSampleClusters();
    printOutput(envelope({
      source: 'sample',
      threshold: 0.5,
      cluster_count: clusters.length,
      total_queries: clusters.reduce((s, c) => s + 1 + c.variant_count, 0),
      clusters,
    }, { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const dbPath = resolveDbPath(args);
    const db = openStateDb(dbPath);

    try {
      const threshold = numberArg(args, 'threshold', 0.5);
      const minImpressions = numberArg(args, 'min-impressions', 5);
      const days = numberArg(args, 'days', 28);
      const intentFilter = args['intent-filter'] || 'all';
      const shouldSave = boolArg(args, 'save');
      const fromTracked = boolArg(args, 'from-tracked');

      // 1. Load entries
      let entries;
      let source;
      if (fromTracked) {
        entries = loadFromTracked(db);
        source = 'tracked_keywords';
      } else {
        entries = loadFromGsc(db, days);
        source = 'gsc_snapshots';
      }

      if (entries.length === 0) {
        printOutput(envelope({
          source,
          threshold,
          cluster_count: 0,
          total_queries: 0,
          clusters: [],
          notes: [`No queries found in ${source}. Try adjusting --days or adding data first.`],
        }, { tool: TOOL }), getOutputFormat(args));
        return;
      }

      // 2. Cluster
      let clusters = clusterQueries(entries, threshold);

      // 3. Filter by minimum impressions
      clusters = clusters.filter(c => c.total_impressions >= minImpressions);

      // 4. Filter by intent
      clusters = filterByIntent(clusters, intentFilter);

      // 5. Save if requested
      let savedCount = 0;
      if (shouldSave) {
        savedCount = saveClusters(db, clusters);
      }

      // 6. Output
      const totalQueries = clusters.reduce((s, c) => s + 1 + c.variant_count, 0);
      const output = envelope({
        source,
        days: fromTracked ? null : days,
        threshold,
        cluster_count: clusters.length,
        total_queries: totalQueries,
        saved_to_keywords: shouldSave ? savedCount : undefined,
        clusters,
      }, { tool: TOOL });

      printOutput(output, getOutputFormat(args));
    } finally {
      db.close();
    }
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

if (require.main === module) {
  main();
}

module.exports = main;
