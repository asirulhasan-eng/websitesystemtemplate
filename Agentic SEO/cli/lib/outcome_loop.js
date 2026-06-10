// outcome_loop.js — business-outcome (clicks-primary) evaluation + remediation policy.
//
// The follow-up / experiment machinery measures whether a deployed change actually
// helped. The owner's success metric is GSC CLICKS (not SERP position): a change
// "failed" only if clicks to the target dropped over the measurement window.
// Position is kept as a secondary diagnostic and as a FALLBACK when the page has too
// few clicks for a reliable clicks signal.
//
// Remediation is DEBOUNCED and LEVER-SPLIT (policy in config/guardrails.json ->
// outcome_loop, env-overridable):
//   - never act on a single dip; require N consecutive degraded checks within a
//     bounded watch window (re-check every recheck_days, up to max_watch_days).
//   - on a CONFIRMED regression: CONTENT-lever changes are auto-refreshed;
//     metadata / link-lever changes are auto-rolled-back; corrective / unknown
//     levers get no auto-action (a recovery task is filed for a human/planner).
//
// Pure module: no DB access and no requires into followups/experiments, so it can be
// shared by both without a require cycle and unit-tested in isolation.

const { loadGuardrails } = require("./guardrails");
const { nowIso, nowPlusDaysIso } = require("./dates");

const DEFAULTS = {
  metric: "clicks",
  click_drop_ratio: 0.30,      // >= 30% fewer clicks vs baseline = degraded
  click_improve_ratio: 0.10,   // >= 10% more clicks = improved
  min_baseline_clicks: 5,      // below this, clicks are too noisy -> use position
  position_drop: 3,            // fallback: position slip that counts as degraded
  window_days: 14,             // clicks comparison window (and first-check timing)
  confirm: {
    required_consecutive_degraded: 2, // never act on a single dip
    recheck_days: 7,                  // cadence once a degradation is first seen
    max_watch_days: 28,               // 4-week ceiling from deploy; then hand to human
  },
  auto_rollback_levers: ["title", "meta", "canonical", "image_alt", "schema", "internal_links", "performance"],
  auto_refresh_levers: ["content"],
};

function numEnv(name) {
  const raw = process.env[name];
  if (raw === undefined || raw === "") return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

// Merge guardrails.outcome_loop over DEFAULTS, then apply env overrides (the
// operator escape hatch — they win over file + defaults). Never throws.
function loadOutcomeConfig(options = {}) {
  let fromFile = {};
  try {
    const loaded = options.guardrails || loadGuardrails(options);
    fromFile = (loaded && loaded.config && loaded.config.outcome_loop) || {};
  } catch {
    fromFile = {};
  }

  const cfg = {
    ...DEFAULTS,
    ...fromFile,
    confirm: { ...DEFAULTS.confirm, ...(fromFile.confirm || {}) },
  };

  const clickDrop = numEnv("CLIENT_CLICK_DROP_RATIO");
  if (clickDrop !== null) cfg.click_drop_ratio = clickDrop;
  const minClicks = numEnv("CLIENT_MIN_BASELINE_CLICKS");
  if (minClicks !== null) cfg.min_baseline_clicks = minClicks;
  const windowDays = numEnv("CLIENT_FOLLOWUP_DAYS");
  if (windowDays !== null) cfg.window_days = windowDays;
  const recheck = numEnv("CLIENT_RECHECK_DAYS");
  if (recheck !== null) cfg.confirm.recheck_days = recheck;
  const consec = numEnv("CLIENT_REQUIRED_CONSECUTIVE_DEGRADED");
  if (consec !== null) cfg.confirm.required_consecutive_degraded = consec;
  const watch = numEnv("CLIENT_MAX_WATCH_DAYS");
  if (watch !== null) cfg.confirm.max_watch_days = watch;

  return cfg;
}

/**
 * Clicks-primary outcome, with a SERP-position fallback for low-traffic pages.
 *
 * @param {object} input
 * @param {number|null} input.baselineClicks total clicks over the window before deploy
 * @param {number|null} input.currentClicks  total clicks over the window at check time
 * @param {object}      input.positionEval   result of followups.evaluateRankingDeltas
 * @param {object}      [input.config]        loadOutcomeConfig() result
 * @returns {{regressed:boolean, improved:boolean, outcome:string, primary_signal:string,
 *            baseline_clicks:?number, current_clicks:?number, click_delta:?number,
 *            click_drop_ratio:?number}}
 */
function evaluateOutcome({ baselineClicks, currentClicks, positionEval, config } = {}) {
  const cfg = config || loadOutcomeConfig();
  const base = toNum(baselineClicks);
  const cur = toNum(currentClicks);
  const pos = positionEval || { regressed: false, improvements: [], rows: [] };

  // Primary path: clicks — but only when the baseline is above the noise floor.
  if (base !== null && base >= cfg.min_baseline_clicks) {
    const curClicks = cur === null ? 0 : cur; // no data at check time = zero clicks
    const dropRatio = (base - curClicks) / base; // positive = clicks fell
    const gainRatio = (curClicks - base) / base;
    let outcome = "stable";
    if (dropRatio >= cfg.click_drop_ratio) outcome = "regressed";
    else if (gainRatio >= (cfg.click_improve_ratio ?? 0.1)) outcome = "improved";
    return {
      regressed: outcome === "regressed",
      improved: outcome === "improved",
      outcome,
      primary_signal: "clicks",
      baseline_clicks: base,
      current_clicks: curClicks,
      click_delta: curClicks - base,
      click_drop_ratio: Math.round(dropRatio * 1000) / 1000,
    };
  }

  // Fallback path: not enough clicks to judge -> use SERP position deltas.
  const regressed = Boolean(pos.regressed);
  const improved = !regressed && Array.isArray(pos.improvements) && pos.improvements.length > 0;
  return {
    regressed,
    improved,
    outcome: regressed ? "regressed" : improved ? "improved" : "stable",
    primary_signal: "position_fallback",
    baseline_clicks: base,
    current_clicks: cur,
    click_delta: base !== null && cur !== null ? cur - base : null,
    click_drop_ratio: null,
  };
}

/**
 * Pure debounce/confirmation step. Decides what a ranking_followup should do given
 * this check's outcome and how many consecutive degraded checks preceded it. Never
 * acts on a single dip: a degradation must be confirmed across
 * `required_consecutive_degraded` checks within the `max_watch_days` window.
 *
 * @returns {{decision:'success'|'recovered'|'act'|'watch'|'inconclusive',
 *            consecutive:number, watch_until?:string, recheck_in_days?:number}}
 *   - success      : not degraded, no prior dip -> close as improved/stable.
 *   - recovered    : not degraded, but a prior dip cleared -> close, no action.
 *   - act          : confirmed (>= required consecutive) -> remediate now.
 *   - watch        : degraded but unconfirmed, within window -> schedule a re-check.
 *   - inconclusive : degraded, unconfirmed, watch window elapsed -> hand to a human.
 */
function planConfirmationStep({ regressed, consecutivePrior = 0, config, now, watchUntil, windowDays } = {}) {
  const cfg = config || loadOutcomeConfig();
  if (!regressed) {
    return { decision: (Number(consecutivePrior) || 0) > 0 ? "recovered" : "success", consecutive: 0 };
  }
  const consecutive = (Number(consecutivePrior) || 0) + 1;
  const required = cfg.confirm.required_consecutive_degraded;
  if (consecutive >= required) return { decision: "act", consecutive };

  const nowVal = now || nowIso();
  const wd = Number(windowDays) > 0 ? Number(windowDays) : cfg.window_days;
  const wu = watchUntil
    || nowPlusDaysIso(Math.max(cfg.confirm.recheck_days, cfg.confirm.max_watch_days - wd), new Date(nowVal));
  if (nowVal < wu) {
    return { decision: "watch", consecutive, watch_until: wu, recheck_in_days: cfg.confirm.recheck_days };
  }
  return { decision: "inconclusive", consecutive, watch_until: wu };
}

// Lever -> remediation. Content is refreshed (re-optimized); reversible metadata /
// link levers are rolled back; corrective / unknown levers get no auto-action.
function decideRemediation(lever, config) {
  const cfg = config || loadOutcomeConfig();
  if (!lever) return "none";
  if ((cfg.auto_refresh_levers || []).includes(lever)) return "refresh";
  if ((cfg.auto_rollback_levers || []).includes(lever)) return "rollback";
  return "none";
}

module.exports = {
  DEFAULTS,
  loadOutcomeConfig,
  evaluateOutcome,
  planConfirmationStep,
  decideRemediation,
};
