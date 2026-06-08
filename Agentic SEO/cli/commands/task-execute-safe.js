#!/usr/bin/env node
const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const { parseArgs, requireArg, exitWithError } = require("../lib/cli");
const { nowIso } = require("../lib/dates");
const { writeJson, slugify } = require("../lib/io");
const { openStateDb, makeId } = require("../lib/state_db");
const { LOCK_ORDER, urlToLikelyFile } = require("../lib/tasks");
const git = require("../lib/git");
const { loadBrain, assertAllowedByBrain, logBrainEvent } = require("../lib/obsidian_brain");
const { assertTaskStatus, isCompletedTaskStatus } = require("../lib/statuses");
const { assertTaskExecutionAllowed } = require("../lib/guardrails");
const { resolveSitePath } = require("../lib/site_paths");
const { maybeCreateFollowups, createFollowupTask, evaluateRankingDeltas, domainFromUrl } = require("../lib/followups");

function main() {
  const args = parseArgs();
  if (args.help) {
    printHelp();
    return;
  }

  const db = openStateDb(args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db");
  const taskId = requireArg(args, "task");
  const siteRoot = path.resolve(process.cwd(), args["site-root"] || "D:\\Projects\\{{NICHE}} SEO Agency");
  const task = db.prepare("SELECT * FROM tasks WHERE task_id = ?").get(taskId);
  if (!task) throw new Error(`Task not found: ${taskId}`);
  const brain = loadBrain({ vaultRoot: args["brain-vault"] || args.vault, mode: "execution", autoCompile: args.compile !== false }).brain;
  const brainDecision = assertAllowedByBrain(task, brain);
  if (!brainDecision.allowed) {
    logBrainEvent(db, task, brainDecision, "execute_safe_task");
    throw new Error(`Task ${taskId} blocked by Obsidian Brain rule ${brainDecision.rule_id}: ${brainDecision.reason}`);
  }
  const metadata = safeJson(task.metadata_json);
  const lockTargets = buildLockTargets(task, metadata);
  const output = {
    generated_at: nowIso(),
    tool: "execute_safe_task",
    task_id: taskId,
    site_root: siteRoot,
    dry_run: !args.apply,
    actions: [],
    locks: [],
  };

  assertRepoReady(siteRoot, Boolean(args["allow-dirty"]));

  try {
    output.locks = args["skip-locks"] ? [] : acquireLocks(db, task, lockTargets);

    // A ranking_followup is an executor-scheduled SERP re-check (no file edit), so
    // it is handled here rather than through the deterministic plan/apply path.
    const issueType = metadata.task_type || (metadata.evidence && metadata.evidence.type);
    if (issueType === "ranking_followup") {
      return executeRankingFollowup(db, task, metadata, { args, output });
    }

    const plan = planTask(siteRoot, task, metadata);
    output.actions = plan.actions;

    if (!plan.actions.length) {
      output.status = args.apply ? "skipped" : "no_action";
      output.reason = plan.reason || "No deterministic safe edit found for this task.";
      if (args.apply) {
        updateTaskState(db, task, "skipped", output, "task_execution_no_action");
      } else {
        // Plan-only mode should not make the task terminal. Record the diagnostic
        // event but leave queue state unchanged.
        db.exec("BEGIN IMMEDIATE TRANSACTION");
        try {
          recordTaskEvent(db, taskId, "task_execution_no_action", task.status, task.status, output);
          db.exec("COMMIT");
        } catch (e) {
          db.exec("ROLLBACK");
          console.error("Failed to record no_action event:", e.message);
        }
      }
      return finish(output, args);
    }

    if (args.apply) {
      assertTaskExecutionAllowed(db, task, { checkDailyLimit: Boolean(args.production) });
      if (task.risk_level !== "safe" && !args["allow-semi-safe"]) {
        throw new Error(`Refusing to apply non-safe task ${taskId} without --allow-semi-safe.`);
      }

      const isProduction = Boolean(args.production);
      const branch = isProduction
        ? (args["production-branch"] || git.currentBranch(siteRoot))
        : (args.branch || branchName(task));

      if (!isProduction && (args.branch || args["create-branch"])) {
        git.checkoutNewBranch(siteRoot, branch);
      }

      for (const action of plan.actions) applyAction(siteRoot, action);
      const changedFiles = [...new Set(plan.actions.map((action) => action.file_path).filter(Boolean))];
      output.changed_files = changedFiles;

      if ((args.commit || isProduction) && changedFiles.length > 0) {
        git.add(siteRoot, changedFiles.map((file) => path.relative(siteRoot, file)));
        git.commit(siteRoot, `${taskId}: ${task.title}`, {
          name: args["git-user-name"] || "{{SITE_NAME}} Agent",
          email: args["git-user-email"] || "agent@{{DOMAIN}}",
        });
        output.commit_sha = git.shortHead(siteRoot);
      }

      if ((args.push || isProduction) && changedFiles.length > 0) {
        const pushBranch = git.currentBranch(siteRoot);
        output.push_result = git.push(siteRoot, args.remote || "origin", pushBranch);
      }

      // Lane 1: Safe auto-push to production with deployment tracking
      if (isProduction && changedFiles.length > 0) {
        const deploymentId = recordDeployment(db, task, branch, output.commit_sha);
        output.deployment_id = deploymentId;

        // Wait for Cloudflare deployment if available
        try {
          const waitResult = runTool("deploy-wait.js", [
            "--db", args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db",
            "--state-deployment-id", deploymentId,
            ...(isProduction ? ["--environment", "production"] : ["--branch", branch]),
            "--timeout-seconds", "180",
            "--json",
          ]);
          output.cloudflare_wait = JSON.parse(waitResult);
        } catch (e) {
          console.error("Cloudflare wait skipped:", e.message);
          output.cloudflare_wait = { skipped: true, error: e.message };
        }
        // Only the wait tool confirming ok:true means the build went live.
        // A skipped/timed-out/failed wait must NOT be reported as a successful
        // production deploy â€” flag it for human review instead.
        output.deploy_verified = output.cloudflare_wait && output.cloudflare_wait.ok === true;

        // Run live validation if requested
        if (args["validate-live"] && task.target_url) {
          try {
            const validateResult = runTool("deploy-validate.js", [
              "--db", args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db",
              "--deployment-id", deploymentId,
              "--url", task.target_url,
              "--task", taskId,
              "--json",
              ...(args["rollback-on-failure"] ? ["--rollback-on-failure", "--site-root", siteRoot] : []),
            ]);
            output.validation = JSON.parse(validateResult);
          } catch (e) {
            console.error("Live validation failed:", e.message);
            output.validation = { passed: false, error: e.message };
          }
        }

        const productionStatus = output.deploy_verified ? "deployed_to_production" : "needs_review";
        if (!output.deploy_verified) {
          output.deploy_warning = "Cloudflare deployment was not confirmed live (wait skipped, timed out, or failed). Marked needs_review instead of deployed_to_production.";
        }
        updateTaskState(db, task, productionStatus, output);
        output.status = productionStatus;
      } else {
        if (isProduction && changedFiles.length === 0) output.production_deploy_skipped = "No file changes were required for this deterministic safe action.";
        updateTaskState(db, task, args.push ? "preview_pushed" : "executed", output);
        output.status = "executed";
      }

      // Schedule a deferred ranking follow-up once a real, ranking-affecting change
      // is live. Gate on actual file changes and a deployed/executed state so a
      // no-op or unverified deploy never creates a verification task. Never let a
      // follow-up failure fail the underlying task.
      if (changedFiles.length > 0 && ["deployed_to_production", "executed", "preview_pushed"].includes(output.status)) {
        output.followups = maybeCreateFollowups(db, task, metadata, {
          canonicalTaskType: metadata.task_type || (metadata.evidence && metadata.evidence.type) || null,
          domain: args.domain || null,
        });
      }
    } else {
      output.status = "planned";
    }

    finish(output, args);
  } finally {
    if (!args["keep-locks"]) releaseLocks(db, output.locks);
    db.close();
  }
}

// Execute a ranking_followup task: re-check live SERP positions for the tracked
// keywords, compare against the baseline captured when the original change shipped,
// and (on regression) enqueue a recovery task + alert. No file edit is made.
function executeRankingFollowup(db, task, metadata, { args, output }) {
  const evidence = metadata.evidence || {};
  const keywords = (Array.isArray(evidence.keywords) && evidence.keywords.length)
    ? evidence.keywords
    : [task.target_keyword].filter(Boolean);
  const baseline = evidence.baseline_positions && typeof evidence.baseline_positions === "object"
    ? evidence.baseline_positions
    : {};
  const domain = args.domain || domainFromUrl(task.target_url) || null;
  output.tool = "ranking_followup_evaluation";
  output.keywords = keywords;
  output.baseline_positions = baseline;

  if (!keywords.length) {
    output.status = args.apply ? "skipped" : "no_action";
    output.reason = "Ranking follow-up has no keywords to evaluate.";
    if (args.apply) updateTaskState(db, task, "skipped", output, "ranking_followup_no_keywords");
    return finish(output, args);
  }

  if (!args.apply) {
    output.status = "planned";
    output.reason = `Would re-check SERP positions for ${keywords.join(", ")} and compare to baseline.`;
    return finish(output, args);
  }

  // Live SERP re-check; persists to serp_checks so future baselines improve.
  const current = {};
  try {
    const serpArgs = [
      "--keywords", keywords.join(","),
      "--db", args.db || process.env.CLIENT_DB_PATH || process.env.SEO_AGENT_DB || "/opt/client-sqlite/seo-agent.db",
      "--json",
    ];
    if (domain) serpArgs.push("--domain", domain);
    const serpOut = JSON.parse(runTool("serp-check.js", serpArgs));
    output.serp_check = { ok: serpOut.ok, keywords_checked: serpOut.keywords_checked };
    for (const row of serpOut.rows || []) {
      // Treat a missing position as null (unranked), never 0 — Number(null) === 0
      // would otherwise read as rank #0 and hide a regression.
      current[row.keyword] = (row.position === null || row.position === undefined || !Number.isFinite(Number(row.position)))
        ? null
        : Number(row.position);
    }
  } catch (e) {
    output.status = "needs_review";
    output.reason = `SERP re-check failed: ${e.message}`;
    output.serp_check = { ok: false, error: e.message };
    updateTaskState(db, task, "needs_review", output, "ranking_followup_check_failed");
    return finish(output, args);
  }

  output.current_positions = current;
  const evaluation = evaluateRankingDeltas(baseline, current, {});
  output.evaluation = evaluation;

  if (evaluation.regressed) {
    const regressedKeywords = evaluation.regressions.map((r) => r.keyword);
    output.recovery_task = createFollowupTask(db, {
      parentTask: task,
      parentMetadata: metadata,
      taskType: "ranking_recovery",
      riskLevel: "safe",
      priority: 920,
      source: "executor_followup",
      title: `Investigate ranking drop: ${regressedKeywords[0]}`,
      description: `Rankings slipped after a prior optimization. Regressed: ${evaluation.regressions
        .map((r) => `${r.keyword} ${r.baseline}→${r.current === null ? "unranked" : r.current}`)
        .join("; ")}. Diagnose and recover.`,
      targetUrl: task.target_url || null,
      targetFile: task.target_file || null,
      targetKeyword: regressedKeywords[0],
      scheduledForIso: null, // recovery work is not deferred
      dedupeByTargetUrl: true,
      evidence: {
        type: "ranking_recovery",
        keywords: regressedKeywords,
        regressions: evaluation.regressions,
        baseline_positions: baseline,
        current_positions: current,
        parent_followup_task_id: task.task_id,
      },
    });
    enqueueRankingAlert(db, task, evaluation);
    output.alerted = true;
  }

  updateTaskState(db, task, "completed", output, "ranking_followup_evaluated");
  output.status = "completed";
  return finish(output, args);
}

function enqueueRankingAlert(db, task, evaluation) {
  const summary = evaluation.regressions
    .map((r) => `${r.keyword}: ${r.baseline} -> ${r.current === null ? "unranked" : r.current}`)
    .join("; ");
  db.prepare(
    "INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at) VALUES (?, 'send_monitor_alert', 'task', ?, ?, 'pending', ?)",
  ).run(
    makeId("OUT"),
    task.task_id,
    JSON.stringify({
      alert_type: "ranking_regression",
      severity: "warning",
      message: `Ranking regression detected after optimization (task ${task.task_id}): ${summary}`,
      task_id: task.task_id,
      target_url: task.target_url,
      regressions: evaluation.regressions,
    }),
    nowIso(),
  );
}

function planTask(siteRoot, task, metadata) {
  const evidence = metadata.evidence || {};
  const issueType = metadata.task_type === "new_blog_post"
    ? "new_blog_post"
    : (evidence.type || metadata.task_type);
  const targetFile = resolveTargetFile(siteRoot, task, evidence);
  const actions = [];

  if (issueType === "new_blog_post") {
    if (!targetFile) return { actions, reason: "Target file not found: unknown" };
    if (fs.existsSync(targetFile)) {
      return { actions, reason: `New blog target already exists: ${targetFile}` };
    }
    actions.push(newBlogPostAction(siteRoot, targetFile, task, evidence));
    return { actions };
  }

  if (issueType === "duplicate_faqpage_schema") {
    actions.push(...duplicateFaqPageSchemaActions(siteRoot, task, evidence, targetFile));
    if (!actions.length) return { actions, reason: "No duplicate FAQPage structured-data sources found on affected files." };
    return { actions };
  }

  if (!targetFile || !fs.existsSync(targetFile)) {
    return { actions, reason: `Target file not found: ${targetFile || "unknown"}` };
  }

  const html = fs.readFileSync(targetFile, "utf8");
  if (issueType === "missing_title") {
    const title = titleFromTask(task, html);
    actions.push(replaceHeadAction(targetFile, html, `<title>${escapeHtml(title)}</title>`));
  } else if (issueType === "missing_meta_description") {
    const description = descriptionFromTask(task, html);
    actions.push(replaceHeadAction(targetFile, html, `<meta name="description" content="${escapeHtml(description)}">`));
  } else if (issueType === "missing_canonical") {
    const canonical = canonicalFor(task);
    if (canonical) actions.push(replaceHeadAction(targetFile, html, `<link rel="canonical" href="${escapeHtml(canonical)}">`));
  } else if (issueType === "missing_image_alt") {
    const nextHtml = html.replace(/<img\b(?![^>]*\salt\s*=)([^>]*)>/i, '<img alt=""$1>');
    if (nextHtml !== html) actions.push(writeAction(targetFile, html, nextHtml, "Add empty alt attribute to first image missing alt text."));
  } else if (issueType === "protect_ranking_gain") {
    actions.push(serpProtectionSnapshotAction(targetFile, html, task, evidence));
  } else if (issueType === "internal_link_opportunity" || issueType === "internal_linking") {
    const linkActions = internalLinkActions(targetFile, html, evidence);
    if (!linkActions.length) {
      return {
        actions,
        reason: "No applicable internal-link insertion. Needs evidence.links[{anchor_text,to_url}] " +
          "(or evidence.anchor_text + evidence.to_url) with an existing, unlinked mention of the anchor on the page.",
      };
    }
    actions.push(...linkActions);
  } else {
    return { actions, reason: `Task type ${issueType || "unknown"} is not a deterministic safe edit.` };
  }

  return { actions };
}

function replaceHeadAction(filePath, html, insertHtml) {
  const headClose = html.search(/<\/head>/i);
  if (headClose === -1) throw new Error(`Cannot find </head> in ${filePath}`);
  const nextHtml = `${html.slice(0, headClose)}  ${insertHtml}\n${html.slice(headClose)}`;
  return writeAction(filePath, html, nextHtml, `Insert ${insertHtml}`);
}

function newBlogPostAction(siteRoot, targetFile, task, evidence) {
  const brief = evidence.blog_brief || {};
  const h1 = cleanText(brief.proposed_h1 || task.title.replace(/^Create blog:\s*/i, "") || task.target_keyword || "{{NICHE}} SEO Guide");
  const keyword = cleanText(brief.primary_keyword || task.target_keyword || h1);
  const intent = cleanText(brief.search_intent || task.description || `A practical guide for {{NICHE}} companies researching ${keyword}.`);
  const canonical = canonicalFor(task) || `https://{{DOMAIN}}/${path.relative(siteRoot, targetFile).replace(/\\/g, "/").replace(/\.html$/i, "")}`;
  const published = new Date().toISOString().slice(0, 10);
  const title = `${h1} | {{SITE_NAME}}`;
  const description = truncate(`${intent} Practical advice from {{SITE_NAME}}.agency for {{NICHE}} businesses that want more qualified calls.`, 155);
  const outline = Array.isArray(brief.outline) && brief.outline.length ? brief.outline : [
    `What ${keyword} means for {{NICHE}} companies`,
    "Common mistakes to avoid",
    "How to turn the strategy into more booked jobs",
    "A practical owner checklist",
  ];
  const faqs = Array.isArray(brief.faq_targets) && brief.faq_targets.length ? brief.faq_targets : [
    `What should {{AUDIENCE}} know about ${keyword}?`,
    `How long does ${keyword} take to work?`,
    `Can a {{NICHE}} company handle ${keyword} in-house?`,
  ];
  const differentiation = cleanText(brief.differentiation || "This article uses {{AUDIENCE}}-specific examples, owner checklists, and conversion-focused next steps.");
  const competitorSource = cleanText(evidence.competitor_source_url || "");
  const body = renderBlogArticle({ h1, keyword, intent, outline, faqs, differentiation, competitorSource, published });
  const html = renderBlogHtml({ title, description, canonical, h1, body, published });
  return writeAction(targetFile, "", html, `Create new blog post draft for ${JSON.stringify(h1)} from approved content brief.`);
}

function renderBlogHtml({ title, description, canonical, h1, body, published }) {
  const schema = {
    "@context": "https://schema.org",
    "@type": "BlogPosting",
    headline: h1,
    description,
    url: canonical,
    datePublished: published,
    dateModified: published,
    author: { "@type": "Organization", name: "{{SITE_NAME}}.agency", url: "https://{{DOMAIN}}" },
    publisher: {
      "@type": "Organization",
      name: "{{SITE_NAME}}.agency",
      url: "https://{{DOMAIN}}",
      logo: { "@type": "ImageObject", url: "https://{{DOMAIN}}/{{NICHE}}-seo-agency-logo-200.webp" },
    },
    mainEntityOfPage: canonical,
  };
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: "https://{{DOMAIN}}/" },
      { "@type": "ListItem", position: 2, name: "Blog", item: "https://{{DOMAIN}}/blog/" },
      { "@type": "ListItem", position: 3, name: h1, item: canonical },
    ],
  };
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8"/>
<meta content="width=device-width, initial-scale=1.0" name="viewport"/>
<title>${escapeHtml(title)}</title>
<meta content="${escapeHtml(description)}" name="description"/>
<meta content="index, follow" name="robots"/>
<link href="${escapeHtml(canonical)}" rel="canonical"/>
<meta content="${escapeHtml(h1)}" property="og:title"/>
<meta content="${escapeHtml(description)}" property="og:description"/>
<meta content="${escapeHtml(canonical)}" property="og:url"/>
<meta content="article" property="og:type"/>
<meta content="{{SITE_NAME}}.agency" property="og:site_name"/>
<meta content="summary_large_image" name="twitter:card"/>
<link href="../css/main.css" rel="stylesheet"/>
<link href="../css/blog.css" rel="stylesheet"/>
<link href="/css/floating-cta.css?v=1" rel="stylesheet"/>
<link href="/assets/favicon.ico" rel="icon" type="image/x-icon"/>
<script type="application/ld+json">${JSON.stringify(schema)}</script>
<script type="application/ld+json">${JSON.stringify(breadcrumb)}</script>
</head>
<body>
<header class="header" id="header"><div class="header__inner"><a aria-label="{{SITE_NAME}}.agency Home" class="header__logo" href="../"><img alt="{{SITE_NAME}}.agency logo" height="80" src="../{{NICHE}}-seo-agency-logo-150.webp" width="80"/><span class="header__logo-text">{{SITE_NAME}}<span>.agency</span></span></a><nav aria-label="Main navigation" class="nav"><ul class="nav__links"><li><a class="nav__link" href="../">Home</a></li><li><a class="nav__link" href="../services/{{NICHE}}-seo">What We Offer</a></li><li><a class="nav__link" href="../services/{{NICHE}}-seo-process">How We Do It</a></li><li><a class="nav__link" href="../services/pricing">Pricing</a></li><li><a class="nav__link" href="../blog/">Blog</a></li></ul><a class="btn btn--primary btn--sm" href="../services/free-seo-audit">Get Free SEO Audit</a></nav></div></header>
<main>
<article>
<header class="article-header"><div class="container"><div class="breadcrumbs" style="justify-content:center;margin-bottom:var(--space-4);"><a href="../">Home</a> <span>/</span> <a href="./">Blog</a></div><div class="article-header__meta">{{NICHE}} Marketing</div><h1 class="article-header__title">${escapeHtml(h1)}</h1><div class="article-header__author"><span>Published ${escapeHtml(formatDisplayDate(published))}</span> â€¢ <span>Draft for review</span></div></div></header>
<div class="article-layout"><div class="container"><div class="article-container article-content">
${body}
<div class="cta-box" id="bottom-cta"><h2 class="cta-box__title">Want a {{NICHE}} SEO Plan Built Around Real Calls?</h2><p>We will review your site, rankings, local visibility, and lead path, then show you the biggest opportunities to get more booked jobs.</p><a class="btn btn--primary" href="../services/free-seo-audit">Run My Free SEO Audit</a></div>
</div></div></div>
</article>
</main>
<footer class="footer" id="footer"><div class="container"><p>{{SITE_NAME}}.agency helps {{NICHE}} companies rank higher, show up on Google Maps, and turn local searches into calls.</p></div></footer>
<script src="../js/main.js"></script>
<script src="/js/floating-cta.js?v=1" defer></script>
</body>
</html>
`;
}

function renderBlogArticle({ h1, keyword, intent, outline, faqs, differentiation, competitorSource, published }) {
  const intro = `<div class="tldr-box"><div class="tldr-box__label">The Bottom Line for Busy {{AUDIENCE}}</div><ul><li>${escapeHtml(intent)}</li><li>This draft was generated from an approved competitor-gap content brief and should be reviewed before production publishing.</li><li>The goal is to answer the search intent better than generic marketing advice by using {{NICHE}}-specific examples, checklists, and conversion guidance.</li></ul></div>`;
  const sourceNote = competitorSource ? `<p><em>Brief source reviewed: ${escapeHtml(competitorSource)}. This article is written as original {{SITE_NAME}} guidance, not copied competitor content.</em></p>` : "";
  const sections = outline.map((heading, index) => {
    const cleanHeading = cleanText(heading);
    return `<h2>${escapeHtml(cleanHeading)}</h2>\n<p>${escapeHtml(sectionParagraph(cleanHeading, keyword, index))}</p>\n${index === 0 ? `<p>${escapeHtml(differentiation)}</p>` : ""}`;
  }).join("\n");
  const checklist = `<h2>Quick Owner Checklist</h2><ul>${outline.slice(0, 7).map((item) => `<li>${escapeHtml(checklistItem(item, keyword))}</li>`).join("")}</ul>`;
  const faqHtml = `<section class="faq-section" id="faq"><h2>FAQs About ${escapeHtml(keyword)}</h2><div class="faq-accordion">${faqs.map((question) => `<div class="faq-item"><button aria-expanded="false" class="faq-question">${escapeHtml(question)} <svg fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><polyline points="6 9 12 15 18 9"></polyline></svg></button><div class="faq-answer"><div class="faq-answer__inner"><p>${escapeHtml(faqAnswer(question, keyword))}</p></div></div></div>`).join("")}</div></section>`;
  return `${intro}\n<p>${escapeHtml(h1)} is a practical guide for {{NICHE}} company owners who want clearer marketing decisions, stronger local visibility, and more qualified calls.</p>\n${sourceNote}\n${sections}\n${checklist}\n${faqHtml}`;
}

function sectionParagraph(heading, keyword, index) {
  const lower = heading.toLowerCase();
  if (lower.includes("checklist") || lower.includes("action")) return `Use this section as a working checklist. For ${keyword}, the safest path is to inspect the current page, local search signals, tracking, and call path before making expensive changes. Prioritize fixes that can be measured in rankings, calls, booked jobs, and lead quality.`;
  if (lower.includes("gbp") || lower.includes("google") || lower.includes("maps")) return `For {{AUDIENCE}}, Google visibility usually depends on both the website and the Google Business Profile. Check categories, services, reviews, photos, service areas, proximity, and whether the website reinforces the same services and locations.`;
  if (lower.includes("tracking") || lower.includes("call") || lower.includes("lead")) return `The work is only useful if it produces better calls. Connect ${keyword} decisions to call tracking, form tracking, booked-job quality, and page-level reporting so the owner can see which changes actually create revenue.`;
  if (lower.includes("technical") || lower.includes("schema") || lower.includes("speed")) return `Technical SEO supports trust and discovery. A {{NICHE}} site should load quickly on mobile, be indexable, use clean internal links, and include structured data where it helps Google understand services, locations, and FAQs.`;
  if (index === 0) return `${keyword} should be judged by practical business outcomes, not vanity metrics. A {{NICHE}} company needs pages and local signals that match real service demand, build trust quickly, and make it easy for homeowners to call.`;
  return `This step matters because {{NICHE}} searches are local, urgent, and high-trust. The better the page answers the ownerâ€™s real question, the easier it is to earn rankings, calls, and confident follow-up.`;
}

function checklistItem(item, keyword) {
  return `Review ${cleanText(item).toLowerCase()} in relation to ${keyword}, then document the next fix, owner, and expected impact.`;
}

function faqAnswer(question, keyword) {
  const lower = String(question || "").toLowerCase();
  if (lower.includes("how long")) return `Most {{NICHE}} SEO improvements need weeks to months, depending on competition, the starting website, Google Business Profile strength, and how quickly content, technical fixes, and authority signals are improved.`;
  if (lower.includes("cost")) return `Cost depends on market size, competition, page count, tracking needs, and whether the company needs strategy, content, technical fixes, or ad support. Start by fixing the highest-impact gaps first.`;
  if (lower.includes("in-house")) return `Some tasks can be handled in-house if the team has time and clear standards. Competitive markets usually need experienced SEO, content, technical, and tracking support working together.`;
  return `${keyword} works best when it is tied to real {{NICHE}} services, local demand, trustworthy proof, and measurable calls instead of generic website traffic alone.`;
}

function formatDisplayDate(dateValue) {
  const date = new Date(`${dateValue}T00:00:00Z`);
  return date.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

function truncate(value, max) {
  const text = cleanText(value);
  return text.length <= max ? text : `${text.slice(0, max - 1).trim()}â€¦`;
}

function writeAction(filePath, before, after, description) {
  return { type: "write_file", file_path: filePath, description, before_length: before.length, after_length: after.length, after };
}

function duplicateFaqPageSchemaActions(siteRoot, task, evidence, primaryTargetFile) {
  const files = affectedFaqPageFiles(siteRoot, task, evidence, primaryTargetFile);
  const actions = [];
  for (const filePath of files) {
    if (!filePath || !fs.existsSync(filePath)) continue;
    const html = fs.readFileSync(filePath, "utf8");
    const nextHtml = removeDuplicateFaqPageMicrodata(html);
    if (nextHtml !== html) {
      actions.push(writeAction(
        filePath,
        html,
        nextHtml,
        "Remove duplicate FAQPage microdata and keep the canonical JSON-LD FAQPage source.",
      ));
    }
  }
  return actions;
}

function affectedFaqPageFiles(siteRoot, task, evidence, primaryTargetFile) {
  const values = [primaryTargetFile, task.target_file, evidence.file];
  if (Array.isArray(evidence.examples)) {
    for (const example of evidence.examples) values.push(example && (example.file || example.target_file || urlToLikelyFile(example.url, { siteRoot })));
  }
  if (Array.isArray(evidence.affected_urls)) {
    for (const url of evidence.affected_urls) values.push(urlToLikelyFile(url, { siteRoot }));
  }
  const seen = new Set();
  return values
    .filter(Boolean)
    .map((value) => resolveSitePath(siteRoot, value, "FAQPage affected file"))
    .filter((filePath) => {
      if (seen.has(filePath)) return false;
      seen.add(filePath);
      return true;
    });
}

function removeDuplicateFaqPageMicrodata(html) {
  if (!html.includes("itemtype=\"https://schema.org/FAQPage\"") && !html.includes("itemtype='https://schema.org/FAQPage'")) return html;
  if (!/"@type"\s*:\s*"FAQPage"/.test(html)) return html;
  return html
    .replace(/\sitemscope\b/g, "")
    .replace(/\sitemtype=(['"])https:\/\/schema\.org\/(FAQPage|Question|Answer)\1/g, "")
    .replace(/\sitemprop=(['"])(mainEntity|acceptedAnswer|name|text)\1/g, "");
}

// Deterministic internal-link executor. Activates only when the task carries a
// structured link spec; converts an EXISTING, unlinked plain-text mention of the
// anchor on the target page into a link. It never fabricates new prose and never
// touches a paragraph that already contains a link, so it is safe to auto-apply.
function internalLinkActions(targetFile, html, evidence) {
  const specs = normalizeLinkSpecs(evidence);
  let nextHtml = html;
  const applied = [];
  for (const spec of specs) {
    const candidate = insertInternalLink(nextHtml, spec.anchor_text, spec.to_url);
    if (candidate && candidate !== nextHtml) {
      nextHtml = candidate;
      applied.push(spec);
    }
  }
  if (!applied.length || nextHtml === html) return [];
  const summary = applied.map((s) => `"${s.anchor_text}" â†’ ${s.to_url}`).join(", ");
  return [writeAction(targetFile, html, nextHtml, `Add ${applied.length} internal link(s): ${summary}`)];
}

// Accept a few shapes the planner might emit: evidence.links[], a single
// {anchor_text,to_url}, or {anchor,target_url} aliases. Keep only complete specs.
function normalizeLinkSpecs(evidence) {
  const raw = [];
  if (Array.isArray(evidence.links)) raw.push(...evidence.links);
  if (evidence.anchor_text || evidence.anchor || evidence.to_url || evidence.target_url) raw.push(evidence);
  const seen = new Set();
  const specs = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const anchorText = cleanText(item.anchor_text || item.anchor || "");
    const toUrl = cleanText(item.to_url || item.target_url || item.href || "");
    if (!anchorText || !toUrl) continue;
    const key = `${anchorText.toLowerCase()}|${toUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);
    specs.push({ anchor_text: anchorText, to_url: toUrl });
  }
  return specs;
}

// Wrap the first plain-text occurrence of anchorText inside a paragraph that does
// not already contain a link. Returns updated HTML, or null if no safe spot.
function insertInternalLink(html, anchorText, toUrl) {
  const esc = escapeRegExp(anchorText);
  const paragraphRe = /<p\b[^>]*>([\s\S]*?)<\/p>/gi;
  let match;
  while ((match = paragraphRe.exec(html)) !== null) {
    const inner = match[1];
    if (/<a\b/i.test(inner)) continue;                         // already has a link
    const phraseRe = new RegExp(`(^|[^\\w])(${esc})([^\\w]|$)`, "i");
    if (!phraseRe.test(inner)) continue;
    const replacedInner = inner.replace(phraseRe, (full, pre, phrase, post) =>
      `${pre}<a href="${escapeHtml(toUrl)}">${phrase}</a>${post}`);
    const newParagraph = match[0].slice(0, match[0].indexOf(inner)) +
      replacedInner + match[0].slice(match[0].indexOf(inner) + inner.length);
    return html.slice(0, match.index) + newParagraph + html.slice(match.index + match[0].length);
  }
  return null;
}

function serpProtectionSnapshotAction(targetFile, html, task, evidence) {
  const keyword = task.target_keyword || evidence.keyword || "";
  const title = cleanText(firstMatch(html, /<title\b[^>]*>([\s\S]*?)<\/title>/i));
  const metaDescription = cleanText(firstMatch(html, /<meta\b(?=[^>]*\bname=["']description["'])(?=[^>]*\bcontent=["']([^"']*)["'])[^>]*>/i));
  const h1 = cleanText(firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i));
  const bodyText = cleanText(html);
  const keywordRegex = keyword ? new RegExp(escapeRegExp(keyword), "i") : null;
  const checks = {
    title_mentions_keyword: Boolean(keywordRegex && keywordRegex.test(title)),
    meta_mentions_keyword: Boolean(keywordRegex && keywordRegex.test(metaDescription)),
    h1_mentions_keyword: Boolean(keywordRegex && keywordRegex.test(h1)),
    body_mentions_keyword: Boolean(keywordRegex && keywordRegex.test(bodyText)),
  };

  return {
    type: "serp_protection_snapshot",
    target_file: targetFile,
    description: `Protect SERP gain for ${JSON.stringify(keyword)} by recording ranking, competitor, and on-page support evidence.`,
    keyword,
    current_position: evidence.current_position || null,
    current_url: evidence.current_url || task.target_url || null,
    movement_type: evidence.movement_type || null,
    top_competitors: Array.isArray(evidence.top_competitors) ? evidence.top_competitors.slice(0, 10) : [],
    on_page_checks: checks,
  };
}

function applyAction(siteRoot, action) {
  if (action.type === "serp_protection_snapshot") return;
  if (action.type !== "write_file") throw new Error(`Unsupported action: ${action.type}`);
  const filePath = resolveSitePath(siteRoot, action.file_path, "action file");
  fs.writeFileSync(filePath, action.after, "utf8");
}

function resolveTargetFile(siteRoot, task, evidence) {
  const value = evidence.file || task.target_file || urlToLikelyFile(task.target_url, { siteRoot });
  if (!value) return null;
  return resolveSitePath(siteRoot, value, "target file");
}

function titleFromTask(task, html) {
  const h1 = firstMatch(html, /<h1\b[^>]*>([\s\S]*?)<\/h1>/i);
  return cleanText(h1 || task.target_keyword || task.title || "{{SITE_NAME}}");
}

function descriptionFromTask(task, html) {
  const title = titleFromTask(task, html);
  return `${title} from {{SITE_NAME}}. Practical SEO support for {{NICHE}} businesses that want stronger search visibility and more qualified leads.`;
}

function canonicalFor(task) {
  if (task.target_url && /^https?:\/\//i.test(task.target_url)) return task.target_url;
  return null;
}

function buildLockTargets(task, metadata) {
  const locks = metadata.locks && metadata.locks.length ? metadata.locks : [];
  const targets = locks.map((lock) => ({ type: lock.lock_type, resource: lock.resource_id }));
  if (task.target_file) targets.push({ type: "file_lock", resource: task.target_file });
  if (task.target_url) targets.push({ type: "url_lock", resource: task.target_url });
  if (task.target_keyword) targets.push({ type: "keyword_lock", resource: task.target_keyword });
  const seen = new Set();
  return targets.filter((target) => {
    const key = `${target.type}:${target.resource}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return target.type && target.resource;
  });
}

function acquireLocks(db, task, targets) {
  const now = nowIso();
  const acquired = [];
  // Sort by LOCK_ORDER to prevent deadlocks (Â§14)
  targets.sort((a, b) => {
    const ai = LOCK_ORDER.indexOf(a.type);
    const bi = LOCK_ORDER.indexOf(b.type);
    return (ai === -1 ? Infinity : ai) - (bi === -1 ? Infinity : bi);
  });
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    for (const target of targets) {
      const conflict = db
        .prepare("SELECT * FROM locks WHERE status = 'active' AND lock_type = ? AND resource_id = ? AND (expires_at IS NULL OR expires_at > ?) LIMIT 1")
        .get(target.type, target.resource, now);
      if (conflict) throw new Error(`Lock conflict on ${target.type}:${target.resource} held by ${conflict.lock_id}`);
      const lockId = makeId("LOCK");
      db.prepare(
        "INSERT INTO locks (lock_id, lock_type, resource_id, task_id, owner_agent, status, created_at, expires_at, heartbeat_at, reason, metadata_json) VALUES (?, ?, ?, ?, 'Task Executor', 'active', ?, ?, ?, ?, ?)",
      ).run(lockId, target.type, target.resource, task.task_id, now, new Date(Date.now() + 120 * 60000).toISOString(), now, "execute_safe_task", "{}");
      acquired.push({ lock_id: lockId, ...target });
    }
    db.exec("COMMIT");
    return acquired;
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function releaseLocks(db, locks) {
  if (!locks || locks.length === 0) return;
  const now = nowIso();
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    const updateLock = db.prepare('UPDATE locks SET status = ?, released_at = ? WHERE lock_id = ?');
    const insertEvt = db.prepare('INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)');
    for (const lock of locks) {
      updateLock.run('released', now, lock.lock_id);
      insertEvt.run(makeId('EVT'), 'lock_released', lock.task_id || null, 'lock', lock.lock_id, 'active', 'released', 'task_executor', 'Safe Task Executor', now, JSON.stringify({lock_type: lock.lock_type, resource_id: lock.resource_id}));
    }
    db.exec('COMMIT');
  } catch (e) { db.exec('ROLLBACK'); throw e; }
}

function updateTaskState(db, task, status, metadata, eventType = "task_executed") {
  assertTaskStatus(status);
  const now = nowIso();
  db.exec("BEGIN IMMEDIATE TRANSACTION");
  try {
    const completedClause = isCompletedTaskStatus(status) ? ", completed_at = ?" : "";
    const updateParams = isCompletedTaskStatus(status)
      ? [status, now, now, task.task_id]
      : [status, now, task.task_id];
    db.prepare(`UPDATE tasks SET status = ?, updated_at = ?${completedClause} WHERE task_id = ?`).run(...updateParams);
    recordTaskEvent(db, task.task_id, eventType, task.status, status, metadata);
    db.prepare(
      "INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at) VALUES (?, 'update_obsidian_task_note', 'task', ?, ?, 'pending', ?)",
    ).run(makeId("OUT"), task.task_id, JSON.stringify(metadata), now);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
}

function recordTaskEvent(db, taskId, eventType, oldValue, newValue, metadata) {
  db.prepare(
    "INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?, ?, ?, 'task', ?, ?, ?, 'task_executor', 'Task Executor', ?, ?)",
  ).run(makeId("EVT"), eventType, taskId, taskId, oldValue, newValue, nowIso(), JSON.stringify(metadata || {}));
}

function assertRepoReady(siteRoot, allowDirty) {
  if (!fs.existsSync(siteRoot)) throw new Error(`Site root not found: ${siteRoot}`);
  if (!git.isGitRepo(siteRoot)) throw new Error(`Site root is not a git repo: ${siteRoot}`);
  if (git.isDirty(siteRoot) && !allowDirty) throw new Error(`Site repo is dirty. Use --allow-dirty only after review.`);
}

function finish(output, args) {
  const outPath = args.out || `tools/out/executor/task-execution-${output.task_id}-${Date.now()}.json`;
  writeJson(outPath, output);
  if (args.json) console.log(JSON.stringify(output, null, 2));
  else {
    console.log(`Task execution ${output.status}: ${outPath}`);
    for (const action of output.actions || []) console.log(`${action.type} | ${action.file_path || action.target_file || "no-file-change"} | ${action.description}`);
  }
}

function recordDeployment(db, task, branch, commitSha) {
  const now = nowIso();
  const deploymentId = makeId('DEP');
  db.exec('BEGIN IMMEDIATE TRANSACTION');
  try {
    db.prepare(
      'INSERT INTO deployments (deployment_id, task_id, branch_name, commit_sha, deployment_type, status, started_at, metadata_json) VALUES (?,?,?,?,?,?,?,?)'
    ).run(deploymentId, task.task_id, branch, commitSha, 'production', 'running', now, JSON.stringify({ task_id: task.task_id, lane: 1, auto_push: true }));
    db.prepare(
      'INSERT INTO events (event_id, event_type, task_id, resource_type, resource_id, old_value, new_value, source, agent_name, created_at, metadata_json) VALUES (?,?,?,?,?,?,?,?,?,?,?)'
    ).run(makeId('EVT'), 'deployment_started', task.task_id, 'deployment', deploymentId, null, 'running', 'task_executor', 'Safe Task Executor', now, JSON.stringify({ lane: 1, branch, commit_sha: commitSha }));
    db.prepare(
      'INSERT INTO outbox_jobs (outbox_id, job_type, entity_type, entity_id, payload_json, status, created_at) VALUES (?,?,?,?,?,?,?)'
    ).run(makeId('OUT'), 'update_obsidian_deployment_note', 'deployment', deploymentId, JSON.stringify({ deployment_id: deploymentId, task_id: task.task_id, branch, commit_sha: commitSha }), 'pending', now);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return deploymentId;
}

function runTool(toolFile, toolArgs) {
  const fullPath = path.join(__dirname, toolFile);
  return execFileSync(process.execPath, [fullPath, ...toolArgs], {
    cwd: process.cwd(), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function branchName(task) {
  return `agent/${task.task_id}-${slugify(task.title || "task").slice(0, 40)}`;
}

function firstMatch(text, pattern) {
  const match = text.match(pattern);
  return match ? match[1] : "";
}

function cleanText(value) {
  return String(value || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function escapeHtml(value) {
  return String(value || "").replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function safeJson(value) {
  try {
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
}

function printHelp() {
  console.log(`
Usage:
  node tools/execute_safe_task.js --task CAND-2026-05-26-ABC --site-root "D:\\Projects\\{{NICHE}} SEO Agency"
  node tools/execute_safe_task.js --task CAND-... --apply --create-branch --commit
  node tools/execute_safe_task.js --task CAND-... --apply --production --validate-live

Options:
  --db path              SQLite DB path.
  --task id              Task ID to execute.
  --site-root path       Website repo path.
  --apply                Apply deterministic safe edits. Without it, plan only.
  --production           Lane 1: Commit to production branch, push, deploy, validate.
  --production-branch x  Production branch name (default: main).
  --validate-live        Run Serper/HTTP live-page validation after production deploy.
  --rollback-on-failure  Auto-revert commit if live validation fails.
  --create-branch        Create/reset an agent branch before edits.
  --branch name          Branch name to use.
  --commit               Commit changed files.
  --git-user-name x      Commit author name.
  --git-user-email x     Commit author email.
  --push                 Push current branch after commit.
  --remote origin        Git remote.
  --allow-dirty          Continue if repo has local changes.
  --allow-semi-safe      Permit apply for semi_safe tasks.
  --domain x             Domain for ranking_followup SERP re-checks (else derived from target URL).
  --skip-locks           Do not acquire locks; caller already owns/release them.
  --keep-locks           Do not release acquired locks.

Follow-ups:
  After a ranking-affecting change deploys, the executor schedules a deferred
  'ranking_followup' task (default +14d, CLIENT_FOLLOWUP_DAYS to override) that
  re-checks SERP positions and enqueues a recovery task if rankings slipped.
`);
}


if (require.main === module) {
  try {
    main();
  } catch (error) {
    exitWithError(error);
  }
}

module.exports = main;
