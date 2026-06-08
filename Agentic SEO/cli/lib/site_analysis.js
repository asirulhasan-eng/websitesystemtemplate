const fs = require('node:fs');
const path = require('node:path');

const DEFAULT_BASE_URL = 'https://{{DOMAIN}}';

const STOPWORDS = new Set([
  'a', 'an', 'and', 'are', 'as', 'at', 'be', 'been', 'but', 'by', 'can',
  'for', 'from', 'has', 'have', 'how', 'if', 'in', 'into', 'is', 'it',
  'its', 'more', 'near', 'not', 'of', 'on', 'or', 'our', 'page', 'that',
  'the', 'their', 'this', 'to', 'was', 'we', 'what', 'when', 'where',
  'which', 'who', 'why', 'will', 'with', 'you', 'your',
]);

function normalizeBaseUrl(baseUrl = DEFAULT_BASE_URL) {
  return String(baseUrl || DEFAULT_BASE_URL).replace(/\/+$/, '');
}

function normalizeUrl(input, baseUrl = DEFAULT_BASE_URL) {
  if (!input) return '';
  try {
    const base = normalizeBaseUrl(baseUrl);
    const url = new URL(String(input), `${base}/`);
    url.hash = '';
    url.search = '';
    let pathname = url.pathname.replace(/\/index\.html$/i, '/');
    pathname = pathname.replace(/\.html$/i, '');
    pathname = pathname.replace(/\/+$/, '') || '/';
    return `${url.protocol}//${url.host}${pathname}`;
  } catch {
    return String(input);
  }
}

function fileToUrl(relativePath, baseUrl = DEFAULT_BASE_URL) {
  const base = normalizeBaseUrl(baseUrl);
  const clean = String(relativePath || '')
    .replace(/\\/g, '/')
    .replace(/\.html$/i, '')
    .replace(/\/index$/i, '')
    .replace(/^\/+/, '');
  return normalizeUrl(`${base}/${clean}`, base);
}

function urlToFilePath(urlOrPath, siteRoot, baseUrl = DEFAULT_BASE_URL) {
  if (!siteRoot) return null;
  if (urlOrPath && fs.existsSync(path.isAbsolute(urlOrPath) ? urlOrPath : path.resolve(siteRoot, urlOrPath))) {
    return path.isAbsolute(urlOrPath) ? urlOrPath : path.resolve(siteRoot, urlOrPath);
  }

  let pathname;
  try {
    pathname = new URL(String(urlOrPath), `${normalizeBaseUrl(baseUrl)}/`).pathname;
  } catch {
    pathname = String(urlOrPath || '').startsWith('/') ? String(urlOrPath) : `/${urlOrPath || ''}`;
  }

  pathname = pathname.replace(/\/+$/, '') || '/';
  const clean = decodeURIComponent(pathname).replace(/^\/+/, '');
  const candidates = clean
    ? [
        path.join(siteRoot, clean),
        path.join(siteRoot, clean.endsWith('.html') ? clean : `${clean}.html`),
        path.join(siteRoot, clean, 'index.html'),
      ]
    : [path.join(siteRoot, 'index.html')];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) return candidate;
  }
  return candidates[candidates.length - 1];
}

async function readPageSource(options = {}) {
  const {
    url,
    file,
    siteRoot,
    baseUrl = DEFAULT_BASE_URL,
    timeoutMs = 20000,
    preferLive = false,
  } = options;

  if (file) {
    const resolved = siteRoot && !path.isAbsolute(file) ? path.resolve(siteRoot, file) : path.resolve(file);
    if (!fs.existsSync(resolved)) throw new Error(`File not found: ${resolved}`);
    const html = fs.readFileSync(resolved, 'utf8');
    return {
      source: 'file',
      input: file,
      file: resolved,
      url: fileToUrl(path.relative(siteRoot || path.dirname(resolved), resolved), baseUrl),
      status: 200,
      html,
    };
  }

  if (!url) throw new Error('Provide a URL or file path');

  if (siteRoot && !preferLive) {
    const candidate = urlToFilePath(url, siteRoot, baseUrl);
    if (candidate && fs.existsSync(candidate)) {
      const html = fs.readFileSync(candidate, 'utf8');
      return {
        source: 'file',
        input: url,
        file: candidate,
        url: normalizeUrl(url, baseUrl),
        status: 200,
        html,
      };
    }
  }

  const fetched = await fetchText(url, { timeoutMs });
  return {
    source: 'live',
    input: url,
    url: fetched.finalUrl || normalizeUrl(url, baseUrl),
    status: fetched.status,
    headers: fetched.headers,
    html: fetched.body,
  };
}

async function fetchText(url, options = {}) {
  const timeoutMs = options.timeoutMs || 20000;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      method: options.method || 'GET',
      redirect: options.redirect || 'follow',
      headers: options.headers || { 'user-agent': '{{SITE_NAME}}Agent/2.0 (+https://{{DOMAIN}})' },
      signal: controller.signal,
    });
    const body = options.method === 'HEAD' ? '' : await response.text();
    return {
      ok: response.ok,
      status: response.status,
      statusText: response.statusText,
      finalUrl: response.url,
      headers: Object.fromEntries(response.headers.entries()),
      body,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function extractPageSignals(html) {
  const safeHtml = String(html || '');
  const title = stripHtml(match(safeHtml, /<title[^>]*>([\s\S]*?)<\/title>/i) || '');
  const metaDescription =
    match(safeHtml, /<meta\b[^>]*name=["']description["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    match(safeHtml, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']description["'][^>]*>/i) ||
    '';
  const canonical = extractLinkHref(safeHtml, 'canonical') || '';
  const robots =
    match(safeHtml, /<meta\b[^>]*name=["']robots["'][^>]*content=["']([^"']*)["'][^>]*>/i) ||
    match(safeHtml, /<meta\b[^>]*content=["']([^"']*)["'][^>]*name=["']robots["'][^>]*>/i) ||
    '';
  const h1s = matchAll(safeHtml, /<h1[^>]*>([\s\S]*?)<\/h1>/gi).map(stripHtml).filter(Boolean);
  const h2s = matchAll(safeHtml, /<h2[^>]*>([\s\S]*?)<\/h2>/gi).map(stripHtml).filter(Boolean);
  const text = stripHtml(safeHtml);

  return {
    title,
    meta_description: decodeHtml(metaDescription),
    canonical: decodeHtml(canonical),
    robots: decodeHtml(robots),
    h1s,
    h2s,
    text,
    word_count: countWords(text),
  };
}

function extractLinkHref(html, rel) {
  const escaped = escapeRegex(rel);
  const patterns = [
    new RegExp(`<link\\b[^>]*rel=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*href=["']([^"']*)["'][^>]*>`, 'i'),
    new RegExp(`<link\\b[^>]*href=["']([^"']*)["'][^>]*rel=["'][^"']*\\b${escaped}\\b[^"']*["'][^>]*>`, 'i'),
  ];
  for (const pattern of patterns) {
    const found = match(html, pattern);
    if (found) return found;
  }
  return null;
}

function extractLinks(html, pageUrl, baseUrl = DEFAULT_BASE_URL) {
  const links = [];
  const regex = /<a\b[^>]*href=["']([^"'#][^"']*)["'][^>]*>([\s\S]*?)<\/a>/gi;
  let found;
  const seen = new Set();
  while ((found = regex.exec(String(html || ''))) !== null) {
    const href = decodeHtml(found[1].trim());
    if (!href || /^(mailto|tel|javascript):/i.test(href)) continue;
    let absolute;
    try {
      absolute = new URL(href, pageUrl || `${normalizeBaseUrl(baseUrl)}/`).toString();
    } catch {
      continue;
    }
    const normalized = normalizeUrl(absolute, baseUrl);
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    links.push({
      href,
      url: normalized,
      text: stripHtml(found[2] || ''),
      internal: normalized.startsWith(normalizeBaseUrl(baseUrl)),
    });
  }
  return links;
}

function tokenize(text) {
  return decodeHtml(text)
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/[\s-]+/)
    .map((token) => normalizeToken(token))
    .filter((token) => token.length > 1 && !STOPWORDS.has(token));
}

function normalizeToken(token) {
  let normalized = String(token || '').trim();
  if (normalized.length > 4 && normalized.endsWith('ies')) normalized = `${normalized.slice(0, -3)}y`;
  else if (normalized.length > 5 && normalized.endsWith('ing')) normalized = normalized.slice(0, -3);
  else if (normalized.length > 4 && normalized.endsWith('ers')) normalized = normalized.slice(0, -1);
  else if (normalized.length > 4 && normalized.endsWith('s')) normalized = normalized.slice(0, -1);
  return normalized;
}

function termFrequency(tokens) {
  const counts = new Map();
  for (const token of tokens) counts.set(token, (counts.get(token) || 0) + 1);
  return counts;
}

function cosineSimilarity(a, b) {
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const value of a.values()) normA += value * value;
  for (const value of b.values()) normB += value * value;
  for (const [token, value] of a.entries()) dot += value * (b.get(token) || 0);
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

function jaccardSimilarity(tokensA, tokensB) {
  const a = new Set(tokensA);
  const b = new Set(tokensB);
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const token of a) {
    if (b.has(token)) intersection += 1;
  }
  return intersection / (a.size + b.size - intersection);
}

function topSharedTerms(tokensA, tokensB, limit = 20) {
  const a = termFrequency(tokensA);
  const b = termFrequency(tokensB);
  const shared = [];
  for (const [token, countA] of a.entries()) {
    const countB = b.get(token);
    if (countB) shared.push({ term: token, source_count: countA, target_count: countB, weight: countA + countB });
  }
  return shared.sort((x, y) => y.weight - x.weight || x.term.localeCompare(y.term)).slice(0, limit);
}

function countWords(text) {
  return String(text || '').split(/\s+/).filter(Boolean).length;
}

function stripHtml(input) {
  return decodeHtml(
    String(input || '')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim(),
  );
}

function decodeHtml(input) {
  return String(input || '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => {
      const parsed = Number(code);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
    })
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => {
      const parsed = Number.parseInt(code, 16);
      return Number.isFinite(parsed) ? String.fromCharCode(parsed) : _;
    });
}

function match(text, regex) {
  const found = String(text || '').match(regex);
  return found ? found[1] : null;
}

function matchAll(text, regex) {
  const results = [];
  let found;
  while ((found = regex.exec(String(text || ''))) !== null) results.push(found[1]);
  return results;
}

function escapeRegex(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function walkDir(dir) {
  const results = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) results.push(...walkDir(full));
    else if (entry.isFile()) results.push(full);
  }
  return results;
}

module.exports = {
  DEFAULT_BASE_URL,
  normalizeBaseUrl,
  normalizeUrl,
  fileToUrl,
  urlToFilePath,
  readPageSource,
  fetchText,
  extractPageSignals,
  extractLinks,
  tokenize,
  termFrequency,
  cosineSimilarity,
  jaccardSimilarity,
  topSharedTerms,
  stripHtml,
  decodeHtml,
  walkDir,
};
