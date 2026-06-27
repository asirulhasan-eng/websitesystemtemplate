/**
 * cli.js Ã¢â‚¬â€ Enhanced argument parser and command helpers for v2 CLI
 *
 * Provides:
 * - parseArgs()  Ã¢â‚¬â€ parse CLI arguments into a structured object
 * - requireArg() Ã¢â‚¬â€ get a required argument or throw
 * - numberArg()  Ã¢â‚¬â€ get a numeric argument with default
 * - boolArg()    Ã¢â‚¬â€ get a boolean flag
 * - listArg()    Ã¢â‚¬â€ get a comma-separated list argument
 * - jsonArg()    Ã¢â‚¬â€ parse a JSON argument
 * - printHelp()  Ã¢â‚¬â€ print formatted help text
 * - exitWithError() Ã¢â‚¬â€ print error and exit
 * - resolveDbPath() Ã¢â‚¬â€ resolve the SQLite database path
 */

function parseArgs(argv = process.argv.slice(2)) {
  const args = {};
  const positional = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];

    if (arg === '--') {
      positional.push(...argv.slice(i + 1));
      break;
    }

    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      const eqIndex = key.indexOf('=');

      if (eqIndex !== -1) {
        // --key=value
        args[key.slice(0, eqIndex)] = key.slice(eqIndex + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        // --key value
        args[key] = argv[++i];
      } else {
        // --flag (boolean)
        args[key] = true;
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      // -k value or -f (flag)
      const key = arg.slice(1);
      if (i + 1 < argv.length && !argv[i + 1].startsWith('-')) {
        args[key] = argv[++i];
      } else {
        args[key] = true;
      }
    } else {
      positional.push(arg);
    }
  }

  args._positional = positional;
  return args;
}

function requireArg(args, name, errorMessage) {
  const value = args[name];
  if (value === undefined || value === null || value === '') {
    throw new Error(errorMessage || `Missing required argument: --${name}`);
  }
  return value;
}

function numberArg(args, name, defaultValue = 0) {
  const value = args[name];
  if (value === undefined || value === null) return defaultValue;
  const num = Number(value);
  if (Number.isNaN(num)) return defaultValue;
  return num;
}

function boolArg(args, name, defaultValue = false) {
  const value = args[name];
  if (value === undefined || value === null) return defaultValue;
  if (value === true || value === 'true' || value === '1' || value === 'yes') return true;
  if (value === false || value === 'false' || value === '0' || value === 'no') return false;
  return defaultValue;
}

function listArg(args, name, defaultValue = []) {
  const value = args[name];
  if (!value) return defaultValue;
  if (Array.isArray(value)) return value;
  return String(value).split(',').map(s => s.trim()).filter(Boolean);
}

function jsonArg(args, name, defaultValue = null) {
  const value = args[name];
  if (!value) return defaultValue;
  try {
    return JSON.parse(value);
  } catch {
    throw new Error(`Invalid JSON for --${name}: ${value}`);
  }
}

function resolveDbPath(args) {
  const raw = args.db
    || process.env.WEBSITE_AGENT_DB_PATH
    || process.env.SEO_AGENT_DB
    || '/opt/website-state/website-agent.db';
  // Normalize Windows-style backslashes to forward slashes so the path is
  // always absolute on Linux, even if a cron script or .env uses backslashes.
  return raw.replace(/\\/g, '/');
}

function exitWithError(error) {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ error: message }));
  process.exitCode = 1;
}

function getOutputFormat(args) {
  if (args.csv) return 'csv';
  if (args.table) return 'table';
  return 'json'; // default
}

module.exports = {
  parseArgs,
  requireArg,
  numberArg,
  boolArg,
  listArg,
  jsonArg,
  resolveDbPath,
  exitWithError,
  getOutputFormat,
};
