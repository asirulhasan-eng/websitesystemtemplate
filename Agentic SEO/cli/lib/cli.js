/**
 * cli.js â€” Enhanced argument parser and command helpers for v2 CLI
 *
 * Provides:
 * - parseArgs()  â€” parse CLI arguments into a structured object
 * - requireArg() â€” get a required argument or throw
 * - numberArg()  â€” get a numeric argument with default
 * - boolArg()    â€” get a boolean flag
 * - listArg()    â€” get a comma-separated list argument
 * - jsonArg()    â€” parse a JSON argument
 * - printHelp()  â€” print formatted help text
 * - exitWithError() â€” print error and exit
 * - resolveDbPath() â€” resolve the SQLite database path
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
  return args.db
    || process.env.CLIENT_DB_PATH
    || process.env.SEO_AGENT_DB
    || '/opt/client-sqlite/seo-agent.db';
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
