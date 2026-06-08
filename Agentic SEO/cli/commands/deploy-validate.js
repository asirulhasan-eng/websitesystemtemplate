#!/usr/bin/env node
const path = require("node:path");
const fs = require("node:fs");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso, compactDateTime } = require("../lib/dates");
const { writeJson } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");

// ---------------------------------------------------------------------------
// Â§9 Module 4 â€” Live Deployment Validator
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
  const now = nowIso();

  // â”€â”€ 1. HTTP fetch â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const checks = [];
  let responseBody = "";
  let fetchError = null;
  let responseTimeMs = 0;
  let httpStatus = 0;

  const startMs = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  try {
    const response = await fetch(url, {
      redirect: "follow",
      signal: controller.signal,
    });
    httpStatus = response.status;
    responseBody = await response.text();
    responseTimeMs = Date.now() - startMs;
  } catch (error) {
    fetchError = error.message;
    responseTimeMs = Date.now() - startMs;
  } finally {
    clearTimeout(timeout);
  }

  // â”€â”€ 2. Run validation checks â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  // Check 1: HTTP health â€” status 200
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
      ? `Description: "${metaDescContent.slice(0, 80)}â€¦"`
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

  // Check 7: Serper live check (optional)
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

  // â”€â”€ 3. Overall result â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  const allPassed = checks.every((c) => c.passed);
  const validationStatus = allPassed ? "passed" : "failed";

  const report = {
    ok: allPassed,
    generated_at: now,
    tool: "validate_live_deployment",
    deployment_id: deploymentId,
    task_id: taskId,
    url,
    http_status: httpStatus,
    response_time_ms: responseTimeMs,
    validation_status: validationStatus,
    checks,
  };

  // â”€â”€ 4. SQLite recording â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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

  // â”€â”€ 5. Output â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
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
      console.log(`  ${c.passed ? "âœ“" : "âœ—"} ${c.check}: ${c.detail}`);
    }
    console.log(`Report: ${outPath}`);
  }

  // â”€â”€ 6. Rollback on failure â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
  if (!allPassed && args["rollback-on-failure"] && deploymentId) {
    console.log("Validation failed â€” triggering rollbackâ€¦");
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
  node tools/validate_live_deployment.js --url https://{{DOMAIN}}/ --deployment-id DEP-...

Options:
  --url url                 Live URL to validate (required).
  --deployment-id id        Deployment record ID.
  --db path                 SQLite DB path.
  --site-root path          Site root directory for file checks.
  --task id                 Related task ID.
  --domain domain           Domain to look for in Serper results.
  --keyword keyword         Keyword for Serper SERP rank check.
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
  7. Serper live check (if --keyword and --domain provided)
`);
}


if (require.main === module) {
  main().catch(exitWithError);
}

module.exports = main;
