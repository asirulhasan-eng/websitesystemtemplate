// This is a template repo where {{TIMEZONE}} is unfilled; makeId()->localDateOnly()
// needs a real IANA zone. Match the regression suite and pin UTC for tests.
process.env.SEO_AGENT_TIMEZONE = process.env.SEO_AGENT_TIMEZONE || "UTC";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

const { openStateDb } = require("../cli/lib/state_db");
const { routeTask } = require("../cli/lib/task_routing");
const {
  leverForType,
  classifyIncomingChange,
  openExperiment,
  closeExperiment,
  findOpenExperiments,
  loadOpenExperimentsByUrl,
} = require("../cli/lib/experiments");
const { maybeCreateFollowups } = require("../cli/lib/followups");
const { nowPlusDaysIso } = require("../cli/lib/dates");

function tempDb() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "client-experiments-"));
  return openStateDb(path.join(dir, "state.db"));
}

const future = () => nowPlusDaysIso(14);
const past = () => nowPlusDaysIso(-1);

// ── lever taxonomy ──────────────────────────────────────────────────────────
test("leverForType maps change types and returns null for corrective/monitoring", () => {
  assert.strictEqual(leverForType("missing_title"), "title");
  assert.strictEqual(leverForType("content_refresh"), "content");
  assert.strictEqual(leverForType("money_page_refresh"), "content");
  assert.strictEqual(leverForType("internal_link_opportunity"), "internal_links");
  assert.strictEqual(leverForType("ranking_recovery"), null);
  assert.strictEqual(leverForType("ranking_followup"), null);
  assert.strictEqual(leverForType("protect_ranking_gain"), null);
  assert.strictEqual(leverForType("monitor"), null);
  assert.strictEqual(leverForType(undefined), null);
});

// ── pure decision ───────────────────────────────────────────────────────────
test("classifyIncomingChange holds a same-lever change inside an open window", () => {
  const open = [{ experiment_id: "EXP-1", lever: "title", status: "open", ended_at: future(), task_id: "TSK-A" }];
  const res = classifyIncomingChange({ taskType: "missing_title", openExperiments: open, taskId: "TSK-B" });
  assert.strictEqual(res.decision, "hold");
  assert.strictEqual(res.reason, "same_lever_window_open");
  assert.deepStrictEqual(res.confounds.map((e) => e.experiment_id), ["EXP-1"]);
});

test("classifyIncomingChange allows + annotates an orthogonal-lever change", () => {
  const open = [{ experiment_id: "EXP-1", lever: "title", status: "open", ended_at: future(), task_id: "TSK-A" }];
  const res = classifyIncomingChange({ taskType: "internal_link_opportunity", openExperiments: open });
  assert.strictEqual(res.decision, "annotate");
  assert.strictEqual(res.reason, "orthogonal_window_open");
});

test("classifyIncomingChange allows when window is expired or empty", () => {
  const expired = [{ experiment_id: "EXP-1", lever: "title", status: "open", ended_at: past(), task_id: "TSK-A" }];
  assert.strictEqual(classifyIncomingChange({ taskType: "missing_title", openExperiments: expired }).decision, "allow");
  assert.strictEqual(classifyIncomingChange({ taskType: "missing_title", openExperiments: [] }).decision, "allow");
});

test("classifyIncomingChange never holds corrective or approval-gated changes", () => {
  const open = [{ experiment_id: "EXP-1", lever: "title", status: "open", ended_at: future() }];
  assert.strictEqual(classifyIncomingChange({ taskType: "ranking_recovery", openExperiments: open }).decision, "allow");
  assert.strictEqual(
    classifyIncomingChange({ taskType: "missing_title", approvalRequired: true, openExperiments: open }).reason,
    "approval_gated_elsewhere",
  );
});

test("classifyIncomingChange ignores an experiment the same task opened", () => {
  const open = [{ experiment_id: "EXP-1", lever: "title", status: "open", ended_at: future(), task_id: "TSK-SELF" }];
  const res = classifyIncomingChange({ taskType: "missing_title", openExperiments: open, taskId: "TSK-SELF" });
  assert.strictEqual(res.decision, "allow");
});

// ── persistence ─────────────────────────────────────────────────────────────
test("openExperiment writes a row + change-log event and findOpenExperiments reads it", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  const res = openExperiment(db, {
    taskType: "missing_title",
    taskId: "TSK-A",
    targetUrl: url,
    targetKeyword: "seo services",
    baseline: { "seo services": 8 },
    windowDays: 14,
  });
  assert.strictEqual(res.opened, true);
  assert.strictEqual(res.lever, "title");

  const open = findOpenExperiments(db, url);
  assert.strictEqual(open.length, 1);
  assert.strictEqual(open[0].lever, "title");
  assert.deepStrictEqual(open[0].baseline, { "seo services": 8 });

  const change = db.prepare("SELECT * FROM events WHERE event_type = 'page_change_event'").all();
  assert.strictEqual(change.length, 1);
  assert.strictEqual(change[0].new_value, "title");
  db.close();
});

test("findOpenExperiments matches URLs that differ only by trailing slash / .html", () => {
  const db = tempDb();
  openExperiment(db, { taskType: "content_refresh", taskId: "T", targetUrl: "https://example.com/blog/post.html", windowDays: 14 });
  assert.strictEqual(findOpenExperiments(db, "https://example.com/blog/post").length, 1);
  assert.strictEqual(findOpenExperiments(db, "https://example.com/blog/post/").length, 1);
  db.close();
});

test("reopening the same url+lever supersedes the prior experiment (clock reset)", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  const first = openExperiment(db, { taskType: "missing_title", taskId: "T1", targetUrl: url, windowDays: 14 });
  const second = openExperiment(db, { taskType: "missing_title", taskId: "T2", targetUrl: url, windowDays: 14 });
  assert.strictEqual(second.superseded, 1);

  const open = findOpenExperiments(db, url);
  assert.strictEqual(open.length, 1, "only the newest window stays open");
  assert.strictEqual(open[0].experiment_id, second.experiment_id);

  const prior = db.prepare("SELECT status FROM experiments WHERE experiment_id = ?").get(first.experiment_id);
  assert.strictEqual(prior.status, "superseded");
  db.close();
});

test("a different lever on the same URL opens a second, independent window", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  openExperiment(db, { taskType: "missing_title", taskId: "T1", targetUrl: url, windowDays: 14 });
  openExperiment(db, { taskType: "internal_link_opportunity", taskId: "T2", targetUrl: url, windowDays: 14 });
  const open = findOpenExperiments(db, url);
  assert.deepStrictEqual(open.map((e) => e.lever).sort(), ["internal_links", "title"]);
  db.close();
});

test("closeExperiment by parent task records the outcome and lifts the window", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  openExperiment(db, { taskType: "missing_title", taskId: "TSK-A", targetUrl: url, windowDays: 14 });
  const res = closeExperiment(db, { parentTaskId: "TSK-A", lever: "title", outcome: "improved", result: { ok: true } });
  assert.strictEqual(res.closed, true);
  assert.strictEqual(res.outcome, "improved");
  assert.strictEqual(findOpenExperiments(db, url).length, 0, "closed window no longer holds");
  const row = db.prepare("SELECT status, outcome FROM experiments WHERE task_id = 'TSK-A'").get();
  assert.strictEqual(row.status, "closed");
  assert.strictEqual(row.outcome, "improved");
  db.close();
});

// ── routing integration ─────────────────────────────────────────────────────
function approvedTask(overrides = {}) {
  return {
    task_id: "TSK-NEW",
    title: "Optimize title tag",
    status: "approved",
    risk_level: "safe",
    priority_score: 700,
    target_url: "https://example.com/services/seo",
    target_keyword: "seo services",
    approval_required: 0,
    metadata_json: JSON.stringify({ task_type: "missing_title" }),
    ...overrides,
  };
}

test("routeTask parks a same-lever task in research_hold while a window is open", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  openExperiment(db, { taskType: "missing_title", taskId: "TSK-OLD", targetUrl: url, windowDays: 14 });
  const byUrl = loadOpenExperimentsByUrl(db);

  const route = routeTask(approvedTask(), {
    open_experiments: byUrl.get(require("../cli/lib/task_routing").normalizeUrlForDedupe(url)) || [],
  });
  assert.strictEqual(route.workflow_bucket, "research_hold");
  assert.ok(route.data_quality_flags.includes("research_hold_same_lever"));
  assert.strictEqual(route.research_window.decision, "hold");
  db.close();
});

test("routeTask lets an orthogonal-lever task run, flagged for annotation", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  openExperiment(db, { taskType: "missing_title", taskId: "TSK-OLD", targetUrl: url, windowDays: 14 });
  const byUrl = loadOpenExperimentsByUrl(db);

  const linkTask = approvedTask({
    task_id: "TSK-LINK",
    title: "Add internal link",
    metadata_json: JSON.stringify({ task_type: "internal_link_opportunity" }),
  });
  const route = routeTask(linkTask, {
    open_experiments: byUrl.get(require("../cli/lib/task_routing").normalizeUrlForDedupe(url)) || [],
  });
  assert.notStrictEqual(route.workflow_bucket, "research_hold");
  assert.ok(route.data_quality_flags.includes("experiment_window_orthogonal"));
  db.close();
});

test("routeTask without open_experiments context is unaffected (backward compatible)", () => {
  const route = routeTask(approvedTask(), {});
  assert.notStrictEqual(route.workflow_bucket, "research_hold");
  assert.strictEqual(route.research_window.decision, "allow");
});

// ── follow-up flow opens the window ──────────────────────────────────────────
test("maybeCreateFollowups opens an experiment alongside the ranking follow-up", () => {
  const db = tempDb();
  const url = "https://example.com/services/seo";
  const parent = {
    task_id: "TSK-PARENT",
    title: "Optimize service page title",
    target_url: url,
    target_keyword: "seo services",
    target_file: "services/seo.html",
  };
  const results = maybeCreateFollowups(db, parent, { task_type: "missing_title", evidence: {} }, {});
  const experiment = results.find((r) => r.kind === "experiment");
  assert.ok(experiment && experiment.opened, "an experiment is opened");
  assert.strictEqual(experiment.lever, "title");
  assert.strictEqual(findOpenExperiments(db, url).length, 1);
  db.close();
});
