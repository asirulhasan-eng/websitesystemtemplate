/**
 * intelligence.js â€” Shared logic for the Intelligence Pipeline.
 *
 * The intelligence pipeline decomposes the old monolithic daily work plan into
 * focused analysis modules. Each module gathers fresh data, analyses it with AI
 * judgement, and saves a standardized REPORT (never a task). The daily planner
 * then reads an aggregated summary of those reports and is the sole producer of
 * tasks.
 *
 * This module is data/logic only â€” no AI, no side effects beyond what the
 * commands ask for. It owns:
 *   - the module registry + cadence rules
 *   - cadence evaluation (which modules are "due" this session)
 *   - report id / markdown path conventions
 *   - markdown rendering for a report
 *   - the Brain observation note builder
 *   - summary aggregation across the latest reports
 *
 * See processes/intelligence/ for the per-module playbooks the AI follows, and
 * the architecture doc (Intelligence Pipeline â†’ Daily Planner) for the design.
 */

const crypto = require("node:crypto");
const { compactDateTime, localCalendar, nowIso } = require("./dates");
const {
  MEMORY_FOLDERS,
  memoryNoteRelativePath,
  renderMemoryNoteMarkdown,
} = require("./obsidian_brain");

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Module registry â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
// Cadence rules are evaluated by isModuleDue(). Recognised keys:
//   every_session   â€” run on every planner session (morning + evening)
//   sessions        â€” only run on these sessions (e.g. ['morning'])
//   interval_hours  â€” only run if this many hours have elapsed since last run
//   weekdays        â€” only run on these ISO weekdays (Mon=1 â€¦ Sun=7)
//   monthly_day     â€” only run on this day-of-month
// Gates combine with AND. A module with no positive cadence never auto-runs
// (but can still be forced with `v2 intelligence report` / --modules).

const MODULES = [
  { id: "gsc-performance", name: "GSC Performance Snapshot", cadence: { every_session: true } },
  { id: "threat-detection", name: "Threat Detection", cadence: { every_session: true } },
  { id: "serp-monitor", name: "SERP Monitor", cadence: { sessions: ["morning"] } },
  { id: "task-queue-health", name: "Task Queue Health", cadence: { every_session: true } },
  { id: "content-gap-quick", name: "Content Gap Quick Scan", cadence: { interval_hours: 48 } },
  { id: "competitor-watch", name: "Competitor Watch", cadence: { weekdays: [1], sessions: ["morning"] } },
  { id: "money-keyword-deep", name: "Money Keyword Deep Dive", cadence: { weekdays: [4], sessions: ["morning"] } },
  { id: "new-page-opportunities", name: "New Service Page Suggestions", cadence: { weekdays: [1], sessions: ["morning"] } },
  { id: "internal-linking", name: "Internal Linking Audit", cadence: { monthly_day: 1, sessions: ["morning"] } },
  { id: "tech-health", name: "Technical Health", cadence: { monthly_day: 1, sessions: ["morning"] } },
  { id: "keyword-research", name: "Keyword Research & Discovery", cadence: { weekdays: [2], sessions: ["morning"] } },
];

const MODULE_BY_ID = new Map(MODULES.map((m) => [m.id, m]));

function isKnownModule(moduleId) {
  return MODULE_BY_ID.has(moduleId);
}

function moduleName(moduleId) {
  const m = MODULE_BY_ID.get(moduleId);
  return m ? m.name : moduleId;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Severity â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const SEVERITY_RANK = { normal: 0, warning: 1, critical: 2 };
const SEVERITY_ICON = { normal: "ðŸŸ¢", warning: "âš ï¸", critical: "ðŸ”´" };

function normalizeSeverity(value) {
  const key = String(value || "normal").trim().toLowerCase();
  if (!(key in SEVERITY_RANK)) {
    throw new Error(`Unsupported severity: ${value}. Use one of: ${Object.keys(SEVERITY_RANK).join(", ")}.`);
  }
  return key;
}

const VALID_SESSIONS = new Set(["morning", "evening", "manual"]);
function normalizeSession(value) {
  const key = String(value || "").trim().toLowerCase();
  if (!VALID_SESSIONS.has(key)) {
    throw new Error(`Unsupported session: ${value}. Use one of: ${[...VALID_SESSIONS].join(", ")}.`);
  }
  return key;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Cadence â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Decide whether a module is due to run.
 * @param {object} cadence - cadence rules from the registry
 * @param {object} ctx     - { session, weekday, dayOfMonth, lastRunAt, now }
 * @returns {{ due: boolean, reason: string }}
 */
function isModuleDue(cadence, ctx) {
  const { session, weekday, dayOfMonth, lastRunAt } = ctx;
  const now = ctx.now instanceof Date ? ctx.now.getTime() : Number(ctx.now) || Date.now();

  if (cadence.sessions && !cadence.sessions.includes(session)) {
    return { due: false, reason: `session '${session}' not in [${cadence.sessions.join(",")}]` };
  }
  if (cadence.weekdays && !cadence.weekdays.includes(weekday)) {
    return { due: false, reason: `weekday ${weekday} not in [${cadence.weekdays.join(",")}]` };
  }
  if (cadence.monthly_day && dayOfMonth !== cadence.monthly_day) {
    return { due: false, reason: `day-of-month ${dayOfMonth} != ${cadence.monthly_day}` };
  }
  if (cadence.interval_hours) {
    if (lastRunAt) {
      const elapsedH = (now - Date.parse(lastRunAt)) / 3_600_000;
      if (Number.isFinite(elapsedH) && elapsedH < cadence.interval_hours) {
        return { due: false, reason: `ran ${elapsedH.toFixed(1)}h ago < ${cadence.interval_hours}h interval` };
      }
    }
  }
  return { due: true, reason: cadenceReason(cadence) };
}

function cadenceReason(cadence) {
  if (cadence.every_session) return "every session";
  if (cadence.monthly_day) return `monthly (day ${cadence.monthly_day})`;
  if (cadence.weekdays) return `weekly (weekday ${cadence.weekdays.join(",")})`;
  if (cadence.interval_hours) return `interval ${cadence.interval_hours}h elapsed`;
  if (cadence.sessions) return `session ${cadence.sessions.join(",")}`;
  return "due";
}

/**
 * Compute which modules are due for a given session.
 * @param {object} opts
 * @param {string} opts.session   - 'morning' | 'evening'
 * @param {Date}   [opts.now]
 * @param {object} [opts.lastRuns] - map module_id -> last successful run_at ISO string
 * @returns {{ due: Array, skipped: Array }}
 */
function computeDueModules({ session, now = new Date(), lastRuns = {} } = {}) {
  const cal = localCalendar(now);
  const ctx = {
    session: normalizeSession(session),
    weekday: cal.weekday,
    dayOfMonth: cal.day,
    now: now.getTime(),
  };
  const due = [];
  const skipped = [];
  for (const mod of MODULES) {
    const verdict = isModuleDue(mod.cadence, { ...ctx, lastRunAt: lastRuns[mod.id] || null });
    const entry = { module_id: mod.id, name: mod.name, reason: verdict.reason, last_run_at: lastRuns[mod.id] || null };
    if (verdict.due) due.push(entry);
    else skipped.push(entry);
  }
  return { due, skipped };
}

/**
 * Flag modules whose latest report is older than their cadence expects (stale).
 * Used by the summary so the planner knows when intelligence is missing.
 */
function staleModules({ session, now = new Date(), lastRuns = {} } = {}) {
  const { due } = computeDueModules({ session, now, lastRuns });
  return due
    .filter((m) => !lastRuns[m.module_id])
    .map((m) => ({ module_id: m.module_id, name: m.name, reason: "no report yet (module is due this session)" }));
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Report identity / paths â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function makeReportId(now = new Date()) {
  // RPT-YYYYMMDDHHMMSS-xxxxxx  (matches the architecture doc's report_id shape)
  const stamp = compactDateTime(now).replace(/T/, "").replace(/Z$/, "").slice(0, 14);
  const rand = crypto.randomBytes(3).toString("hex");
  return `RPT-${stamp}-${rand}`;
}

/**
 * Date-first markdown path: cron/intelligence/{YYYY-MM-DD}/{HHMM}-{module_id}.md
 * Date and time are taken in the configured local timezone so folders line up
 * with the session times the planner thinks in ({{TIMEZONE_ABBR}}), not UTC.
 */
function reportMarkdownRelativePath(moduleId, runAt = new Date()) {
  const cal = localCalendar(runAt);
  return `cron/intelligence/${cal.date}/${cal.hhmm}-${moduleId}.md`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Markdown rendering â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function renderReportMarkdown(report) {
  const data = report.data && typeof report.data === "object" ? report.data : {};
  const session = report.session || "manual";
  const severity = normalizeSeverity(report.severity);
  const runAt = report.run_at || nowIso();
  const cal = localCalendar(new Date(runAt));
  const title = `${moduleName(report.module_id)} â€” ${cal.date} ${cap(session)}`;

  const lines = [];
  lines.push("---");
  lines.push(`module: ${report.module_id}`);
  lines.push(`session: ${session}`);
  lines.push(`run_at: ${runAt}`);
  lines.push(`severity: ${severity}`);
  lines.push(`report_id: ${report.id}`);
  lines.push("---");
  lines.push("");
  lines.push(`# ${title}`);
  lines.push("");
  lines.push(`**Severity: ${SEVERITY_ICON[severity]} ${severity.toUpperCase()}**`);
  lines.push("");
  lines.push("## Headline");
  lines.push(report.headline || "(none)");
  lines.push("");

  const opportunities = arr(report.opportunities || data.opportunities);
  lines.push("## Opportunities");
  if (opportunities.length) {
    lines.push("| Type | Keyword | Position | Was | Impr (7d) | Value | Recommendation |");
    lines.push("|------|---------|----------|-----|-----------|-------|----------------|");
    for (const o of opportunities) {
      lines.push(`| ${cell(o.type)} | ${cell(o.keyword)} | ${cell(o.current_position)} | ${cell(o.previous_position)} | ${cell(o.impressions_7d)} | ${cell(o.business_value)} | ${cell(o.recommendation)} |`);
    }
  } else {
    lines.push("_None this run._");
  }
  lines.push("");

  const threats = arr(report.threats || data.threats);
  lines.push("## Threats");
  if (threats.length) {
    lines.push("| Type | Keyword | Position | Was | Severity | Recommendation |");
    lines.push("|------|---------|----------|-----|----------|----------------|");
    for (const t of threats) {
      lines.push(`| ${cell(t.type)} | ${cell(t.keyword)} | ${cell(t.current_position)} | ${cell(t.previous_position)} | ${cell(t.severity)} | ${cell(t.recommendation)} |`);
    }
  } else {
    lines.push("_None this run._");
  }
  lines.push("");

  const observations = arr(report.observations || data.observations);
  lines.push("## Observations");
  if (observations.length) {
    for (const o of observations) lines.push(`- ${typeof o === "string" ? o : cell(o)}`);
  } else {
    lines.push("_None this run._");
  }
  lines.push("");

  const recommendations = arr(report.recommendations || data.recommendations);
  lines.push("## Recommendations");
  if (recommendations.length) {
    let i = 1;
    for (const r of recommendations) {
      if (typeof r === "string") {
        lines.push(`${i}. ${r}`);
      } else {
        const priority = r.priority ? `**[${String(r.priority).toUpperCase()}]** ` : "";
        const evidence = r.evidence ? ` _(evidence: ${r.evidence})_` : "";
        lines.push(`${i}. ${priority}${r.action || ""}${evidence}`);
      }
      i += 1;
    }
  } else {
    lines.push("_None this run._");
  }
  lines.push("");

  const coverage = report.coverage || data.coverage;
  if (coverage) {
    lines.push("## Coverage");
    lines.push(`- Scanned: ${coverage.scanned_count ?? "unknown"}`);
    lines.push(`- Surfaced top: ${coverage.surfaced_top ?? "unknown"}`);
    lines.push(`- Floor applied: ${coverage.floor_applied || "none"}`);
    if (coverage.deprioritized_reason) lines.push(`- Deprioritized: ${coverage.deprioritized_reason}`);
    lines.push("");
  }

  return `${lines.join("\n")}\n`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Brain observation note â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Decide whether a report is noteworthy enough for a Brain observation note,
 * and if so build the {memory_id, relative_path, markdown, ...} payload.
 * Per the obsidian-memory-protocol cardinal rule, the note is an interpretation
 * (reasoning), NOT a data dump â€” raw metrics live in SQLite + the markdown file.
 * @returns {object|null}
 */
function buildBrainObservation(report) {
  const severity = normalizeSeverity(report.severity);
  const opportunities = arr(report.opportunities);
  const threats = arr(report.threats);
  const noteworthy = SEVERITY_RANK[severity] >= SEVERITY_RANK.warning || opportunities.length > 0 || threats.length > 0;
  if (!noteworthy) return null;

  const memoryId = `MEM-${compactDateTime().replace(/T/, "").replace(/Z$/, "").slice(0, 14)}-${crypto.randomBytes(3).toString("hex")}`;
  const session = report.session || "manual";
  const cal = localCalendar(new Date(report.run_at || nowIso()));
  const title = `Intel: ${moduleName(report.module_id)} ${cal.date} ${session} â€” ${report.headline}`.slice(0, 160);

  const bodyLines = [];
  bodyLines.push(`${report.module_id} module â€” ${report.headline}`);
  if (threats.length) {
    bodyLines.push("", "Threats flagged:");
    for (const t of threats.slice(0, 8)) {
      bodyLines.push(`- ${t.keyword || t.type || "signal"}: ${t.previous_position != null && t.current_position != null ? `${t.previous_position}â†’${t.current_position} ` : ""}(${t.severity || severity})`);
    }
  }
  if (opportunities.length) {
    bodyLines.push("", "Opportunities flagged:");
    for (const o of opportunities.slice(0, 8)) {
      bodyLines.push(`- ${o.keyword || o.type || "signal"}${o.business_value ? ` [${o.business_value}]` : ""}: ${o.recommendation || ""}`.trim());
    }
  }
  bodyLines.push("", `Raw metrics: report ${report.id} (SQLite analysis_reports + ${report.markdown_path || "markdown report"}).`);

  const memory = {
    memory_id: memoryId,
    memory_type: "observation",
    title,
    body: bodyLines.join("\n"),
    created_at: report.run_at || nowIso(),
    session: `intelligence-${session}`,
    source: report.module_id,
    tags: ["intelligence", report.module_id, session].filter(Boolean),
    links: [],
  };

  return {
    memory_id: memoryId,
    memory_type: "observation",
    title,
    relative_path: memoryNoteRelativePath(memory),
    markdown: renderMemoryNoteMarkdown(memory),
  };
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ Summary aggregation â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
/**
 * Aggregate the latest report from each module into a single prioritized
 * summary document for the planner. Reports are parsed rows from
 * analysis_reports (report_json already parsed onto `.report`).
 */
function aggregateSummary(reports, { session, staleList = [] } = {}) {
  const sorted = [...reports].sort(
    (a, b) => (SEVERITY_RANK[normalizeSeverity(b.severity)] - SEVERITY_RANK[normalizeSeverity(a.severity)])
      || String(b.run_at).localeCompare(String(a.run_at)),
  );

  const opportunities = [];
  const threats = [];
  const recommendations = [];
  const observations = [];
  const coverageBlocks = [];

  for (const r of sorted) {
    const body = r.report || {};
    for (const o of arr(body.opportunities)) opportunities.push({ module: r.module_id, ...o });
    for (const t of arr(body.threats)) threats.push({ module: r.module_id, ...t });
    for (const rec of arr(body.recommendations)) {
      recommendations.push(typeof rec === "string" ? { module: r.module_id, action: rec } : { module: r.module_id, ...rec });
    }
    for (const ob of arr(body.observations)) observations.push({ module: r.module_id, text: typeof ob === "string" ? ob : JSON.stringify(ob) });
    if (body.coverage) coverageBlocks.push({ module: r.module_id, ...body.coverage });
  }

  const priorityRank = { high: 0, medium: 1, low: 2 };
  recommendations.sort((a, b) => (priorityRank[a.priority] ?? 1) - (priorityRank[b.priority] ?? 1));

  const counts = { critical: 0, warning: 0, normal: 0 };
  for (const r of sorted) counts[normalizeSeverity(r.severity)] += 1;

  return {
    session: session || null,
    generated_at: nowIso(),
    modules_reporting: sorted.length,
    severity_counts: counts,
    overall_severity: sorted.length
      ? Object.keys(SEVERITY_RANK).reverse().find((s) => counts[s] > 0) || "normal"
      : "normal",
    stale_modules: staleList,
    headlines: sorted.map((r) => ({
      module: r.module_id,
      session: r.session,
      run_at: r.run_at,
      severity: normalizeSeverity(r.severity),
      headline: r.headline,
      report_id: r.id,
    })),
    threats,
    opportunities,
    recommendations,
    observations,
    coverage: coverageBlocks.length > 0 ? coverageBlocks : undefined,
  };
}

function renderSummaryMarkdown(summary) {
  const lines = [];
  lines.push(`# Intelligence Summary â€” ${summary.session ? cap(summary.session) : "All"} (${summary.generated_at})`);
  lines.push("");
  lines.push(`**Overall: ${SEVERITY_ICON[summary.overall_severity] || ""} ${String(summary.overall_severity).toUpperCase()}** Â· ${summary.modules_reporting} module report(s) Â· ðŸ”´ ${summary.severity_counts.critical} / âš ï¸ ${summary.severity_counts.warning} / ðŸŸ¢ ${summary.severity_counts.normal}`);
  lines.push("");
  if (summary.stale_modules && summary.stale_modules.length) {
    lines.push("## âš ï¸ Stale / missing intelligence");
    for (const s of summary.stale_modules) lines.push(`- **${s.module_id}** â€” ${s.reason}`);
    lines.push("");
  }
  lines.push("## Module headlines");
  for (const h of summary.headlines) {
    lines.push(`- ${SEVERITY_ICON[h.severity]} **${h.module}** (${h.session}, ${h.run_at}): ${h.headline}`);
  }
  lines.push("");
  if (summary.threats.length) {
    lines.push("## Threats (act first)");
    for (const t of summary.threats) {
      lines.push(`- [${t.module}] **${t.keyword || t.type || "signal"}** ${t.previous_position != null ? `${t.previous_position}â†’${t.current_position} ` : ""}(${t.severity || ""}) â€” ${t.recommendation || ""}`);
    }
    lines.push("");
  }
  if (summary.opportunities.length) {
    lines.push("## Opportunities");
    for (const o of summary.opportunities) {
      lines.push(`- [${o.module}] **${o.keyword || o.type || "signal"}**${o.business_value ? ` [${o.business_value}]` : ""} â€” ${o.recommendation || ""}`);
    }
    lines.push("");
  }
  if (summary.recommendations.length) {
    lines.push("## Recommendations (prioritized)");
    let i = 1;
    for (const r of summary.recommendations) {
      const p = r.priority ? `**[${String(r.priority).toUpperCase()}]** ` : "";
      lines.push(`${i}. ${p}${r.action || ""} _(${r.module}${r.evidence ? `; ${r.evidence}` : ""})_`);
      i += 1;
    }
    lines.push("");
  }
  if (summary.coverage && summary.coverage.length) {
    lines.push("## Coverage (per module)");
    for (const c of summary.coverage) {
      lines.push(`- **${c.module}**: scanned ${c.scanned_count ?? "?"} items, surfaced top ${c.surfaced_top ?? "?"}, floor: ${c.floor_applied || "none"}`);
    }
    lines.push("");
  }
  return `${lines.join("\n")}\n`;
}

// â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ helpers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
function arr(value) {
  return Array.isArray(value) ? value : [];
}
function cell(value) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function cap(value) {
  const s = String(value || "");
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

module.exports = {
  MODULES,
  MODULE_BY_ID,
  MEMORY_FOLDERS,
  SEVERITY_RANK,
  SEVERITY_ICON,
  isKnownModule,
  moduleName,
  normalizeSeverity,
  normalizeSession,
  isModuleDue,
  computeDueModules,
  staleModules,
  makeReportId,
  reportMarkdownRelativePath,
  renderReportMarkdown,
  buildBrainObservation,
  aggregateSummary,
  renderSummaryMarkdown,
};
