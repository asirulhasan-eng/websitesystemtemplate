const { readJsonResponse, createRateLimiter } = require('./http');

const gscLimiter = createRateLimiter({ maxRequests: 400, windowMs: 60000 });

const tokenCache = { token: null, expiresAt: 0 };

async function getGscAccessToken(config) {
  const existingToken = config.get("GSC_ACCESS_TOKEN");
  const refreshToken = config.get("GSC_REFRESH_TOKEN");
  const clientId = config.get("GSC_CLIENT_ID");
  const clientSecret = config.get("GSC_CLIENT_SECRET");

  if (refreshToken && clientId && clientSecret) {
    if (tokenCache.token && Date.now() < tokenCache.expiresAt) {
      return tokenCache.token;
    }

    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: refreshToken,
        grant_type: "refresh_token",
      }),
    });

    const json = await readJsonResponse(response);
    if (!response.ok) {
      throw new Error(`GSC token refresh failed: ${json.error || response.statusText}`);
    }
    tokenCache.token = json.access_token;
    tokenCache.expiresAt = Date.now() + (json.expires_in - 60) * 1000; // Refresh 60s before expiry
    return json.access_token;
  }

  if (existingToken) return existingToken;
  throw new Error("Missing GSC OAuth credentials.");
}

async function querySearchAnalytics(config, options = {}) {
  const siteUrl = options.siteUrl || config.require("GSC_SITE_URL");
  const token = await getGscAccessToken(config);
  const endpoint = `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(siteUrl)}/searchAnalytics/query`;

  const body = {
    startDate: options.startDate,
    endDate: options.endDate,
    dimensions: options.dimensions || ["query", "page"],
    rowLimit: options.rowLimit || 25000,
    startRow: options.startRow || 0,
    dataState: options.dataState || "final",
  };

  if (options.dimensionFilterGroups) body.dimensionFilterGroups = options.dimensionFilterGroups;
  if (options.type) body.type = options.type;
  if (options.aggregationType) body.aggregationType = options.aggregationType;

  await gscLimiter.wait();

  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`GSC query failed: ${json.error?.message || response.statusText}`);
  }

  return {
    siteUrl,
    request: body,
    rows: json.rows || [],
    responseAggregationType: json.responseAggregationType,
  };
}

async function inspectUrl(config, options = {}) {
  const siteUrl = options.siteUrl || config.require("GSC_SITE_URL");
  const inspectionUrl = options.inspectionUrl || options.url;
  if (!inspectionUrl) throw new Error("Missing inspection URL.");

  const token = await getGscAccessToken(config);
  const body = {
    inspectionUrl,
    siteUrl,
    languageCode: options.languageCode || "en-US",
  };

  await gscLimiter.wait();

  const response = await fetch("https://searchconsole.googleapis.com/v1/urlInspection/index:inspect", {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`GSC URL inspection failed: ${json.error?.message || response.statusText}`);
  }

  return {
    siteUrl,
    request: body,
    inspectionResult: json.inspectionResult || null,
    raw: json,
  };
}


module.exports = {
  getGscAccessToken,
  querySearchAnalytics,
  inspectUrl,
};
