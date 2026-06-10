// Template repo: {{TIMEZONE}} is unfilled; makeId()->localDateOnly() needs a real
// IANA zone. Match the rest of the suite and pin UTC.
process.env.SEO_AGENT_TIMEZONE = process.env.SEO_AGENT_TIMEZONE || "UTC";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const {
  DEFAULTS,
  loadOutcomeConfig,
  evaluateOutcome,
  planConfirmationStep,
  decideRemediation,
} = require("../cli/lib/outcome_loop");
const { leverForType } = require("../cli/lib/experiments");
const { openStateDb, makeId } = require("../cli/lib/state_db");
const { readClicksWindow, captureBaselineClicks, createFollowupTask, evaluateRankingDeltas } = require("../cli/lib/followups");
const { nowIso, nowPlusDaysIso } = require("../cli/lib/dates");

const CFG = DEFAULTS; // deterministic config, independent of guardrails.json

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-outcome-"));
  return openStateDb(path.join(dir, "state.db"));
}

function insertSnapshot(db, page, clicks, capturedAt) {
  db.prepare(
    "INSERT INTO gsc_snapshots (snapshot_id, query, page, clicks, impressions, ctr, position, captured_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(makeId("GSC"), "kw", page, clicks, clicks * 10, 0.1, 5, capturedAt);
}

// ── evaluateOutcome: clicks primary ──────────────────────────────────────────
test("evaluateOutcome flags a regression when clicks fall past the drop ratio", () => {
  const res = evaluateOutcome({ baselineClicks: 100, currentClicks: 50, positionEval: { regressed: false }, config: CFG });
  assert.strictEqual(res.regressed, true);
  assert.strictEqual(res.primary_signal, "clicks");
  assert.strictEqual(res.click_delta, -50);
});

test("evaluateOutcome reports improved / stable on clicks", () => {
  assert.strictEqual(evaluateOutcome({ baselineClicks: 100, currentClicks: 130, positionEval: {}, config: CFG }).outcome, "improved");
  assert.strictEqual(evaluateOutcome({ baselineClicks: 100, currentClicks: 95, positionEval: {}, config: CFG }).outcome, "stable");
});

test("evaluateOutcome treats no current data as zero clicks (full regression)", () => {
  const res = evaluateOutcome({ baselineClicks: 40, currentClicks: null, positionEval: {}, config: CFG });
  assert.strictEqual(res.regressed, true);
  assert.strictEqual(res.current_clicks, 0);
});

// ── evaluateOutcome: position fallback for low-traffic pages ──────────────────
test("evaluateOutcome falls back to SERP position when baseline clicks are below the floor", () => {
  const positionEval = evaluateRankingDeltas({ kw: 5 }, { kw: 12 }, { dropThreshold: 3 }); // slipped 7
  const res = evaluateOutcome({ baselineClicks: 2, currentClicks: 1, positionEval, config: CFG });
  assert.strictEqual(res.primary_signal, "position_fallback");
  assert.strictEqual(res.regressed, true);
});

test("evaluateOutcome with no clicks baseline uses position and reports stable when steady", () => {
  const positionEval = evaluateRankingDeltas({ kw: 5 }, { kw: 5 }, { dropThreshold: 3 });
  const res = evaluateOutcome({ baselineClicks: null, currentClicks: null, positionEval, config: CFG });
  assert.strictEqual(res.primary_signal, "position_fallback");
  assert.strictEqual(res.regressed, false);
  assert.strictEqual(res.outcome, "stable");
});

// ── decideRemediation: lever split ───────────────────────────────────────────
test("decideRemediation refreshes content levers and rolls back metadata/link levers", () => {
  assert.strictEqual(decideRemediation("content", CFG), "refresh");
  assert.strictEqual(decideRemediation("title", CFG), "rollback");
  assert.strictEqual(decideRemediation("meta", CFG), "rollback");
  assert.strictEqual(decideRemediation("internal_links", CFG), "rollback");
  assert.strictEqual(decideRemediation(null, CFG), "none");
  // corrective task types carry no lever -> no auto-action
  assert.strictEqual(decideRemediation(leverForType("ranking_recovery"), CFG), "none");
});

test("cwv_fix carries the performance lever and a confirmed regression rolls it back", () => {
  assert.strictEqual(leverForType("cwv_fix"), "performance");
  assert.strictEqual(leverForType("page_speed_fix"), "performance");
  // A bad speed change is a deterministic commit, so the safe remediation is revert —
  // never a content refresh (that would pull the wrong lever).
  assert.strictEqual(decideRemediation("performance", CFG), "rollback");
});

// ── planConfirmationStep: debounce state machine ─────────────────────────────
test("planConfirmationStep: clean reading is success (or recovered after a prior dip)", () => {
  assert.strictEqual(planConfirmationStep({ regressed: false, consecutivePrior: 0, config: CFG }).decision, "success");
  assert.strictEqual(planConfirmationStep({ regressed: false, consecutivePrior: 1, config: CFG }).decision, "recovered");
});

test("planConfirmationStep: a single degraded reading does NOT act — it schedules a watch", () => {
  const step = planConfirmationStep({ regressed: true, consecutivePrior: 0, config: CFG });
  assert.strictEqual(step.decision, "watch");
  assert.strictEqual(step.consecutive, 1);
  assert.strictEqual(step.recheck_in_days, CFG.confirm.recheck_days);
  assert.ok(step.watch_until > nowIso(), "watch_until is in the future");
});

test("planConfirmationStep: the 2nd consecutive degraded reading triggers action", () => {
  const step = planConfirmationStep({ regressed: true, consecutivePrior: 1, config: CFG });
  assert.strictEqual(step.decision, "act");
  assert.strictEqual(step.consecutive, 2);
});

test("planConfirmationStep: degraded but past the watch window is inconclusive (no auto-action)", () => {
  const step = planConfirmationStep({ regressed: true, consecutivePrior: 0, config: CFG, watchUntil: "2000-01-01T00:00:00.000Z" });
  assert.strictEqual(step.decision, "inconclusive");
});

// ── loadOutcomeConfig: defaults + env override ───────────────────────────────
test("loadOutcomeConfig returns defaults and honours env overrides", () => {
  const base = loadOutcomeConfig();
  assert.strictEqual(typeof base.click_drop_ratio, "number");
  assert.strictEqual(base.confirm.required_consecutive_degraded, 2);

  process.env.CLIENT_CLICK_DROP_RATIO = "0.5";
  process.env.CLIENT_RECHECK_DAYS = "3";
  try {
    const over = loadOutcomeConfig();
    assert.strictEqual(over.click_drop_ratio, 0.5);
    assert.strictEqual(over.confirm.recheck_days, 3);
  } finally {
    delete process.env.CLIENT_CLICK_DROP_RATIO;
    delete process.env.CLIENT_RECHECK_DAYS;
  }
});

// ── clicks plumbing: gsc_snapshots reader ────────────────────────────────────
test("readClicksWindow sums clicks for a URL and normalizes trailing slash / .html", () => {
  const db = tempDb();
  const recent = nowPlusDaysIso(-2);
  insertSnapshot(db, "https://example.com/blog/post", 7, recent);
  insertSnapshot(db, "https://example.com/blog/post/", 5, recent); // same page, trailing slash
  insertSnapshot(db, "https://example.com/other", 99, recent);     // different page
  const res = readClicksWindow(db, "https://example.com/blog/post.html", 14);
  assert.strictEqual(res.total, 12);
  assert.strictEqual(res.rows, 2);
  db.close();
});

test("readClicksWindow ignores snapshots older than the window and returns null when none match", () => {
  const db = tempDb();
  insertSnapshot(db, "https://example.com/p", 50, nowPlusDaysIso(-40)); // outside 14d
  assert.strictEqual(readClicksWindow(db, "https://example.com/p", 14).total, null);
  assert.strictEqual(captureBaselineClicks(db, "https://example.com/nope", 14).total, null);
  db.close();
});

// ── depthDelta: monitoring re-checks don't consume the change-depth budget ────
test("createFollowupTask depthDelta:0 preserves parent depth (monitoring re-check)", () => {
  const db = tempDb();
  const parent = { task_id: "TSK-FU", title: "Ranking follow-up", target_url: "https://example.com/x", target_keyword: "kw" };
  const baseSpec = {
    parentTask: parent,
    parentMetadata: { followup_depth: 2 },
    taskType: "ranking_followup",
    riskLevel: "safe",
    source: "executor_followup",
    title: "Ranking re-check: kw",
    targetUrl: "https://example.com/x",
    targetKeyword: "kw",
    scheduledForIso: nowPlusDaysIso(7),
    dedupeByTargetUrl: false,
    evidence: { type: "ranking_followup" },
  };
  const recheck = createFollowupTask(db, { ...baseSpec, depthDelta: 0 });
  assert.strictEqual(recheck.created, true);
  assert.strictEqual(recheck.depth, 2, "re-check stays at the parent's depth");

  const change = createFollowupTask(db, { ...baseSpec, targetUrl: "https://example.com/y", taskType: "content_refresh" });
  assert.strictEqual(change.depth, 3, "a real change step still increments depth by 1");
  db.close();
});
