function toDateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function daysAgo(days) {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - Number(days));
  return toDateOnly(date);
}

function addDays(dateText, days) {
  const date = new Date(`${dateText}T00:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + Number(days));
  return toDateOnly(date);
}

function nowIso() {
  return new Date().toISOString();
}

// Full ISO timestamp `days` from now (UTC). Used to schedule deferred follow-up
// tasks (e.g. re-evaluate rankings 14 days after a page optimization deploys).
function nowPlusDaysIso(days, from = new Date()) {
  const date = new Date(from.getTime());
  date.setUTCDate(date.getUTCDate() + Number(days));
  return date.toISOString();
}

function compactDateTime(date = new Date()) {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

function localDateOnly(date = new Date(), timeZone = process.env.SEO_AGENT_TIMEZONE || "{{TIMEZONE}}") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${lookup.year}-${lookup.month}-${lookup.day}`;
}

// Calendar parts in the configured local timezone. Used by the intelligence
// pipeline to date-stamp report folders/files and to evaluate weekday/monthly
// cadence rules consistently with how the crons fire ({{TIMEZONE_ABBR}}, not UTC).
function localCalendar(date = new Date(), timeZone = process.env.SEO_AGENT_TIMEZONE || "{{TIMEZONE}}") {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    weekday: "short",
  }).formatToParts(date);
  const lookup = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  // Intl hour can be "24" at midnight in some engines; normalize to "00".
  const hour = lookup.hour === "24" ? "00" : lookup.hour;
  const weekdayMap = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return {
    date: `${lookup.year}-${lookup.month}-${lookup.day}`,
    hhmm: `${hour}${lookup.minute}`,
    weekday: weekdayMap[lookup.weekday] || null,
    day: Number(lookup.day),
    month: Number(lookup.month),
    year: Number(lookup.year),
  };
}

module.exports = {
  toDateOnly,
  daysAgo,
  addDays,
  nowIso,
  nowPlusDaysIso,
  compactDateTime,
  localDateOnly,
  localCalendar,
};
