#!/usr/bin/env node
const path = require("node:path");
const fs = require("node:fs");
const { parseArgs, requireArg, boolArg, numberArg, exitWithError } = require("../lib/cli");
const { nowIso, compactDateTime } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");

// ---------------------------------------------------------------------------
// Ã‚Â§9 Module 4 Ã¢â‚¬â€ Live Deployment Validator
// Performs HTTP health checks and optional Serper SERP verification against
// a live URL, records validation results to SQLite, and can trigger rollback.
// ---------------------------------------------------------------------------

async function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const url = requireArg(args, "url");
  const deploymentId = args["deployment-id"] || null;
  const taskId = args.task || null;
  const domain = args.domain || null;
  const keyword = args.keyword || null;
  const siteRoot = args["site-root"] || null;
  const requireIndexPresence = boolArg(args, "require-index") || boolArg(args, "require-index-presence");
  const requireSitemapPresence = boolArg(args, "require-sitemap") || boolArg(args, "require-sitemap-presence");
  const cacheBust = boolArg(args, "cache-bust");
  const deployWindowMinutes = numberArg(args, "deploy-window-minutes", 30);
  const canonicalUrl = stripQueryAndHash(url);
  const indexUrl = args["index-url"] || defaultIndexUrl(canonicalUrl);
  const sitemapUrl = args["sitemap-url"] || defaultSitemapUrl(canonicalUrl);
  const fetchedUrl = cacheBust ? withCacheBust(url) : url;
  const now = nowIso();

  // Ã¢â€â‚¬Ã¢â€â‚¬ 1. HTTP fetch Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const checks = [];
  let responseBody = "";
  let fetchError = null;
  let responseTimeMs = 0;
  let httpStatus = 0;
  let responseHeaders = {};

  const startMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(fetchedUrl, {
      redirect: "follow",
      signal: controller.signal,
    });
    httpStatus = response.status;
    responseHeaders = headersObject(response.headers);
    responseBody = await response.text();
    responseTimeMs = Date.now() - startMs;
  } catch (error) {
    fetchError = error.message;
    responseTimeMs = Date.now() - startMs;
  } finally {
    clearTimeout(timeout);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 2. Run validation checks Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬

  // Check 1: HTTP health Ã¢â‚¬â€ status 200
  checks.push({
    check: "http_health",
    passed: httpStatus === 200,
    detail: fetchError
      ? `Fetch error: ${fetchError}`
      : `Status ${httpStatus}, ${responseTimeMs}ms`,
  });

  // Check 2: HTML title present
  const titleMatch = responseBody.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  const titleText = titleMatch ? titleMatch[1].trim() : "";
  checks.push({
    check: "html_title_present",
    passed: titleText.length > 0,
    detail: titleText ? `Title: "${titleText}"` : "No <title> tag found or empty",
  });

  // Check 3: Meta description present
  const metaDescMatch = responseBody.match(
    /<meta\b(?=[^>]*name=["']description["'])[^>]*>/i,
  );
  let metaDescContent = "";
  if (metaDescMatch) {
    const contentMatch = metaDescMatch[0].match(/content\s*=\s*["']([^"']*)["']/i);
    metaDescContent = contentMatch ? contentMatch[1].trim() : "";
  }
  checks.push({
    check: "meta_description_present",
    passed: metaDescContent.length > 0,
    detail: metaDescContent
      ? `Description: "${metaDescContent.slice(0, 80)}Ã¢â‚¬Â¦"`
      : "No meta description found or empty",
  });

  // Check 4: Canonical tag present
  const canonicalMatch = responseBody.match(
    /<link\b(?=[^>]*rel=["'][^"']*canonical[^"']*["'])[^>]*>/i,
  );
  let canonicalHref = "";
  if (canonicalMatch) {
    const hrefMatch = canonicalMatch[0].match(/href\s*=\s*["']([^"']*)["']/i);
    canonicalHref = hrefMatch ? hrefMatch[1].trim() : "";
  }
  checks.push({
    check: "canonical_tag_present",
    passed: canonicalHref.length > 0,
    detail: canonicalHref
      ? `Canonical: ${canonicalHref}`
      : "No canonical tag found",
  });

  // Check 5: No accidental noindex
  const noindexMatch = responseBody.match(
    /<meta\b(?=[^>]*name=["']robots["'])[^>]*content=["'][^"']*noindex[^"']*["'][^>]*>/i,
  );
  checks.push({
    check: "no_accidental_noindex",
    passed: !noindexMatch,
    detail: noindexMatch
      ? "DANGER: noindex directive detected"
      : "No noindex directive found",
  });

  // Check 6: Content size check
  const contentSize = Buffer.byteLength(responseBody, "utf8");
  checks.push({
    check: "content_size",
    passed: contentSize >= 500,
    detail: `${contentSize} bytes${contentSize < 500 ? " (suspiciously small)" : ""}`,
  });

  // Check 7: blog/index listing contains the published URL (optional but required
  // by the blog completion gate). This catches stale deploys where the commit was
  // pushed but production did not actually expose the new page.
  if (requireIndexPresence) {
    const fetchedIndexUrl = cacheBust ? withCacheBust(indexUrl) : indexUrl;
    const indexResult = await fetchText(fetchedIndexUrl);
    const indexPassed = indexResult.status === 200 && containsUrlReference(indexResult.body, canonicalUrl);
    checks.push({
      check: "index_page_contains_url",
      passed: indexPassed,
      detail: indexResult.error
        ? `Index fetch error: ${indexResult.error}`
        : `Index status ${indexResult.status}, contains ${canonicalUrl}: ${indexPassed}`,
      url: indexUrl,
      http_status: indexResult.status,
      response_time_ms: indexResult.responseTimeMs,
    });
  }

  // Check 8: sitemap contains the published URL (optional but required by the blog
  // completion gate). A live 404 must never be accepted just because origin/main
  // moved; sitemap/index evidence is recorded alongside the HTTP verdict.
  if (requireSitemapPresence) {
    const fetchedSitemapUrl = cacheBust ? withCacheBust(sitemapUrl) : sitemapUrl;
    const sitemapResult = await fetchText(fetchedSitemapUrl);
    const sitemapPassed = sitemapResult.status === 200 && containsUrlReference(sitemapResult.body, canonicalUrl);
    checks.push({
      check: "sitemap_contains_url",
      passed: sitemapPassed,
      detail: sitemapResult.error
        ? `Sitemap fetch error: ${sitemapResult.error}`
        : `Sitemap status ${sitemapResult.status}, contains ${canonicalUrl}: ${sitemapPassed}`,
      url: sitemapUrl,
      http_status: sitemapResult.status,
      response_time_ms: sitemapResult.responseTimeMs,
    });
  }

  // Check 9: Serper live check (optional)
  if (keyword && domain) {
    try {
      const { loadToolEnv } = require("../lib/env");
      const { serperSearch } = require("../lib/serper");
      const config = loadToolEnv();
      const serp = await serperSearch(config, { q: keyword, num: 100 });
      const organic = serp.organic || [];
      const found = organic.find((r) => r.link && r.link.includes(domain));
      checks.push({
        check: "serper_live_check",
        passed: Boolean(found),
        detail: found
          ? `Domain "${domain}" found at position ${found.position} for "${keyword}"`
          : `Domain "${domain}" NOT found in top ${organic.length} results for "${keyword}"`,
      });
    } catch (serperError) {
      checks.push({
        check: "serper_live_check",
        passed: false,
        detail: `Serper check failed: ${serperError.message}`,
      });
    }
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 3. Overall result Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const allPassed = checks.every((c) => c.passed);
  const validationStatus = allPassed ? "passed" : "failed";

  const deploymentContext = args.db && deploymentId
    ? loadDeploymentContext(args.db, deploymentId, now)
    : null;
  const productionVisibility = classifyProductionVisibility({
    allPassed,
    httpStatus,
    fetchError,
    deploymentContext,
    deployWindowMinutes,
  });

  const report = {
    ok: allPassed,
    generated_at: now,
    tool: "validate_live_deployment",
    deployment_id: deploymentId,
    task_id: taskId,
    url,
    fetched_url: fetchedUrl,
    canonical_url: canonicalUrl,
    http_status: httpStatus,
    response_headers: responseHeaders,
    response_time_ms: responseTimeMs,
    validation_status: validationStatus,
    deployment_context: deploymentContext,
    production_visibility: productionVisibility,
    checks,
  };

  // Ã¢â€â‚¬Ã¢â€â‚¬ 4. SQLite recording Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (args.db && deploymentId) {
    const db = openStateDb(args.db);
    const ts = nowIso();
    db.exec("BEGIN IMMEDIATE TRANSACTION");
    try {
      db.prepare(
        "UPDATE deployments SET validation_status = ? WHERE deployment_id = ?",
      ).run(validationStatus, deploymentId);

      const eventType = allPassed
        ? "deployment_validated"
        : "deployment_validation_failed";
      const payload = {
        deployment_id: deploymentId,
        task_id: taskId,
        url,
        validation_status: validationStatus,
        deployment_context: deploymentContext,
        production_visibility: productionVisibility,
        checks,
      };

      db.prepare(
        `
          INSERT INTO events (
            event_id, event_type, task_id, resource_type, resource_id,
            old_value, new_value, source, agent_name, created_at, metadata_json
          ) VALUES (?, ?, ?, ?, ?, ?, ?, 'deployment_validator', 'Deployment Validator', ?, ?)
        `,
      ).run(
        makeId("EVT"),
        eventType,
        taskId,
        "deployment",
        deploymentId,
        null,
        validationStatus,
        ts,
        JSON.stringify(payload),
      );

      db.prepare(
        `
          INSERT INTO outbox_jobs (
            outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at
          ) VALUES (?, ?, ?, ?, ?, 'pending', ?)
        `,
      ).run(
        makeId("OUT"),
        "update_obsidian_deployment_note",
        "deployment",
        deploymentId,
        JSON.stringify(payload),
        ts,
      );

      db.exec("COMMIT");
      report.db_recorded = true;
    } catch (dbError) {
      db.exec("ROLLBACK");
      report.db_recorded = false;
      report.db_error = dbError.message;
    }
    db.close();
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 5. Output Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  const outPath =
    args.out ||
    path.join(
      process.cwd(),
      "tools",
      "out",
      "validation",
      `validation-${compactDateTime()}.json`,
    );
  writeJson(outPath, report);

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `Validation ${validationStatus}: ${url} (${checks.filter((c) => c.passed).length}/${checks.length} checks passed)`,
    );
    for (const c of checks) {
      console.log(`  ${c.passed ? "Ã¢Å“â€œ" : "Ã¢Å“â€”"} ${c.check}: ${c.detail}`);
    }
    console.log(`Report: ${outPath}`);
  }

  // Ã¢â€â‚¬Ã¢â€â‚¬ 6. Rollback on failure Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬Ã¢â€â‚¬
  if (!allPassed && args["rollback-on-failure"] && deploymentId) {
    console.log("Validation failed Ã¢â‚¬â€ triggering rollbackÃ¢â‚¬Â¦");
    const { execFileSync } = require("node:child_process");
    const rollbackScript = path.join(__dirname, "deploy-rollback.js");
    const rollbackArgs = [rollbackScript, "--deployment-id", deploymentId];
    if (args.db) rollbackArgs.push("--db", String(args.db));
    if (siteRoot) rollbackArgs.push("--site-root", siteRoot);
    rollbackArgs.push("--apply", "--json");
    try {
      const output = execFileSync(process.execPath, rollbackArgs, {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
      });
      console.log("Rollback output:", output);
    } catch (rollbackError) {
      console.error("Rollback failed:", rollbackError.message);
    }
  }

  if (!allPassed) process.exitCode = 1;
}

function printHelp() {
  console.log(`
Usage:
  node tools/validate_live_deployment.js --url https://example.com/ --deployment-id DEP-...

Options:
  --url url                 Live URL to validate (required).
  --deployment-id id        Deployment record ID.
  --db path                 SQLite DB path.
  --site-root path          Site root directory for file checks.
  --task id                 Related task ID.
  --domain domain           Domain to look for in Serper results.
  --keyword keyword         Keyword for Serper SERP rank check.
  --require-index           Require the blog/index page to contain --url.
  --index-url url           Index/listing URL to check (default: origin + /blog/ for blog URLs).
  --require-sitemap         Require sitemap.xml to contain --url.
  --sitemap-url url         Sitemap URL to check (default: origin + /sitemap.xml).
  --cache-bust              Append a cache-busting query parameter to HTTP checks.
  --deploy-window-minutes N  Minutes after deployment start before a 404 is persistent stale-production (default: 30).
  --preview                 Validate preview URL instead.
  --rollback-on-failure     Spawn deploy-rollback.js on validation failure.
  --out path                JSON output path.
  --json                    Print full JSON to stdout.
  --help                    Show this help.

Checks performed:
  1. HTTP health (status 200, response time)
  2. HTML title present
  3. Meta description present
  4. Canonical tag present
  5. No accidental noindex
  6. Content size (>= 500 bytes)
  7. Index/listing page contains URL (if --require-index)
  8. Sitemap contains URL (if --require-sitemap)
  9. Serper live check (if --keyword and --domain provided)
`);
}

async function fetchText(url) {
  const startMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);
  try {
    const response = await fetch(url, { redirect: "follow", signal: controller.signal });
    return {
      status: response.status,
      body: await response.text(),
      headers: headersObject(response.headers),
      responseTimeMs: Date.now() - startMs,
      error: null,
    };
  } catch (error) {
    return {
      status: 0,
      body: "",
      headers: {},
      responseTimeMs: Date.now() - startMs,
      error: error.message,
    };
  } finally {
    clearTimeout(timeout);
  }
}

function headersObject(headers) {
  const out = {};
  if (!headers || typeof headers.forEach !== "function") return out;
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function stripQueryAndHash(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.search = "";
    parsed.hash = "";
    return parsed.toString().replace(/\/$/, "");
  } catch {
    return String(rawUrl || "").split("#")[0].split("?")[0].replace(/\/$/, "");
  }
}

function defaultIndexUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    parsed.search = "";
    parsed.hash = "";
    if (parsed.pathname.startsWith("/blog/")) {
      parsed.pathname = "/blog/";
    } else if (parsed.pathname.startsWith("/services/")) {
      parsed.pathname = "/services";
    } else {
      parsed.pathname = "/";
    }
    return parsed.toString();
  } catch {
    return "";
  }
}

function defaultSitemapUrl(targetUrl) {
  try {
    const parsed = new URL(targetUrl);
    parsed.search = "";
    parsed.hash = "";
    parsed.pathname = "/sitemap.xml";
    return parsed.toString();
  } catch {
    return "";
  }
}

function withCacheBust(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.set("sbseo_validation_ts", String(Date.now()));
    return parsed.toString();
  } catch {
    return rawUrl;
  }
}

function containsUrlReference(body, targetUrl) {
  if (!body || !targetUrl) return false;
  const needles = new Set([targetUrl]);
  try {
    const parsed = new URL(targetUrl);
    needles.add(parsed.pathname);
    needles.add(`${parsed.origin}${parsed.pathname}`.replace(/\/$/, ""));
    needles.add(`${parsed.origin}${parsed.pathname}/`);
  } catch {
    // Fall through with the raw target string.
  }
  for (const needle of needles) {
    if (needle && body.includes(needle)) return true;
  }
  return false;
}

function loadDeploymentContext(dbPath, deploymentId, now) {
  let db;
  try {
    db = openStateDb(dbPath);
    const row = db.prepare(
      'SELECT deployment_id, task_id, branch_name, commit_sha, deployment_type, cloudflare_deployment_id, production_url, status, started_at, finished_at, validation_status, metadata_json FROM deployments WHERE deployment_id = ?'
    ).get(deploymentId);
    if (!row) {
      return { deployment_id: deploymentId, found: false };
    }
    const ageMinutes = minutesBetween(row.started_at, now);
    return {
      found: true,
      deployment_id: row.deployment_id,
      task_id: row.task_id || null,
      branch_name: row.branch_name || null,
      commit_sha: row.commit_sha || null,
      deployment_type: row.deployment_type || null,
      cloudflare_deployment_id: row.cloudflare_deployment_id || null,
      production_url: row.production_url || null,
      status: row.status || null,
      started_at: row.started_at || null,
      finished_at: row.finished_at || null,
      validation_status: row.validation_status || null,
      age_minutes: ageMinutes,
      has_cloudflare_status_path: Boolean(row.cloudflare_deployment_id || row.production_url),
    };
  } catch (error) {
    return { deployment_id: deploymentId, found: false, error: error.message };
  } finally {
    if (db) db.close();
  }
}

function classifyProductionVisibility({ allPassed, httpStatus, fetchError, deploymentContext, deployWindowMinutes }) {
  if (allPassed) {
    return {
      status: 'live_verified',
      reason: 'Production URL returned HTTP 200 and all requested validation checks passed.',
      deploy_window_minutes: deployWindowMinutes,
      human_action: null,
    };
  }

  const deploymentAge = deploymentContext && Number.isFinite(deploymentContext.age_minutes)
    ? deploymentContext.age_minutes
    : null;
  const afterWindow = deploymentAge !== null && deploymentAge >= deployWindowMinutes;
  let status = 'validation_failed';
  let reason = fetchError ? `Production fetch failed: ${fetchError}` : `Production validation failed with HTTP ${httpStatus}.`;

  if (httpStatus === 404) {
    status = afterWindow ? 'persistent_stale_production' : 'auto_deploy_delay';
    reason = afterWindow
      ? `Live clean URL is still HTTP 404 ${deploymentAge}m after the deployment started, beyond the ${deployWindowMinutes}m deploy window.`
      : deploymentAge === null
        ? 'Live clean URL is HTTP 404, but deployment age is unknown; cannot distinguish deploy delay from persistent stale production.'
        : `Live clean URL is HTTP 404 ${deploymentAge}m after deployment start, still inside the ${deployWindowMinutes}m deploy window.`;
  }

  const mappingMissing = deploymentContext
    && deploymentContext.found
    && !deploymentContext.has_cloudflare_status_path;
  const humanAction = mappingMissing
    ? 'Cloudflare deployment status/project mapping is missing for this deployment. Verify Cloudflare credentials/account access, set CLOUDFLARE_PROJECT_NAME to the actual Pages project for example.com, or expose a deploy hook/status path; do not complete the task while the live clean URL remains 404 after the deploy window.'
    : status === 'persistent_stale_production'
      ? 'Reopen or retry the task and verify Cloudflare Pages production deployment; do not leave the task completed while the live clean URL remains 404 after the deploy window.'
      : null;

  return {
    status,
    reason,
    deploy_window_minutes: deployWindowMinutes,
    deployment_age_minutes: deploymentAge,
    cloudflare_status_path_present: deploymentContext ? deploymentContext.has_cloudflare_status_path : null,
    human_action: humanAction,
  };
}

function minutesBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  const start = Date.parse(startIso);
  const end = Date.parse(endIso);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.round((end - start) / 60000));
}


if (require.main === module) {
  main().catch(exitWithError);
}

module.exports = main;
