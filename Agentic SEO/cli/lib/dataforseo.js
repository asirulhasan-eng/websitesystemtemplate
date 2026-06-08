const { readJsonResponse, createRateLimiter, createBudgetTracker } = require('./http');

const dfsLimiter = createRateLimiter({ maxRequests: 666, windowMs: 60000 });
const dfsBudget = createBudgetTracker({ name: 'dataforseo', dailyLimit: 3000, unit: 'credits' });

async function dataForSeoOrganicSearch(config, options = {}) {
  const login = config.require("DATAFORSEO_LOGIN");
  const password = config.require("DATAFORSEO_PASSWORD");

  // Budget check — 1 search = ~1 credit for live/advanced
  const budget = dfsBudget.consume(1);
  if (!budget.allowed) {
    return { error: budget.message, budget_exhausted: true };
  }
  await dfsLimiter.wait();

  const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/advanced", {
    method: "POST",
    headers: {
      authorization: `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`,
      "content-type": "application/json",
    },
    body: JSON.stringify([
      {
        keyword: options.q,
        location_code: Number(options.locationCode || 2840),
        language_code: options.languageCode || "en",
        device: options.device || "desktop",
        depth: Number(options.depth || 30),
      },
    ]),
  });

  const json = await readJsonResponse(response);
  if (!response.ok) {
    throw new Error(`DataForSEO request failed: ${json.status_message || response.statusText}`);
  }
  if (json.status_code && json.status_code !== 20000) {
    throw new Error(`DataForSEO API failed: ${json.status_message || json.status_code}`);
  }

  const task = json.tasks && json.tasks[0];
  if (!task) throw new Error("DataForSEO returned no task.");
  if (task.status_code && task.status_code !== 20000) {
    throw new Error(`DataForSEO task failed: ${task.status_message || task.status_code}`);
  }

  return json;
}

function compactDataForSeoSerp(json) {
  const task = json.tasks && json.tasks[0];
  const result = task && task.result && task.result[0];
  const items = result && Array.isArray(result.items) ? result.items : [];
  const organicItems = items.filter((item) => item.type === "organic");
  const paaItems = items.filter((item) => item.type === "people_also_ask");

  return {
    searchParameters: {
      q: result ? result.keyword : undefined,
      gl: result ? result.location_code : undefined,
      hl: result ? result.language_code : undefined,
      provider: "dataforseo",
    },
    knowledgeGraph: null,
    organic: organicItems.map((item) => ({
      position: item.rank_group || item.rank_absolute,
      title: item.title,
      link: item.url,
      snippet: item.description,
      date: null,
    })),
    peopleAlsoAsk: paaItems.map((item) => ({
      question: item.title,
      answer: item.description,
      link: item.url,
    })),
    relatedSearches: [],
  };
}


module.exports = {
  dataForSeoOrganicSearch,
  compactDataForSeoSerp,
};
