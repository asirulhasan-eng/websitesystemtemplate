#!/usr/bin/env node
/**
 * content-blog-cannibalization.js - Check existing blog coverage before a new
 * supporting blog is recommended.
 *
 * The planner uses this as a deterministic pre-flight gate. It answers:
 * "Do we already have a blog post close enough to refresh, differentiate, or
 * internally link instead of creating a new one?"
 */

const fs = require('node:fs');
const path = require('node:path');
const { parseArgs, numberArg, boolArg, getOutputFormat } = require('../lib/cli');
const { printOutput, envelope, errorEnvelope } = require('../lib/output');
const {
  DEFAULT_BASE_URL,
  normalizeUrl,
  fileToUrl,
  urlToFilePath,
  extractPageSignals,
  tokenize,
  termFrequency,
  cosineSimilarity,
  jaccardSimilarity,
  topSharedTerms,
  walkDir,
} = require('../lib/site_analysis');

const TOOL = 'content-blog-cannibalization';

// Domain vocabulary shared by virtually every page on a single-niche site.
// Without this, plain term-frequency cosine is dominated by generic terms
// ("{{NICHE}}", "seo", "google", "local"...) so EVERY proposed {{NICHE}} topic
// looks like a duplicate of some existing {{NICHE}} blog. Stripping these makes
// the score reflect the DISTINCTIVE angle, not "also about {{NICHE}}".
const DOMAIN_STOPWORDS = new Set(tokenize([
  '{{NICHE}}', '{{AUDIENCE}}', '{{AUDIENCE}}',
  'seo', 'search', 'engine', 'optimization',
  'google', 'local', 'locally', 'map', 'maps',
  'rank', 'ranking', 'rankings', 'keyword', 'keywords',
  'business', 'businesses', 'company', 'companies',
  'service', 'services', 'marketing', 'advertising', 'ads', 'ad', 'ppc',
  'website', 'websites', 'web', 'online', 'digital', 'agency', 'agencies',
  'customer', 'customers', 'client', 'clients', 'lead', 'leads', 'call', 'calls',
].join(' ')));

function stripDomain(tokens) {
  return tokens.filter((token) => !DOMAIN_STOPWORDS.has(token));
}

function main() {
  const args = parseArgs();
  if (args.help || args.h) { printHelp(); return; }

  if (args.sample) {
    printOutput(envelope(buildSampleOutput(), { tool: TOOL }), getOutputFormat(args));
    return;
  }

  try {
    const topic = clean(args.topic || args.title || '');
    const targetKeyword = clean(args['target-keyword'] || args.keyword || '');
    const brief = clean(args.brief || args.description || '');
    if (!topic && !targetKeyword && !brief) {
      throw new Error('Provide --topic, --target-keyword, or --brief');
    }

    const siteRoot = args['site-root'] || process.env.CLIENT_SITE_ROOT || '/opt/client-site';
    const baseUrl = args['base-url'] || process.env.CLIENT_BASE_URL || DEFAULT_BASE_URL;
    if (!fs.existsSync(siteRoot)) throw new Error(`Site root not found: ${siteRoot}`);

    const threshold = numberArg(args, 'threshold', 0.45);
    const reviewThreshold = numberArg(args, 'review-threshold', 0.3);
    const limit = numberArg(args, 'limit', 10);
    const includeText = boolArg(args, 'include-text', false);
    const supportInput = args['support-url'] || args['support-file'] || args['target-url'] || args['target-file'] || null;

    const proposal = {
      topic,
      target_keyword: targetKeyword,
      brief,
      tokens: weightedProposalTokens({ topic, targetKeyword, brief }),
      phrase_tokens: tokenize([topic, targetKeyword].filter(Boolean).join(' ')),
      phrases: [topic, targetKeyword].map(normalizePhrase).filter(Boolean),
    };

    const htmlFiles = walkDir(siteRoot)
      .filter((file) => file.endsWith('.html'))
      .filter((file) => !file.includes(`${path.sep}node_modules${path.sep}`) && !file.includes(`${path.sep}.git${path.sep}`))
      .filter((file) => !file.includes(`${path.sep}_archive${path.sep}`));

    const blogPages = htmlFiles
      .filter((file) => classifyPageType(path.relative(siteRoot, file)) === 'blog')
      .map((file) => analyzePage(file, siteRoot, baseUrl, proposal, includeText))
      .sort((a, b) => b.score - a.score || b.exact_phrase_hits - a.exact_phrase_hits || String(a.url).localeCompare(String(b.url)));

    const matches = blogPages
      .filter((page) => page.verdict !== 'low_overlap')
      .slice(0, limit > 0 ? limit : blogPages.length);
    const top = blogPages[0] || null;

    const supportPage = supportInput
      ? analyzeSupportPage(supportInput, siteRoot, baseUrl, proposal)
      : null;

    const decision = decide({ top, matches, threshold, reviewThreshold });
    const data = {
      proposed: {
        topic: topic || null,
        target_keyword: targetKeyword || null,
        support_url: supportPage ? supportPage.url : normalizeSupportUrl(supportInput, baseUrl),
      },
      site_root: siteRoot,
      thresholds: {
        block: threshold,
        review: reviewThreshold,
      },
      existing_blog_count: blogPages.length,
      matched_blog_count: matches.length,
      recommendation: decision.recommendation,
      risk: decision.risk,
      action: decision.action,
      reason: decision.reason,
      support_page: supportPage,
      matches,
      next_steps: decision.next_steps,
      notes: [
        'Run before creating or approving a supporting new_blog_post task.',
        'Only recommendation=refresh_existing_blog blocks a new post (true same-query collision). create_new_blog and differentiate_or_refresh both proceed; for the latter, give the new post a distinct angle.',
        'Record this JSON or its top-match summary in task metadata.evidence.blog_cannibalization_check.',
      ],
    };

    printOutput(envelope(data, { tool: TOOL }), getOutputFormat(args));
  } catch (err) {
    printOutput(errorEnvelope(err, { tool: TOOL }), 'json');
    process.exitCode = 1;
  }
}

function analyzeSupportPage(input, siteRoot, baseUrl, proposal) {
  const normalizedInput = input.startsWith('/') ? `${normalizeBaseForJoin(baseUrl)}${input}` : input;
  let file = normalizedInput.includes('://') || !fs.existsSync(normalizedInput)
    ? urlToFilePath(normalizedInput, siteRoot, baseUrl)
    : path.resolve(input);
  // A root or directory support URL (e.g. "/") resolves to a directory; map it
  // to the directory's index.html so we never try to read a directory as a file.
  if (file && fs.existsSync(file) && fs.statSync(file).isDirectory()) {
    const indexFile = path.join(file, 'index.html');
    file = fs.existsSync(indexFile) ? indexFile : null;
  }
  if (!file || !fs.existsSync(file)) {
    return {
      input,
      found: false,
      url: normalizeSupportUrl(normalizedInput, baseUrl),
      note: 'Support page was not found locally; cannibalization check still used existing blog inventory.',
    };
  }
  const analyzed = analyzePage(file, siteRoot, baseUrl, proposal, false);
  return {
    found: true,
    url: analyzed.url,
    file: analyzed.file,
    page_type: classifyPageType(analyzed.file),
    title: analyzed.title,
    h1: analyzed.h1,
    score: analyzed.score,
    shared_terms: analyzed.shared_terms.slice(0, 12),
  };
}

function analyzePage(file, siteRoot, baseUrl, proposal, includeText) {
  const relativePath = path.relative(siteRoot, file).replace(/\\/g, '/');
  const html = fs.readFileSync(file, 'utf8');
  const signals = extractPageSignals(html);
  const pageTokens = weightedPageTokens(signals);
  const headingTokens = tokenize([signals.title, ...signals.h1s, ...signals.h2s].join(' '));
  const cosine = cosineSimilarity(termFrequency(proposal.tokens), termFrequency(pageTokens));
  const jaccard = jaccardSimilarity(proposal.tokens, pageTokens);
  const headingOverlap = jaccardSimilarity(proposal.phrase_tokens, headingTokens);
  const score = round((cosine * 0.68) + (jaccard * 0.17) + (headingOverlap * 0.15), 3);
  const sharedTerms = topSharedTerms(proposal.tokens, pageTokens, 18)
    .map(({ term, source_count, target_count }) => ({ term, proposal_count: source_count, page_count: target_count }));
  const textHaystack = normalizePhrase([signals.title, signals.h1s.join(' '), signals.meta_description, signals.text].join(' '));
  const slugHaystack = normalizePhrase(relativePath.replace(/\.html$/i, '').replace(/\/index$/i, '').replace(/[/-]+/g, ' '));
  const exactPhraseHits = proposal.phrases.filter((phrase) => phrase && (textHaystack.includes(phrase) || slugHaystack.includes(phrase))).length;
  const verdict = classify(score, exactPhraseHits, sharedTerms.length, headingOverlap);

  const result = {
    url: pageUrlForFile(relativePath, baseUrl),
    file: relativePath,
    title: signals.title || null,
    h1: signals.h1s[0] || null,
    meta_description: signals.meta_description || null,
    word_count: signals.word_count,
    score,
    verdict,
    exact_phrase_hits: exactPhraseHits,
    components: {
      cosine: round(cosine, 3),
      jaccard: round(jaccard, 3),
      heading_overlap: round(headingOverlap, 3),
    },
    shared_terms: sharedTerms,
    recommended_action: actionForVerdict(verdict),
  };
  if (includeText) result.text_excerpt = signals.text.slice(0, 500);
  return result;
}

function weightedProposalTokens({ topic, targetKeyword, brief }) {
  const chunks = [];
  repeat(chunks, targetKeyword, 5);
  repeat(chunks, topic, 4);
  repeat(chunks, brief, 1);
  return stripDomain(tokenize(chunks.join(' ')));
}

function weightedPageTokens(signals) {
  const chunks = [];
  repeat(chunks, signals.title, 5);
  repeat(chunks, signals.h1s.join(' '), 4);
  repeat(chunks, signals.h2s.join(' '), 2);
  repeat(chunks, signals.meta_description, 3);
  repeat(chunks, signals.text, 1);
  return stripDomain(tokenize(chunks.join(' ')));
}

function repeat(chunks, value, count) {
  const text = clean(value);
  if (!text) return;
  for (let i = 0; i < count; i += 1) chunks.push(text);
}

function classify(score, exactPhraseHits, sharedTermCount, headingOverlap) {
  // TRUE cannibalization = two URLs fighting for the SAME primary query. The
  // reliable signal for that is an exact keyword/slug/heading collision â€” NOT
  // generic body-text overlap (everything on a single-niche site overlaps).
  if (exactPhraseHits > 0) return 'likely_cannibalization';
  if (headingOverlap >= 0.5 && score >= 0.3) return 'likely_cannibalization';
  // Strong distinctive overlap without an exact collision: write it, but with a
  // clearly different angle/intent from the existing post.
  if (score >= 0.3 && sharedTermCount >= 3) return 'needs_differentiation_review';
  return 'low_overlap';
}

function actionForVerdict(verdict) {
  if (verdict === 'likely_cannibalization') return 'refresh_or_link_existing_blog';
  if (verdict === 'needs_differentiation_review') return 'differentiate_angle_before_new_blog';
  return 'safe_to_ignore';
}

function decide({ top, matches, threshold, reviewThreshold }) {
  if (!top) {
    return {
      recommendation: 'create_new_blog',
      risk: 'low',
      action: 'No existing blog posts were found; a new supporting blog can be considered if it is strategically useful.',
      reason: 'Blog inventory is empty.',
      next_steps: ['Create a clear brief and link it to the support target page.'],
    };
  }

  // Lean-autonomous gate: ONLY a true same-query collision blocks a new post.
  // A collision means an existing blog targets the same primary keyword (exact
  // keyword/slug/heading match) â€” verdict === 'likely_cannibalization'. Generic
  // topical adjacency does NOT block; it at most asks for a distinct angle.
  const trueCollision = top.verdict === 'likely_cannibalization';
  if (trueCollision) {
    return {
      recommendation: 'refresh_existing_blog',
      risk: 'high',
      action: `Refresh ${top.url} instead of creating a near-identical post; it already targets this query.`,
      reason: `Top existing blog scored ${top.score} with ${top.exact_phrase_hits} exact keyword/heading hit(s) â€” same primary query.`,
      next_steps: [
        'Refresh the matching blog for the new angle, or add an internal link from it to the support target.',
        'Only create a new URL after documenting a genuinely distinct target query.',
      ],
    };
  }

  // Distinctive overlap but NOT the same query: proceed autonomously, just nudge
  // the writer toward a clearly different angle.
  const needsAngle = top.score >= threshold;
  if (needsAngle) {
    return {
      recommendation: 'differentiate_or_refresh',
      risk: 'medium',
      action: `Create the new post, but give it a clearly distinct angle/intent from ${top.url}.`,
      reason: `Top existing blog scored ${top.score} (above ${threshold}) but shares no exact keyword/heading collision.`,
      next_steps: [
        'Pick a sub-angle or audience the existing post does not cover.',
        'Add a contextual internal link between the two posts.',
        'Record the unique target query and internal-link role.',
      ],
    };
  }

  return {
    recommendation: 'create_new_blog',
    risk: 'low',
    action: 'No same-query collision and no material overlap; create the new supporting post.',
    reason: `Top existing blog scored ${top.score}, below the differentiation threshold ${threshold}.`,
    next_steps: [
      'Create the new blog; link it up to the support target page.',
      'Record this check in task metadata before approval.',
    ],
  };
}

function classifyPageType(relativePath) {
  const lower = String(relativePath || '').replace(/\\/g, '/').toLowerCase();
  if (lower === 'index.html' || lower === '/' || lower === '') return 'home';
  if (lower.startsWith('services/')) return 'service';
  if (lower.startsWith('blog/')) return 'blog';
  if (/^(about|contact|privacy|terms|thank-you|404)/i.test(lower)) return 'utility';
  return 'other';
}

function normalizeSupportUrl(input, baseUrl) {
  if (!input) return null;
  return normalizeUrl(input, baseUrl);
}

function normalizeBaseForJoin(baseUrl) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function pageUrlForFile(relativePath, baseUrl) {
  const clean = String(relativePath || '').replace(/\\/g, '/').replace(/^\/+/, '');
  if (clean.toLowerCase() === 'index.html') return normalizeBaseForJoin(baseUrl);
  return fileToUrl(clean, baseUrl);
}

function normalizePhrase(value) {
  return clean(value)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .replace(/[\s-]+/g, ' ')
    .trim();
}

function clean(value) {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function round(value, digits = 3) {
  return Number(Number(value || 0).toFixed(digits));
}

function buildSampleOutput() {
  return {
    proposed: {
      topic: 'Local SEO checklist for {{AUDIENCE}}',
      target_keyword: 'local SEO for {{AUDIENCE}}',
      support_url: 'https://{{DOMAIN}}/',
    },
    site_root: '/opt/client-site',
    thresholds: { block: 0.2, review: 0.12 },
    existing_blog_count: 18,
    matched_blog_count: 1,
    recommendation: 'refresh_existing_blog',
    risk: 'high',
    action: 'Use or refresh https://{{DOMAIN}}/blog/local-seo-checklist-for-{{AUDIENCE}} instead of creating a new overlapping post.',
    reason: 'Top existing blog scored 0.31, with 1 exact phrase hit(s).',
    support_page: {
      found: true,
      url: 'https://{{DOMAIN}}/',
      file: 'index.html',
      page_type: 'home',
      title: '{{SITE_NAME}}.agency',
      h1: 'SEO for {{AUDIENCE}}',
      score: 0.14,
      shared_terms: [{ term: '{{AUDIENCE}}', proposal_count: 2, page_count: 8 }],
    },
    matches: [
      {
        url: 'https://{{DOMAIN}}/blog/local-seo-checklist-for-{{AUDIENCE}}',
        file: 'blog/local-seo-checklist-for-{{AUDIENCE}}/index.html',
        title: 'Local SEO Checklist for {{AUDIENCE}}',
        h1: 'Local SEO Checklist for {{AUDIENCE}}',
        meta_description: 'A practical local SEO checklist for {{NICHE}} companies.',
        word_count: 2200,
        score: 0.31,
        verdict: 'likely_cannibalization',
        exact_phrase_hits: 1,
        components: { cosine: 0.33, jaccard: 0.14, heading_overlap: 0.5 },
        shared_terms: [{ term: 'local', proposal_count: 2, page_count: 9 }],
        recommended_action: 'refresh_or_link_existing_blog',
      },
    ],
    next_steps: [
      'Refresh the matching blog for the new angle if needed.',
      'Add a contextual internal link from that blog to the support target.',
      'Only create a new blog after documenting a distinct intent split.',
    ],
    notes: [
      'Run before creating or approving a supporting new_blog_post task.',
      'Record this JSON or its top-match summary in task metadata.evidence.blog_cannibalization_check.',
    ],
  };
}

function printHelp() {
  console.log(`
content-blog-cannibalization - Check existing blog overlap before suggesting a new post

Usage:
  v2 content blog-cannibalization --topic <title> [options]

Inputs:
  --topic <text>           Proposed blog title or angle.
  --target-keyword <kw>    Primary keyword the proposed post would target.
  --brief <text>           Optional content brief or must-cover notes.
  --support-url <url>      Page this blog would support, e.g. / or /services/pricing.
  --support-file <path>    Local support page file.
  --site-root <path>       Local website root (default: env CLIENT_SITE_ROOT or /opt/client-site).
  --base-url <url>         Site base URL (default: https://{{DOMAIN}}).

Scoring:
  --threshold <score>        High-risk threshold (default: 0.20).
  --review-threshold <score> Review threshold (default: 0.12).
  --limit <N>                Max matching blog rows to show (default: 10).
  --include-text             Include a short text excerpt for each returned match.

Output:
  --json                   JSON output (default).
  --table                  Table output.
  --sample                 Sample output without filesystem access.

Examples:
  v2 content blog-cannibalization --topic "Local SEO checklist for {{AUDIENCE}}" --target-keyword "local SEO for {{AUDIENCE}}" --support-url / --json
  v2 content blog-cannibalization --topic "{{NICHE}} SEO pricing mistakes" --target-keyword "{{NICHE}} SEO pricing" --support-url /services/pricing --site-root ./site --json
`);
}

if (require.main === module) {
  main();
}

module.exports = main;
