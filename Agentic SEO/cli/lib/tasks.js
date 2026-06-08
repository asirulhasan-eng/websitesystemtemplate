const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");
const { localDateOnly, nowIso } = require("./dates");

const LOCK_ORDER = [
  'cron_run_lock', 'backup_lock', 'global_deployment_lock',
  'cloudflare_config_lock', 'robots_lock', 'sitemap_lock',
  'navigation_lock', 'header_lock', 'footer_lock',
  'schema_template_lock', 'css_global_lock', 'homepage_lock',
  'money_page_cluster_lock', 'url_lock', 'file_lock',
  'keyword_lock', 'experiment_lock', 'approval_lock'
];

const SERVICE_PAGE_CLUSTER_TASK_TYPES = new Set([
  'service_page_gap',
  'new_service_page',
  'money_page_refresh',
  'service_architecture_review',
]);

function createTaskCandidate(input) {
  const createdAt = input.createdAt || nowIso();
  const stablePart = crypto
    .createHash("sha1")
    .update([input.source, input.taskType, input.targetUrl, input.targetKeyword, input.title].join("|"))
    .digest("hex")
    .slice(0, 10)
    .toUpperCase();
  const idDate = input.idDate || localDateOnly();

  return {
    candidate_id: input.candidateId || `CAND-${idDate}-${stablePart}`,
    title: input.title,
    description: input.description,
    status: "candidate",
    risk_level: input.riskLevel || "semi_safe",
    priority_score: input.priorityScore || 1,
    source: input.source,
    task_type: input.taskType,
    target_url: input.targetUrl || null,
    target_file: input.targetFile || null,
    target_keyword: input.targetKeyword || null,
    approval_required: Boolean(input.approvalRequired),
    locks: input.locks || inferLocks(input),
    evidence: input.evidence || {},
    created_at: createdAt,
    metadata: input.metadata || {},
  };
}

function inferLocks(input) {
  const locks = [];
  if (input.targetFile) locks.push({ lock_type: "file_lock", resource_id: normalizePath(input.targetFile) });
  if (input.targetUrl) locks.push({ lock_type: "url_lock", resource_id: input.targetUrl });
  if (input.targetKeyword) locks.push({ lock_type: "keyword_lock", resource_id: input.targetKeyword });

  if (input.taskType === "new_page" || input.taskType === "new_service_page") {
    locks.push({ lock_type: "sitemap_lock", resource_id: "sitemap.xml" });
    locks.push({ lock_type: "money_page_cluster_lock", resource_id: "core-service-pages" });
  } else if (SERVICE_PAGE_CLUSTER_TASK_TYPES.has(input.taskType)) {
    locks.push({ lock_type: "money_page_cluster_lock", resource_id: "core-service-pages" });
  }

  if (input.taskType === "robots_change") {
    locks.push({ lock_type: "robots_lock", resource_id: "robots.txt" });
    locks.push({ lock_type: "global_deployment_lock", resource_id: "production" });
  }

  return locks;
}

function urlToLikelyFile(url, options = {}) {
  const siteRoot = options.siteRoot || process.env.CLIENT_SITE_ROOT || "/opt/client-site";
  try {
    const parsed = new URL(url);
    const hasTrailingSlash = parsed.pathname.endsWith("/");
    const pathname = parsed.pathname.replace(/^\/+|\/+$/g, "");
    if (!pathname) return "index.html";
    if (/\.html?$/i.test(pathname)) return pathname;
    if (!hasTrailingSlash) {
      const htmlFile = `${pathname}.html`;
      if (siteRoot && fs.existsSync(path.join(siteRoot, htmlFile))) return htmlFile;
    }
    return path.posix.join(pathname, "index.html");
  } catch {
    const raw = String(url || "");
    const hasTrailingSlash = raw.endsWith("/");
    const pathname = raw.replace(/^\/+|\/+$/g, "");
    if (!pathname) return null;
    if (/\.html?$/i.test(pathname)) return pathname;
    if (!hasTrailingSlash) {
      const htmlFile = `${pathname}.html`;
      if (siteRoot && fs.existsSync(path.join(siteRoot, htmlFile))) return htmlFile;
    }
    return path.posix.join(pathname, "index.html");
  }
}

function normalizePath(value) {
  return String(value).replace(/\\/g, "/");
}

function acquireTaskLocks(db, task, options = {}) {
  const locks = inferLocks(task);
  if (locks.length === 0) return { acquired: true, locks: [] };

  const now = nowIso();
  const ttlMinutes = options.ttlMinutes || 120;
  const expiresAt = new Date(Date.now() + ttlMinutes * 60000).toISOString();
  const owner = options.owner || 'task_executor';

  // Sort by lock_type using the official LOCK_ORDER for consistent ordering
  locks.sort((a, b) => {
    const ai = LOCK_ORDER.indexOf(a.lock_type);
    const bi = LOCK_ORDER.indexOf(b.lock_type);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });

  const acquired = [];
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    for (const lock of locks) {
      // Check for active conflicts
      const conflict = db.prepare(
        "SELECT * FROM locks WHERE lock_type = ? AND resource_id = ? AND status = 'active' AND expires_at > ?"
      ).get(lock.lock_type, lock.resource_id, now);

      if (conflict) {
        db.exec('ROLLBACK');
        return { acquired: false, conflicts: [{ lock, held_by: conflict }] };
      }

      const lockId = `LCK-${localDateOnly()}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`;
      db.prepare(
        'INSERT INTO locks (lock_id, lock_type, resource_id, task_id, owner_agent, status, created_at, expires_at, heartbeat_at) VALUES (?,?,?,?,?,?,?,?,?)'
      ).run(lockId, lock.lock_type, lock.resource_id, task.task_id || task.candidate_id, owner, 'active', now, expiresAt, now);
      acquired.push({ lock_id: lockId, ...lock });
    }
    db.exec('COMMIT');
    return { acquired: true, locks: acquired };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

module.exports = {
  LOCK_ORDER,
  SERVICE_PAGE_CLUSTER_TASK_TYPES,
  createTaskCandidate,
  inferLocks,
  urlToLikelyFile,
  acquireTaskLocks,
};
