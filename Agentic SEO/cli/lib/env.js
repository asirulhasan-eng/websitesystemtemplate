const fs = require("node:fs");
const path = require("node:path");

function loadToolEnv(options = {}) {
  const cwd = options.cwd || process.cwd();
  const explicitEnvPath = options.envPath || process.env.SEO_AGENT_ENV_FILE;
  // The agent root is stable regardless of where the process was launched.
  // env.js lives at <agent-root>/cli/lib/env.js, so two levels up is the root.
  // Falling back to it means cron jobs (and the Hermes sessions they spawn)
  // still find the agent's .env even when their cwd is /root or elsewhere â€”
  // this is what was causing "Missing SMTP_HOST" dead-letters on email paths.
  const agentRoot = process.env.CLIENT_AGENT_ROOT || path.resolve(__dirname, "..", "..");
  const envPaths = explicitEnvPath
    ? [path.resolve(cwd, explicitEnvPath)]
    : dedupePaths([
        path.resolve(cwd, "env.txt"),
        path.resolve(cwd, ".env"),
        path.resolve(agentRoot, "env.txt"),
        path.resolve(agentRoot, ".env"),
      ]);
  const parsed = {};

  for (const envPath of envPaths) {
    if (fs.existsSync(envPath)) {
      Object.assign(parsed, parseEnvText(fs.readFileSync(envPath, "utf8")));
    }
  }

  return {
    envPath: envPaths.find((candidate) => fs.existsSync(candidate)) || envPaths[envPaths.length - 1],
    envPaths,
    get(name, defaultValue = undefined) {
      const value = process.env[name] || parsed[name];
      return value === undefined || value === "" ? defaultValue : value;
    },
    require(name) {
      const value = this.get(name);
      if (!value) throw new Error(`Missing ${name}. Set it in the environment or an env file.`);
      return value;
    },
    allPublic() {
      const merged = { ...parsed, ...process.env };
      return {
        hasGithubToken: Boolean(merged.GITHUB_TOKEN),
        hasCloudflareToken: Boolean(merged.CLOUDFLARE_API_TOKEN),
        hasGscRefreshToken: Boolean(merged.GSC_REFRESH_TOKEN),
        hasSerperApiKey: Boolean(merged.SERPER_API_KEY),
        gscSiteUrl: merged.GSC_SITE_URL,
        cloudflareProjectName: merged.CLOUDFLARE_PROJECT_NAME,
      };
    },
  };
}

function dedupePaths(paths) {
  return [...new Set(paths)];
}

function parseEnvText(text) {
  const env = {};
  let pendingKey = null;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const keyValue = line.match(/^([A-Z][A-Z0-9_]+)\s*=\s*(.*)$/);
    if (keyValue) {
      const key = keyValue[1];
      const value = normalizeEnvValue(keyValue[2]);
      if (!isPlaceholder(value)) {
        env[key] = value;
        pendingKey = null;
      } else {
        pendingKey = key;
      }
      continue;
    }

    const serperMatch = line.match(/^serper api key\s+(.+)$/i);
    if (serperMatch) {
      env.SERPER_API_KEY = serperMatch[1].trim();
      pendingKey = null;
      continue;
    }

    if (/^Client ID$/i.test(line)) {
      pendingKey = "GSC_CLIENT_ID";
      continue;
    }
    if (/^Client secret$/i.test(line)) {
      pendingKey = "GSC_CLIENT_SECRET";
      continue;
    }
    if (/^Refresh token$/i.test(line)) {
      pendingKey = "GSC_REFRESH_TOKEN";
      continue;
    }
    if (/^Access token$/i.test(line)) {
      pendingKey = "GSC_ACCESS_TOKEN";
      continue;
    }
    const apiLoginWithValue = line.match(/^API login:\s*(.+)$/i);
    if (apiLoginWithValue) {
      env.DATAFORSEO_LOGIN = apiLoginWithValue[1].trim();
      pendingKey = null;
      continue;
    }
    const apiPasswordWithValue = line.match(/^API password:\s*(.+)$/i);
    if (apiPasswordWithValue) {
      env.DATAFORSEO_PASSWORD = apiPasswordWithValue[1].trim();
      pendingKey = null;
      continue;
    }

    if (/^API login:?$/i.test(line)) {
      pendingKey = "DATAFORSEO_LOGIN";
      continue;
    }
    if (/^API password:?$/i.test(line)) {
      pendingKey = "DATAFORSEO_PASSWORD";
      continue;
    }

    if (pendingKey) {
      env[pendingKey] = line;
      pendingKey = null;
      continue;
    }

    if (line.startsWith(tokenPrefix("github_pat"))) env.GITHUB_TOKEN = line;
    if (/^[a-f0-9]{32}$/i.test(line)) env.CLOUDFLARE_ACCOUNT_ID = line;
    if (line.startsWith(tokenPrefix("cfut"))) env.CLOUDFLARE_API_TOKEN = line;
    if (/\.apps\.googleusercontent\.com$/.test(line)) env.GSC_CLIENT_ID = line;
    if (line.startsWith(tokenPrefix("google_client_secret"))) env.GSC_CLIENT_SECRET = line;
    if (line.startsWith(tokenPrefix("google_refresh"))) env.GSC_REFRESH_TOKEN = line;
    if (line.startsWith(tokenPrefix("google_access"))) env.GSC_ACCESS_TOKEN = line;
  }

  return env;
}

function isPlaceholder(value) {
  return !value || /^your_/i.test(value) || /^PASTE_/i.test(value);
}

function normalizeEnvValue(value) {
  let normalized = String(value || "").trim();
  if (
    (normalized.startsWith('"') && normalized.endsWith('"')) ||
    (normalized.startsWith("'") && normalized.endsWith("'"))
  ) {
    normalized = normalized.slice(1, -1);
  }
  return normalized;
}

function tokenPrefix(name) {
  const prefixes = {
    github_pat: ["github", "pat", ""].join("_"),
    cfut: ["cfut", ""].join("_"),
    google_client_secret: ["GOCSPX", ""].join("-"),
    google_refresh: ["1", "", ""].join("/"),
    google_access: ["ya29", ""].join("."),
  };
  return prefixes[name];
}

module.exports = {
  loadToolEnv,
  parseEnvText,
};
