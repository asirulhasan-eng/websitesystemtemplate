const { readJsonResponse, createRateLimiter } = require('./http');

const serperLimiter = createRateLimiter({ maxRequests: 16, windowMs: 1000 });

async function serperSearch(config, options = {}) {
  const apiKey = config.require("SERPER_API_KEY");

  await serperLimiter.wait();

  const response = await fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      q: options.q,
      gl: options.gl || "us",
      hl: options.hl || "en",
      page: options.page || 1,
      num: options.num || 10,
    }),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Serper search failed: ${json.message || response.statusText}`);
  }
  return json;
}

async function serperScrape(config, options = {}) {
  const apiKey = config.require("SERPER_API_KEY");

  await serperLimiter.wait();

  const response = await fetch("https://scrape.serper.dev", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify({
      url: options.url,
      includeMarkdown: Boolean(options.includeMarkdown),
    }),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Serper scrape failed: ${json.message || response.statusText}`);
  }
  return json;
}

// Map a freshness window (in days) to Serper's `tbs=qdr:*` recency bucket.
// Serper/Google only expose day/week/month/year buckets, so we round UP to the
// smallest bucket that still covers the requested window (a 7-day ask → week).
function daysToRecency(days) {
  const n = Number(days);
  if (!Number.isFinite(n) || n <= 0) return null;
  if (n <= 1) return "qdr:d";
  if (n <= 7) return "qdr:w";
  if (n <= 31) return "qdr:m";
  return "qdr:y";
}

// News search against Serper's /news endpoint. Used by the Industry Radar to
// gather fresh, dated headlines per beat. `tbs` (recency) can be passed directly
// or derived from `days`.
async function serperNews(config, options = {}) {
  const apiKey = config.require("SERPER_API_KEY");

  await serperLimiter.wait();

  const tbs = options.tbs || daysToRecency(options.days);
  const body = {
    q: options.q,
    gl: options.gl || "us",
    hl: options.hl || "en",
    page: options.page || 1,
    num: options.num || 10,
  };
  if (tbs) body.tbs = tbs;

  const response = await fetch("https://google.serper.dev/news", {
    method: "POST",
    headers: {
      "X-API-KEY": apiKey,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`Serper news failed: ${json.message || response.statusText}`);
  }
  return json;
}

function compactNews(json) {
  return {
    searchParameters: json.searchParameters || null,
    news: (json.news || []).map((item) => ({
      position: item.position,
      title: item.title,
      link: item.link,
      snippet: item.snippet,
      date: item.date,
      source: item.source,
    })),
  };
}

function compactSerp(json) {
  return {
    searchParameters: json.searchParameters,
    knowledgeGraph: json.knowledgeGraph || null,
    organic: (json.organic || []).map((result) => ({
      position: result.position,
      title: result.title,
      link: result.link,
      snippet: result.snippet,
      date: result.date,
    })),
    peopleAlsoAsk: json.peopleAlsoAsk || [],
    relatedSearches: json.relatedSearches || [],
  };
}


module.exports = {
  serperSearch,
  serperScrape,
  serperNews,
  compactSerp,
  compactNews,
  daysToRecency,
};
